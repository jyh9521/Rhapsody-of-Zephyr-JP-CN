const fs = require("fs");
const path = require("path");

const ROOT = "_work/current_decoded_for_scan";
const STORY = process.env.STORY_TSV || path.join("_work", "text", "story_done.tsv");
const FINAL_STORY_JSON = "_work/text/story_done_final_cn_markers_translated.json";
const OUT = "_work/text/installed_visible_japanese_candidates_to_translate.tsv";
const REPORT = "_work/text/installed_visible_japanese_candidates_to_translate_report.json";
const dec = new TextDecoder("shift_jis");

function deobfuscate(buf) {
  const out = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = (0xbf - buf[i]) & 0xff;
  return out;
}

function isAscii(b) {
  return b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126);
}

function isLead(b) {
  return (b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc);
}

function isTrail(b) {
  return (b >= 0x40 && b <= 0x7e) || (b >= 0x80 && b <= 0xfc);
}

function isActionLabel(text) {
  return /^(未使用|歩き|走り|ダッシュ|弱攻撃|強攻撃|基本待機|状態異常|戦闘不能|防御待機|回避待機|対話_|イベント|アイテム|つるはし|宝箱開け|上昇中|下降中|しゃがむ|ダメージ|ジャンプ|ターン|待機|防御|回避|勝利ポーズ)/.test(text);
}

function looksVisibleJapanese(text) {
  if (!text || /[\uff61-\uff9f\ufffd]/.test(text)) return false;
  if (isActionLabel(text)) return false;
  if (/[ぁ-んァ-ヶー]/.test(text)) return true;
  return /(隊長|行け|囚人|牢屋|魔装機|未使用|誰だ|待て)/.test(text);
}

function normalizeForSearch(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function parseStoryTranslations() {
  const raw = fs.readFileSync(STORY, "utf8").replace(/^\uFEFF/, "").replace(/\0/g, "");
  const lines = raw.split(/\r?\n/);
  const header = lines.shift().split("\t");
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const map = new Map();
  const storyTexts = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = line.split("\t");
    const text = cols[idx.text] || "";
    const translation = cols[idx.translation] || "";
    if (text && translation) storyTexts.push(normalizeForSearch(text));
    if (!text || !translation) continue;
    if (!map.has(text)) map.set(text, new Set());
    map.get(text).add(translation);
  }
  if (fs.existsSync(FINAL_STORY_JSON)) {
    const rows = JSON.parse(fs.readFileSync(FINAL_STORY_JSON, "utf8"));
    for (const row of rows) {
      if (row.text && row.translation) storyTexts.push(normalizeForSearch(row.text));
    }
  }
  return { exactMap: map, storyTexts };
}

function findStoryFullTextMatch(text, storyTexts) {
  const needle = normalizeForSearch(text);
  if (!needle) return null;
  for (const storyText of storyTexts) {
    if (storyText === needle) return { type: "exact", text: storyText };
    if (storyText.includes(needle)) return { type: "contained", text: storyText };
  }
  return null;
}

function scanFile(file) {
  const rows = [];
  const buf = deobfuscate(fs.readFileSync(file));
  let i = 0;
  while (i < buf.length) {
    const start = i;
    const bytes = [];
    while (i < buf.length) {
      const b = buf[i];
      if (isAscii(b)) {
        bytes.push(b);
        i++;
        continue;
      }
      if (isLead(b) && i + 1 < buf.length && isTrail(buf[i + 1])) {
        bytes.push(b, buf[i + 1]);
        i += 2;
        continue;
      }
      break;
    }
    if (bytes.length >= 4) {
      const text = dec.decode(Buffer.from(bytes)).replace(/\s+/g, " ").trim();
      if (looksVisibleJapanese(text)) {
        rows.push({ file: path.basename(file), offset: start, byteLength: bytes.length, text });
      }
    }
    if (i === start) i++;
  }
  return rows;
}

