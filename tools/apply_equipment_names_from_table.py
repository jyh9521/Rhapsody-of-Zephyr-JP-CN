#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import shutil
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TABLE = ROOT / "_work" / "text" / "equipment_names_to_translate.tsv"
REPORT = ROOT / "_work" / "text" / "equipment_names_apply_report.json"


def bf(data: bytes) -> bytes:
    return bytes((0xBF - b) & 0xFF for b in data)


def main() -> int:
    rows_by_source: dict[Path, list[dict[str, object]]] = {}
    skipped: list[dict[str, object]] = []

    with TABLE.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for line_no, row in enumerate(reader, start=2):
            source = (row.get("source") or "").strip()
            cn_name = (row.get("cn_name") or "").strip()
            if not source or not cn_name:
                skipped.append({"line": line_no, "source": source, "jp_name": row.get("jp_name", ""), "reason": "missing source/cn_name"})
                continue
            try:
                offset = int((row.get("text_offset_hex") or row.get("offset_hex") or "").strip(), 16)
                capacity = int((row.get("byte_capacity") or "").strip())
                encoded = cn_name.encode("cp936")
            except Exception as exc:
                skipped.append({"line": line_no, "source": source, "jp_name": row.get("jp_name", ""), "cn_name": cn_name, "reason": str(exc)})
                continue
            if len(encoded) > capacity:
                skipped.append(
                    {
                        "line": line_no,
                        "source": source,
                        "jp_name": row.get("jp_name", ""),
                        "cn_name": cn_name,
                        "reason": "overflow",
                        "need": len(encoded),
                        "capacity": capacity,
                    }
                )
                continue
            rows_by_source.setdefault(ROOT / source, []).append(
                {
                    "line": line_no,
                    "offset": offset,
                    "capacity": capacity,
                    "jp_name": row.get("jp_name", ""),
                    "cn_name": cn_name,
                    "encoded": encoded,
                }
            )

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backups: list[str] = []
    patched: list[dict[str, object]] = []
    for source, rows in rows_by_source.items():
        if not source.exists():
            for row in rows:
                skipped.append({"line": row["line"], "source": str(source), "jp_name": row["jp_name"], "reason": "missing source"})
            continue

        data = bytearray(source.read_bytes())
        backup = source.with_name(f"{source.name}.bak_before_equipment_names_{stamp}")
        shutil.copy2(source, backup)
        backups.append(str(backup))

        for row in rows:
            encoded = row["encoded"]
            capacity = int(row["capacity"])
            offset = int(row["offset"])
            plain = bytes(encoded) + bytes(capacity - len(encoded))
            data[offset : offset + capacity] = bf(plain)
            patched.append(
                {
                    "source": str(source.relative_to(ROOT)),
                    "line": row["line"],
                    "offset": f"0x{offset:06x}",
                    "jp_name": row["jp_name"],
                    "cn_name": row["cn_name"],
                    "capacity": capacity,
                    "used": len(encoded),
                }
            )

        source.write_bytes(data)

    REPORT.write_text(
        json.dumps(
            {
                "generatedAt": datetime.now().isoformat(timespec="seconds"),
                "table": str(TABLE.relative_to(ROOT)),
                "backups": backups,
                "patchedCount": len(patched),
                "skippedCount": len(skipped),
                "patched": patched,
                "skipped": skipped,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"patched={len(patched)} skipped={len(skipped)}")
    print(f"report={REPORT}")
    if skipped:
        for row in skipped[:20]:
            print(f"SKIP line={row.get('line')} {row.get('source')} {row.get('jp_name')} {row.get('reason')}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
