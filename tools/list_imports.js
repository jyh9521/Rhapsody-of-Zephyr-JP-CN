const { readPe } = require("./inspect_pe");

function readCString(buf, off) {
  const end = buf.indexOf(0, off);
  return buf.toString("ascii", off, end < 0 ? buf.length : end);
}

function listImports(filePath) {
  const pe = readPe(filePath);
  const buf = pe.buf;
  const peOff = buf.readUInt32LE(0x3c);
  const optionalHeader = peOff + 24;
  const importRva = buf.readUInt32LE(optionalHeader + 96 + 8);
  if (!importRva) return [];

  const imports = [];
  let descOff = pe.rvaToOffset(importRva);
  for (;;) {
    const originalFirstThunk = buf.readUInt32LE(descOff);
    const timeDateStamp = buf.readUInt32LE(descOff + 4);
    const forwarderChain = buf.readUInt32LE(descOff + 8);
    const nameRva = buf.readUInt32LE(descOff + 12);
    const firstThunk = buf.readUInt32LE(descOff + 16);
    if (!(originalFirstThunk || timeDateStamp || forwarderChain || nameRva || firstThunk)) break;

    const dll = readCString(buf, pe.rvaToOffset(nameRva));
    const thunkRva = originalFirstThunk || firstThunk;
    let thunkOff = pe.rvaToOffset(thunkRva);
    let iatRva = firstThunk;
    const funcs = [];
    for (;;) {
      const thunk = buf.readUInt32LE(thunkOff);
      if (!thunk) break;
      if (thunk & 0x80000000) {
        funcs.push({ ordinal: thunk & 0xffff, iatRva });
      } else {
        const nameOff = pe.rvaToOffset(thunk);
        const hint = buf.readUInt16LE(nameOff);
        const name = readCString(buf, nameOff + 2);
        funcs.push({ name, hint, iatRva, iatVa: pe.imageBase + iatRva });
      }
      thunkOff += 4;
      iatRva += 4;
    }
    imports.push({ dll, funcs });
    descOff += 20;
  }
  return imports;
}

function main() {
  const filePath = process.argv[2] || "zephyr.exe";
  const imports = listImports(filePath);
  for (const imp of imports) {
    console.log(imp.dll);
    for (const fn of imp.funcs) {
      if (fn.name) {
        console.log(`  ${fn.name.padEnd(32)} IAT=0x${fn.iatVa.toString(16)}`);
      } else {
        console.log(`  #${fn.ordinal} IAT=0x${fn.iatVa.toString(16)}`);
      }
    }
  }
}

if (require.main === module) main();

module.exports = { listImports };
