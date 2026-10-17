from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path("_work/decoded")
OUT = Path("_work/previews")
OUT.mkdir(parents=True, exist_ok=True)

WIDTHS = [64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 320, 384, 512, 640]


def load_palette(path: Path):
    raw = path.read_bytes()
    pal = []
    for i in range(0, min(len(raw), 768), 3):
        # Falcom palettes are stored as 6-bit RGB.
        r, g, b = raw[i], raw[i + 1], raw[i + 2]
        pal.extend([min(255, r * 4), min(255, g * 4), min(255, b * 4)])
    pal.extend([0] * (768 - len(pal)))
    return pal


def render_sheet(name: str) -> Path:
    data = (ROOT / f"{name}_sp.bin").read_bytes()
    pal = load_palette(ROOT / f"{name}_pa.bin")
    thumbs = []
    for width in WIDTHS:
        height = (len(data) + width - 1) // width
        padded = data + bytes(width * height - len(data))
        img = Image.frombytes("P", (width, height), padded)
        img.putpalette(pal)
        scale = max(1, min(3, 384 // max(width, 1)))
        img = img.resize((width * scale, height * scale), Image.Resampling.NEAREST)
        label_h = 18
        tile = Image.new("RGB", (img.width, img.height + label_h), "white")
        tile.paste(img.convert("RGB"), (0, label_h))
        ImageDraw.Draw(tile).text((4, 2), f"w={width}", fill=(255, 0, 0))
        thumbs.append(tile)

    sheet_w = 900
    x = y = row_h = 0
    positions = []
    for tile in thumbs:
        if x and x + tile.width > sheet_w:
            x = 0
            y += row_h + 8
            row_h = 0
        positions.append((x, y, tile))
        x += tile.width + 8
        row_h = max(row_h, tile.height)

    sheet = Image.new("RGB", (sheet_w, y + row_h), (225, 225, 225))
    for x, y, tile in positions:
        sheet.paste(tile, (x, y))
    out = OUT / f"{name}_indexed_sheet.png"
    sheet.save(out)
    return out


def main():
    for name in ["sysm", "itemp", "menu"]:
        print(render_sheet(name))


if __name__ == "__main__":
    main()
