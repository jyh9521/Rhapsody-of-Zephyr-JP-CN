const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join("_work", "text");

function readUtf8(file) {
  return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
}

function parseTsv(file) {
  if (!fs.existsSync(file)) return [];
  const text = readUtf8(file);
  const lines = text.split(/\r?\n/).filter((line) => line.length);
  if (!lines.length) return [];
  const header = lines.shift().split("\t");
  return lines.map((line, lineIndex) => {
    const cells = line.split("\t");
    const row = { __file: file, __line: lineIndex + 2 };
    for (let i = 0; i < header.length; i++) row[header[i]] = cells[i] ?? "";
    return row;
  });
}

function tsvEscape(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, "\\n")
    .replace(/\t/g, " ");
}

function writeTsv(file, rows, header) {
  const lines = [header.join("\t")];
  for (const row of rows) lines.push(header.map((key) => tsvEscape(row[key])).join("\t"));
  fs.writeFileSync(file, "\uFEFF" + lines.join("\n") + "\n", "utf8");
}

function normalizeJp(raw) {
  return String(raw ?? "")
    .replace(/[\x00-\x1f]/g, "")
    .replace(/^[%.・･\s]+/u, "")
    .trim()
    .normalize("NFKC");
}

function normalizeCn(raw) {
  return String(raw ?? "")
    .replace(/[\x00-\x1f]/g, "")
    .replace(/^[%.・･\s]+/u, "")
    .trim()
    .normalize("NFKC");
}

function addPair(pairs, category, jp, cn, source, detail) {
  const jpKey = normalizeJp(jp);
  const cnKey = normalizeCn(cn);
  if (!jpKey || !cnKey) return;
  pairs.push({
    category,
    jp: jpKey,
    cn: cnKey,
    source,
    detail,
  });
}

