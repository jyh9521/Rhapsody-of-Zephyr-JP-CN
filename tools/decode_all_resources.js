const fs = require("fs");
const path = require("path");
const { decodeResource } = require("./zep_decode");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function safeOutPath(root, file) {
  const rel = path.relative(root, file).replace(/[\\/]/g, "__");
  return path.join("_work", "all_decoded", `${rel}.bin`);
}

function main() {
  const root = process.argv[2] || path.join("_work", "extracted");
  const files = walk(root);
  let ok = 0;
  let fail = 0;
  const errors = [];
  for (const file of files) {
    try {
      const input = fs.readFileSync(file);
      const decoded = decodeResource(input);
      const out = safeOutPath(root, file);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, decoded.data);
      ok++;
    } catch (err) {
      fail++;
      errors.push({ file: path.relative(process.cwd(), file), error: err.message });
    }
  }
  fs.mkdirSync(path.join("_work", "all_decoded"), { recursive: true });
  fs.writeFileSync(path.join("_work", "all_decoded_errors.json"), JSON.stringify(errors, null, 2));
  console.log(`decoded ok=${ok} fail=${fail} out=_work/all_decoded`);
}

if (require.main === module) main();
