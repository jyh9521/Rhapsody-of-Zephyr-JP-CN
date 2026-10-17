from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DECODED = ROOT / "_work" / "decoded"
OUT_SPRITES = ROOT / "_work" / "patched_sprites" / "worldmap"
OUT_DECODED = ROOT / "_work" / "patched_decoded_map_graphics" / "_work" / "all_decoded"

FONT_CANDIDATES = [
    Path(r"C:\Windows\Fonts\msyhbd.ttc"),
    Path(r"C:\Windows\Fonts\simhei.ttf"),
    Path(r"C:\Windows\Fonts\simsun.ttc"),
]


def font_path() -> Path:
    for path in FONT_CANDIDATES:
        if path.exists():
            return path
    raise FileNotFoundError("No Chinese-capable Windows font found")


def load_palette(path: Path) -> list[int]:
    raw = path.read_bytes()
    pal: list[int] = []
    for i in range(0, 768, 3):
        r, g, b = raw[i], raw[i + 1], raw[i + 2]
        pal.extend([min(255, r * 4), min(255, g * 4), min(255, b * 4)])
    return pal


def fit_font(text: str, draw: ImageDraw.ImageDraw, max_size: int, width: int, height: int) -> ImageFont.FreeTypeFont:
    for size in range(max_size, 10, -1):
        font = ImageFont.truetype(str(font_path()), size)
        box = draw.textbbox((0, 0), text, font=font, stroke_width=2)
        if box[2] - box[0] <= width and box[3] - box[1] <= height:
            return font
    return ImageFont.truetype(str(font_path()), 11)


def extract_sprite_pixels(buf: bytes, off: int, width: int, height: int, length: int) -> tuple[bytearray, list[bytes], int]:
    data_start = off + 12
    data = bytearray(buf[data_start:data_start + length])
    if length != 2 + height * (width + 4):
        raise ValueError(f"Unexpected worldmap row format: length={length}, expected={2 + height * (width + 4)}")
    rows: list[bytes] = []
    p = 2
    for _ in range(height):
        rows.append(bytes(data[p:p + 4]))
        p += 4 + width
    return data, rows, data_start


def main() -> None:
    sp_path = DECODED / "worldmap_sp.bin"
    pa_path = DECODED / "worldmap_pa.bin"
    if not sp_path.exists() or not pa_path.exists():
        raise FileNotFoundError("Run/copy decoded worldmap_sp.bin and worldmap_pa.bin into _work/decoded first")

    buf = bytearray(sp_path.read_bytes())
    count = int.from_bytes(buf[0x42:0x44], "little")
    if count != 1:
        raise ValueError(f"Expected one worldmap sprite, got {count}")

    off = 0x80
    length = int.from_bytes(buf[off:off + 4], "little")
    width = int.from_bytes(buf[off + 4:off + 6], "little", signed=True)
    height = int.from_bytes(buf[off + 6:off + 8], "little", signed=True)
    if (width, height) != (624, 480):
        raise ValueError(f"Unexpected worldmap size: {width}x{height}")

    data, _row_headers, data_start = extract_sprite_pixels(buf, off, width, height, length)
    pixels = bytearray()
    p = 2
    for _ in range(height):
        p += 4
        pixels.extend(data[p:p + width])
        p += width

    img = Image.frombytes("P", (width, height), bytes(pixels))
    img.putpalette(load_palette(pa_path))
    rgb = img.convert("RGB")
    draw = ImageDraw.Draw(rgb)

    # Replace the decorative Latin continent title at the lower-left corner.
    cover = (24, 426, 218, 468)
    bg = rgb.crop((34, 400, 228, 426)).resize((cover[2] - cover[0], cover[3] - cover[1]))
    rgb.paste(bg, cover)
    text = "安塔利亚"
    font = fit_font(text, draw, 30, cover[2] - cover[0] - 8, cover[3] - cover[1] - 4)
    box = draw.textbbox((0, 0), text, font=font, stroke_width=2)
    x = cover[0] + ((cover[2] - cover[0]) - (box[2] - box[0])) // 2 - box[0]
    y = cover[1] + ((cover[3] - cover[1]) - (box[3] - box[1])) // 2 - box[1]
    draw.text((x, y), text, font=font, fill=(244, 218, 90), stroke_width=2, stroke_fill=(52, 30, 8))

    pal_img = Image.new("P", (1, 1))
    pal_img.putpalette(img.getpalette())
    patched = rgb.quantize(palette=pal_img, dither=Image.Dither.NONE)
    patched.putpalette(img.getpalette())

    OUT_SPRITES.mkdir(parents=True, exist_ok=True)
    patched.save(OUT_SPRITES / "00_624x480_x0_y0.png")

    patched_pixels = bytes(patched.getdata())
    p = 2
    src = 0
    for _ in range(height):
        p += 4
        data[p:p + width] = patched_pixels[src:src + width]
        p += width
        src += width
    buf[data_start:data_start + length] = data

    OUT_DECODED.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DECODED / "ZEP_DAT0__worldmap._sp.bin"
    out_path.write_bytes(buf)
    print(out_path)
    print(OUT_SPRITES / "00_624x480_x0_y0.png")


if __name__ == "__main__":
    main()
