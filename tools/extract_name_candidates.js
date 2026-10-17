const fs = require("fs");
const path = require("path");

const STORY_JSON = path.join("_work", "text", "story_ac_bf.json");
const OUT_DIR = path.join("_work", "text");

const draftCn = new Map([
  ["メディチ", "梅迪奇"],
  ["ルイ", "路易"],
  ["ボルス", "波尔斯"],
  ["カイン", "凯因"],
  ["ミレー", "米蕾"],
  ["アーウィン", "阿尔文"],
  ["白髪の囚人", "白发囚犯"],
  ["リデル", "莉迪尔"],
  ["クラウジビッツ", "克劳塞维茨"],
  ["シラノ", "西拉诺"],
  ["カーナ", "卡娜"],
  ["イザベル", "伊莎贝尔"],
  ["クリス", "克莉丝"],
  ["エスメラルダ", "艾丝梅拉达"],
  ["ディアブロ", "迪亚布罗"],
]);

function tsvCell(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/\t/g, " ");
}

function compactText(value) {
  return String(value ?? "")
    .replace(/\/n/g, " ")
    .replace(/\/[0-9a-fA-F]{2,3}[a-zA-Z]?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getOrCreate(map, name, kind) {
  if (!map.has(name)) {
    map.set(name, {
      name,
      kind,
      count: 0,
      firstId: "",
      firstResource: "",
      examples: [],
    });
  }
  return map.get(name);
}

function addHit(map, name, kind, rec) {
  const clean = String(name || "").trim();
  if (!clean) return;
  const row = getOrCreate(map, clean, kind);
  row.count += 1;
  if (!row.firstId) {
    row.firstId = rec.id || "";
    row.firstResource = rec.resource || "";
  }
  if (row.examples.length < 3) {
    row.examples.push(`${rec.id}: ${compactText(rec.text).slice(0, 90)}`);
  }
}

function classifyLabel(label) {
  if (/^\d+:/.test(label)) return "map_or_scene_label";
  if (/^[A-Za-z0-9_:-]+$/.test(label)) return "control_or_ascii_label";
  return "speaker_label";
}

function writeRows(file, rows, includeKind = true) {
  const header = includeKind
    ? ["kind", "jp_name", "cn_name", "current_draft", "count", "first_resource", "first_id", "examples"]
    : ["jp_name", "cn_name", "current_draft", "count", "first_resource", "first_id", "examples"];
  const lines = [header.join("\t")];
  for (const row of rows) {
    const base = [
      row.name,
      draftCn.get(row.name) || "",
      draftCn.get(row.name) || "",
      row.count,
      row.firstResource,
      row.firstId,
      row.examples.join(" | "),
    ];
    const cells = includeKind ? [row.kind, ...base] : base;
    lines.push(cells.map(tsvCell).join("\t"));
  }
  fs.writeFileSync(file, `${lines.join("\r\n")}\r\n`, "utf8");
}

function writeSimpleRows(file, rows) {
  const header = ["jp_name", "cn_name", "current_draft", "count", "first_resource", "first_id"];
  const lines = [header.join("\t")];
  for (const row of rows) {
    lines.push(
      [
        row.name,
        draftCn.get(row.name) || "",
        draftCn.get(row.name) || "",
        row.count,
        row.firstResource,
        row.firstId,
      ]
        .map(tsvCell)
        .join("\t")
    );
  }
  fs.writeFileSync(file, `${lines.join("\r\n")}\r\n`, "utf8");
}

function main() {
  if (!fs.existsSync(STORY_JSON)) {
    throw new Error(`Missing ${STORY_JSON}. Run the story text extractor first.`);
  }

  const story = JSON.parse(fs.readFileSync(STORY_JSON, "utf8"));
  const labels = new Map();
  const mentions = new Map();
  const labelRe = /\[([^\]\r\n]{1,60})\]/g;

  for (const rec of story) {
    const text = rec.text || "";
    let match;
    while ((match = labelRe.exec(text))) {
      const label = match[1].trim();
      addHit(labels, label, classifyLabel(label), rec);
    }
  }

  const speakerNames = new Set(
    [...labels.values()]
      .filter((row) => row.kind === "speaker_label")
      .map((row) => row.name)
  );

  for (const rec of story) {
    const text = (rec.text || "").replace(labelRe, " ");

    for (const name of speakerNames) {
      if (name.length < 2) continue;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(escaped, "g");
      let match;
      while ((match = re.exec(text))) {
        addHit(mentions, name, "speaker_name_mentioned_in_body", rec);
      }
    }

    const middleDotRe = /[ァ-ヶー]{2,}(?:・[ァ-ヶー]{1,})+/g;
    while ((match = middleDotRe.exec(text))) {
      addHit(mentions, match[0], "middle_dot_name_candidate", rec);
    }
  }

  const byFirstSeen = (a, b) => {
    const aId = a.firstId || "";
    const bId = b.firstId || "";
    return aId.localeCompare(bId, "ja") || a.name.localeCompare(b.name, "ja");
  };
  const byKindThenFirst = (a, b) =>
    a.kind.localeCompare(b.kind, "en") || byFirstSeen(a, b);

  const speakerRows = [...labels.values()]
    .filter((row) => row.kind === "speaker_label")
    .sort(byFirstSeen);
  const allLabelRows = [...labels.values()].sort(byKindThenFirst);
  const mentionRows = [...mentions.values()]
    .filter((row) => !speakerNames.has(row.name) || row.kind !== "speaker_name_mentioned_in_body")
    .sort(byKindThenFirst);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  writeSimpleRows(path.join(OUT_DIR, "speaker_names_to_translate.tsv"), speakerRows);
  writeRows(path.join(OUT_DIR, "speaker_names_for_translation.tsv"), speakerRows, false);
  writeRows(path.join(OUT_DIR, "all_bracket_labels_for_review.tsv"), allLabelRows, true);
  writeRows(path.join(OUT_DIR, "inline_name_candidates_for_review.tsv"), mentionRows, true);
  fs.writeFileSync(
    path.join(OUT_DIR, "name_candidates_for_translation.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: STORY_JSON,
        speakerLabels: speakerRows,
        allBracketLabels: allLabelRows,
        inlineCandidates: mentionRows,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`speaker labels: ${speakerRows.length}`);
  console.log(`all bracket labels: ${allLabelRows.length}`);
  console.log(`inline candidates: ${mentionRows.length}`);
  console.log(`wrote ${path.join(OUT_DIR, "speaker_names_to_translate.tsv")}`);
  console.log(`wrote ${path.join(OUT_DIR, "speaker_names_for_translation.tsv")}`);
  console.log(`wrote ${path.join(OUT_DIR, "all_bracket_labels_for_review.tsv")}`);
  console.log(`wrote ${path.join(OUT_DIR, "inline_name_candidates_for_review.tsv")}`);
}

main();
