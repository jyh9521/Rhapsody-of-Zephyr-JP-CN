const fs = require("fs");
const path = require("path");
const { readPe } = require("./inspect_pe");

const dec = new TextDecoder("shift_jis", { fatal: false });

function validShiftJis(buf) {
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e) || (b >= 0xa1 && b <= 0xdf)) {
      continue;
    }
    if ((b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc)) {
      const trail = buf[++i];
      if ((trail >= 0x40 && trail <= 0x7e) || (trail >= 0x80 && trail <= 0xfc)) continue;
      return false;
    }
    return false;
  }
  return true;
}

function hasJapanese(text) {
  return /[ぁ-んァ-ン一-龥]/.test(text);
}

function likelyFalsePositive(text) {
  if (/^8孀/.test(text)) return true;
  if (/[◆蠅]/.test(text)) return true;
  if (/^[\uFF61-\uFF9F]{2,}/.test(text) && !/[ぁ-んァ-ン一-龥]/.test(text.replace(/[\uFF61-\uFF9F]/g, ""))) return true;
  return false;
}

function extractExeStrings(filePath) {
  const pe = readPe(filePath);
  const rows = [];
  for (const section of pe.sections.filter((s) => s.name === ".rdata" || s.name === ".data")) {
    const start = section.rawPointer;
    const end = section.rawPointer + section.rawSize;
    for (let off = start; off < end; off++) {
      let e = off;
      while (e < end && pe.buf[e] !== 0) e++;
      const len = e - off;
      if (len >= 4) {
        const raw = pe.buf.subarray(off, e);
        if (validShiftJis(raw)) {
          const text = dec.decode(raw);
          if (hasJapanese(text) && !likelyFalsePositive(text)) {
            rows.push({
              id: `exe_${rows.length.toString().padStart(4, "0")}`,
              fileOffset: off,
              va: pe.imageBase + section.virtualAddress + (off - section.rawPointer),
              section: section.name,
              byteLength: len,
              text,
              translation: "",
            });
          }
        }
      }
      off = e;
    }
  }
  return rows;
}

function main() {
  const input = process.argv[2] || "zephyr.exe";
  const output = process.argv[3] || path.join("_work", "text", "exe_strings.json");
  const rows = extractExeStrings(input);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(rows, null, 2), "utf8");
  console.log(`Extracted ${rows.length} strings -> ${output}`);
}

if (require.main === module) {
  main();
}

module.exports = { extractExeStrings, validShiftJis };
