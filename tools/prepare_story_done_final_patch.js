const fs = require("fs");
const path = require("path");

const STORY_TSV = "story_done.tsv";
const NAMES_TSV = path.join("_work", "text", "speaker_names_to_translate.tsv");
const OUT_JSON = path.join("_work", "text", "story_done_final_translated.json");
const OUT_REPORT = path.join("_work", "text", "story_done_final_prepare_report.json");

function readTsv(file) {
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").trimEnd();
  const lines = raw ? raw.split(/\r?\n/) : [];
  if (!lines.length) return { header: [], rows: [] };
  const header = lines.shift().split("\t");
  const rows = lines.map((line, index) => {
    const cols = line.split("\t");
    while (cols.length < header.length) cols.push("");
    if (cols.length !== header.length) {
      throw new Error(`${file}:${index + 2}: expected ${header.length} columns, got ${cols.length}`);
    }
    const row = {};
    header.forEach((key, i) => {
      row[key] = cols[i] || "";
    });
    return row;
  });
  return { header, rows };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function loadNameMap() {
  const { rows } = readTsv(NAMES_TSV);
  return rows
    .map((row) => ({
      jp: (row.jp_name || "").trim(),
      cn: (row.cn_name || "").trim(),
      draft: (row.current_draft || "").trim(),
    }))
    .filter((row) => row.jp && row.cn)
    .sort((a, b) => b.jp.length - a.jp.length || a.jp.localeCompare(b.jp, "ja"));
}

function normalizeTranslation(text) {
  return String(text || "").replace(/・/g, "·").replace(/〜/g, "～");
}

function restoreJpMarkers(text, nameMap) {
  let restored = 0;
  const unknown = [];
  const out = text.replace(/\[([^\]]*)\]/g, (whole, inner) => {
    const key = inner.replace(/\/n/g, "").replace(/[\s　]+$/g, "");
    const keyJp = key.replace(/·/g, "・");
    if (nameMap.some(({ jp }) => keyJp === jp)) return whole;
    for (const { jp, cn, draft } of nameMap) {
      const cnTail = cn.includes(" ") ? cn.split(" ").pop() : cn;
      const candidates = new Set([cn, cnTail, cn.replace(/·/g, "・"), cn.replace(/・/g, "·")]);
      if (draft) {
        candidates.add(draft);
        candidates.add(draft.replace(/·/g, "・"));
        candidates.add(draft.replace(/・/g, "·"));
      }
      if (candidates.has(key)) {
        restored += 1;
        return `[${jp}]`;
      }
    }
    unknown.push(inner);
    return whole;
  });
  return { text: out, restored, unknown };
}

function main() {
  const nameMap = loadNameMap();
  const { header, rows } = readTsv(STORY_TSV);
  for (const key of ["id", "source", "offset", "byteLength", "text", "translation"]) {
    if (!header.includes(key)) throw new Error(`${STORY_TSV}: missing ${key}`);
  }

  const prepared = [];
  const restoredRows = [];
  const unknownMarkers = [];
  const droppedMarkerRows = [];
  for (const row of rows) {
    const translation = normalizeTranslation((row.translation || "").trim());
    if (!translation) continue;
    const restored = restoreJpMarkers(translation, nameMap);
    prepared.push({
      id: row.id,
      source: row.source,
      offset: Number(row.offset),
      byteLength: Number(row.byteLength),
      encoding: "cp936",
      transform: "bf_sub",
      text: row.text,
      translation: restored.text,
    });
    if (restored.restored) restoredRows.push({ id: row.id, restored: restored.restored });
    for (const marker of restored.unknown) unknownMarkers.push({ id: row.id, marker });
    const origMarkers = (row.text.match(/\[[^\]]*\]/g) || []).length;
    const newMarkers = (restored.text.match(/\[[^\]]*\]/g) || []).length;
    if (origMarkers !== newMarkers) droppedMarkerRows.push({ id: row.id, original: origMarkers, translated: newMarkers });
  }

  writeJson(OUT_JSON, prepared);
  writeJson(OUT_REPORT, {
    generatedAt: new Date().toISOString(),
    storyTsv: STORY_TSV,
    namesTsv: NAMES_TSV,
    outJson: OUT_JSON,
    nameMapEntries: nameMap.length,
    translatedRows: prepared.length,
    rowsWithMarkersRestoredToJp: restoredRows.length,
    unknownMarkers: unknownMarkers.slice(0, 200),
    unknownMarkerCount: unknownMarkers.length,
    rowsWithMarkerCountMismatch: droppedMarkerRows,
  });
  console.log(`name map entries=${nameMap.length}`);
  console.log(`translated rows=${prepared.length}`);
  console.log(`rows with markers restored to JP=${restoredRows.length}`);
  console.log(`unknown markers=${unknownMarkers.length}, marker-count mismatches=${droppedMarkerRows.length}`);
  console.log(`wrote ${OUT_JSON}`);
  console.log(`wrote ${OUT_REPORT}`);
}

main();
