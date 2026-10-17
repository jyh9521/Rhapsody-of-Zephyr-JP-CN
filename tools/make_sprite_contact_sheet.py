import sys
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path("_work/sprites")
OUT = Path("_work/previews")
OUT.mkdir(parents=True, exist_ok=True)


def make_sheet(name: str):
    files = sorted((ROOT / name).glob("*.png"))
    tiles = []
    for file in files:
        img = Image.open(file).convert("RGBA")
        scale = 2 if max(img.size) < 160 else 1
        if scale != 1:
            img = img.resize((img.width * scale, img.height * scale), Image.Resampling.NEAREST)
        label_h = 20
        tile = Image.new("RGBA", (img.width, img.height + label_h), (240, 240, 240, 255))
        tile.paste(img, (0, label_h), img)
        draw = ImageDraw.Draw(tile)
        draw.text((3, 3), file.name.split("_", 1)[0] + " " + file.name.split("_", 2)[1], fill=(255, 0, 0, 255))
        tiles.append(tile.convert("RGB"))

    sheet_w = 1200
    x = y = row_h = 0
    positions = []
    for tile in tiles:
        if x and x + tile.width > sheet_w:
            x = 0
            y += row_h + 12
            row_h = 0
        positions.append((x, y, tile))
        x += tile.width + 12
        row_h = max(row_h, tile.height)

    sheet = Image.new("RGB", (sheet_w, y + row_h), (220, 220, 220))
    for x, y, tile in positions:
        sheet.paste(tile, (x, y))
    out = OUT / f"{name}_sprites_contact.png"
    sheet.save(out)
    print(out)


def main():
    names = sys.argv[1:] or ["sysm", "itemp", "menu", "status", "btlwin"]
    for name in names:
        if not (ROOT / name).exists():
            print(f"{name}: missing sprite directory")
            continue
        make_sheet(name)


if __name__ == "__main__":
    main()
