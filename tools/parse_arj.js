const fs = require("fs");
const path = require("path");

function cString(buf, offset, max) {
  let end = offset;
  while (end < max && buf[end] !== 0) end++;
  return buf.subarray(offset, end).toString("ascii");
}

function parseHeaders(file) {
  const buf = fs.readFileSync(file);
  const entries = [];
  let off = 0;

  while (off + 4 <= buf.length) {
    if (buf[off] !== 0x60 || buf[off + 1] !== 0xea) {
      throw new Error(`${file}: ARJ signature missing at 0x${off.toString(16)}`);
    }
    const headerSize = buf.readUInt16LE(off + 2);
    if (headerSize === 0) {
      entries.push({ offset: off, terminator: true });
      break;
    }

    const base = off + 4;
    const firstHeaderSize = buf[base];
    const flags = buf[base + 4];
    const method = buf[base + 5];
    const fileType = buf[base + 6];
    const compressedSize = buf.readUInt32LE(base + 0x0c);
    const originalSize = buf.readUInt32LE(base + 0x10);
    const crc = buf.readUInt32LE(base + 0x14);
    const name = cString(buf, base + firstHeaderSize, base + headerSize);

    const headerEnd = off + 4 + headerSize + 4;
    let ext = headerEnd;
    while (ext + 2 <= buf.length) {
      const extSize = buf.readUInt16LE(ext);
      ext += 2;
      if (!extSize) break;
      ext += extSize + 4;
    }

    const hasData = fileType === 0;
    entries.push({
      offset: off,
      headerSize,
      firstHeaderSize,
      flags,
      method,
      fileType,
      compressedSize,
      originalSize,
      crc: `0x${crc.toString(16).padStart(8, "0")}`,
      name,
      dataOffset: hasData ? ext : null,
      dataEnd: hasData ? ext + compressedSize : null,
    });
    off = ext + (hasData ? compressedSize : 0);
  }

  return entries;
}

function main() {
  if (process.argv[2] === "--json") {
    const rows = [];
    for (const file of process.argv.slice(3)) {
      try {
        for (const entry of parseHeaders(file)) {
          if (entry.terminator) continue;
          rows.push({ file, ...entry });
        }
      } catch (err) {
        rows.push({ file, error: err.message });
      }
    }
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  for (const file of process.argv.slice(2)) {
    console.log(`\n${file}`);
    console.table(parseHeaders(file).map((entry) => ({
      name: entry.name,
      offset: entry.offset == null ? "" : `0x${entry.offset.toString(16)}`,
      method: entry.method,
      fileType: entry.fileType,
      packed: entry.compressedSize,
      unpacked: entry.originalSize,
      dataOffset: entry.dataOffset == null ? "" : `0x${entry.dataOffset.toString(16)}`,
      dataEnd: entry.dataEnd == null ? "" : `0x${entry.dataEnd.toString(16)}`,
      terminator: !!entry.terminator,
    })));
  }
}

if (require.main === module) main();

module.exports = { parseHeaders };
