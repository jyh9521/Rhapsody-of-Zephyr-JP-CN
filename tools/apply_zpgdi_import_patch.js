const fs = require("fs");
const path = require("path");

const exePath = process.argv[2] || "zephyr.exe";
const backupPath = `${exePath}.bak_before_zpgdi_import`;
const from = Buffer.from("GDI32.dll\0", "ascii");
const to = Buffer.from("ZPGDI.dll\0", "ascii");

if (from.length !== to.length) {
  throw new Error("Proxy DLL name must have the same length as GDI32.dll");
}

const buf = fs.readFileSync(exePath);
if (!fs.existsSync(backupPath)) fs.copyFileSync(exePath, backupPath);

let patched = 0;
let off = -1;
while ((off = buf.indexOf(from, off + 1)) !== -1) {
  to.copy(buf, off);
  patched++;
}

if (!patched) {
  if (buf.indexOf(to) >= 0) {
    console.log("ZPGDI import patch already installed.");
  } else {
    throw new Error("Could not find GDI32.dll import string");
  }
} else if (patched !== 1) {
  throw new Error(`Expected one GDI32.dll import string, patched ${patched}`);
} else {
  fs.writeFileSync(exePath, buf);
  console.log(`Patched ${path.resolve(exePath)} import GDI32.dll -> ZPGDI.dll`);
}

console.log(`Backup: ${path.resolve(backupPath)}`);
