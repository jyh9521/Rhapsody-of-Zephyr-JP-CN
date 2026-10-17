const fs = require("fs");

const exePath = process.argv[2] || "zephyr.exe";
const backupPath = `${exePath}.bak_before_exe_medit_name`;

const from = Buffer.from("8381836683428360", "hex"); // メディチ
const to = Buffer.from("c3b7b5cfc6e62020", "hex");   // 梅迪奇 + two spaces

if (from.length !== to.length) {
  throw new Error("replacement length mismatch");
}

const buf = fs.readFileSync(exePath);
const offsets = [];
for (let off = buf.indexOf(from); off >= 0; off = buf.indexOf(from, off + from.length)) {
  offsets.push(off);
}

if (!offsets.length) {
  console.log("No raw メディチ bytes found in exe; nothing changed.");
  process.exit(0);
}

if (!fs.existsSync(backupPath)) {
  fs.copyFileSync(exePath, backupPath);
  console.log(`Created backup ${backupPath}`);
}

for (const off of offsets) {
  to.copy(buf, off);
  console.log(`Patched raw メディチ at 0x${off.toString(16)}`);
}

fs.writeFileSync(exePath, buf);
console.log(`Patched ${offsets.length} occurrence(s) in ${exePath}`);
