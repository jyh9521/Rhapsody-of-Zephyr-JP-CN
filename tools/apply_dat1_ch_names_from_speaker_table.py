#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import shutil
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TABLE = ROOT / "_work" / "text" / "speaker_names_to_translate.tsv"
HDR = ROOT / "ZEP_DAT1.HDR"
LIB = ROOT / "ZEP_DAT1.LIB"
ORIG_DECODED = ROOT / "_work" / "all_decoded"
REPORT = ROOT / "_work" / "text" / "dat1_ch_name_patch_report.json"
DAT1_NAME_OVERRIDES = {
    "マキャベリー": "马基",
}


def bf(data: bytes) -> bytes:
    return bytes((0xBF - b) & 0xFF for b in data)


class BitReader:
    def __init__(self, buf: bytes, offset: int):
        self.buf = buf
        self.offset = offset + 2
        self.bits_left = 8
        self.bits = buf[offset + 1] if offset + 1 < len(buf) else 0

    def bit(self) -> int:
        if self.bits_left == 0:
            lo = self.buf[self.offset] if self.offset < len(self.buf) else 0
            hi = self.buf[self.offset + 1] if self.offset + 1 < len(self.buf) else 0
            self.bits = lo | (hi << 8)
            self.offset += 2
            self.bits_left = 16
        out = self.bits & 1
        self.bits >>= 1
        self.bits_left -= 1
        return out

    def bits_value(self, count: int) -> int:
        value = 0
        for _ in range(count):
            value = (value << 1) | self.bit()
        return value

    def byte_at(self) -> int:
        return self.offset

    def byte(self) -> int:
        value = self.buf[self.offset] if self.offset < len(self.buf) else 0
        self.offset += 1
        return value


def copy_len(reader: BitReader) -> int:
    if reader.bit():
        return 2
    if reader.bit():
        return 3
    if reader.bit():
        return 4
    if reader.bit():
        return 5
    if not reader.bit():
        return reader.byte() + 14
    return reader.bits_value(3) + 6


def copy_from_window(out: list[int], prov: list[dict[str, int | bool]], distance: int, length: int) -> None:
    source = len(out) - distance
    for i in range(length):
        out.append(0 if source + i < 0 else out[source + i])
        prov.append({"lit": False, "src": source + i})


def decode_type0(buf: bytes, offset: int, block_length: int, out: list[int], prov: list[dict[str, int | bool]]) -> int:
    block_end = offset - 2 + block_length
    reader = BitReader(buf, offset)
    while reader.offset < block_end:
        if not reader.bit():
            raw = reader.byte_at()
            out.append(reader.byte())
            prov.append({"lit": True, "raw": raw})
            continue
        if not reader.bit():
            distance = reader.byte()
            copy_from_window(out, prov, distance, copy_len(reader))
            continue
        distance_or_command = (reader.bits_value(5) << 8) | reader.byte()
        if distance_or_command > 0:
            if distance_or_command > 1:
                copy_from_window(out, prov, distance_or_command, copy_len(reader))
                continue
            repeat_len = (reader.bits_value(4) if not reader.bit() else ((reader.bits_value(4) << 8) | reader.byte())) + 14
            value = reader.byte()
            for _ in range(repeat_len):
                out.append(value)
                prov.append({"lit": False})
            continue
        return reader.offset
    return block_end


def decode_packed(buf: bytes, offset: int, block_length: int, out: list[int], prov: list[dict[str, int | bool]]) -> int:
    consumed = 2
    while consumed != block_length:
        command = buf[offset] if offset < len(buf) else 0
        offset += 1
        consumed += 1
        if command & 0x80:
            distance = ((command & 0x1F) << 8) | (buf[offset] if offset < len(buf) else 0)
            offset += 1
            length = ((command >> 5) & 3) + 4
            consumed += 1
            while consumed != block_length and (buf[offset] & 0xE0) == 0x60:
                length += buf[offset] & 0x1F
                offset += 1
                consumed += 1
            copy_from_window(out, prov, distance, length)
            continue
        if command & 0x40:
            if command & 0x10:
                length = (((command & 0x0F) << 8) | (buf[offset] if offset < len(buf) else 0)) + 4
                offset += 1
                consumed += 1
            else:
                length = (command & 0x0F) + 4
            value = buf[offset] if offset < len(buf) else 0
            offset += 1
            consumed += 1
            for _ in range(length):
                out.append(value)
                prov.append({"lit": False})
            continue
        length = command & 0x1F
        if command & 0x20:
            length = (length << 8) | (buf[offset] if offset < len(buf) else 0)
            offset += 1
            consumed += 1
        for _ in range(length):
            raw = offset
            out.append(buf[offset] if offset < len(buf) else 0)
            offset += 1
            prov.append({"lit": True, "raw": raw})
        consumed += length
    return offset


