const fs = require("fs");
const path = require("path");

const STORY_TSV = "story_done.tsv";
const OUT_TSV = path.join("_work", "text", "untranslated_candidates.tsv");
const OUT_JSON = path.join("_work", "text", "untranslated_candidates_report.json");

function readTsv(file) {
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").trimEnd();
  const lines = raw ? raw.split(/\r?\n/) : [];
  if (!lines.length) return { header: [], rows: [] };
  const header = lines.shift().split("\t");
  const rows = lines.map((line, index) => {
    const cols = line.split("\t");
    while (cols.length < header.length) cols.push("");
    const row = {};
    header.forEach((key, i) => {
      row[key] = cols[i] || "";
    });
    row.__line = index + 2;
    return row;
  });
  return { header, rows };
}

function hasKana(s) {
  return /[\u3040-\u30ff\uff61-\uff9f]/.test(s);
}

function hasJapaneseKanjiCue(s) {
  return /[隊長個獲発見戦闘勝利敗北敵味方剣撃槍砲術薬鍵扉箱壊開閉]/.test(s);
}

function hasCjk(s) {
  return /[\u3400-\u9fff]/.test(s);
}

function visibleTextLike(s) {
  const text = s.replace(/\/[0-9a-f]{1,2}[a-z]?/gi, "").replace(/\/n/g, "").replace(/\[[^\]]*\]/g, "");
  if (!text.trim()) return false;
  if (/^[A-Z0-9_+\-\[\]().:%\s]+$/.test(text)) return false;
  return hasKana(text) || hasCjk(text);
}

function classify(row) {
  const text = row.text || "";
  const translation = row.translation || "";
  const reasons = [];
  if (!translation.trim() && visibleTextLike(text)) reasons.push("blank_translation");
  if (translation.trim() && hasKana(translation)) reasons.push("translation_has_kana");
  if (translation.includes("隊長")) reasons.push("translation_has_taichou");
  if (translation.includes("行け")) reasons.push("translation_has_ike");
  if (!translation.trim() && text.includes("隊長")) reasons.push("source_has_taichou_blank");
  if (!translation.trim() && text.includes("行け")) reasons.push("source_has_ike_blank");
  if (!translation.trim() && !hasKana(text) && hasJapaneseKanjiCue(text)) reasons.push("japanese_kanji_cue_blank");
  return reasons;
}

function main() {
  const { rows } = readTsv(STORY_TSV);
  const candidates = [];
  const counts = {};
  for (const row of rows) {
    const reasons = classify(row);
    if (!reasons.length) continue;
    for (const reason of reasons) counts[reason] = (counts[reason] || 0) + 1;
    candidates.push({
      reason: reasons.join(","),
      line: row.__line,
      id: row.id,
      source: row.source,
      offset: row.offset,
      byteLength: row.byteLength,
      text: row.text,
      translation: row.translation,
    });
  }

  fs.mkdirSync(path.dirname(OUT_TSV), { recursive: true });
  const header = ["reason", "line", "id", "source", "offset", "byteLength", "text", "translation"];
  const lines = [header.join("\t")];
  for (const row of candidates) {
    lines.push(header.map((key) => String(row[key] ?? "").replace(/\r?\n/g, "\\n")).join("\t"));
  }
  fs.writeFileSync(OUT_TSV, `${lines.join("\n")}\n`, "utf8");
  fs.writeFileSync(
    OUT_JSON,
    `${JSON.stringify({ candidateCount: candidates.length, counts, outTsv: OUT_TSV }, null, 2)}\n`,
    "utf8",
  );
  console.log(`candidates=${candidates.length}`);
  console.log(JSON.stringify(counts, null, 2));
  console.log(`wrote ${OUT_TSV}`);
}

main();
