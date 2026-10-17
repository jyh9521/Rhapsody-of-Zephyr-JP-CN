const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseHeader } = require("./zep_archive");
const { decodeResource } = require("./zep_decode");

const archive = 3;
const resource = "FL12_S08._AC";
const offset = 0x333b;
const before = Buffer.from([0x2f, 0x32, 0x20]); // "/2 " - invalid control code
const after = Buffer.from([0x2f, 0x32, 0x63]);  // "/2c" - original control code
const stageRoot = "_work/invalid_control_fix_20260715";

const { entries } = parseHeader(`ZEP_DAT${archive}.HDR`);
const entry = entries.find((value) => value.name === resource);
if (!entry) throw new Error(`Missing ${resource} in ZEP_DAT${archive}.HDR`);

const lib = fs.readFileSync(`ZEP_DAT${archive}.LIB`);
const decoded = decodeResource(lib.subarray(entry.offset, entry.offset + entry.size)).data;
const actual = Buffer.from(decoded.subarray(offset, offset + before.length)).map((byte) => (0xbf - byte + 0x100) & 0xff);
if (!actual.equals(before)) {
  throw new Error(`Refusing to patch unexpected bytes at ${resource}:0x${offset.toString(16)} (${actual.toString("hex")})`);
}

decoded[offset + 2] = (0xbf - after[2]) & 0xff;
const output = path.join(stageRoot, "_work", "all_decoded", `ZEP_DAT${archive}__${resource}.bin`);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, decoded);

console.log(JSON.stringify({
  resource,
  offset: `0x${offset.toString(16)}`,
  before: before.toString("ascii"),
  after: after.toString("ascii"),
  decodedSha256: crypto.createHash("sha256").update(decoded).digest("hex"),
  output,
}, null, 2));
