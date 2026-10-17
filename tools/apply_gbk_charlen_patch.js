const fs = require("fs");

const exePath = process.argv[2] || "zephyr.exe";
const backupPath = `${exePath}.bak_before_gbk_charlen`;
const offset = 0x75f60;

const original = Buffer.from([
  0x8a, 0x44, 0x24, 0x04, 0x3c, 0x80, 0x73, 0x05, 0x33, 0xc0,
  0xc2, 0x04, 0x00, 0x3c, 0xa0, 0x73, 0x08, 0xb8, 0x01, 0x00,
  0x00, 0x00, 0xc2, 0x04, 0x00, 0x3c, 0xe0, 0x1b, 0xc0, 0x40,
  0xc2, 0x04, 0x00,
]);

const patched = Buffer.from([
  // GBK/CP936: treat 0x81..0xFE as a double-byte lead.
  0x8a, 0x44, 0x24, 0x04, // mov al,[esp+4]
  0x3c, 0x81, // cmp al,81h
  0x72, 0x0c, // jb single
  0x3c, 0xfe, // cmp al,0FEh
  0x77, 0x08, // ja single
  0xb8, 0x01, 0x00, 0x00, 0x00, // mov eax,1
  0xc2, 0x04, 0x00, // ret 4
  0x33, 0xc0, // single: xor eax,eax
  0xc2, 0x04, 0x00, // ret 4
  0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90,
]);

function hex(buf) {
  return buf.toString("hex").toUpperCase();
}

const buf = fs.readFileSync(exePath);
if (!fs.existsSync(backupPath)) fs.copyFileSync(exePath, backupPath);

const current = buf.subarray(offset, offset + original.length);
if (current.equals(patched)) {
  console.log(`GBK char-length patch already installed at 0x${offset.toString(16)}`);
} else if (current.equals(original)) {
  patched.copy(buf, offset);
  fs.writeFileSync(exePath, buf);
  console.log(`Installed GBK char-length patch at 0x${offset.toString(16)}`);
} else {
  throw new Error(
    `Unexpected bytes at 0x${offset.toString(16)}; got ${hex(current)}`,
  );
}

console.log(`Backup: ${backupPath}`);
