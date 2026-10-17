const fs = require("fs");
const path = require("path");

const exePath = process.argv[2] || "zephyr.exe";
const backupPath = `${exePath}.bak_gbk_font`;

const msGothic = Buffer.from([
  0x82, 0x6c, 0x82, 0x72, 0x20, 0x83, 0x53, 0x83, 0x56, 0x83, 0x62, 0x83, 0x4e, 0x00,
]);
const simSun = Buffer.from("SimSun\0", "ascii");

function replaceFontFace(buf) {
  const off = buf.indexOf(msGothic);
  if (off < 0) {
    const existing = buf.indexOf(simSun);
    if (existing >= 0) return { off: existing, alreadyPatched: true };
    throw new Error("Could not find MS Gothic font face string");
  }

  simSun.copy(buf, off);
  buf.fill(0, off + simSun.length, off + msGothic.length);
  return { off, alreadyPatched: false };
}

function patchShiftJisCharsets(buf) {
  const broadStart = 0x75c00;
  const broadEnd = 0x75e00;
  const hits = [];

  for (let off = broadStart; off < Math.min(buf.length - 5, broadEnd); off++) {
    if (buf[off] === 0x68 && buf[off + 1] === 0x80 && buf[off + 2] === 0 && buf[off + 3] === 0 && buf[off + 4] === 0) {
      hits.push(off);
    }
  }

  if (!hits.length) {
    for (let off = broadStart; off < Math.min(buf.length - 5, broadEnd); off++) {
      if (buf[off] === 0x68 && buf[off + 1] === 0x86 && buf[off + 2] === 0 && buf[off + 3] === 0 && buf[off + 4] === 0) {
        hits.push(off);
      }
    }
    if (hits.length >= 2) return { hits, alreadyPatched: true };
    throw new Error("Could not find CreateFontA SHIFTJIS charset pushes");
  }

  for (const off of hits) buf[off + 1] = 0x86;
  return { hits, alreadyPatched: false };
}

function main() {
  const buf = fs.readFileSync(exePath);
  if (!fs.existsSync(backupPath)) fs.copyFileSync(exePath, backupPath);

  const patched = Buffer.from(buf);
  const font = replaceFontFace(patched);
  const charset = patchShiftJisCharsets(patched);
  fs.writeFileSync(exePath, patched);

  console.log(`patched ${path.resolve(exePath)}`);
  console.log(`backup ${path.resolve(backupPath)}`);
  console.log(
    `font=0x${font.off.toString(16)}${font.alreadyPatched ? " already" : ""}, charsets=${charset.hits
      .map((off) => `0x${off.toString(16)}`)
      .join(",")}${charset.alreadyPatched ? " already" : ""}`
  );
}

main();
