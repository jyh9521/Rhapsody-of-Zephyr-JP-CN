const fs = require("fs");

const storyPath = process.argv[2] || "_work/text/story_done.tsv";
const reportPaths = process.argv.slice(3);
if (!reportPaths.length) {
  reportPaths.push(
    "_work/text/story_done_control_token_mismatches.tsv",
    "_work/text/story_done_japanese_middle_dot_rows.tsv",
  );
}

function parseDelimited(text, delimiter = "\t") {
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") rows.pop();
  if (!rows.length) return { header: [], rows: [] };
  const header = rows.shift();
  return {
    header,
    rows: rows.map((fields, index) => {
      const out = { __line: index + 2 };
      for (let i = 0; i < header.length; i++) out[header[i]] = fields[i] ?? "";
      return out;
    }),
  };
}

function serializePlainTsv(header, rows) {
  const lines = [header.join("\t")];
  for (const row of rows) {
    lines.push(header.map((key) => String(row[key] ?? "").replace(/\r?\n/g, "/n")).join("\t"));
  }
  return `${lines.join("\r\n")}\r\n`;
}

function main() {
  const storyParsed = parseDelimited(fs.readFileSync(storyPath, "utf8"));
  const storyHeader = storyParsed.header;
  const storyRows = storyParsed.rows;
  if (!storyHeader.includes("id") || !storyHeader.includes("translation")) {
    throw new Error(`story TSV missing id/translation columns: ${storyPath}`);
  }

  const updates = new Map();
  const conflicts = [];
  const reportStats = [];
  for (const reportPath of reportPaths) {
    const parsed = parseDelimited(fs.readFileSync(reportPath, "utf8"));
    if (!parsed.header.includes("id") || !parsed.header.includes("translation")) {
      throw new Error(`report TSV missing id/translation columns: ${reportPath}`);
    }
    let usable = 0;
    for (const row of parsed.rows) {
      const id = row.id;
      const translation = row.translation ?? "";
      if (!id || !translation) continue;
      usable++;
      if (updates.has(id) && updates.get(id).translation !== translation) {
        conflicts.push({
          id,
          firstReport: updates.get(id).reportPath,
          secondReport: reportPath,
          firstTranslation: updates.get(id).translation,
          secondTranslation: translation,
        });
      }
      updates.set(id, { translation, reportPath });
    }
    reportStats.push({ reportPath, rows: parsed.rows.length, usable });
  }

  const missingIds = [];
  let changed = 0;
  let unchanged = 0;
  const storyById = new Map(storyRows.map((row) => [row.id, row]));
  for (const [id, update] of updates.entries()) {
    const row = storyById.get(id);
    if (!row) {
      missingIds.push(id);
      continue;
    }
    if (row.translation === update.translation) {
      unchanged++;
    } else {
      row.translation = update.translation;
      changed++;
    }
  }

  if (conflicts.length) {
    fs.writeFileSync(
      "_work/text/story_done_report_merge_conflicts.json",
      `${JSON.stringify({ conflicts }, null, 2)}\n`,
      "utf8",
    );
  }

  const backupPath = `${storyPath}.bak_before_report_merge_20260706`;
  if (!fs.existsSync(backupPath)) fs.copyFileSync(storyPath, backupPath);
  fs.writeFileSync(storyPath, serializePlainTsv(storyHeader, storyRows), "utf8");

  const summary = {
    storyPath,
    backupPath,
    reportStats,
    updateIds: updates.size,
    changed,
    unchanged,
    conflictCount: conflicts.length,
    conflictPolicy: "later report wins",
    missingIds,
    missingIdCount: missingIds.length,
  };
  fs.writeFileSync("_work/text/story_done_report_merge_summary.json", `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main();
