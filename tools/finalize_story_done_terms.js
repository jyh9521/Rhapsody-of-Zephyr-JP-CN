const fs = require("fs");
const path = require("path");

const STORY = "story_done.tsv";
const OUT_REPORT = path.join("_work", "text", "story_done_term_finalize_report.json");

function readTsv(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  const trailingBlank = lines.length && lines[lines.length - 1] === "";
  if (trailingBlank) lines.pop();
  const header = lines.shift().split("\t");
  return {
    header,
    rows: lines.map((line, index) => {
      const cells = line.split("\t");
      while (cells.length < header.length) cells.push("");
      return { cells, line: index + 2 };
    }),
    trailingBlank,
  };
}

function writeTsv(file, header, rows, trailingBlank) {
  const lines = [header.join("\t"), ...rows.map((row) => row.cells.join("\t"))];
  fs.writeFileSync(file, "\uFEFF" + lines.join("\n") + (trailingBlank ? "\n" : ""), "utf8");
}

function parseTable(file) {
  if (!fs.existsSync(file)) return [];
  const parsed = readTsv(file);
  return parsed.rows.map((row) => {
    const obj = { __line: row.line };
    parsed.header.forEach((key, index) => {
      obj[key] = row.cells[index] || "";
    });
    return obj;
  });
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceAll(text, from, to) {
  if (!from || from === to || !text.includes(from)) return { text, count: 0 };
  let count = 0;
  const out = text.replace(new RegExp(escapeRe(from), "g"), () => {
    count += 1;
    return to;
  });
  return { text: out, count };
}

function loadSpeakerRows() {
  return parseTable(path.join("_work", "text", "speaker_names_to_translate.tsv"))
    .map((row) => ({
      jp: (row.jp_name || "").trim(),
      cn: (row.cn_name || "").trim(),
      draft: (row.current_draft || "").trim(),
    }))
    .filter((row) => row.jp && row.cn)
    .sort((a, b) => b.jp.length - a.jp.length || a.jp.localeCompare(b.jp, "ja"));
}

function loadClassRows() {
  return parseTable(path.join("_work", "text", "ch_class_names_to_translate.tsv"))
    .map((row) => ({
      jp: (row.jp_class || "").trim(),
      cn: (row.cn_class || "").trim(),
    }))
    .filter((row) => row.jp && row.cn)
    .sort((a, b) => b.jp.length - a.jp.length || a.jp.localeCompare(b.jp, "ja"));
}

function loadEquipmentRows() {
  const rows = [];
  for (const row of parseTable(path.join("_work", "text", "tables_bf.tsv"))) {
    const jp = String(row.text || "").replace(/[\x00-\x1f]/g, "").replace(/^[%.・･\s]+/u, "").trim();
    const cn = String(row.translation || "").replace(/[\x00-\x1f]/g, "").replace(/^[%.・･\s]+/u, "").trim();
    if (jp && cn) rows.push({ jp, cn, source: "tables_bf" });
  }
  for (const row of parseTable(path.join("_work", "text", "equipment_names_to_translate.tsv"))) {
    const jp = (row.jp_name || "").trim();
    const cn = (row.cn_name || "").trim();
    if (jp && cn) rows.push({ jp, cn, source: "equipment_pending" });
  }
  const best = new Map();
  for (const row of rows) {
    if (!best.has(row.jp) || row.source === "equipment_pending") best.set(row.jp, row);
  }
  return [...best.values()].sort((a, b) => b.jp.length - a.jp.length || a.jp.localeCompare(b.jp, "ja"));
}

function buildMarkerMap(speakers) {
  const variants = new Map();
  for (const { jp, cn, draft } of speakers) {
    if (!variants.has(jp)) variants.set(jp, new Set());
    variants.get(jp).add(jp);
    variants.get(jp).add(cn);
    if (draft) variants.get(jp).add(draft);
    variants.get(jp).add(cn.replace(/·/g, "・"));
    variants.get(jp).add(cn.replace(/・/g, "·"));
  }
  return variants;
}

function normalizeMarker(inner) {
  return inner.replace(/\/n/g, "").replace(/\s+$/g, "").replace(/　+$/g, "");
}

function fixMarkers(text, markerMap, speakers) {
  let changed = 0;
  const out = text.replace(/\[([^\]]*)\]/g, (whole, inner) => {
    const key = normalizeMarker(inner);
    for (const { jp, cn } of speakers) {
      const vars = markerMap.get(jp);
      if (vars && vars.has(key)) {
        if (inner === cn) return whole;
        changed += 1;
        return `[${cn}]`;
      }
    }
    return whole;
  });
  return { text: out, changed };
}

function gatedReplace(text, jpText, jpTerm, variants, canonical) {
  if (!jpText.includes(jpTerm)) return { text, count: 0 };
  let total = 0;
  let out = text;
  for (const variant of variants) {
    const result = replaceAll(out, variant, canonical);
    out = result.text;
    total += result.count;
  }
  return { text: out, count: total };
}

