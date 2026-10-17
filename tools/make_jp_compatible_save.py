#!/usr/bin/env python3
"""Create a Japanese-engine-compatible copy of a Chinese Zephyr save.

The game saves several rendered-name/class caches using BF-subtracted bytes.
Chinese builds write these caches in GBK, whereas the Japanese executable
expects CP932.  This tool restores only those caches and the checksum; it
does not change progress or game-state bytes.
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NAME_TABLE = ROOT / "_work" / "text" / "zpgdi_builtin_names_report.tsv"
CLASS_TABLE = ROOT / "_work" / "text" / "ch_class_names_to_translate.tsv"


def bf(data: bytes) -> bytes:
    return bytes((0xBF - value) & 0xFF for value in data)


def read_pairs(path: Path, jp_column: str, cn_column: str) -> dict[bytes, bytes]:
    """Return only unambiguous GBK-to-CP932 pairs that fit in-place."""
    choices: dict[bytes, set[bytes]] = {}
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle, delimiter="\t"):
            japanese = (row.get(jp_column) or "").strip()
            chinese = (row.get(cn_column) or "").strip()
            if not japanese or not chinese:
                continue
            try:
                jp_bytes = japanese.encode("cp932")
                cn_bytes = chinese.encode("gbk")
            except UnicodeEncodeError:
                continue
            # The Chinese patch only replaces strings that fit the original
            # Japanese field.  Short two-byte candidates are too ambiguous.
            if len(cn_bytes) >= 4 and len(jp_bytes) >= len(cn_bytes):
                choices.setdefault(cn_bytes, set()).add(jp_bytes)
    return {
        chinese: next(iter(japanese_options))
        for chinese, japanese_options in choices.items()
        if len(japanese_options) == 1
    }


def replace_all(data: bytearray, chinese: bytes, japanese: bytes) -> list[int]:
    """Restore one BF-subtracted field with known Chinese-save padding."""
    source = bf(chinese)
    replacement = bf(japanese)
    padding = bf(b" " * (len(japanese) - len(chinese)))
    offsets: list[int] = []
    start = 0
    while (offset := data.find(source, start)) >= 0:
        # A longer Japanese text must consume exactly the spaces installed by
        # the Chinese patch.  This prevents a false match from touching game
        # state data.
        if padding:
            extension = data[offset + len(source) : offset + len(replacement)]
            # Older save writers use transformed NULs while the localization
            # patch itself uses transformed ASCII spaces.
            if extension not in (padding, b"\xBF" * len(padding)):
                start = offset + 1
                continue
        data[offset : offset + len(replacement)] = replacement
        offsets.append(offset)
        start = offset + len(replacement)
    return offsets


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    if not args.input.is_file():
        raise SystemExit(f"Input save does not exist: {args.input}")
    if args.output.exists():
        raise SystemExit(f"Refusing to overwrite existing output: {args.output}")

    pairs = read_pairs(NAME_TABLE, "jp_name", "cn_name")
    pairs.update(read_pairs(CLASS_TABLE, "jp_class", "cn_class"))
    # Present in Zephyr09's current class cache, but not in the class table.
    pairs["流浪剑士".encode("gbk")] = "放浪剣士".encode("cp932")

    data = bytearray(args.input.read_bytes())
    changes: list[tuple[int, bytes, bytes]] = []
    for chinese, japanese in sorted(pairs.items(), key=lambda item: len(item[0]), reverse=True):
        for offset in replace_all(data, chinese, japanese):
            changes.append((offset, chinese, japanese))

    # This full-name cache was shortened by the Chinese name patch.  Its
    # fixed 0x20-byte field is otherwise identical to the Japanese layout.
    full_name_offset = 0x1378
    full_name_end = 0x1398
    full_name = "ロベルト・デ・メディチ".encode("cp932")
    expected_prefix = bf("ロベルト・".encode("cp932"))
    if data[full_name_offset : full_name_offset + len(expected_prefix)] == expected_prefix:
        data[full_name_offset:full_name_end] = bf(
            full_name + b"\x00" * (full_name_end - full_name_offset - len(full_name))
        )
        changes.append((full_name_offset, b"<mixed full-name cache>", full_name))

    # This five-byte sorting-key tail is left behind by an old shortened
    # replacement of \"シルバーナ\" after the ASCII alias \"Captain Silver\".
    # It is part of the same character cache and must be CP932 for the
    # Japanese loader to advance through the record correctly.
    silvana_tail_offset = 0x0B67
    broken_tail = bytes.fromhex("fb cd df c4 c8")
    fixed_tail = bytes.fromhex("8b 83 6f 81 5b")
    if bf(bytes(data[silvana_tail_offset : silvana_tail_offset + len(broken_tail)])) == broken_tail:
        data[silvana_tail_offset : silvana_tail_offset + len(fixed_tail)] = bf(fixed_tail)
        changes.append((silvana_tail_offset, broken_tail, fixed_tail))

    if not changes:
        raise SystemExit("No localized cache fields were found; no output was written.")

    data[-1] = sum(data[:-1]) & 0xFF
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(data)

    print(f"output={args.output}")
    print(f"replaced_fields={len(changes)}")
    for offset, chinese, japanese in changes:
        print(f"0x{offset:05X} {chinese.hex()} -> {japanese.hex()}")
    print(f"checksum=0x{data[-1]:02X}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
