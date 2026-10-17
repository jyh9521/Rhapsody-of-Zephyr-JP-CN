#!/usr/bin/env python3
from __future__ import annotations

import csv
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DECODED = ROOT / "_work" / "all_decoded"
OUT_TABLE = ROOT / "_work" / "text" / "ch_class_names_to_translate.tsv"
OUT_OCCURRENCES = ROOT / "_work" / "text" / "ch_class_name_occurrences.tsv"


def bf(data: bytes) -> bytes:
    return bytes((0xBF - b) & 0xFF for b in data)


def read_field(data: bytes, offset: int, size: int = 0x20) -> tuple[str, bytes] | None:
    raw = bf(data[offset : offset + size]).split(b"\0", 1)[0]
    if not raw:
        return None
    try:
        return raw.decode("cp932"), raw
    except UnicodeDecodeError:
        return None


def main() -> int:
    grouped: dict[str, list[dict[str, object]]] = defaultdict(list)

    for path in sorted(DECODED.glob("ZEP_DAT1__*._ch.bin")):
        data = path.read_bytes()
        if len(data) < 0x90:
            continue
        class_field = read_field(data, 0x70)
        if class_field is None:
            continue
        name_field = read_field(data, 0x10)
        full_name_field = read_field(data, 0x30)
        jp_class, class_bytes = class_field
        resource = path.name.removeprefix("ZEP_DAT1__").removesuffix(".bin")
        grouped[jp_class].append(
            {
                "resource": resource,
                "jp_class": jp_class,
                "byte_capacity": len(class_bytes),
                "jp_name": name_field[0] if name_field else "",
                "jp_full_name": full_name_field[0] if full_name_field else "",
            }
        )

    OUT_TABLE.parent.mkdir(parents=True, exist_ok=True)
    with OUT_TABLE.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["jp_class", "cn_class", "count", "byte_capacity", "first_resource", "resources"],
            delimiter="\t",
        )
        writer.writeheader()
        for jp_class, rows in sorted(grouped.items(), key=lambda item: (-len(item[1]), item[0])):
            writer.writerow(
                {
                    "jp_class": jp_class,
                    "cn_class": "",
                    "count": len(rows),
                    "byte_capacity": max(int(row["byte_capacity"]) for row in rows),
                    "first_resource": rows[0]["resource"],
                    "resources": ",".join(str(row["resource"]) for row in rows),
                }
            )

    with OUT_OCCURRENCES.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["resource", "jp_name", "jp_full_name", "jp_class", "byte_capacity"],
            delimiter="\t",
        )
        writer.writeheader()
        for rows in grouped.values():
            writer.writerows(rows)

    total = sum(len(rows) for rows in grouped.values())
    print(f"classes={len(grouped)} occurrences={total}")
    print(f"wrote {OUT_TABLE}")
    print(f"wrote {OUT_OCCURRENCES}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
