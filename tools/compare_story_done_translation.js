const fs = require("fs");

const storyPath = process.argv[2] || "_work/text/story_done.tsv";
const speakerPath = process.argv[3] || "_work/text/speaker_names_to_translate.tsv";

function parseTsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.length);
  const header = lines.shift().split("\t");
  return lines.map((line, index) => {
    const fields = line.split("\t");
    const row = { __line: index + 2 };
    for (let i = 0; i < header.length; i++) row[header[i]] = fields[i] ?? "";
    return row;
  });
}

function quoteField(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function writeQuotedTsv(file, rows, headers) {
  const body = rows.map((row) => headers.map((header) => quoteField(row[header])).join("\t"));
  const text = `\uFEFF${headers.map(quoteField).join("\t")}\r\n${body.join("\r\n")}${rows.length ? "\r\n" : ""}`;
  fs.writeFileSync(file, text, "utf8");
}

function tokenCounts(text) {
  const counts = new Map();
  for (const match of String(text || "").matchAll(/\/(?:n|\d+[A-Za-z]|[A-Za-z]+)/g)) {
    const token = match[0];
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return counts;
}

function formatCounts(counts) {
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([token, count]) => `${token}:${count}`)
    .join(" ");
}

function diffCounts(source, target) {
  const keys = new Set([...source.keys(), ...target.keys()]);
  const missing = [];
  const extra = [];
  for (const key of [...keys].sort()) {
    const left = source.get(key) || 0;
    const right = target.get(key) || 0;
    if (left > right) missing.push(`${key}:${left - right}`);
    if (right > left) extra.push(`${key}:${right - left}`);
  }
  return { missing: missing.join(" "), extra: extra.join(" ") };
}

function loadSpeakerNames(file) {
  if (!fs.existsSync(file)) return [];
  const rows = parseTsv(fs.readFileSync(file, "utf8"));
  return [...new Set(rows.map((row) => row.jp_name).filter((name) => name && name.trim()))]
    .filter((name) => !/^[\x00-\x7F]+$/.test(name))
    .sort((a, b) => b.length - a.length);
}

function main() {
  const rows = parseTsv(fs.readFileSync(storyPath, "utf8"));
  const speakerNames = loadSpeakerNames(speakerPath);
  const controlMismatches = [];
  const untranslatedSuspects = [];
  const highConfidenceUntranslated = [];
  const japaneseMiddleDotRows = [];
  const kanaRe = /[\u3040-\u309F\u30A0-\u30FF\uFF66-\uFF9D]/g;
  const strongKanaRe = /[\u3040-\u309F\u30A1-\u30FA\u30FC-\u30FF\uFF66-\uFF9D]/g;
  const jpPunctuationRe = /[「」『』【】]/g;

  for (const row of rows) {
    const jpText = row.text || "";
    const cnText = row.translation || "";
    const jpCounts = tokenCounts(jpText);
    const cnCounts = tokenCounts(cnText);
    const diff = diffCounts(jpCounts, cnCounts);
    if (diff.missing || diff.extra) {
      controlMismatches.push({
        line: row.__line,
        id: row.id,
        source: row.source,
        offset: row.offset,
        byteLength: row.byteLength,
        jp_tokens: formatCounts(jpCounts),
        cn_tokens: formatCounts(cnCounts),
        missing_in_cn: diff.missing,
        extra_in_cn: diff.extra,
        jp_text: jpText,
        translation: cnText,
      });
    }

    const issues = [];
    const kana = [...new Set(cnText.match(kanaRe) || [])];
    if (kana.length) issues.push(`kana:${kana.join("")}`);
    const strongKana = [...new Set(cnText.match(strongKanaRe) || [])];
    if (strongKana.length) {
      highConfidenceUntranslated.push({
        line: row.__line,
        id: row.id,
        source: row.source,
        offset: row.offset,
        byteLength: row.byteLength,
        issue: `strong_kana:${strongKana.join("")}`,
        jp_text: jpText,
        translation: cnText,
      });
    }
    if (cnText.includes("・")) {
      japaneseMiddleDotRows.push({
        line: row.__line,
        id: row.id,
        source: row.source,
        offset: row.offset,
        byteLength: row.byteLength,
        issue: "katakana_middle_dot",
        jp_text: jpText,
        translation: cnText,
      });
    }
    const jpPunctuation = [...new Set(cnText.match(jpPunctuationRe) || [])];
    if (jpPunctuation.length) issues.push(`jp_punctuation:${jpPunctuation.join("")}`);
    const speakerHits = [];
    for (const name of speakerNames) {
      if (cnText.includes(name)) {
        speakerHits.push(name);
        if (speakerHits.length >= 12) break;
      }
    }
    if (speakerHits.length) issues.push(`jp_speaker_name:${speakerHits.join("|")}`);
    if (issues.length) {
      untranslatedSuspects.push({
        line: row.__line,
        id: row.id,
        source: row.source,
        offset: row.offset,
        byteLength: row.byteLength,
        issue: issues.join("; "),
        jp_text: jpText,
        translation: cnText,
      });
    }
  }

  const controlReport = "_work/text/story_done_control_token_mismatches.tsv";
  const untranslatedReport = "_work/text/story_done_untranslated_suspects.tsv";
  const highConfidenceReport = "_work/text/story_done_untranslated_high_confidence.tsv";
  const middleDotReport = "_work/text/story_done_japanese_middle_dot_rows.tsv";
  writeQuotedTsv(controlReport, controlMismatches, [
    "line",
    "id",
    "source",
    "offset",
    "byteLength",
    "jp_tokens",
    "cn_tokens",
    "missing_in_cn",
    "extra_in_cn",
    "jp_text",
    "translation",
  ]);
  writeQuotedTsv(untranslatedReport, untranslatedSuspects, [
    "line",
    "id",
    "source",
    "offset",
    "byteLength",
    "issue",
    "jp_text",
    "translation",
  ]);
  writeQuotedTsv(highConfidenceReport, highConfidenceUntranslated, [
    "line",
    "id",
    "source",
    "offset",
    "byteLength",
    "issue",
    "jp_text",
    "translation",
  ]);
  writeQuotedTsv(middleDotReport, japaneseMiddleDotRows, [
    "line",
    "id",
    "source",
    "offset",
    "byteLength",
    "issue",
    "jp_text",
    "translation",
  ]);

  const summary = {
    story: storyPath,
    rows: rows.length,
    speakerNameDictionarySize: speakerNames.length,
    controlTokenMismatchCount: controlMismatches.length,
    untranslatedSuspectCount: untranslatedSuspects.length,
    highConfidenceUntranslatedCount: highConfidenceUntranslated.length,
    japaneseMiddleDotRowCount: japaneseMiddleDotRows.length,
    controlTokenReport: controlReport,
    untranslatedSuspectReport: untranslatedReport,
    highConfidenceUntranslatedReport: highConfidenceReport,
    japaneseMiddleDotReport: middleDotReport,
  };
  fs.writeFileSync("_work/text/story_done_compare_summary.json", `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main();
