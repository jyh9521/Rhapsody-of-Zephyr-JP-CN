import sys
from pathlib import Path
from PIL import Image

ROOT = Path("_work/decoded")
OUT = Path("_work/sprites")
OUT.mkdir(parents=True, exist_ok=True)


def load_palette(name: str):
    raw = (ROOT / f"{name}_pa.bin").read_bytes()
    pal = []
    for i in range(0, 768, 3):
        r, g, b = raw[i], raw[i + 1], raw[i + 2]
        pal.extend([min(255, r * 4), min(255, g * 4), min(255, b * 4)])
    return pal


def export(name: str):
    buf = (ROOT / f"{name}_sp.bin").read_bytes()
    pal = load_palette(name)
    count = int.from_bytes(buf[0x42:0x44], "little")
    off = 0x80
    out_dir = OUT / name
    out_dir.mkdir(parents=True, exist_ok=True)
    for i in range(count):
        length = int.from_bytes(buf[off:off + 4], "little")
        width = int.from_bytes(buf[off + 4:off + 6], "little", signed=True)
        height = int.from_bytes(buf[off + 6:off + 8], "little", signed=True)
        x = int.from_bytes(buf[off + 8:off + 10], "little", signed=True)
        y = int.from_bytes(buf[off + 10:off + 12], "little", signed=True)
        data = buf[off + 12:off + 12 + length]
        if width <= 0 or height <= 0 or not data:
            print(f"{name}: skipping sprite {i:02d} ({width}x{height}, len={length})")
            off += 12 + length
            continue
        rows = []
        if length == 2 + height * (width + 4):
            p = 2
            for _ in range(height):
                p += 4
                rows.append(data[p:p + width])
                p += width
        elif length >= width * height:
            rows = [data[r * width:(r + 1) * width] for r in range(height)]
        else:
            rows = [bytes([0]) * width for _ in range(height)]
        pixels = b"".join(rows)
        img = Image.frombytes("P", (width, height), pixels)
        img.putpalette(pal)
        img.save(out_dir / f"{i:02d}_{width}x{height}_x{x}_y{y}.png")
        off += 12 + length
    print(f"{name}: exported {count} -> {out_dir}")


def main():
    names = sys.argv[1:] or ["sysm", "itemp", "menu", "status", "btlwin"]
    for name in names:
        if (ROOT / f"{name}_sp.bin").exists() and (ROOT / f"{name}_pa.bin").exists():
            export(name)
        else:
            print(f"{name}: missing decoded _sp/_pa pair")


if __name__ == "__main__":
    main()
