const fs = require("fs");
const path = require("path");

class BitReader {
  constructor(buf, offset) {
    this.buf = buf;
    this.offset = offset + 2;
    this.bitsLeft = 8;
    this.bits = buf[offset + 1] || 0;
  }

  bit() {
    if (this.bitsLeft === 0) {
      this.bits = (this.buf[this.offset] || 0) | ((this.buf[this.offset + 1] || 0) << 8);
      this.offset += 2;
      this.bitsLeft = 16;
    }

    const bit = this.bits & 1;
    this.bits >>>= 1;
    this.bitsLeft--;
    return bit;
  }

  bitsValue(count) {
    let value = 0;
    for (let i = 0; i < count; i++) {
      value = (value << 1) | this.bit();
    }
    return value;
  }

  byte() {
    return this.buf[this.offset++] || 0;
  }
}

function copyFromWindow(out, distance, length) {
  if (distance < 0) {
    throw new Error(`Invalid LZ distance: ${distance}`);
  }

  let source = out.length - distance;

  for (let i = 0; i < length; i++) {
    out.push(source + i < 0 ? 0 : (out[source + i] ?? 0));
  }
}

function copyLength(reader) {
  if (reader.bit()) return 2;
  if (reader.bit()) return 3;
  if (reader.bit()) return 4;
  if (reader.bit()) return 5;
  if (!reader.bit()) return reader.byte() + 14;
  return reader.bitsValue(3) + 6;
}

function decodeType0(buf, offset, blockLength, out) {
  if (buf[offset] !== 0) {
    throw new Error(`decodeType0 called on block type ${buf[offset]} at ${offset}`);
  }

  const blockEnd = offset - 2 + blockLength;
  const reader = new BitReader(buf, offset);

  while (reader.offset < blockEnd) {
    if (!reader.bit()) {
      out.push(reader.byte());
      continue;
    }

    if (!reader.bit()) {
      const distance = reader.byte();
      copyFromWindow(out, distance, copyLength(reader));
      continue;
    }

    const distanceOrCommand = (reader.bitsValue(5) << 8) | reader.byte();
    if (distanceOrCommand > 0) {
      if (distanceOrCommand > 1) {
        copyFromWindow(out, distanceOrCommand, copyLength(reader));
        continue;
      }

      const repeatLength = (reader.bit() ? ((reader.bitsValue(4) << 8) | reader.byte()) : reader.bitsValue(4)) + 14;
      const value = reader.byte();
      for (let i = 0; i < repeatLength; i++) out.push(value);
      continue;
    }

    return reader.offset;
  }

  return blockEnd;
}

function copyBytes(out, source, length) {
  for (let i = 0; i < length; i++) out.push(source[i] || 0);
}

function decodePacked(buf, offset, blockLength, out) {
  let consumed = 2;
  while (consumed !== blockLength) {
    const command = buf[offset++] || 0;
    consumed++;

    if (command & 0x80) {
      let distance = ((command & 0x1f) << 8) | (buf[offset++] || 0);
      let length = ((command >>> 5) & 3) + 4;
      consumed++;

      while (consumed !== blockLength && (buf[offset] & 0xe0) === 0x60) {
        length += buf[offset] & 0x1f;
        offset++;
        consumed++;
      }

      copyFromWindow(out, distance, length);
      continue;
    }

    if (command & 0x40) {
      let length;
      if (command & 0x10) {
        length = (((command & 0x0f) << 8) | (buf[offset++] || 0)) + 4;
        consumed++;
      } else {
        length = (command & 0x0f) + 4;
      }

      const value = buf[offset++] || 0;
      consumed++;
      for (let i = 0; i < length; i++) out.push(value);
      continue;
    }

    let length = command & 0x1f;
    if (command & 0x20) {
      length = (length << 8) | (buf[offset++] || 0);
      consumed++;
    }

    copyBytes(out, buf.subarray(offset, offset + length), length);
    offset += length;
    consumed += length;
  }

  return offset;
}