function collectPairs() {
  const pairs = [];

  for (const row of parseTsv(path.join(OUT_DIR, "speaker_names_to_translate.tsv"))) {
    addPair(
      pairs,
      "speaker",
      row.jp_name,
      row.cn_name,
      row.__file,
      `line=${row.__line}; count=${row.count || ""}; first=${row.first_id || ""}`,
    );
  }

  for (const row of parseTsv(path.join(OUT_DIR, "ch_class_names_to_translate.tsv"))) {
    addPair(
      pairs,
      "class",
      row.jp_class,
      row.cn_class,
      row.__file,
      `line=${row.__line}; count=${row.count || ""}; first=${row.first_resource || ""}`,
    );
  }

  for (const row of parseTsv(path.join(OUT_DIR, "equipment_names_to_translate.tsv"))) {
    addPair(
      pairs,
      row.source?.includes("ATC") ? "attack_skill_pending" : "equipment_pending",
      row.jp_name,
      row.cn_name,
      row.__file,
      `line=${row.__line}; source=${row.source || ""}; offset=${row.text_offset_hex || row.offset_hex || ""}`,
    );
  }

  for (const row of parseTsv(path.join(OUT_DIR, "tables_bf.tsv"))) {
    const src = row.source || "";
    addPair(
      pairs,
      src.includes("ATC") ? "attack_skill_installed_table" : "item_installed_table",
      row.text,
      row.translation,
      row.__file,
      `line=${row.__line}; source=${src}; offset=${row.offset || ""}`,
    );
  }

  for (const row of parseTsv(path.join(OUT_DIR, "exe_strings_to_translate.tsv"))) {
    addPair(
      pairs,
      `exe:${row.category || ""}`,
      row.jp_text,
      row.cn_text,
      row.__file,
      `line=${row.__line}; offset=${row.offset_hex || ""}`,
    );
  }

  const storyRows = parseTsv("story_done.tsv");
  for (const row of storyRows) {
    const jpLabels = [...String(row.text || "").matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
    const cnLabels = [...String(row.translation || "").matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
    const n = Math.min(jpLabels.length, cnLabels.length);
    for (let i = 0; i < n; i++) {
      addPair(
        pairs,
        "story_bracket_label",
        jpLabels[i],
        cnLabels[i],
        "story_done.tsv",
        `line=${row.__line}; id=${row.id || ""}`,
      );
    }
  }

  return pairs;
}

function duplicateByJp(pairs) {
  const grouped = new Map();
  for (const pair of pairs) {
    if (!grouped.has(pair.jp)) grouped.set(pair.jp, []);
    grouped.get(pair.jp).push(pair);
  }

  const rows = [];
  for (const [jp, items] of grouped) {
    const cnSet = new Set(items.map((x) => x.cn));
    if (cnSet.size <= 1) continue;
    rows.push({
      jp,
      cn_count: cnSet.size,
      cn_values: [...cnSet].join(" | "),
      categories: [...new Set(items.map((x) => x.category))].join(" | "),
      occurrences: items
        .map((x) => `${x.category}:${x.cn} @ ${x.detail}`)
        .slice(0, 30)
        .join(" || "),
    });
  }
  rows.sort((a, b) => Number(b.cn_count) - Number(a.cn_count) || a.jp.localeCompare(b.jp, "ja"));
  return rows;
}

function duplicateStoryRows() {
  const grouped = new Map();
  for (const row of parseTsv("story_done.tsv")) {
    const jp = String(row.text || "").trim();
    const cn = String(row.translation || "").trim();
    if (!jp || !cn) continue;
    if (!grouped.has(jp)) grouped.set(jp, []);
    grouped.get(jp).push({ cn, id: row.id, line: row.__line });
  }
  const rows = [];
  for (const [jp, items] of grouped) {
    const cnSet = new Set(items.map((x) => x.cn));
    if (cnSet.size <= 1) continue;
    rows.push({
      jp_text: jp,
      cn_count: cnSet.size,
      cn_values: [...cnSet].join(" | "),
      occurrences: items.map((x) => `${x.id}@line${x.line}:${x.cn}`).join(" || "),
    });
  }
  rows.sort((a, b) => Number(b.cn_count) - Number(a.cn_count) || a.jp_text.localeCompare(b.jp_text, "ja"));
  return rows;
}

function canonicalPairs(pairs, duplicateRows) {
  const conflicted = new Set(duplicateRows.map((row) => row.jp));
  const priority = new Map([
    ["speaker", 1],
    ["class", 2],
    ["equipment_pending", 3],
    ["attack_skill_pending", 4],
    ["item_installed_table", 5],
    ["attack_skill_installed_table", 6],
  ]);
  const best = new Map();
  for (const pair of pairs) {
    if (conflicted.has(pair.jp)) continue;
    if (!priority.has(pair.category)) continue;
    if (pair.jp.length < 2 || pair.cn.length < 1) continue;
    const rank = priority.get(pair.category);
    const old = best.get(pair.jp);
    if (!old || rank < old.rank) best.set(pair.jp, { ...pair, rank });
  }
  return [...best.values()]
    .filter((p) => p.jp.length >= 3 || /[\u30a0-\u30ff]/.test(p.jp))
    .sort((a, b) => b.jp.length - a.jp.length);
}

function storyTermMisses(canon) {
  const genericJp = new Set([
    "不明",
    "囚人",
    "少年",
    "少女",
    "青年",
    "女の子",
    "お金",
    "補助",
    "魔法",
  ]);
  const rows = [];
  const storyRows = parseTsv("story_done.tsv");
  const katakanaOrMark = /[\u30a0-\u30ffー]/u;
  const matchesTerm = (text, term) => {
    let pos = text.indexOf(term);
    while (pos >= 0) {
      const before = pos > 0 ? text[pos - 1] : "";
      const after = pos + term.length < text.length ? text[pos + term.length] : "";
      if (!(katakanaOrMark.test(term) && (katakanaOrMark.test(before) || katakanaOrMark.test(after)))) {
        return true;
      }
      pos = text.indexOf(term, pos + 1);
    }
    return false;
  };
  for (const row of storyRows) {
    const jpText = row.text || "";
    const cnText = normalizeCn(row.translation || "");
    for (const p of canon) {
      if (genericJp.has(p.jp)) continue;
      if (!matchesTerm(jpText, p.jp)) continue;
      if (cnText.includes(p.cn)) continue;
      rows.push({
        id: row.id,
        jp_term: p.jp,
        expected_cn: p.cn,
        category: p.category,
        jp_text: jpText,
        cn_text: row.translation || "",
      });
      break;
    }
  }
  return rows;
}

function reverseDuplicateByCn(pairs) {
  const grouped = new Map();
  for (const pair of pairs) {
    if (!grouped.has(pair.cn)) grouped.set(pair.cn, []);
    grouped.get(pair.cn).push(pair);
  }
  const rows = [];
  for (const [cn, items] of grouped) {
    const jpSet = new Set(items.map((x) => x.jp));
    if (jpSet.size <= 1) continue;
    rows.push({
      cn,
      jp_count: jpSet.size,
      jp_values: [...jpSet].join(" | "),
      categories: [...new Set(items.map((x) => x.category))].join(" | "),
      occurrences: items.map((x) => `${x.category}:${x.jp} @ ${x.detail}`).slice(0, 30).join(" || "),
    });
  }
  rows.sort((a, b) => Number(b.jp_count) - Number(a.jp_count) || a.cn.localeCompare(b.cn, "zh"));
  return rows;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const pairs = collectPairs();
  const duplicateRows = duplicateByJp(pairs);
  const storyDupRows = duplicateStoryRows();
  const canon = canonicalPairs(pairs, duplicateRows);
  const storyMissRows = storyTermMisses(canon);
  const reverseRows = reverseDuplicateByCn(pairs);

  writeTsv(path.join(OUT_DIR, "translation_consistency_jp_to_cn_conflicts.tsv"), duplicateRows, [
    "jp",
    "cn_count",
    "cn_values",
    "categories",
    "occurrences",
  ]);
  writeTsv(path.join(OUT_DIR, "translation_consistency_story_duplicate_rows.tsv"), storyDupRows, [
    "jp_text",
    "cn_count",
    "cn_values",
    "occurrences",
  ]);
  writeTsv(path.join(OUT_DIR, "translation_consistency_story_term_misses.tsv"), storyMissRows, [
    "id",
    "jp_term",
    "expected_cn",
    "category",
    "jp_text",
    "cn_text",
  ]);
  writeTsv(path.join(OUT_DIR, "translation_consistency_cn_to_jp_same_cn.tsv"), reverseRows, [
    "cn",
    "jp_count",
    "jp_values",
    "categories",
    "occurrences",
  ]);

  const summary = {
    pairs: pairs.length,
    jpToCnConflicts: duplicateRows.length,
    exactStoryDuplicateConflicts: storyDupRows.length,
    storyTermMisses: storyMissRows.length,
    cnToJpSameCn: reverseRows.length,
    outputs: {
      jpToCnConflicts: path.join(OUT_DIR, "translation_consistency_jp_to_cn_conflicts.tsv"),
      storyDuplicateRows: path.join(OUT_DIR, "translation_consistency_story_duplicate_rows.tsv"),
      storyTermMisses: path.join(OUT_DIR, "translation_consistency_story_term_misses.tsv"),
      cnToJpSameCn: path.join(OUT_DIR, "translation_consistency_cn_to_jp_same_cn.tsv"),
    },
  };
  fs.writeFileSync(
    path.join(OUT_DIR, "translation_consistency_summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
    "utf8",
  );
  console.log(JSON.stringify(summary, null, 2));
}

main();
