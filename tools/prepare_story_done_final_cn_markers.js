const fs = require("fs");
const path = require("path");

const STORY_TSV = process.env.STORY_TSV || path.join("_work", "text", "story_done.tsv");
const SPEAKER_TSV = process.env.SPEAKER_TSV || path.join("_work", "text", "speaker_names_to_translate.tsv");
const OUT_JSON = path.join("_work", "text", "story_done_final_cn_markers_translated.json");
const OUT_REPORT = path.join("_work", "text", "story_done_final_cn_markers_prepare_report.json");

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
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function loadSpeakerMarkerMap() {
  if (!fs.existsSync(SPEAKER_TSV)) return new Map();
  const { header, rows } = readTsv(SPEAKER_TSV);
  const jpKey = header.includes("jp_name") ? "jp_name" : null;
  const cnKey = header.includes("cn_name") ? "cn_name" : null;
  if (!jpKey || !cnKey) return new Map();

  const map = new Map();
  for (const row of rows) {
    const jp = (row[jpKey] || "").trim();
    const cn = (row[cnKey] || "").trim();
    if (!jp || !cn) continue;
    map.set(jp, cn);
    map.set(jp.replace(/・/g, "·"), cn);
    map.set(jp.replace(/·/g, "・"), cn);
  }
  return map;
}

function normalizeTranslation(text) {
  return String(text || "")
    .replace(/繝ｻ/g, "ﾂｷ")
    .replace(/縲・/g, "・")
    .replace(/・/g, "·");
}

function trimAsciiWhitespace(text) {
  return String(text || "").replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
}

function normalizeMarkers(text, speakerMap) {
  if (!speakerMap.size) return text;
  return text.replace(/\[([^\]]+)\]/g, (whole, inner) => {
    const mapped = speakerMap.get(inner) || speakerMap.get(inner.replace(/·/g, "・")) || speakerMap.get(inner.replace(/・/g, "·"));
    return mapped ? `[${mapped}]` : whole;
  });
}

function fitKnownCnMarkerOverflow(id, text) {
  if (id === "2:FL02_S04._AC:0015c7") {
    return text.replace("[黑暗之声]/n人类之子啊……", "[黑暗之声]/n人类之子啊。");
  }
  return text;
}

function main() {
  const { header, rows } = readTsv(STORY_TSV);
  const speakerMap = loadSpeakerMarkerMap();
  for (const key of ["id", "source", "offset", "byteLength", "text", "translation"]) {
    if (!header.includes(key)) throw new Error(`${STORY_TSV}: missing ${key}`);
  }

  const prepared = [];
  const markerRows = [];
  const jpMarkerRows = [];
  for (const row of rows) {
    const translation = fitKnownCnMarkerOverflow(row.id, normalizeMarkers(normalizeTranslation(trimAsciiWhitespace(row.translation)), speakerMap));
    if (!translation) continue;
    const markers = translation.match(/\[[^\]]*\]/g) || [];
    if (markers.length) markerRows.push({ id: row.id, markers });
    const jpMarkers = markers.filter((m) => /[\u3040-\u30ff\u31f0-\u31ff]/.test(m));
    if (jpMarkers.length) jpMarkerRows.push({ id: row.id, markers: jpMarkers });
    prepared.push({
      id: row.id,
      source: row.source,
      offset: Number(row.offset),
      byteLength: Number(row.byteLength),
      encoding: "cp936",
      transform: "bf_sub",
      text: row.text,
      translation,
    });
  }

  writeJson(OUT_JSON, prepared);
  writeJson(OUT_REPORT, {
    generatedAt: new Date().toISOString(),
    storyTsv: STORY_TSV,
    speakerTsv: SPEAKER_TSV,
    outJson: OUT_JSON,
    speakerMarkerMapSize: speakerMap.size,
    translatedRows: prepared.length,
    rowsWithMarkers: markerRows.length,
    rowsWithJapaneseKanaMarkers: jpMarkerRows.length,
    japaneseKanaMarkersSample: jpMarkerRows.slice(0, 100),
  });
  console.log(`translated rows=${prepared.length}`);
  console.log(`rows with markers=${markerRows.length}`);
  console.log(`rows with Japanese-kana markers=${jpMarkerRows.length}`);
  console.log(`wrote ${OUT_JSON}`);
  console.log(`wrote ${OUT_REPORT}`);
}

main();
