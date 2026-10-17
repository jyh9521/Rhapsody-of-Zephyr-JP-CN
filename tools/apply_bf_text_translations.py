import argparse
import json
import re
import shutil
from pathlib import Path

MARKER_RE = re.compile(r"\[[^\]]*\]")


def obfuscate(data: bytes) -> bytes:
    return bytes(((0xBF - b) & 0xFF) for b in data)


def encode_mixed(text: str, body_encoding: str, marker_encoding: str = "cp932") -> bytes:
    """Encode translation text; bracketed speaker markers stay Shift-JIS.

    The engine matches [name] markers against internal Shift-JIS data, so
    markers keep cp932 encoding even when the body text is GBK/CP936.
    Markers that cannot be represented in cp932 fall back to body encoding.
    """
    out = bytearray()
    pos = 0
    for m in MARKER_RE.finditer(text):
        out += text[pos:m.start()].encode(body_encoding)
        effective_marker_encoding = body_encoding if marker_encoding == "body" else marker_encoding
        try:
            out += m.group(0).encode(effective_marker_encoding)
        except UnicodeEncodeError:
            out += m.group(0).encode(body_encoding)
        pos = m.end()
    out += text[pos:].encode(body_encoding)
    return bytes(out)


def apply_rows(rows, out_dir: Path, encoding: str, force_encoding: bool, dry_run: bool, marker_encoding: str):
    grouped = {}
    for row in rows:
        translation = row.get("translation") or ""
        if not translation:
            continue
        grouped.setdefault(row["source"], []).append(row)

    changed = 0
    errors = []
    for source, source_rows in grouped.items():
        src_path = Path(source)
        if not src_path.exists():
            errors.append(f"Missing source: {source}")
            continue

        out_path = out_dir / source
        # patch on top of an already-copied file when present (pre-seeded dirs)
        base_path = out_path if out_path.exists() else src_path
        data = bytearray(base_path.read_bytes())

        for row in source_rows:
            text_encoding = encoding if force_encoding else (row.get("encoding") or encoding)
            try:
                plain = encode_mixed(row["translation"], text_encoding, marker_encoding)
            except UnicodeEncodeError as exc:
                errors.append(f"{row['id']}: cannot encode with {text_encoding}: {exc}")
                continue

            capacity = int(row["byteLength"])
            if len(plain) > capacity:
                errors.append(f"{row['id']}: {len(plain)} bytes exceeds capacity {capacity}")
                continue

            offset = int(row["offset"])
            data[offset : offset + capacity] = obfuscate(plain) + bytes([0xBF]) * (capacity - len(plain))
            changed += 1

        if not dry_run:
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_bytes(data)

    return changed, errors


def copy_unchanged_sources(rows, out_dir: Path):
    for source in sorted({row["source"] for row in rows}):
        src_path = Path(source)
        out_path = out_dir / source
        if src_path.exists() and not out_path.exists():
            out_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src_path, out_path)


def main():
    parser = argparse.ArgumentParser(description="Apply translations to BF-subtracted text resources.")
    parser.add_argument("json_path")
    parser.add_argument("--out-dir", default="_work/patched_decoded")
    parser.add_argument("--encoding", default="cp932")
    parser.add_argument("--marker-encoding", default="cp932")
    parser.add_argument("--force-encoding", action="store_true")
    parser.add_argument("--copy-unchanged", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-invalid", action="store_true")
    parser.add_argument("--error-report")
    args = parser.parse_args()

    rows = json.loads(Path(args.json_path).read_text(encoding="utf-8"))
    out_dir = Path(args.out_dir)
    changed, errors = apply_rows(rows, out_dir, args.encoding, args.force_encoding, args.dry_run, args.marker_encoding)

    if args.copy_unchanged and not args.dry_run:
        copy_unchanged_sources(rows, out_dir)

    for error in errors[:50]:
        print(f"ERROR: {error}")
    if len(errors) > 50:
        print(f"ERROR: ... {len(errors) - 50} more")

    if args.error_report:
        Path(args.error_report).parent.mkdir(parents=True, exist_ok=True)
        Path(args.error_report).write_text(
            json.dumps(
                {
                    "changed": changed,
                    "errors": errors,
                    "errorCount": len(errors),
                    "outDir": str(out_dir),
                    "dryRun": args.dry_run,
                    "skipInvalid": args.skip_invalid,
                    "markerEncoding": args.marker_encoding,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

    print(f"changed={changed} errors={len(errors)} out={out_dir}")
    if errors and not args.skip_invalid:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
