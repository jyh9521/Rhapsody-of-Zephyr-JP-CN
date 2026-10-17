const fs = require("fs");
const path = require("path");

const TABLE = path.join("_work", "text", "equipment_names_to_translate.tsv");
const REPORT = path.join("_work", "text", "equipment_names_apply_report.json");

function readTsv(file) {
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").trimEnd();
  const lines = raw ? raw.split(/\r?\n/) : [];
  if (!lines.length) return { header: [], rows: [] };
  const header = lines.shift().split("\t");
  return {
    header,
    rows: lines.map((line, index) => {
      const cols = line.split("\t");
      while (cols.length < header.length) cols.push("");
      const row = { __line: index + 2 };
      header.forEach((key, i) => {
        row[key] = cols[i] || "";
      });
      return row;
    }),
  };
}

function bf(data) {
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) out[i] = (0xbf - data[i]) & 0xff;
  return out;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "_" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function main() {
  const { rows } = readTsv(TABLE);
  const bySource = new Map();
  const skipped = [];
  for (const row of rows) {
    const source = (row.source || "").trim();
    const cn = (row.cn_name || "").trim();
    if (!source || !cn) {
      skipped.push({ line: row.__line, source, jp_name: row.jp_name || "", reason: "missing source/cn_name" });
      continue;
    }
    const offset = Number.parseInt(row.text_offset_hex || row.offset_hex || "", 16);
    const capacity = Number(row.byte_capacity);
    if (!Number.isInteger(offset) || !Number.isInteger(capacity) || capacity <= 0) {
      skipped.push({ line: row.__line, source, jp_name: row.jp_name || "", reason: "bad offset/capacity" });
      continue;
    }
    const encoded = Buffer.from(cn, "gbk");
    if (encoded.length > capacity) {
      skipped.push({
        line: row.__line,
        source,
        jp_name: row.jp_name || "",
        cn_name: cn,
        reason: "overflow",
        need: encoded.length,
        capacity,
      });
      continue;
    }
    if (!bySource.has(source)) bySource.set(source, []);
    bySource.get(source).push({ line: row.__line, offset, capacity, jp_name: row.jp_name || "", cn_name: cn, encoded });
  }

  const stamp = timestamp();
  const patched = [];
  const backups = [];
  for (const [source, sourceRows] of bySource) {
    if (!fs.existsSync(source)) {
      for (const row of sourceRows) skipped.push({ line: row.line, source, jp_name: row.jp_name, reason: "missing source" });
      continue;
    }
    const data = Buffer.from(fs.readFileSync(source));
    const backup = `${source}.bak_before_equipment_names_${stamp}`;
    fs.copyFileSync(source, backup);
    backups.push(backup);
    for (const row of sourceRows) {
      const plain = Buffer.concat([row.encoded, Buffer.alloc(row.capacity - row.encoded.length, 0)]);
      bf(plain).copy(data, row.offset);
      patched.push({
        source,
        line: row.line,
        offset: `0x${row.offset.toString(16).padStart(6, "0")}`,
        jp_name: row.jp_name,
        cn_name: row.cn_name,
        capacity: row.capacity,
        used: row.encoded.length,
      });
    }
    fs.writeFileSync(source, data);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    table: TABLE,
    backups,
    patchedCount: patched.length,
    skippedCount: skipped.length,
    patched,
    skipped,
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`patched=${patched.length} skipped=${skipped.length}`);
  console.log(`report=${REPORT}`);
  if (skipped.length) {
    for (const row of skipped.slice(0, 20)) console.log(`SKIP line=${row.line} ${row.source} ${row.jp_name} ${row.reason}`);
    process.exitCode = 1;
  }
}

main();
