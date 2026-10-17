const fs = require("fs");
const path = require("path");

const STORY_JSON = path.join("_work", "text", "story_ac_bf.json");
const OUT_DIR = path.join("_work", "text");
const MIN_FILTERED_COUNT = 3;
const MIN_RAW_COUNT = 2;

const labelRe = /\[([^\]\r\n]{1,60})\]/g;

const genericKanjiStops = new Set([
  "私", "自分", "今", "今日", "明日", "昨日", "一体", "本当", "今回", "今後",
  "現在", "以前", "以上", "以下", "必要", "大丈夫", "全部", "全員", "全て",
  "少し", "相手", "場所", "時間", "一緒", "最近", "普通", "確か", "多分",
  "無理", "本気", "大変", "重要", "関係", "問題", "理由", "方法", "予定",
  "最初", "最後", "名前", "人間", "人々", "誰", "何", "何者", "何事",
  "事", "者", "奴", "連中", "方", "様", "気", "力", "物", "今度",
  "本来", "本物", "偽物", "他", "前", "後", "中", "外", "上", "下",
  "東", "西", "南", "北", "入口", "出口", "内部", "地下", "部屋",
  "今日", "状態", "情報", "成功", "失敗", "可能", "不可能", "無駄",
  "安心", "確認", "準備", "説明", "相談", "協力", "戦闘", "攻撃",
]);

const genericKanaStops = new Set([
  "そう", "どう", "ここ", "そこ", "あそこ", "これ", "それ", "あれ",
  "もちろん", "ありがとう", "こんにちは", "こんばんは", "さようなら",
]);

function tsvCell(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/\t/g, " ");
}

