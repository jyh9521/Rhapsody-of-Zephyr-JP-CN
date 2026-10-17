const fs = require("fs");
const path = require("path");
const { parseHeader } = require("./zep_archive");
const { decodeResource } = require("./zep_decode");

const reportPath = process.argv[2] || path.join("_work", "text", "dat1_ch_class_patch_report.json");
const hdrPath = process.argv[3] || "ZEP_DAT1.HDR";
const libPath = process.argv[4] || "ZEP_DAT1.LIB";
const outPath = process.argv[5] || path.join("_work", "text", "dat1_ch_class_installed_verify_report.json");
const FIELD_OFFSET = 0x70;
const FIELD_SIZE = 0x20;

function bf(data) {
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) out[i] = (0xbf - data[i]) & 0xff;
  return out;
}

function decodeField(decoded) {
  const plain = bf(decoded.subarray(FIELD_OFFSET, FIELD_OFFSET + FIELD_SIZE));
  const bytes = [];
  for (const byte of plain) {
    if (byte === 0 || byte === 0x20) break;
    bytes.push(byte);
  }
  return new TextDecoder("gb18030").decode(Uint8Array.from(bytes));
}

function main() {
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const expected = new Map((report.patched || []).map((row) => [row.resource, row.cn_class]));
  const { entries } = parseHeader(hdrPath);
  const lib = fs.readFileSync(libPath);
  const mismatches = [];
  let checked = 0;

  for (const entry of entries) {
    if (!expected.has(entry.name)) continue;
    const encoded = lib.subarray(entry.offset, entry.offset + entry.size);
    const decoded = decodeResource(encoded).data;
    const actual = decodeField(decoded);
    const target = expected.get(entry.name);
    checked++;
    if (actual !== target) mismatches.push({ resource: entry.name, expected: target, actual });
  }

  const result = { checked, mismatchCount: mismatches.length, mismatches: mismatches.slice(0, 100) };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
  if (mismatches.length) process.exit(1);
}

main();
