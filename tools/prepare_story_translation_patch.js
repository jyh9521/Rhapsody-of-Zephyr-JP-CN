const fs = require("fs");
const path = require("path");

const STORY_TSV = path.join("_work", "text", "story_ac_bf.tsv");
const NAMES_TSV = path.join("_work", "text", "speaker_names_to_translate.tsv");
const OUT_JSON = path.join("_work", "text", "story_ac_bf_translated_from_tsv.json");
const OUT_REPORT = path.join("_work", "text", "story_ac_bf_translation_prepare_report.json");

function readTsv(file) {
  const raw = fs.readFileSync(file, "utf8").replace(/^﻿/, "").trimEnd();
  const lines = raw ? raw.split(/\r?\n/) : [];
  if (!lines.length) return { header: [], rows: [] };
  const header = lines.shift().split("\t");
  const rows = lines.map((line, index) => {
    const cols = line.split("\t");
    while (cols.length < header.length) {
      cols.push("");
    }
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

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadNameMap() {
  const { header, rows } = readTsv(NAMES_TSV);
  const jpIndex = header.indexOf("jp_name");
  const cnIndex = header.indexOf("cn_name");
  const draftIndex = header.indexOf("current_draft");
  if (jpIndex < 0 || cnIndex < 0) {
    throw new Error(`${NAMES_TSV}: missing jp_name/cn_name columns`);
  }

  return rows
    .map((row) => ({
      jp: row.jp_name.trim(),
      cn: row.cn_name.trim(),
      draft: draftIndex >= 0 ? (row.current_draft || "").trim() : "",
    }))
    .filter((row) => row.jp && row.cn)
    .sort((a, b) => b.jp.length - a.jp.length || a.jp.localeCompare(b.jp, "ja"));
}

function applyNameMap(text, nameMap) {
  let out = text;
  let replacements = 0;
  for (const { jp, cn } of nameMap) {
    if (!out.includes(jp)) continue;
    const before = out;
    out = out.replace(new RegExp(escapeRe(jp), "g"), cn);
    if (out !== before) replacements += 1;
  }
  return { text: out, replacements };
}

// Speaker markers like [CN name] must stay Shift-JIS in the game data:
// the engine appears to match the bracketed name against an internal name
// registry, and a GBK name there breaks the lookup (suspected crash source).
// Restore any bracketed cn_name/current_draft form back to [jp_name].
// The visible name plate is converted to Chinese at draw time by ZPGDI.dll.
function restoreJpMarkers(text, nameMap) {
  let restored = 0;
  const unknown = [];
  const out = text.replace(/\[([^\]]*)\]/g, (whole, inner) => {
    const key = inner.replace(/\/n/g, "").replace(/[\s　]+$/g, "");
    const keyJp = key.replace(/·/g, "・");
    for (const { jp, cn, draft } of nameMap) {
      if (keyJp === jp) {
        if (key !== keyJp) { restored += 1; return `[${jp}]`; }
        return whole;
      }
      const cnTail = cn.includes(" ") ? cn.split(" ").pop() : cn;
      if (key === cn || key === cnTail || (draft && key === draft)) {
        restored += 1;
        return `[${jp}]`;
      }
    }
    unknown.push(inner);
    return whole;
  });
  return { text: out, restored, unknown };
}

function normalizeTranslation(text) {
  return String(text || "")
    .replace(/・/g, "·")
    .replace(/〜/g, "～");
}

function main() {
  const nameMap = loadNameMap();
  const { header, rows } = readTsv(STORY_TSV);
  const required = ["id", "source", "offset", "byteLength", "text", "translation"];
  for (const key of required) {
    if (!header.includes(key)) throw new Error(`${STORY_TSV}: missing ${key} column`);
  }

  const prepared = [];
  const nameReplacementRows = [];
  const markerRestoredRows = [];
  const unknownMarkers = [];
  const droppedMarkerRows = [];
  for (const row of rows) {
    const translation = normalizeTranslation((row.translation || "").trim());
    if (!translation) continue;
    const mapped = applyNameMap(translation, nameMap);
    const restoredMarkers = restoreJpMarkers(mapped.text, nameMap);
    const item = {
      id: row.id,
      source: row.source,
      offset: Number(row.offset),
      byteLength: Number(row.byteLength),
      encoding: "cp936",
      transform: "bf_sub",
      text: row.text,
      translation: restoredMarkers.text,
    };
    prepared.push(item);
    if (mapped.replacements) {
      nameReplacementRows.push({
        id: row.id,
        replacements: mapped.replacements,
        before: translation,
        after: restoredMarkers.text,
      });
    }
    if (restoredMarkers.restored) {
      markerRestoredRows.push({ id: row.id, restored: restoredMarkers.restored });
    }
    for (const inner of restoredMarkers.unknown) {
      unknownMarkers.push({ id: row.id, marker: inner });
    }
    const origMarkers = (row.text.match(/\[[^\]]*\]/g) || []).length;
    const newMarkers = (restoredMarkers.text.match(/\[[^\]]*\]/g) || []).length;
    if (origMarkers !== newMarkers) {
      droppedMarkerRows.push({ id: row.id, original: origMarkers, translated: newMarkers });
    }
  }

  writeJson(OUT_JSON, prepared);
  writeJson(OUT_REPORT, {
    generatedAt: new Date().toISOString(),
    storyTsv: STORY_TSV,
    namesTsv: NAMES_TSV,
    outJson: OUT_JSON,
    nameMapEntries: nameMap.length,
    translatedRows: prepared.length,
    rowsWithNameReplacements: nameReplacementRows.length,
    rowsWithMarkersRestoredToJp: markerRestoredRows.length,
    unknownMarkers: unknownMarkers.slice(0, 100),
    rowsWithMarkerCountMismatch: droppedMarkerRows,
    nameReplacementRows: nameReplacementRows.slice(0, 200),
  });

  console.log(`name map entries=${nameMap.length}`);
  console.log(`translated rows=${prepared.length}`);
  console.log(`rows with name replacements=${nameReplacementRows.length}`);
  console.log(`rows with markers restored to JP=${markerRestoredRows.length}`);
  console.log(`unknown markers=${unknownMarkers.length}, marker-count mismatches=${droppedMarkerRows.length}`);
  console.log(`wrote ${OUT_JSON}`);
  console.log(`wrote ${OUT_REPORT}`);
}

main();
