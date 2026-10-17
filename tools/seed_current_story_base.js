const fs = require("fs");
const path = require("path");
const { parseHeader } = require("./zep_archive");
const { decodeResource } = require("./zep_decode");

const patchPath = process.argv[2] || path.join("_work", "text", "story_done_final_cn_markers_translated.json");
const stageRoot = process.argv[3] || "_work/patched_decoded_story_current_base";
const rows = JSON.parse(fs.readFileSync(patchPath, "utf8"));
const sourceRe = /^_work[\\/]all_decoded[\\/]ZEP_DAT(\d+)__(.+)\.bin$/i;
const wanted = new Map();

for (const row of rows) {
  const match = sourceRe.exec(row.source || "");
  if (!match) throw new Error(`Unexpected story source path: ${row.source}`);
  const archive = Number(match[1]);
  const resource = match[2];
  wanted.set(`${archive}:${resource}`, { archive, resource, source: row.source });
}

const archives = new Map();
for (const item of wanted.values()) {
  if (!archives.has(item.archive)) {
    const hdrPath = `ZEP_DAT${item.archive}.HDR`;
    const libPath = `ZEP_DAT${item.archive}.LIB`;
    const entries = new Map(parseHeader(hdrPath).entries.map((entry) => [entry.name, entry]));
    archives.set(item.archive, { entries, lib: fs.readFileSync(libPath) });
  }
}

for (const item of wanted.values()) {
  const archive = archives.get(item.archive);
  const entry = archive.entries.get(item.resource);
  if (!entry) throw new Error(`Missing ZEP_DAT${item.archive} resource: ${item.resource}`);
  const decoded = decodeResource(archive.lib.subarray(entry.offset, entry.offset + entry.size)).data;
  const output = path.join(stageRoot, item.source);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, decoded);
}

console.log(JSON.stringify({
  patchPath,
  stageRoot,
  translatedRows: rows.length,
  seededResources: wanted.size,
  archives: [...archives.keys()].sort((a, b) => a - b),
}, null, 2));
