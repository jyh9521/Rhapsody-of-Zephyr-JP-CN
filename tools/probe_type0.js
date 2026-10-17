const fs = require("fs");

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
    for (let i = 0; i < count; i++) value = (value << 1) | this.bit();
    return value;
  }

  byte() {
    return this.buf[this.offset++] || 0;
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

function main() {
  const input = process.argv[2];
  if (!input) throw new Error("Usage: node tools/probe_type0.js <resource>");

  const buf = fs.readFileSync(input);
  const blockLength = buf.readUInt16LE(0);
  const blockType = buf[2];
  const blockEnd = blockLength;
  const reader = new BitReader(buf, 2);
  const out = [];

  console.log({ input, fileLength: buf.length, blockLength, blockType, blockEnd });
  for (let op = 0; op < 200 && reader.offset < blockEnd; op++) {
    const before = { op, offset: reader.offset, bitsLeft: reader.bitsLeft, bits: reader.bits, out: out.length };
    const b1 = reader.bit();
    if (!b1) {
      const value = reader.byte();
      out.push(value);
      if (op < 80) console.log({ ...before, cmd: "literal", value });
      continue;
    }

    const b2 = reader.bit();
    if (!b2) {
      const distance = reader.byte();
      const length = copyLength(reader);
      if (op < 80) console.log({ ...before, cmd: "near", distance, length });
      for (let i = 0; i < length; i++) out.push(0);
      continue;
    }

    const distanceOrCommand = (reader.bitsValue(5) << 8) | reader.byte();
    if (distanceOrCommand > 1) {
      const length = copyLength(reader);
      if (op < 80) console.log({ ...before, cmd: "far", distance: distanceOrCommand, length });
      for (let i = 0; i < length; i++) out.push(0);
      continue;
    }

    if (distanceOrCommand === 1) {
      console.log({ ...before, cmd: "end" });
      break;
    }

    const repeatLength = (reader.bit() ? ((reader.bitsValue(4) << 8) | reader.byte()) : reader.bitsValue(4)) + 14;
    const value = reader.byte();
    if (op < 80) console.log({ ...before, cmd: "rle", repeatLength, value });
    for (let i = 0; i < repeatLength; i++) out.push(value);
  }
  console.log({ finalOffset: reader.offset, outLength: out.length, firstBytes: Buffer.from(out.slice(0, 32)).toString("hex") });
}

main();
