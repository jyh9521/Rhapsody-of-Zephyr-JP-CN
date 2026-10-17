import argparse
import csv
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Report translated story rows that do not fit fixed text slots.")
    parser.add_argument("json_path", default="_work/text/story_ac_bf_translated_from_tsv.json")
    parser.add_argument("--encoding", default="cp936")
    parser.add_argument("--out", default="_work/text/story_ac_bf_overflow_rows.tsv")
    args = parser.parse_args()

    rows = json.loads(Path(args.json_path).read_text(encoding="utf-8"))
    out_rows = []
    for row in rows:
        translation = row.get("translation") or ""
        capacity = int(row["byteLength"])
        try:
            encoded = translation.encode(args.encoding)
        except UnicodeEncodeError as exc:
            out_rows.append({
                "id": row["id"],
                "capacity": capacity,
                "gbk_bytes": "",
                "over_by": "",
                "problem": f"encode: {exc}",
                "source_text": row.get("text", ""),
                "translation": translation,
            })
            continue
        if len(encoded) > capacity:
            out_rows.append({
                "id": row["id"],
                "capacity": capacity,
                "gbk_bytes": len(encoded),
                "over_by": len(encoded) - capacity,
                "problem": "too_long",
                "source_text": row.get("text", ""),
                "translation": translation,
            })

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["id", "capacity", "gbk_bytes", "over_by", "problem", "source_text", "translation"],
            delimiter="\t",
        )
        writer.writeheader()
        writer.writerows(out_rows)

    print(f"rows={len(out_rows)} -> {out_path}")


if __name__ == "__main__":
    main()