def decode_prov(buf: bytes) -> tuple[bytes, list[dict[str, int | bool]]]:
    offset = 0
    out: list[int] = []
    prov: list[dict[str, int | bool]] = []
    while offset + 3 <= len(buf):
        block_length = int.from_bytes(buf[offset : offset + 2], "little")
        offset += 2
        block_type = buf[offset] if offset < len(buf) else 0
        if block_type == 0:
            offset = decode_type0(buf, offset, block_length, out, prov)
        else:
            offset = decode_packed(buf, offset, block_length, out, prov)
        continuation = buf[offset] if offset < len(buf) else 0
        offset += 1
        if continuation == 0:
            break
    return bytes(out), prov


@dataclass
class Entry:
    name: str
    header_offset: int
    offset: int
    size: int


def read_cstring(buf: bytes, start: int, length: int) -> str:
    raw = buf[start : start + length].split(b"\0", 1)[0]
    return raw.decode("cp932")


def parse_header(path: Path) -> list[Entry]:
    buf = path.read_bytes()
    entries: list[Entry] = []
    for off in range(16, len(buf), 32):
        name = read_cstring(buf, off, 16)
        if not name:
            continue
        entries.append(Entry(name, off, int.from_bytes(buf[off + 16 : off + 20], "little"), int.from_bytes(buf[off + 20 : off + 24], "little")))
    return entries


def load_names() -> dict[str, str]:
    names: dict[str, str] = {}
    with TABLE.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            jp = (row.get("jp_name") or "").strip()
            cn = (row.get("cn_name") or "").strip()
            if jp and cn:
                names[jp] = cn
    return names


def resolve_raw(prov: list[dict[str, int | bool]], index: int, seen: set[int] | None = None) -> int | None:
    if index < 0 or index >= len(prov):
        return None
    if seen is None:
        seen = set()
    if index in seen:
        return None
    seen.add(index)
    item = prov[index]
    if item.get("lit") and isinstance(item.get("raw"), int):
        return int(item["raw"])
    src = item.get("src")
    if isinstance(src, int):
        return resolve_raw(prov, src, seen)
    return None


def original_plain_name(resource: str) -> tuple[str, bytes] | None:
    path = ORIG_DECODED / f"ZEP_DAT1__{resource}.bin"
    if not path.exists():
        return None
    stored = path.read_bytes()[0x10:0x40]
    plain = bf(stored).split(b"\0", 1)[0]
    if not plain:
        return None
    try:
        return plain.decode("cp932"), plain
    except UnicodeDecodeError:
        return None


def main() -> int:
    names = load_names()
    lib = bytearray(LIB.read_bytes())
    entries = parse_header(HDR)
    patched = []
    skipped = []

    for entry in entries:
        if not entry.name.lower().endswith("._ch"):
            continue
        original = original_plain_name(entry.name)
        if original is None:
            continue
        jp_name, jp_bytes = original
        cn_name = DAT1_NAME_OVERRIDES.get(jp_name, names.get(jp_name))
        if not cn_name:
            continue
        try:
            cn_bytes = cn_name.encode("cp936")
        except UnicodeEncodeError as exc:
            skipped.append({"resource": entry.name, "jp_name": jp_name, "cn_name": cn_name, "reason": f"cp936: {exc}"})
            continue
        if len(cn_bytes) > len(jp_bytes):
            skipped.append({
                "resource": entry.name,
                "jp_name": jp_name,
                "cn_name": cn_name,
                "reason": "overflow",
                "capacity": len(jp_bytes),
                "need": len(cn_bytes),
            })
            continue

        raw = bytearray(lib[entry.offset : entry.offset + entry.size])
        decoded, prov = decode_prov(raw)
        if len(decoded) < 0x10 + len(jp_bytes) or len(prov) < 0x10 + len(jp_bytes):
            skipped.append({"resource": entry.name, "jp_name": jp_name, "cn_name": cn_name, "reason": "decoded-too-short"})
            continue
        replacement = bf(cn_bytes + b" " * (len(jp_bytes) - len(cn_bytes)))
        raw_writes: dict[int, int] = {}
        conflict = None
        for index, value in enumerate(replacement, start=0x10):
            raw_offset = resolve_raw(prov, index)
            if raw_offset is None:
                conflict = "unresolved-nonliteral-field"
                break
            old_value = raw_writes.get(raw_offset)
            if old_value is not None and old_value != value:
                conflict = "backref-byte-conflict"
                break
            raw_writes[raw_offset] = value
        if conflict:
            skipped.append({"resource": entry.name, "jp_name": jp_name, "cn_name": cn_name, "reason": conflict})
            continue

        for raw_offset, value in raw_writes.items():
            raw[raw_offset] = value
        lib[entry.offset : entry.offset + entry.size] = raw
        patched.append({
            "resource": entry.name,
            "jp_name": jp_name,
            "cn_name": cn_name,
            "capacity": len(jp_bytes),
            "used": len(cn_bytes),
        })

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = LIB.with_name(f"{LIB.name}.bak_before_dat1_cn_names_{timestamp}")
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
