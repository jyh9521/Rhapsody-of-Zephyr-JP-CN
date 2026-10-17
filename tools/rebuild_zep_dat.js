const fs = require("fs");
const path = require("path");
const { parseHeader } = require("./zep_archive");
const { encodeLiteralResource } = require("./zep_decode");

function replacementPath(root, archive, resource) {
  return path.join(root, "_work", "all_decoded", `ZEP_DAT${archive}__${resource}.bin`);
}

function rebuildArchive(archive, replacementsRoot, outRoot) {
  const hdrPath = `ZEP_DAT${archive}.HDR`;
  const libPath = `ZEP_DAT${archive}.LIB`;
  const parsed = parseHeader(hdrPath);
  const hdr = fs.readFileSync(hdrPath);
  const lib = fs.readFileSync(libPath);
  const outHdr = Buffer.from(hdr);
  const chunks = [];
  const manifest = [];
  let offset = 0;

  for (const entry of parsed.entries) {
    const decodedReplacement = replacementPath(replacementsRoot, archive, entry.name);
    let encoded;
    let replaced = false;

    if (fs.existsSync(decodedReplacement)) {
      encoded = encodeLiteralResource(fs.readFileSync(decodedReplacement));
      replaced = true;
    } else {
      encoded = lib.subarray(entry.offset, entry.offset + entry.size);
    }

    outHdr.writeUInt32LE(offset, entry.headerOffset + 16);
    outHdr.writeUInt32LE(encoded.length, entry.headerOffset + 20);
    chunks.push(encoded);
    manifest.push({
      archive,
      resource: entry.name,
      offset,
      size: encoded.length,
      originalOffset: entry.offset,
      originalSize: entry.size,
      replaced,
    });
    offset += encoded.length;
  }

  fs.mkdirSync(outRoot, { recursive: true });
  fs.writeFileSync(path.join(outRoot, `ZEP_DAT${archive}.HDR`), outHdr);
  fs.writeFileSync(path.join(outRoot, `ZEP_DAT${archive}.LIB`), Buffer.concat(chunks));
  return manifest;
}

function main() {
  const replacementsRoot = path.resolve(process.argv[2] || "_work/patched_decoded");
  const outRoot = path.resolve(process.argv[3] || "_work/rebuilt_dat");
  const archives = (process.env.ARCHIVES || "0,1,2,3,4,5,6")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value));

  const manifest = [];
  for (const archive of archives) {
    if (!fs.existsSync(`ZEP_DAT${archive}.HDR`)) continue;
    manifest.push(...rebuildArchive(archive, replacementsRoot, outRoot));
  }

  fs.writeFileSync(path.join(outRoot, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  const replaced = manifest.filter((row) => row.replaced).length;
  console.log(`archives=${archives.join(",")} resources=${manifest.length} replaced=${replaced} -> ${outRoot}`);
}

if (require.main === module) main();
