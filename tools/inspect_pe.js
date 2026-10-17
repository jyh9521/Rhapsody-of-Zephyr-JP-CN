const fs = require("fs");

function readPe(filePath) {
  const buf = fs.readFileSync(filePath);
  const peOff = buf.readUInt32LE(0x3c);
  if (buf.toString("ascii", peOff, peOff + 4) !== "PE\0\0") {
    throw new Error(`${filePath} is not a PE file`);
  }

  const numberOfSections = buf.readUInt16LE(peOff + 6);
  const optionalHeaderSize = buf.readUInt16LE(peOff + 20);
  const optionalHeader = peOff + 24;
  const imageBase = buf.readUInt32LE(optionalHeader + 28);
  const sectionsOff = optionalHeader + optionalHeaderSize;
  const sections = [];

  for (let i = 0; i < numberOfSections; i++) {
    const off = sectionsOff + i * 40;
    const nul = buf.indexOf(0, off);
    const nameEnd = nul >= off && nul < off + 8 ? nul : off + 8;
    sections.push({
      name: buf.toString("ascii", off, nameEnd),
      virtualSize: buf.readUInt32LE(off + 8),
      virtualAddress: buf.readUInt32LE(off + 12),
      rawSize: buf.readUInt32LE(off + 16),
      rawPointer: buf.readUInt32LE(off + 20),
      characteristics: buf.readUInt32LE(off + 36),
    });
  }

  function rvaToOffset(rva) {
    for (const section of sections) {
      const span = Math.max(section.virtualSize, section.rawSize);
      if (rva >= section.virtualAddress && rva < section.virtualAddress + span) {
        return section.rawPointer + (rva - section.virtualAddress);
      }
    }
    throw new Error(`RVA 0x${rva.toString(16)} is not in a section`);
  }

  function vaToOffset(va) {
    return rvaToOffset(va - imageBase);
  }

  return { buf, imageBase, sections, rvaToOffset, vaToOffset };
}

function hexDump(buf, base, length) {
  const end = Math.min(buf.length, base + length);
  for (let off = base; off < end; off += 16) {
    const chunk = buf.subarray(off, Math.min(end, off + 16));
    const hex = [...chunk].map((b) => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = [...chunk].map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".")).join("");
    console.log(`${off.toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  ${ascii}`);
  }
}

function findDword(buf, value) {
  const needle = Buffer.alloc(4);
  needle.writeUInt32LE(value >>> 0, 0);
  const hits = [];
  let off = -1;
  while ((off = buf.indexOf(needle, off + 1)) !== -1) hits.push(off);
  return hits;
}

function main() {
  const filePath = process.argv[2] || "zephyr.exe";
  const cmd = process.argv[3] || "sections";
  const pe = readPe(filePath);

  if (cmd === "sections") {
    console.log(`imageBase=0x${pe.imageBase.toString(16)}`);
    console.table(
      pe.sections.map((s) => ({
        name: s.name,
        va: `0x${(pe.imageBase + s.virtualAddress).toString(16)}`,
        rva: `0x${s.virtualAddress.toString(16)}`,
        virtualSize: `0x${s.virtualSize.toString(16)}`,
        rawPointer: `0x${s.rawPointer.toString(16)}`,
        rawSize: `0x${s.rawSize.toString(16)}`,
      })),
    );
    return;
  }

  if (cmd === "dump") {
    const va = Number(process.argv[4]);
    const length = Number(process.argv[5] || 256);
    const off = pe.vaToOffset(va);
    console.log(`VA 0x${va.toString(16)} -> file 0x${off.toString(16)}`);
    hexDump(pe.buf, off, length);
    return;
  }

  if (cmd === "find-dword") {
    const value = Number(process.argv[4]);
    const hits = findDword(pe.buf, value);
    for (const off of hits) console.log(`0x${off.toString(16)}`);
    console.log(`${hits.length} hits`);
    return;
  }

  throw new Error(`Unknown command: ${cmd}`);
}

if (require.main === module) {
  main();
}

module.exports = { readPe, findDword, hexDump };
