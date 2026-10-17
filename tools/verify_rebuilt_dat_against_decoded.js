const fs = require("fs");
const path = require("path");
const { parseHeader } = require("./zep_archive");
const { decodeResource } = require("./zep_decode");

const decodedRoot = path.resolve(process.argv[2] || "_work/patched_decoded_story_final_cn_markers");
const rebuiltRoot = path.resolve(process.argv[3] || "_work/rebuilt_dat_story_final_cn_markers");
const reportPath = path.resolve(process.argv[4] || "_work/text/story_final_cn_markers_rebuild_verify_report.json");
const archives = (process.env.ARCHIVES || "2,3,4")
  .split(",")
  .map((x) => Number(x.trim()))
  .filter(Number.isInteger);

const mismatches = [];
let checked = 0;

for (const archive of archives) {
  const hdrPath = path.join(rebuiltRoot, `ZEP_DAT${archive}.HDR`);
  const libPath = path.join(rebuiltRoot, `ZEP_DAT${archive}.LIB`);
  const { entries } = parseHeader(hdrPath);
  const lib = fs.readFileSync(libPath);

  for (const entry of entries) {
    const expectedPath = path.join(decodedRoot, `_work/all_decoded/ZEP_DAT${archive}__${entry.name}.bin`);
    if (!fs.existsSync(expectedPath)) continue;
    const encoded = lib.subarray(entry.offset, entry.offset + entry.size);
    const actual = decodeResource(encoded).data;
    const expected = fs.readFileSync(expectedPath);
    checked++;
    if (!actual.equals(expected)) {
      mismatches.push({
        archive,
        resource: entry.name,
        expectedLength: expected.length,
        actualLength: actual.length,
      });
    }
  }
}

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(
  reportPath,
  `${JSON.stringify({ checked, mismatchCount: mismatches.length, mismatches: mismatches.slice(0, 100) }, null, 2)}\n`,
  "utf8",
);

console.log(`checked=${checked} mismatchCount=${mismatches.length}`);
console.log(`wrote ${reportPath}`);
if (mismatches.length) process.exit(1);
