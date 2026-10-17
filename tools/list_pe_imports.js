const fs = require("fs");

function rvaToOffset(sections, rva) {
  for (const s of sections) {
    const size = Math.max(s.virtualSize, s.rawSize);
    if (rva >= s.virtualAddress && rva < s.virtualAddress + size) {
      return s.rawPointer + (rva - s.virtualAddress);
    }
  }
  return null;
}

function readCString(buf, off) {
  let end = off;
  while (end < buf.length && buf[end] !== 0) end++;
  return buf.subarray(off, end).toString("ascii");
}

function imports(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt16LE(0) !== 0x5a4d) throw new Error(`${file}: not MZ`);
  const pe = b.readUInt32LE(0x3c);
  if (b.readUInt32LE(pe) !== 0x4550) throw new Error(`${file}: not PE`);
  const coff = pe + 4;
  const numSections = b.readUInt16LE(coff + 2);
  const optSize = b.readUInt16LE(coff + 16);
  const opt = coff + 20;
  const magic = b.readUInt16LE(opt);
  const dataDir = magic === 0x20b ? opt + 112 : opt + 96;
  const importRva = b.readUInt32LE(dataDir + 8);
  const sectionBase = opt + optSize;
  const sections = [];
  for (let i = 0; i < numSections; i++) {
    const off = sectionBase + i * 40;
    sections.push({
      name: readCString(b, off),
      virtualSize: b.readUInt32LE(off + 8),
      virtualAddress: b.readUInt32LE(off + 12),
      rawSize: b.readUInt32LE(off + 16),
      rawPointer: b.readUInt32LE(off + 20),
    });
  }
  const importOff = rvaToOffset(sections, importRva);
  if (importOff == null || importRva === 0) return [];
  const out = [];
  for (let off = importOff; off + 20 <= b.length; off += 20) {
    const originalFirstThunk = b.readUInt32LE(off);
    const nameRva = b.readUInt32LE(off + 12);
    const firstThunk = b.readUInt32LE(off + 16);
    if (!originalFirstThunk && !nameRva && !firstThunk) break;
    const nameOff = rvaToOffset(sections, nameRva);
    if (nameOff == null) continue;
    out.push(readCString(b, nameOff));
  }
  return out;
}

for (const file of process.argv.slice(2)) {
  console.log(`[${file}]`);
  try {
    for (const dll of imports(file)) console.log(dll);
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
  }
}
