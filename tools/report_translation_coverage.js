const fs = require("fs");
const path = require("path");

const INPUTS = [
  path.join("_work", "text", "story_ac_bf.tsv"),
  path.join("_work", "text", "tables_bf.tsv"),
  path.join("_work", "text", "speaker_names_to_translate.tsv"),
];

function readTsv(file) {
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").trimEnd();
  const lines = raw ? raw.split(/\r?\n/) : [];
  if (!lines.length) return { header: [], rows: [] };
  const header = lines.shift().split("\t");
  return {
    header,
    rows: lines.map((line, index) => {
      const cols = line.split("\t");
      const row = { _line: index + 2 };
      header.forEach((key, i) => { row[key] = cols[i] || ""; });
      return row;
    }),
  };
}

function tokens(text) {
  return String(text || "").match(/\/[0-9]*[a-z]/g) || [];
}

function hasKana(text) {
  return /[\u3040-\u30ff\uff61-\uff9f]/.test(String(text || ""));
}

function summarizeFile(file) {
  const { header, rows } = readTsv(file);
  const textCol = header.includes("text") ? "text" : header.includes("jp_name") ? "jp_name" : null;
  const transCol = header.includes("translation") ? "translation" : header.includes("cn_name") ? "cn_name" : null;
  if (!textCol || !transCol) {
    return { file, rows: rows.length, skipped: "no text/translation columns" };
  }

  const untranslated = [];
  const kanaInTranslation = [];
  const controlMismatch = [];

  for (const row of rows) {
    const source = row[textCol] || "";
    const translation = row[transCol] || "";
    if (source.trim() && !translation.trim()) {
      untranslated.push(row);
      continue;
    }
    if (translation && hasKana(translation)) {
      kanaInTranslation.push(row);
    }
    if (header.includes("translation")) {
      const srcTokens = tokens(source).join("|");
      const dstTokens = tokens(translation).join("|");
      if (srcTokens !== dstTokens) {
        controlMismatch.push({ ...row, sourceTokens: srcTokens, translationTokens: dstTokens });
      }
    }
  }

  return {
    file,
    rows: rows.length,
    untranslated: untranslated.length,
    kanaInTranslation: kanaInTranslation.length,
    controlMismatch: controlMismatch.length,
    samples: {
      untranslated: untranslated.slice(0, 20),
      kanaInTranslation: kanaInTranslation.slice(0, 20),
      controlMismatch: controlMismatch.slice(0, 20),
    },
  };
}

function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    files: INPUTS.filter((file) => fs.existsSync(file)).map(summarizeFile),
  };
  const out = path.join("_work", "text", "translation_coverage_report.json");
  fs.writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log(`wrote ${out}`);
}

main();
