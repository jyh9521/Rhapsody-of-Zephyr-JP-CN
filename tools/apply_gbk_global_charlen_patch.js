const fs = require('fs');

const exePath = process.argv[2] || 'zephyr.exe';
const buf = fs.readFileSync(exePath);

const patchOffset = 0x63e10;
const original = Buffer.from([
  0x8a, 0x44, 0x24, 0x04,       // mov al,[esp+4]
  0x3c, 0x80,                   // cmp al,80
  0x73, 0x03,                   // jae +3
  0x33, 0xc0,                   // xor eax,eax
  0xc3,                         // ret
  0x3c, 0xa0,                   // cmp al,a0
  0x73, 0x06,                   // jae +6
  0xb8, 0x01, 0x00, 0x00, 0x00, // mov eax,1
  0xc3,                         // ret
  0x3c, 0xe0,                   // cmp al,e0
  0x1b, 0xc0,                   // sbb eax,eax
  0x40,                         // inc eax
  0xc3                          // ret
]);

const patch = Buffer.from([
  0x8a, 0x44, 0x24, 0x04,       // mov al,[esp+4]
  0x3c, 0x81,                   // cmp al,81
  0x72, 0x0a,                   // jb single
  0x3c, 0xfe,                   // cmp al,fe
  0x77, 0x06,                   // ja single
  0xb8, 0x01, 0x00, 0x00, 0x00, // mov eax,1
  0xc3,                         // ret
  0x33, 0xc0,                   // single: xor eax,eax
  0xc3,                         // ret
  0x90, 0x90, 0x90, 0x90, 0x90, 0x90
]);

const current = buf.subarray(patchOffset, patchOffset + original.length);
const already = buf.subarray(patchOffset, patchOffset + patch.length).equals(patch);
if (!already && !current.equals(original)) {
  throw new Error(`Unexpected bytes at 0x${patchOffset.toString(16)}: ${current.toString('hex')}`);
}

const backup = `${exePath}.bak_before_gbk_global_charlen`;
if (!fs.existsSync(backup)) {
  fs.copyFileSync(exePath, backup);
  console.log(`Created backup ${backup}`);
}

patch.copy(buf, patchOffset);
fs.writeFileSync(exePath, buf);
console.log(`Patched global SJIS char classifier at file offset 0x${patchOffset.toString(16)} for GBK leads.`);
