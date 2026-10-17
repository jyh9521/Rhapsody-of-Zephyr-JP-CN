const fs = require("fs");
const { parseHeader } = require("./zep_archive");
const { decodeResource } = require("./zep_decode");

const sjis = new TextDecoder("shift_jis", { fatal: false });
const gb = new TextDecoder("gb18030", { fatal: false });

function bf(buf) {
  const out = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = (0xbf - buf[i]) & 0xff;
  return out;
}

function snippet(text, index) {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + 90);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

const terms = [
  "部隊長",
  "隊長",
  "銃士",
  "剣士",
  "軍師",
  "ＺＦ第１",
  "ZF第1",
  "部队长",
  "队长",
  "枪手",
  "剑士",
  "军师",
];

const hits = [];
for (let archive = 0; archive <= 6; archive++) {
  const hdrPath = `ZEP_DAT${archive}.HDR`;
  const libPath = `ZEP_DAT${archive}.LIB`;
  if (!fs.existsSync(hdrPath) || !fs.existsSync(libPath)) continue;

  const entries = parseHeader(hdrPath).entries;
  const lib = fs.readFileSync(libPath);
  for (const entry of entries) {
    let decoded;
    try {
      decoded = decodeResource(lib.subarray(entry.offset, entry.offset + entry.size)).data;
    } catch {
      continue;
    }

    for (const [transform, buf] of [
      ["decoded", decoded],
      ["bf", bf(decoded)],
    ]) {
      for (const [encoding, decoder] of [
        ["cp932", sjis],
        ["gb18030", gb],
      ]) {
        const text = decoder.decode(buf);
        for (const term of terms) {
          const index = text.indexOf(term);
          if (index >= 0) {
            hits.push({
              archive,
              name: entry.name,
              transform,
              encoding,
              term,
              index,
              snippet: snippet(text, index),
            });
            break;
          }
        }
      }
    }
  }
}

hits.sort(
  (a, b) =>
    a.archive - b.archive ||
    a.name.localeCompare(b.name) ||
    a.transform.localeCompare(b.transform) ||
    a.encoding.localeCompare(b.encoding) ||
    a.index - b.index,
);

for (const hit of hits) {
  console.log(
    [
      hit.archive,
      hit.name,
      hit.transform,
      hit.encoding,
      hit.term,
      hit.index,
      hit.snippet,
    ].join("\t"),
  );
}
console.error(`hits=${hits.length}`);
