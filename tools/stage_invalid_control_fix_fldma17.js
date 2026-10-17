const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseHeader } = require("./zep_archive");
const { decodeResource } = require("./zep_decode");

const archive = 3;
const resource = "FLDMA17._AC";
const offset = 0x150d;
const capacity = 68;
const stageRoot = "_work/invalid_control_fix_fldma17_20260715";

const { entries } = parseHeader(`ZEP_DAT${archive}.HDR`);
const entry = entries.find((value) => value.name === resource);
if (!entry) throw new Error(`Missing ${resource} in ZEP_DAT${archive}.HDR`);

const lib = fs.readFileSync(`ZEP_DAT${archive}.LIB`);
const decoded = decodeResource(lib.subarray(entry.offset, entry.offset + entry.size)).data;
const plain = Buffer.from(decoded.subarray(offset, offset + capacity)).map((byte) => (0xbf - byte + 0x100) & 0xff);
const end = plain.indexOf(0);
const invalidPrefix = Buffer.from("5bb7a8d7c85d2f", "hex"); // [法兹]/
if (end < 0 || !plain.subarray(0, invalidPrefix.length).equals(invalidPrefix)) {
  throw new Error(`Refusing to patch unexpected bytes at ${resource}:0x${offset.toString(16)}`);
}

const fixed = Buffer.concat([plain.subarray(0, invalidPrefix.length), Buffer.from("n"), plain.subarray(invalidPrefix.length, end)]);
if (fixed.length > capacity) throw new Error("Fixed text exceeds its original slot");
decoded.set(Buffer.from(fixed).map((byte) => (0xbf - byte + 0x100) & 0xff), offset);
decoded.fill(0xbf, offset + fixed.length, offset + capacity);

const output = path.join(stageRoot, "_work", "all_decoded", `ZEP_DAT${archive}__${resource}.bin`);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, decoded);
console.log(JSON.stringify({
  resource,
  offset: `0x${offset.toString(16)}`,
  before: "[法兹]/总、总之…",
  after: "[法兹]/n总、总之…",
  decodedSha256: crypto.createHash("sha256").update(decoded).digest("hex"),
  output,
}, null, 2));
