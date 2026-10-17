const fs = require("fs");
const path = require("path");

const dec = new TextDecoder("shift_jis");

function readCString(buf, start, length) {
  let end = start;
  const max = start + length;
  while (end < max && buf[end] !== 0) end++;
  return dec.decode(buf.subarray(start, end));
}

function parseHeader(headerPath) {
  const buf = fs.readFileSync(headerPath);
  if (buf.length < 16 || (buf.length - 16) % 32 !== 0) {
    throw new Error(`Unexpected HDR size: ${headerPath} (${buf.length})`);
  }

  const entries = [];
  for (let off = 16; off < buf.length; off += 32) {
    const name = readCString(buf, off, 16);
    const offset = buf.readUInt32LE(off + 16);
    const size = buf.readUInt32LE(off + 20);
    if (!name) continue;
    entries.push({ name, offset, size, headerOffset: off });
  }
  return { signature: readCString(buf, 0, 16), entries };
}

function extractArchive(index, outRoot) {
  const hdr = `ZEP_DAT${index}.HDR`;
  const lib = `ZEP_DAT${index}.LIB`;
  const { entries } = parseHeader(hdr);
  const libBuf = fs.readFileSync(lib);
  const outDir = path.join(outRoot, `ZEP_DAT${index}`);
  fs.mkdirSync(outDir, { recursive: true });

  for (const entry of entries) {
    const end = entry.offset + entry.size;
    if (end > libBuf.length) {
      throw new Error(`${hdr}: ${entry.name} exceeds ${lib} size`);
    }
    fs.writeFileSync(path.join(outDir, entry.name), libBuf.subarray(entry.offset, end));
  }
  return { hdr, lib, count: entries.length, outDir };
}

function listArchives() {
  const rows = [];
  for (let i = 0; i <= 6; i++) {
    const hdr = `ZEP_DAT${i}.HDR`;
    if (!fs.existsSync(hdr)) continue;
    const parsed = parseHeader(hdr);
    rows.push({
      archive: i,
      signature: parsed.signature,
      count: parsed.entries.length,
      first: parsed.entries[0]?.name,
      last: parsed.entries.at(-1)?.name,
    });
  }
  return rows;
}

function main() {
  const cmd = process.argv[2] || "list";
  if (cmd === "list") {
    console.table(listArchives());
    return;
  }

  if (cmd === "extract") {
    const outRoot = path.resolve(process.argv[3] || "_work/extracted");
    fs.mkdirSync(outRoot, { recursive: true });
    for (let i = 0; i <= 6; i++) {
      const result = extractArchive(i, outRoot);
      console.log(`Extracted ${result.count} files from ${result.hdr} -> ${result.outDir}`);
    }
    return;
  }

  throw new Error(`Unknown command: ${cmd}`);
}

if (require.main === module) {
  main();
}

module.exports = { parseHeader, extractArchive };