function main() {
  const parsed = readTsv(STORY);
  const textIndex = parsed.header.indexOf("text");
  const transIndex = parsed.header.indexOf("translation");
  const idIndex = parsed.header.indexOf("id");
  if (textIndex < 0 || transIndex < 0 || idIndex < 0) throw new Error("story_done.tsv missing required columns");

  const speakers = loadSpeakerRows();
  const classes = loadClassRows();
  const equipment = loadEquipmentRows();
  const markerMap = buildMarkerMap(speakers);

  const manualByJp = new Map([
    ["マキャベリー", [["马基雅维里", "马基雅维利"]]],
    ["メディチ", [["梅迪奇", "梅迪西"], ["梅迪琪", "梅迪西"]]],
    ["ゲイシル兵士", [["盖希尔士兵", "盖西尔士兵"]]],
    ["ＺＦ補給班", [["西风猎鹰补给班", "ZF补给班"]]],
    ["ＺＦ内務班", [["西风猎鹰后勤部", "ZF后勤部"]]],
    ["ＺＦ警備班", [["西风猎鹰警备部", "ZF警备部"]]],
    ["ＺＦ購買班", [["西风猎鹰采购部", "ZF采购部"]]],
    ["ゼフィール射手", [["西风猎鹰射手", "ZF射手"]]],
    ["地理学会会員", [["地理学会成员", "地理学会会员"]]],
    ["シラノ", [["希罗/n尼", "希罗尼"], ["シラノ", "希罗尼"], ["希拉诺", "希罗尼"]]],
    ["デイモス", [["暗黑神 戴摩斯", "戴摩斯"], ["デイモス", "戴摩斯"]]],
    ["ルーク・バーンスタイン", [["ルーク・バーンスタイン", "卢克·伯恩斯坦"]]],
    ["闇の声", [["闇の声", "黑暗之声"]]],
    ["警備兵", [["警備兵", "警卫兵"]]],
    ["酒場店主", [["酒場店主", "酒馆老板"]]],
    ["水夫", [["水夫", "水手"]]],
    ["白髪の囚人", [["白髪の囚人", "白发囚犯"]]],
    ["シード", [["西德", "希德"]]],
    ["ユスタシア", [["尤斯坦西亚", "尤斯塔西亚"]]],
    ["ルイ", [["鲁伊", "路易"]]],
    ["神の祝福", [["神的祝福", "神之祝福"]]],
    ["ソードブレーカ", [["剑刃破坏者", "碎剑者"]]],
    ["キリアムソード", [["基里亚姆之剑", "基里亚姆剑"]]],
    ["アルマダ", [["阿尔玛达", "无敌舰队"]]],
    ["ジューレンタル", [["杜兰达尔", "尤伦塔尔"]]],
    ["エリクサー", [["圣灵药", "万灵药"]]],
    ["クリサオル", [["克律萨奥尔", "克律萨俄耳"], ["黄金剑", "克律萨俄耳"]]],
    ["グラム", [["格拉姆", "格拉墨"], ["斩龙剑", "格拉墨"]]],
    ["ファランクス", [["方阵枪", "方阵长枪"]]],
    ["サリサダ", [["莎莉莎达", "萨里沙"]]],
    ["ポーション", [["药水", "回复药"]]],
    ["マシンガン", [["机枪", "机关枪"]]],
    ["スチレット", [["匕首", "短锥剑"]]],
    ["カサンドラ", [["预言者之剑", "卡珊德拉"]]],
    ["エストック", [["长剑", "穿甲剑"]]],
    ["闘技場の元締め", [["斗技场老板", "竞技场负责人"]]],
  ]);

  const canonicalByJp = new Map();
  for (const row of [...equipment, ...classes, ...speakers]) {
    if (!canonicalByJp.has(row.jp)) canonicalByJp.set(row.jp, row.cn);
  }

  let rowsChanged = 0;
  let markerChanges = 0;
  let termChanges = 0;
  const changedRows = [];

  for (const row of parsed.rows) {
    const id = row.cells[idIndex] || "";
    const jpText = row.cells[textIndex] || "";
    let translation = row.cells[transIndex] || "";
    const before = translation;

    const fixedMarkers = fixMarkers(translation, markerMap, speakers);
    translation = fixedMarkers.text;
    markerChanges += fixedMarkers.changed;

    for (const [jp, pairs] of manualByJp) {
      const canonical = canonicalByJp.get(jp) || (pairs[0] ? pairs[0][1] : "");
      for (const [variant, target] of pairs) {
        const result = gatedReplace(translation, jpText, jp, [variant], target || canonical);
        translation = result.text;
        termChanges += result.count;
      }
    }

    if (translation !== before) {
      row.cells[transIndex] = translation;
      rowsChanged += 1;
      changedRows.push({ id, before, after: translation });
    }
  }

  const backup = `${STORY}.bak_before_final_term_unify_${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
  fs.copyFileSync(STORY, backup);
  writeTsv(STORY, parsed.header, parsed.rows, parsed.trailingBlank);
  fs.writeFileSync(
    OUT_REPORT,
    JSON.stringify(
      {
        backup,
        rowsChanged,
        markerChanges,
        termChanges,
        changedRows: changedRows.slice(0, 300),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.log(`backup=${backup}`);
  console.log(`rowsChanged=${rowsChanged} markerChanges=${markerChanges} termChanges=${termChanges}`);
  console.log(`report=${OUT_REPORT}`);
}

main();