function decodeResource(buf) {
  let offset = 0;
  const out = [];
  const blocks = [];

  while (offset + 3 <= buf.length) {
    const blockStart = offset;
    const blockLength = buf.readUInt16LE(offset);
    offset += 2;
    const blockType = buf[offset];

    if (blockType === 0) {
      offset = decodeType0(buf, offset, blockLength, out);
    } else {
      offset = decodePacked(buf, offset, blockLength, out);
    }

    blocks.push({ start: blockStart, length: blockLength, type: blockType, end: offset });

    const continuation = buf[offset++];
    if (continuation === 0) {
      break;
    }
  }

  return { data: Buffer.from(out), blocks };
}

function literalBlock(data, offset, length, continuation) {
  const flagWords = length > 8 ? Math.ceil((length - 8) / 16) : 0;
  const blockLength = 4 + length + flagWords * 2;
  if (blockLength > 0xffff) {
    throw new Error(`Literal block too large: ${blockLength}`);
  }

  const out = Buffer.alloc(blockLength + 1);
  out.writeUInt16LE(blockLength, 0);
  out[2] = 0;
  out[3] = 0;

  let src = offset;
  let dst = 4;
  let bitCount = 0;
  for (let i = 0; i < length; i++) {
    if (bitCount === 8 || (bitCount > 8 && (bitCount - 8) % 16 === 0)) {
      out[dst++] = 0;
      out[dst++] = 0;
    }
    out[dst++] = data[src++];
    bitCount++;
  }
  out[dst++] = continuation ? 1 : 0;

  if (dst !== out.length) {
    throw new Error(`Literal block size mismatch: ${dst} !== ${out.length}`);
  }

  return out;
}

function maxLiteralChunk(remaining) {
  let n = Math.min(remaining, 0xffff);
  while (n > 0) {
    const flagWords = n > 8 ? Math.ceil((n - 8) / 16) : 0;
    if (4 + n + flagWords * 2 <= 0xffff) return n;
    n--;
  }
  throw new Error("Unable to fit literal chunk");
}

function encodeLiteralResource(data) {
  const input = Buffer.from(data);
  const blocks = [];
  let offset = 0;
  while (offset < input.length) {
    const length = maxLiteralChunk(input.length - offset);
    const hasMore = offset + length < input.length;
    blocks.push(literalBlock(input, offset, length, hasMore));
    offset += length;
  }
  if (!blocks.length) blocks.push(literalBlock(Buffer.alloc(0), 0, 0, false));
  return Buffer.concat(blocks);
}

function printableRatio(buf) {
  if (!buf.length) return 0;
  let good = 0;
  for (const b of buf) {
    if (b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b < 0x7f) || b >= 0x80) good++;
  }
  return good / buf.length;
}

function main() {
  const cmd = process.argv[2] || "decode";
  const input = process.argv[3];
  if (!input) throw new Error("Usage: node tools/zep_decode.js decode <resource> [output]");

  if (cmd === "decode") {
    const buf = fs.readFileSync(input);
    const decoded = decodeResource(buf);
    const outPath = process.argv[4] || path.join("_work", "decoded", path.basename(input) + ".bin");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, decoded.data);
    console.log(`${input} -> ${outPath}`);
    console.log(`decoded=${decoded.data.length}, printableRatio=${printableRatio(decoded.data).toFixed(3)}`);
    console.table(decoded.blocks);
    return;
  }

  if (cmd === "encode-literal") {
    const decoded = fs.readFileSync(input);
    const encoded = encodeLiteralResource(decoded);
    const outPath = process.argv[4] || path.join("_work", "encoded", path.basename(input).replace(/\.bin$/i, ""));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, encoded);
    console.log(`${input} -> ${outPath}`);
    console.log(`decoded=${decoded.length}, encoded=${encoded.length}`);
    return;
  }

  throw new Error(`Unknown command: ${cmd}`);
}

if (require.main === module) {
  main();
}

module.exports = { decodeResource, decodeType0, encodeLiteralResource };
