const fs = require("fs");
const path = require("path");

function parse(name) {
  const file = path.join("_work", "decoded", `${name}_sp.bin`);
  const buf = fs.readFileSync(file);
  const count = buf.readUInt16LE(0x42);
  let off = 0x80;
  const rows = [];
  for (let i = 0; i < count; i++) {
    if (off + 12 > buf.length) {
      rows.push({ i, off, error: "record exceeds buffer" });
      break;
    }
    const len = buf.readUInt32LE(off);
    const width = buf.readInt16LE(off + 4);
    const height = buf.readInt16LE(off + 6);
    const x = buf.readInt16LE(off + 8);
    const y = buf.readInt16LE(off + 10);
    rows.push({
      i,
      off,
      len,
      width,
      height,
      x,
      y,
      area: width * height,
      len,
      dataOff: off + 12,
    });
    off += 12 + len;
  }
  console.log(`\n${name}: count=${count}, consumed=${off}/${buf.length}`);
  console.table(rows);
}

for (const name of process.argv.slice(2)) parse(name);
