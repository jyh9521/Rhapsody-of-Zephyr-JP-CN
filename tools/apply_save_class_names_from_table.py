#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import shutil
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TABLE = ROOT / "_work" / "text" / "ch_class_names_to_translate.tsv"
SAVE_DIR = ROOT / "save"
REPORT = ROOT / "_work" / "text" / "save_class_patch_report.json"


def bf(data: bytes) -> bytes:
    return bytes((0xBF - b) & 0xFF for b in data)


def load_rows() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    with TABLE.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            jp = (row.get("jp_class") or "").strip()
            cn = (row.get("cn_class") or "").strip()
            if not jp or not cn:
                continue
            jp_bytes = jp.encode("cp932")
            cn_bytes = cn.encode("cp936")
            if len(cn_bytes) > len(jp_bytes):
                rows.append({
                    "jp_class": jp,
                    "cn_class": cn,
                    "skipped": True,
                    "reason": "overflow",
                    "capacity": len(jp_bytes),
                    "need": len(cn_bytes),
                })
                continue
            rows.append({
                "jp_class": jp,
                "cn_class": cn,
                "skipped": False,
                "needle": bf(jp_bytes),
                "replacement": bf(cn_bytes + b" " * (len(jp_bytes) - len(cn_bytes))),
                "capacity": len(jp_bytes),
                "used": len(cn_bytes),
            })
    return rows


def find_all(data: bytes | bytearray, needle: bytes) -> list[int]:
    offsets: list[int] = []
    start = 0
    while True:
        offset = data.find(needle, start)
        if offset < 0:
            return offsets
        offsets.append(offset)
        start = offset + 1


def main() -> int:
    rows = load_rows()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report: dict[str, object] = {
        "timestamp": timestamp,
        "table": str(TABLE.relative_to(ROOT)),
        "files": [],
        "tableSkipped": [row for row in rows if row.get("skipped")],
    }

    for save_path in sorted(SAVE_DIR.glob("Zephyr*.sav")):
        if ".bak" in save_path.name:
            continue
        data = bytearray(save_path.read_bytes())
        file_report = {
            "file": str(save_path.relative_to(ROOT)),
            "backup": None,
            "patchedCount": 0,
            "patched": [],
            "checksumBefore": data[-1] if data else None,
            "checksumAfter": None,
        }
        for row in rows:
            if row.get("skipped"):
                continue
            needle = row["needle"]
            replacement = row["replacement"]
            assert isinstance(needle, bytes)
            assert isinstance(replacement, bytes)
            offsets = find_all(data, needle)
            for offset in offsets:
                data[offset : offset + len(needle)] = replacement
                file_report["patched"].append({
                    "offset": f"0x{offset:x}",
                    "jp_class": row["jp_class"],
                    "cn_class": row["cn_class"],
                    "capacity": row["capacity"],
                    "used": row["used"],
                })
                file_report["patchedCount"] += 1

        if file_report["patchedCount"]:
            backup = save_path.with_name(f"{save_path.name}.bak_before_save_classes_{timestamp}")
            shutil.copy2(save_path, backup)
            data[-1] = sum(data[:-1]) & 0xFF
            save_path.write_bytes(data)
            file_report["backup"] = str(backup.relative_to(ROOT))
            file_report["checksumAfter"] = data[-1]
        else:
            file_report["checksumAfter"] = data[-1] if data else None
        report["files"].append(file_report)

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    total = sum(int(row["patchedCount"]) for row in report["files"])
    print(f"patched={total}")
    print(f"report={REPORT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
