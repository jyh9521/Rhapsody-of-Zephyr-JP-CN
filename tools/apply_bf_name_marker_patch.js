const fs = require("fs");
const path = require("path");
const { parseHeader } = require("./zep_archive");
const { decodeResource, encodeLiteralResource } = require("./zep_decode");

const replacements = [
  ["メディチ", "5b83818366834283605d", "5bc3b7b5cfc6e620205d"], // [梅迪奇  ]
  ["ルイ", "5b838b83435d", "5bc2b7d2d75d"], // [路易]
  ["ボルス", "5b837b838b83585d", "5bb2a8b6fbcbb95d"], // [波尔斯]
  ["カイン", "5b834a834383935d", "5bbfadd2f220205d"], // [凯因  ]
  ["ミレー", "5b837e838c815b5d", "5bc3d7c0d920205d"], // [米蕾  ]
  ["アーウィン", "5b8341815b8345834283935d", "5bb0a2b6fbcec4202020205d"], // [阿尔文    ]
  ["白髪の囚人", "5b949294af82cc8efa906c5d", "5bb0d7b7a2c7f4b7b820205d"], // [白发囚犯  ]
  ["リデル", "5b838a8366838b5d", "5bc0f2b5cfb6fb5d"], // [莉迪尔]
  ["クラウジビッツ", "5b834e8389834583578372836283635d", "5bbfcbc0cdc8fbceacb4c4202020205d"], // [克劳塞维茨    ]
  ["シラノ", "5b83568389836d5d", "5bcef7c0adc5b55d"], // [西拉诺]
  ["カーナ", "5b834a815b83695d", "5bbfa8c4c820205d"], // [卡娜  ]
  ["イザベル", "5b834383558378838b5d", "5bd2c1c9afb1b4b6fb5d"], // [伊莎贝尔]
  ["クリス", "5b834e838a83585d", "5bbfcbc0f2cbbf5d"], // [克莉丝]
  ["エスメラルダ", "5b8347835883818389838b835f5d", "5bb0accbbfc3b7c0adb4ef20205d"], // [艾丝梅拉达  ]
  ["ディアブロ", "5b8366834283418375838d5d", "5bb5cfd1c7b2bcc2de20205d"], // [迪亚布罗  ]
].map(([name, fromHex, toHex]) => {
  const from = obfuscate(Buffer.from(fromHex, "hex"));
  const to = obfuscate(Buffer.from(toHex, "hex"));
  if (from.length !== to.length) {
    throw new Error(`${name}: length mismatch ${from.length} !== ${to.length}`);
  }
  return { name, from, to };
});

function obfuscate(buf) {
  return Buffer.from(buf).map((b) => (0xbf - b) & 0xff);
}

function replaceAll(buf, from, to) {
  let count = 0;
  for (let off = buf.indexOf(from); off >= 0; off = buf.indexOf(from, off + to.length)) {
    to.copy(buf, off);
    count++;
  }
  return count;
}

function backupOnce(file) {
  const backup = `${file}.bak_before_name_markers`;
  if (!fs.existsSync(backup)) {
    fs.copyFileSync(file, backup);
    console.log(`Created backup ${backup}`);
  }
}

function patchArchive(index) {
  const hdrPath = `ZEP_DAT${index}.HDR`;
  const libPath = `ZEP_DAT${index}.LIB`;
  if (!fs.existsSync(hdrPath) || !fs.existsSync(libPath)) return null;

  const parsed = parseHeader(hdrPath);
  const hdr = fs.readFileSync(hdrPath);
  const lib = fs.readFileSync(libPath);
  const outHdr = Buffer.from(hdr);
  const chunks = [];
  const counts = new Map();
  let archiveChanged = 0;
  let offset = 0;

  for (const entry of parsed.entries) {
    const raw = lib.subarray(entry.offset, entry.offset + entry.size);
    let encoded = raw;
    let changed = 0;

    if (entry.name.endsWith("._AC")) {
      try {
        const decoded = Buffer.from(decodeResource(raw).data);
        for (const repl of replacements) {
          const c = replaceAll(decoded, repl.from, repl.to);
          if (c) {
            counts.set(repl.name, (counts.get(repl.name) || 0) + c);
            changed += c;
          }
        }
        if (changed) {
          encoded = encodeLiteralResource(decoded);
          archiveChanged += changed;
          console.log(`ZEP_DAT${index} ${entry.name}: marker replacements=${changed}`);
        }
      } catch (err) {
        console.warn(`WARN: cannot decode ZEP_DAT${index} ${entry.name}: ${err.message}`);
      }
    }

    outHdr.writeUInt32LE(offset, entry.headerOffset + 16);
    outHdr.writeUInt32LE(encoded.length, entry.headerOffset + 20);
    chunks.push(encoded);
    offset += encoded.length;
  }

  if (archiveChanged) {
    backupOnce(hdrPath);
    backupOnce(libPath);
    fs.writeFileSync(hdrPath, outHdr);
    fs.writeFileSync(libPath, Buffer.concat(chunks));
  }

  return { archive: index, changed: archiveChanged, counts };
}

function main() {
  const archives = (process.env.ARCHIVES || "2,3,4").split(",").map((x) => Number(x.trim())).filter(Number.isInteger);
  let total = 0;
  const allCounts = new Map();

  for (const archive of archives) {
    const result = patchArchive(archive);
    if (!result) continue;
    total += result.changed;
    for (const [name, count] of result.counts) {
      allCounts.set(name, (allCounts.get(name) || 0) + count);
    }
  }

  console.log(`Total marker replacements=${total}`);
  for (const [name, count] of [...allCounts].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${name}: ${count}`);
  }
}

if (require.main === module) main();
