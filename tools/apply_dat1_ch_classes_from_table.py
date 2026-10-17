#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import shutil
from datetime import datetime
from pathlib import Path

import importlib.util
import sys


ROOT = Path(__file__).resolve().parents[1]
TABLE = ROOT / "_work" / "text" / "ch_class_names_to_translate.tsv"
HDR = ROOT / "ZEP_DAT1.HDR"
LIB = ROOT / "ZEP_DAT1.LIB"
ORIG_DECODED = ROOT / "_work" / "all_decoded"
REPORT = ROOT / "_work" / "text" / "dat1_ch_class_patch_report.json"
FIELD_OFFSET = 0x70
FIELD_SIZE = 0x20


spec = importlib.util.spec_from_file_location(
    "dat1_names_patch", ROOT / "tools" / "apply_dat1_ch_names_from_speaker_table.py"
)
dat1 = importlib.util.module_from_spec(spec)
sys.modules["dat1_names_patch"] = dat1
assert spec.loader is not None
spec.loader.exec_module(dat1)


def load_classes() -> dict[str, str]:
    classes: dict[str, str] = {}
    with TABLE.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            jp = (row.get("jp_class") or "").strip()
            cn = (row.get("cn_class") or "").strip()
            if jp and cn:
                classes[jp] = cn
    return classes


def original_plain_class(resource: str) -> tuple[str, bytes] | None:
    path = ORIG_DECODED / f"ZEP_DAT1__{resource}.bin"
    if not path.exists():
        return None
    stored = path.read_bytes()[FIELD_OFFSET : FIELD_OFFSET + FIELD_SIZE]
    plain = dat1.bf(stored).split(b"\0", 1)[0]
    if not plain:
        return None
    try:
        return plain.decode("cp932"), plain
    except UnicodeDecodeError:
        return None


def main() -> int:
    class_map = load_classes()
    lib = bytearray(LIB.read_bytes())
    entries = dat1.parse_header(HDR)
    patched = []
    skipped = []

    for entry in entries:
        if not entry.name.lower().endswith("._ch"):
            continue
        original = original_plain_class(entry.name)
        if original is None:
            continue
        jp_class, jp_bytes = original
        cn_class = class_map.get(jp_class)
        if not cn_class:
            continue
        try:
            cn_bytes = cn_class.encode("cp936")
        except UnicodeEncodeError as exc:
            skipped.append({"resource": entry.name, "jp_class": jp_class, "cn_class": cn_class, "reason": f"cp936: {exc}"})
            continue
        if len(cn_bytes) > len(jp_bytes):
            skipped.append({
                "resource": entry.name,
                "jp_class": jp_class,
                "cn_class": cn_class,
                "reason": "overflow",
                "capacity": len(jp_bytes),
                "need": len(cn_bytes),
            })
            continue

        raw = bytearray(lib[entry.offset : entry.offset + entry.size])
        decoded, prov = dat1.decode_prov(raw)
        if len(decoded) < FIELD_OFFSET + len(jp_bytes) or len(prov) < FIELD_OFFSET + len(jp_bytes):
            skipped.append({"resource": entry.name, "jp_class": jp_class, "cn_class": cn_class, "reason": "decoded-too-short"})
            continue

        replacement = dat1.bf(cn_bytes + b" " * (len(jp_bytes) - len(cn_bytes)))
        raw_writes: dict[int, int] = {}
        conflict = None
        for index, value in enumerate(replacement, start=FIELD_OFFSET):
            raw_offset = dat1.resolve_raw(prov, index)
            if raw_offset is None:
                conflict = "unresolved-nonliteral-field"
                break
            old_value = raw_writes.get(raw_offset)
            if old_value is not None and old_value != value:
                conflict = "backref-byte-conflict"
                break
            raw_writes[raw_offset] = value
        if conflict:
            skipped.append({"resource": entry.name, "jp_class": jp_class, "cn_class": cn_class, "reason": conflict})
            continue

        for raw_offset, value in raw_writes.items():
            raw[raw_offset] = value
        lib[entry.offset : entry.offset + entry.size] = raw
        patched.append({
            "resource": entry.name,
            "jp_class": jp_class,
            "cn_class": cn_class,
            "capacity": len(jp_bytes),
            "used": len(cn_bytes),
        })

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = LIB.with_name(f"{LIB.name}.bak_before_dat1_cn_classes_{timestamp}")
    shutil.copy2(LIB, backup)
    LIB.write_bytes(lib)
    report = {
        "backup": str(backup.relative_to(ROOT)),
        "patchedCount": len(patched),
        "skippedCount": len(skipped),
        "patched": patched,
        "skipped": skipped,
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"patched={len(patched)} skipped={len(skipped)}")
    print(f"backup={backup}")
    print(f"report={REPORT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
