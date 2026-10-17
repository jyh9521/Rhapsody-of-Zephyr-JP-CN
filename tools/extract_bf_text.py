import argparse
import json
import os
import re
from pathlib import Path


def deobfuscate(data: bytes) -> bytes:
    return bytes(((0xBF - b) & 0xFF) for b in data)


def is_japanese_char(ch: str) -> bool:
    cp = ord(ch)
    return (
        0x3040 <= cp <= 0x309F
        or 0x30A0 <= cp <= 0x30FF
        or 0x4E00 <= cp <= 0x9FFF
        or 0xFF61 <= cp <= 0xFF9F
    )


def is_kana(ch: str) -> bool:
    cp = ord(ch)
    return 0x3040 <= cp <= 0x309F or 0x30A0 <= cp <= 0x30FF or 0xFF61 <= cp <= 0xFF9F


def is_halfwidth_kana(ch: str) -> bool:
    cp = ord(ch)
    return 0xFF61 <= cp <= 0xFF9F


def has_bad_controls(text: str) -> bool:
    allowed = {"\t", "\n", "\r"}
    return any(ord(ch) < 0x20 and ch not in allowed for ch in text)


def likely_text(text: str, args: argparse.Namespace) -> bool:
    cleaned = re.sub(r"\s+", " ", text).strip()
    if len(cleaned) < args.min_chars:
        return False
    if has_bad_controls(cleaned):
        return False
    japanese = sum(1 for ch in cleaned if is_japanese_char(ch))
    kana = sum(1 for ch in cleaned if is_kana(ch))
    halfwidth_kana = sum(1 for ch in cleaned if is_halfwidth_kana(ch))
    if halfwidth_kana and not args.allow_halfwidth:
        return False
    if japanese < args.min_japanese:
        return False
    if kana < args.min_kana:
        return False
    if japanese / max(len(cleaned), 1) < args.min_ratio:
        return False
    if re.search(r"(.)\1{" + str(args.max_repeat) + r",}", cleaned):
        return False
    return True


def iter_files(targets, include, exclude):
    for target in targets:
        path = Path(target)
        if not path.exists():
            continue
        if path.is_dir():
            for child in path.rglob("*"):
                if child.is_file():
                    rel = str(child)
                    if include and not include.search(rel):
                        continue
                    if exclude and exclude.search(rel):
                        continue
                    yield child
        elif path.is_file():
            rel = str(path)
            if include and not include.search(rel):
                continue
            if exclude and exclude.search(rel):
                continue
            yield path


def source_meta(path: Path):
    name = path.name
    match = re.match(r"ZEP_DAT(\d+)__(.+)\.bin$", name, re.IGNORECASE)
    if match:
        return int(match.group(1)), match.group(2)
    return None, name


def extract_from_file(path: Path, args: argparse.Namespace):
    raw = path.read_bytes()
    plain = deobfuscate(raw)
    archive, resource = source_meta(path)
    rows = []
    start = 0

    for idx, byte in enumerate(plain + b"\x00"):
        if byte != 0:
            continue

        chunk = plain[start:idx]
        if chunk:
            try:
                text = chunk.decode(args.encoding)
            except UnicodeDecodeError:
                start = idx + 1
                continue

            if likely_text(text, args):
                rel = os.path.relpath(path, Path.cwd())
                rows.append(
                    {
                        "id": f"{archive if archive is not None else 'file'}:{resource}:{start:06x}",
                        "source": rel.replace("\\", "/"),
                        "archive": archive,
                        "resource": resource,
                        "offset": start,
                        "byteLength": len(chunk),
                        "encoding": args.encoding,
                        "transform": "bf_sub",
                        "text": text,
                        "translation": "",
                    }
                )

        start = idx + 1

    return rows


def main():
    parser = argparse.ArgumentParser(description="Extract 0xBF-subtracted CP932/SJIS strings.")
    parser.add_argument("targets", nargs="+")
    parser.add_argument("--out", default="_work/text/bf_strings.json")
    parser.add_argument("--include", default="")
    parser.add_argument("--exclude", default="")
    parser.add_argument("--encoding", default="cp932")
    parser.add_argument("--min-chars", type=int, default=4)
    parser.add_argument("--min-japanese", type=int, default=2)
    parser.add_argument("--min-kana", type=int, default=0)
    parser.add_argument("--min-ratio", type=float, default=0.25)
    parser.add_argument("--max-repeat", type=int, default=12)
    parser.add_argument("--allow-halfwidth", action="store_true")
    args = parser.parse_args()

    include = re.compile(args.include, re.IGNORECASE) if args.include else None
    exclude = re.compile(args.exclude, re.IGNORECASE) if args.exclude else None

    rows = []
    files = list(iter_files(args.targets, include, exclude))
    for path in files:
        rows.extend(extract_from_file(path, args))

    rows.sort(key=lambda row: (row["source"], row["offset"]))
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"files={len(files)} strings={len(rows)} -> {out_path}")


if __name__ == "__main__":
    main()
