const fs = require("fs");
const path = require("path");

const dec = new TextDecoder("shift_jis", { fatal: false });

function isAsciiPrintable(b) {
  return b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e);
}

function isHalfwidthKana(b) {
  return b >= 0xa1 && b <= 0xdf;
}

function isLead(b) {
  return (b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc);
}

function isTrail(b) {
  return (b >= 0x40 && b <= 0x7e) || (b >= 0x80 && b <= 0xfc);
}

function isJapaneseChar(ch) {
  const cp = ch.codePointAt(0);
  return (
    (cp >= 0x3040 && cp <= 0x309f) ||
    (cp >= 0x30a0 && cp <= 0x30ff) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xff61 && cp <= 0xff9f)
  );
}

function isKana(ch) {
  const cp = ch.codePointAt(0);
  return (
    (cp >= 0x3040 && cp <= 0x309f) ||
    (cp >= 0x30a0 && cp <= 0x30ff) ||
    (cp >= 0xff61 && cp <= 0xff9f)
  );
}

function isJapanesePunct(ch) {
  return "。、・「」『』！？ー〜…".includes(ch);
}

function longestRepeat(text) {
  let best = 0;
  let current = 0;
  let prev = "";
  for (const ch of text) {
    if (ch === prev) {
      current++;
    } else {
      prev = ch;
      current = 1;
    }
    best = Math.max(best, current);
  }
  return best;
}

function cleanText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function scanBuffer(buf, file, opts) {
  const rows = [];
  let i = 0;
  while (i < buf.length) {
    const start = i;
    const bytes = [];
    let sjisPairs = 0;

    while (i < buf.length) {
      const b = buf[i];
      if (isAsciiPrintable(b) || isHalfwidthKana(b)) {
        bytes.push(b);
        i++;
        continue;
      }
      if (isLead(b) && i + 1 < buf.length && isTrail(buf[i + 1])) {
        bytes.push(b, buf[i + 1]);
        sjisPairs++;
        i += 2;
        continue;
      }
      break;
    }

    if (bytes.length) {
      const text = cleanText(dec.decode(Buffer.from(bytes)));
      let jp = 0;
      let kana = 0;
      let punct = 0;
      for (const ch of text) {
        if (isJapaneseChar(ch)) jp++;
        if (isKana(ch)) kana++;
        if (isJapanesePunct(ch)) punct++;
      }
      if (
        text.length >= opts.minChars &&
        jp >= opts.minJapanese &&
        kana >= opts.minKana &&
        punct >= opts.minPunct &&
        sjisPairs >= opts.minPairs &&
        jp / text.length >= opts.minRatio &&
        longestRepeat(text) <= opts.maxRepeat
      ) {
        rows.push({ file, offset: start, bytes: bytes.length, text });
      }
    }

    if (i === start) i++;
  }
  return rows;
}

function walk(target, out = []) {
  if (!fs.existsSync(target)) return out;
  const st = fs.statSync(target);
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(target)) {
      if (name === ".git" || name === ".agents" || name === ".codex") continue;
      if (target.endsWith("_work") && name === "text") continue;
      walk(path.join(target, name), out);
    }
  } else if (st.isFile()) {
    out.push(target);
  }
  return out;
}

function main() {
  const opts = {
    minChars: Number(process.env.MIN_CHARS || 4),
    minJapanese: Number(process.env.MIN_JP || 2),
    minPairs: Number(process.env.MIN_PAIRS || 1),
    minRatio: Number(process.env.MIN_RATIO || 0.25),
    minKana: Number(process.env.MIN_KANA || 0),
    minPunct: Number(process.env.MIN_PUNCT || 0),
    maxRepeat: Number(process.env.MAX_REPEAT || 20),
  };
  const targets = process.argv.slice(2);
  if (!targets.length) {
    throw new Error("Usage: node tools/scan_sjis_strings.js <file-or-dir> [...]");
  }

  const files = targets.flatMap((target) => walk(target));
  const rows = [];
  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    const buf = fs.readFileSync(file);
    for (const row of scanBuffer(buf, rel, opts)) rows.push(row);
  }

  rows.sort((a, b) => a.file.localeCompare(b.file) || a.offset - b.offset);
  for (const row of rows.slice(0, Number(process.env.LIMIT || 500))) {
    const text = row.text.length > 240 ? `${row.text.slice(0, 240)}...` : row.text;
    console.log(`${row.file}:${row.offset.toString(16)}:${text}`);
  }
  console.error(`scanned=${files.length}, hits=${rows.length}`);
}

if (require.main === module) main();
