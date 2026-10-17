const fs = require("fs");
const path = require("path");

const speakerPath = process.argv[2] || path.join("_work", "text", "speaker_names_to_translate.tsv");
const glossaryPath = process.argv[3] || path.join("_work", "text", "name_glossary_final.csv");
const reportPath = process.argv[4] || path.join("_work", "text", "speaker_names_glossary_sync_report.json");

function parseDelimited(text, delimiter) {
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") rows.pop();
  const header = rows.shift() || [];
  return {
    header,
    rows: rows.map((fields, index) => {
      const out = { __line: index + 2 };
      for (let i = 0; i < header.length; i++) out[header[i]] = fields[i] ?? "";
      return out;
    }),
  };
}

function serializeTsv(header, rows) {
  return `${header.join("\t")}\r\n${rows
    .map((row) => header.map((key) => String(row[key] ?? "").replace(/\r?\n/g, "/n")).join("\t"))
    .join("\r\n")}\r\n`;
}

function main() {
  const speaker = parseDelimited(fs.readFileSync(speakerPath, "utf8"), "\t");
  const glossary = parseDelimited(fs.readFileSync(glossaryPath, "utf8"), ",");
  for (const key of ["jp_name", "cn_name"]) {
    if (!speaker.header.includes(key)) throw new Error(`${speakerPath}: missing ${key}`);
    if (!glossary.header.includes(key)) throw new Error(`${glossaryPath}: missing ${key}`);
  }

  const glossaryMap = new Map();
  const duplicateGlossary = [];
  for (const row of glossary.rows) {
    const jp = (row.jp_name || "").trim();
    const cn = (row.cn_name || "").trim();
    if (!jp || !cn) continue;
    if (glossaryMap.has(jp) && glossaryMap.get(jp) !== cn) duplicateGlossary.push({ jp_name: jp, first: glossaryMap.get(jp), second: cn });
    glossaryMap.set(jp, cn);
  }

  const changed = [];
  const matchedUnchanged = [];
  const speakerNames = new Set();
  for (const row of speaker.rows) {
    const jp = (row.jp_name || "").trim();
    speakerNames.add(jp);
    const next = glossaryMap.get(jp);
    if (!next) continue;
    const prev = row.cn_name || "";
    if (prev === next) {
      matchedUnchanged.push({ line: row.__line, jp_name: jp, cn_name: next });
    } else {
      row.cn_name = next;
      changed.push({ line: row.__line, jp_name: jp, old_cn_name: prev, new_cn_name: next });
    }
  }

  const unmatchedGlossary = [...glossaryMap.keys()].filter((name) => !speakerNames.has(name)).sort();
  const backup = `${speakerPath}.bak_before_name_glossary_sync_20260706`;
  if (!fs.existsSync(backup)) fs.copyFileSync(speakerPath, backup);
  fs.writeFileSync(speakerPath, serializeTsv(speaker.header, speaker.rows), "utf8");

  const report = {
    speakerPath,
    glossaryPath,
    backup,
    glossaryEntries: glossaryMap.size,
    speakerRows: speaker.rows.length,
    changedCount: changed.length,
    matchedUnchangedCount: matchedUnchanged.length,
    unmatchedGlossaryCount: unmatchedGlossary.length,
    duplicateGlossaryCount: duplicateGlossary.length,
    changed,
    unmatchedGlossary: unmatchedGlossary.slice(0, 200),
    duplicateGlossary,
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    changedCount: report.changedCount,
    matchedUnchangedCount: report.matchedUnchangedCount,
    unmatchedGlossaryCount: report.unmatchedGlossaryCount,
    duplicateGlossaryCount: report.duplicateGlossaryCount,
    reportPath,
  }, null, 2));
}

main();