function tsvField(value) {
  return `"${String(value ?? "").replace(/"/g, '""').replace(/\r?\n/g, "\\n")}"`;
}

function buildGroups(rows) {
  const groups = [];
  const byFile = new Map();
  for (const row of rows) {
    if (!byFile.has(row.file)) byFile.set(row.file, []);
    byFile.get(row.file).push(row);
  }

  for (const [file, fileRows] of byFile) {
    fileRows.sort((a, b) => a.offset - b.offset);
    let current = [];
    for (const row of fileRows) {
      const prev = current[current.length - 1];
      if (prev && row.offset - (prev.offset + prev.byteLength) > 2) {
        groups.push({ file, rows: current });
        current = [];
      }
      current.push(row);
    }
    if (current.length) groups.push({ file, rows: current });
  }

  groups.forEach((group, index) => {
    group.id = `g${String(index + 1).padStart(4, "0")}`;
    group.text = group.rows.map((row) => row.text).join(" /slot/ ");
  });
  return groups;
}

function main() {
  const { exactMap: storyMap, storyTexts } = parseStoryTranslations();
  const rows = [];
  for (const name of fs.readdirSync(ROOT)) {
    const file = path.join(ROOT, name);
    if (fs.statSync(file).isFile()) rows.push(...scanFile(file));
  }

  const filteredRows = [];
  const excludedByStory = [];
  for (const row of rows) {
    const match = findStoryFullTextMatch(row.text, storyTexts);
    if (match) {
      excludedByStory.push({ ...row, matchType: match.type });
    } else {
      filteredRows.push(row);
    }
  }

  const groups = buildGroups(filteredRows);
  const groupByRow = new Map();
  for (const group of groups) {
    group.rows.forEach((row, index) => {
      groupByRow.set(row, {
        groupId: group.id,
        groupIndex: index + 1,
        groupCount: group.rows.length,
        groupText: group.text,
      });
    });
  }

  const outRows = filteredRows.map((row) => {
    const matches = Array.from(storyMap.get(row.text) || []);
    const group = groupByRow.get(row);
    return {
      group_id: group.groupId,
      group_index: group.groupIndex,
      group_count: group.groupCount,
      file: row.file,
      offset_hex: `0x${row.offset.toString(16)}`,
      offset: row.offset,
      byteLength: row.byteLength,
      jp_text: row.text,
      group_jp_text: group.groupText,
      suggested_cn: matches.length === 1 ? matches[0] : "",
      existing_translation_count: matches.length,
    };
  });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const header = [
    "group_id",
    "group_index",
    "group_count",
    "file",
    "offset_hex",
    "offset",
    "byteLength",
    "jp_text",
    "group_jp_text",
    "suggested_cn",
    "existing_translation_count",
  ];
  fs.writeFileSync(
    OUT,
    "\uFEFF" +
      [header.map(tsvField).join("\t"), ...outRows.map((row) => header.map((key) => tsvField(row[key])).join("\t"))].join("\n") +
      "\n",
    "utf8",
  );
  const uniqueAuto = outRows.filter((row) => row.existing_translation_count === 1).length;
  const ambiguous = outRows.filter((row) => row.existing_translation_count > 1).length;
  const noSuggestion = outRows.filter((row) => row.existing_translation_count === 0).length;
  fs.writeFileSync(
    REPORT,
    JSON.stringify(
      {
        scannedCandidates: rows.length,
        excludedByStoryFullText: excludedByStory.length,
        count: outRows.length,
        groups: groups.length,
        multiRowGroups: groups.filter((group) => group.rows.length > 1).length,
        uniqueAuto,
        ambiguous,
        noSuggestion,
        out: OUT,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.log(
    `scanned=${rows.length} excludedByStoryFullText=${excludedByStory.length} count=${outRows.length} groups=${groups.length} uniqueAuto=${uniqueAuto} ambiguous=${ambiguous} noSuggestion=${noSuggestion}`,
  );
  console.log(`wrote ${OUT}`);
}

main();
