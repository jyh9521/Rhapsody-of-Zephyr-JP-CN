from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path("_work/decoded")
OUT = Path("_work/previews")
OUT.mkdir(parents=True, exist_ok=True)

WIDTHS = [32, 48, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 512]


def render_sheet(path: Path) -> Path:
    data = path.read_bytes()
    thumbs = []
    for width in WIDTHS:
        height = (len(data) + width - 1) // width
        padded = data + bytes(width * height - len(data))
        img = Image.frombytes("L", (width, height), padded)
        scale = max(1, min(4, 256 // max(width, 1)))
        img = img.resize((width * scale, height * scale), Image.Resampling.NEAREST)
        label_h = 18
        tile = Image.new("RGB", (img.width, img.height + label_h), "white")
        tile.paste(img.convert("RGB"), (0, label_h))
        draw = ImageDraw.Draw(tile)
        draw.text((4, 2), f"w={width}", fill=(255, 0, 0))
        thumbs.append(tile)

    sheet_w = max(t.width for t in thumbs[:2]) * 2
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
    sheet_h = y + row_h
    sheet = Image.new("RGB", (sheet_w, sheet_h), (230, 230, 230))
    for x, y, tile in positions:
        sheet.paste(tile, (x, y))
    out = OUT / f"{path.stem}_sheet.png"
    sheet.save(out)
    return out


def main():
    for name in ["sysm_sp_first.bin", "itemp_sp_first.bin", "menu_sp_first.bin", "status_sp_first.bin", "btlwin_sp_first.bin", "tbtn_sp_first.bin", "snfont_sp_first.bin"]:
        path = ROOT / name
        if path.exists():
            print(render_sheet(path))


if __name__ == "__main__":
    main()
