const fs = require("fs");
const { parseHeader } = require("./zep_archive");
const { decodeResource } = require("./zep_decode");

function subBytes(hex) {
  return Buffer.from(hex, "hex").map((x) => (0xbf - x) & 0xff).toString("hex");
}

const pats = {
  sjis_med: "8381836683428360",
  sjis_di: "83668342",
  bf_sjis_med: subBytes("8381836683428360"),
  bf_sjis_di: subBytes("83668342"),
  gbk_med: "c3b7b5cfc6e6",
  bf_gbk_med: subBytes("c3b7b5cfc6e6"),
};

function hits(buf, hex) {
  const p = Buffer.from(hex, "hex");
  const out = [];
  for (let i = buf.indexOf(p); i >= 0; i = buf.indexOf(p, i + 1)) out.push(i);
  return out;
}

function scanBuffer(label, buf) {
  for (const [name, hex] of Object.entries(pats)) {
    const found = hits(buf, hex);
    if (found.length) {
      console.log(`${label} ${name} ${found.slice(0, 12).map((x) => `0x${x.toString(16)}`).join(" ")} count=${found.length}`);
    }
  }
}

for (const idx of [2, 3, 4]) {
  const hdr = `ZEP_DAT${idx}.HDR`;
  const lib = `ZEP_DAT${idx}.LIB`;
  if (!fs.existsSync(hdr) || !fs.existsSync(lib)) continue;

  const entries = parseHeader(hdr).entries;
  const libBuf = fs.readFileSync(lib);
  console.log(`ARCH ${idx}`);
  for (const e of entries) {
    const raw = libBuf.subarray(e.offset, e.offset + e.size);
    scanBuffer(` raw ${e.name}`, raw);
    try {
      const dec = decodeResource(raw).data;
      scanBuffer(` dec ${e.name}`, dec);
    } catch {
      // Some resource types are not compressed with this codec.
    }
  }
}

scanBuffer(" exe zephyr.exe", fs.readFileSync("zephyr.exe"));