function compactText(value) {
  return String(value ?? "")
    .replace(/\/n/g, " ")
    .replace(/\/[0-9a-fA-F]{1,3}[a-zA-Z]?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTerm(term) {
  return String(term || "")
    .replace(/[ \u3000]+/g, "")
    .replace(/[。、，,.!?！？:：;；"'“”‘’（）()<>＜＞「」『』【】]/g, "")
    .trim();
}

function getRow(map, kind, term) {
  const key = `${kind}\u0000${term}`;
  if (!map.has(key)) {
    map.set(key, {
      kind,
      term,
      count: 0,
      resources: new Set(),
      firstId: "",
      firstResource: "",
      examples: [],
    });
  }
  return map.get(key);
}

function addTerm(map, kind, term, rec) {
  const clean = normalizeTerm(term);
  if (!clean) return;
  if (clean.length < 2) return;
  if (/^[0-9０-９]+$/.test(clean)) return;

  const row = getRow(map, kind, clean);
  row.count += 1;
  if (rec.resource) row.resources.add(rec.resource);
  if (!row.firstId) {
    row.firstId = rec.id || "";
    row.firstResource = rec.resource || "";
  }
  if (row.examples.length < 3) {
    row.examples.push(`${rec.id}: ${compactText(rec.text).slice(0, 100)}`);
  }
}

function addMatches(map, kind, re, text, rec) {
  let match;
  while ((match = re.exec(text))) {
    addTerm(map, kind, match[0], rec);
  }
}

function stripControls(text) {
  return String(text || "")
    .replace(/\/n/g, " ")
    .replace(/\/[0-9a-fA-F]{1,3}[a-zA-Z]?/g, " ")
    .replace(/[［］\[\]\r\n\t]/g, " ");
}

function isUsefulFiltered(row) {
  if (row.count < MIN_FILTERED_COUNT) return false;
  if (row.kind === "kanji_compound" && genericKanjiStops.has(row.term)) return false;
  if (row.kind === "katakana_term" && genericKanaStops.has(row.term)) return false;
  if (row.kind === "katakana_term" && row.term.length < 4 && row.count < 5) return false;
  if (row.kind === "kanji_compound" && row.term.length < 3 && row.count < 6) return false;
  return true;
}

function rowsFromMap(map, minCount, filterFn = null) {
  return [...map.values()]
    .filter((row) => row.count >= minCount)
    .filter((row) => (filterFn ? filterFn(row) : true))
    .sort((a, b) => b.count - a.count || b.resources.size - a.resources.size || a.term.localeCompare(b.term, "ja"));
}

function writeTerms(file, rows) {
  const header = ["kind", "jp_term", "cn_term", "count", "resource_count", "first_resource", "first_id", "examples"];
  const lines = [header.join("\t")];
  for (const row of rows) {
    lines.push(
      [
        row.kind,
        row.term,
        "",
        row.count,
        row.resources.size,
        row.firstResource,
        row.firstId,
        row.examples.join(" | "),
      ].map(tsvCell).join("\t")
    );
  }
  fs.writeFileSync(file, `\ufeff${lines.join("\r\n")}\r\n`, "utf8");
}

function main() {
  if (!fs.existsSync(STORY_JSON)) {
    throw new Error(`Missing ${STORY_JSON}`);
  }
  const story = JSON.parse(fs.readFileSync(STORY_JSON, "utf8"));
  const terms = new Map();
  const speakers = new Map();

  for (const rec of story) {
    const original = rec.text || "";
    let labelMatch;
    while ((labelMatch = labelRe.exec(original))) {
      addTerm(speakers, "speaker_label", labelMatch[1], rec);
    }

    const text = stripControls(original.replace(labelRe, " "));

    addMatches(terms, "middle_dot_name_or_term", /[ァ-ヶー]{2,}(?:・[ァ-ヶー0-9０-９ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+)+/g, text, rec);
    addMatches(terms, "mixed_name_or_term", /(?:[ァ-ヶーＡ-ＺA-Z0-9０-９ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+[一-龯々]+|[一-龯々]+[ァ-ヶーＡ-ＺA-Z0-9０-９ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+)[一-龯々ァ-ヶーＡ-ＺA-Z0-9０-９ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ・ー]*/g, text, rec);
    addMatches(terms, "katakana_term", /[ァ-ヶー]{3,}/g, text, rec);
    addMatches(terms, "kanji_compound", /[一-龯々]{2,}/g, text, rec);
    addMatches(terms, "fullwidth_ascii_term", /[Ａ-Ｚ]{2,}[一-龯々ァ-ヶーＡ-Ｚ0-9０-９]*/g, text, rec);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const speakerRows = rowsFromMap(speakers, 1);
  const rawRows = rowsFromMap(new Map([...terms, ...speakers]), MIN_RAW_COUNT);
  const filteredRows = rowsFromMap(new Map([...terms, ...speakers]), MIN_FILTERED_COUNT, isUsefulFiltered);
  const katakanaRows = rowsFromMap(terms, 1, (row) =>
    row.kind === "katakana_term" || row.kind === "middle_dot_name_or_term" || row.kind === "mixed_name_or_term"
  );
  const kanjiRows = rowsFromMap(terms, MIN_FILTERED_COUNT, (row) => row.kind === "kanji_compound" && !genericKanjiStops.has(row.term));

  writeTerms(path.join(OUT_DIR, "glossary_terms_highfreq.tsv"), filteredRows);
  writeTerms(path.join(OUT_DIR, "glossary_terms_all_raw.tsv"), rawRows);
  writeTerms(path.join(OUT_DIR, "glossary_terms_katakana.tsv"), katakanaRows);
  writeTerms(path.join(OUT_DIR, "glossary_terms_kanji.tsv"), kanjiRows);
  writeTerms(path.join(OUT_DIR, "glossary_terms_speakers.tsv"), speakerRows);

  fs.writeFileSync(
    path.join(OUT_DIR, "glossary_terms_summary.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: STORY_JSON,
        thresholds: {
          filtered: MIN_FILTERED_COUNT,
          raw: MIN_RAW_COUNT,
        },
        counts: {
          speakerLabels: speakerRows.length,
          highfreqFiltered: filteredRows.length,
          allRaw: rawRows.length,
          katakanaAndMixed: katakanaRows.length,
          kanji: kanjiRows.length,
        },
        topFiltered: filteredRows.slice(0, 100).map((row) => ({
          kind: row.kind,
          term: row.term,
          count: row.count,
          resources: row.resources.size,
          firstId: row.firstId,
        })),
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`speaker labels: ${speakerRows.length}`);
  console.log(`high-frequency filtered terms: ${filteredRows.length}`);
  console.log(`raw terms count>=${MIN_RAW_COUNT}: ${rawRows.length}`);
  console.log(`katakana/mixed terms: ${katakanaRows.length}`);
  console.log(`kanji terms count>=${MIN_FILTERED_COUNT}: ${kanjiRows.length}`);
  console.log(`wrote ${path.join(OUT_DIR, "glossary_terms_highfreq.tsv")}`);
}

main();
