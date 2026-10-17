from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SRC = Path("_work/sprites")
OUT = Path("_work/patched_sprites")
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


FONT = font_path()


def find_sprite(name: str, index: int) -> Path:
    matches = sorted((SRC / name).glob(f"{index:02d}_*.png"))
    if not matches:
        raise FileNotFoundError(f"Missing sprite {name}:{index:02d}")
    return matches[0]


def palette_rgb(img: Image.Image, index: int) -> tuple[int, int, int]:
    pal = img.getpalette()
    return tuple(pal[index * 3:index * 3 + 3])


def dominant_bg(img: Image.Image, box: tuple[int, int, int, int]) -> tuple[int, int, int]:
    crop = img.crop(box)
    counts = Counter()
    fallback = Counter()
    for idx in crop.getdata():
        rgb = palette_rgb(img, idx)
        r, g, b = rgb
        total = r + g + b
        if total < 35:
            continue
        fallback[idx] += 1
        if r > g * 1.15 and r > b * 1.15 and total < 430:
            counts[idx] += 1
        elif b > r * 1.1 and b > g * 1.05 and total < 460:
            counts[idx] += 1
    if counts:
        return palette_rgb(img, counts.most_common(1)[0][0])
    if fallback:
        return palette_rgb(img, fallback.most_common(1)[0][0])
    return (96, 10, 8)


def fit_font(text: str, box: tuple[int, int, int, int], max_size: int, stroke: int) -> ImageFont.FreeTypeFont:
    width = box[2] - box[0]
    height = box[3] - box[1]
    probe = Image.new("RGB", (1, 1))
    draw = ImageDraw.Draw(probe)
    for size in range(max_size, 6, -1):
        font = ImageFont.truetype(str(FONT), size)
        bbox = draw.textbbox((0, 0), text, font=font, stroke_width=stroke)
        if bbox[2] - bbox[0] <= width - 2 and bbox[3] - bbox[1] <= height - 1:
            return font
    return ImageFont.truetype(str(FONT), 7)


def draw_label(
    rgb: Image.Image,
    original: Image.Image,
    text: str,
    box: tuple[int, int, int, int],
    max_size: int = 16,
    fill: tuple[int, int, int] = (250, 250, 238),
    stroke_fill: tuple[int, int, int] = (28, 4, 4),
    stroke: int = 1,
):
    draw = ImageDraw.Draw(rgb)
    draw.rectangle(box, fill=dominant_bg(original, box))
    font = fit_font(text, box, max_size, stroke)
    bbox = draw.textbbox((0, 0), text, font=font, stroke_width=stroke)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = box[0] + ((box[2] - box[0]) - text_w) // 2 - bbox[0]
    y = box[1] + ((box[3] - box[1]) - text_h) // 2 - bbox[1] - 1
    draw.text((x, y), text, font=font, fill=fill, stroke_width=stroke, stroke_fill=stroke_fill)


def quantize_to_original(rgb: Image.Image, original: Image.Image) -> Image.Image:
    palette = Image.new("P", (1, 1))
    palette.putpalette(original.getpalette())
    out = rgb.quantize(palette=palette, dither=Image.Dither.NONE)
    out.putpalette(original.getpalette())
    return out


def patch_sprite(name: str, index: int, labels: list[dict]):
    src = find_sprite(name, index)
    original = Image.open(src)
    rgb = original.convert("RGB")
    for label in labels:
        draw_label(rgb, original, **label)
    out_dir = OUT / name
    out_dir.mkdir(parents=True, exist_ok=True)
    quantize_to_original(rgb, original).save(out_dir / src.name)
    print(f"patched {name}:{index:02d} -> {out_dir / src.name}")


WHITE = (252, 250, 240)
YELLOW = (244, 224, 112)
CYAN = (160, 238, 230)


def button(text, box=None, max_size=18, fill=WHITE, stroke=1):
    return {
        "text": text,
        "box": box,
        "max_size": max_size,
        "fill": fill,
        "stroke": stroke,
    }


def main():
    # System/options menu.
    patch_sprite("sysm", 0, [
        button("系统", (47, 9, 160, 31), 18),
        button("存档", (18, 40, 98, 83), 20),
        button("读档", (110, 40, 191, 83), 20),
        button("音量", (6, 85, 100, 107), 14, YELLOW, 0),
        button("消息框", (103, 126, 193, 147), 14, YELLOW, 0),
        button("返回标题", (27, 216, 181, 238), 16),
        button("结束游戏", (36, 238, 172, 259), 16),
    ])
    for idx, text in [(1, "存档"), (2, "存档"), (3, "读档"), (4, "读档")]:
        patch_sprite("sysm", idx, [button(text, (5, 4, 77, 28), 22)])
    for idx in [13, 14]:
        patch_sprite("sysm", idx, [button("半透明", (8, 1, 82, 19), 16)])
    for idx, text in [(15, "返回标题"), (16, "返回标题"), (17, "结束游戏"), (18, "结束游戏")]:
        patch_sprite("sysm", idx, [button(text, (8, 1, 172, 17), 15)])

    # Main command menu.
    patch_sprite("menu", 0, [button("菜单", (31, 5, 76, 23), 15)])
    for idx, text in [(1, "道具"), (2, "道具"), (3, "状态"), (4, "状态"), (5, "系统"), (6, "系统"), (7, "队形"), (8, "队形")]:
        patch_sprite("menu", idx, [button(text, (1, 20, 35, 38), 10)])
    for idx in [10, 11]:
        patch_sprite("menu", idx, [button("世界地图", (8, 7, 72, 25), 12)])

    # Item window title.
    patch_sprite("itemp", 0, [button("使用道具", (133, 3, 223, 20), 15)])

    # Status screen base panel.
    stat_labels = [
        ("力量", (276, 57, 323, 72)),
        ("速度", (276, 73, 323, 88)),
        ("智力", (276, 89, 323, 104)),
        ("攻击力", (276, 105, 323, 120)),
        ("移动力", (276, 121, 323, 136)),
        ("防御力", (276, 137, 323, 152)),
        ("魔抗", (276, 153, 323, 168)),
        ("回合", (276, 169, 323, 184)),
    ]
    status_base = [
        button("状态", (289, 39, 363, 57), 13, YELLOW, 0),
        button("装备", (273, 187, 390, 205), 13, YELLOW, 0),
        button("武器", (276, 206, 336, 225), 12, YELLOW, 0),
        button("弹药", (276, 223, 336, 242), 12, YELLOW, 0),
        button("附件1", (276, 256, 350, 275), 12, YELLOW, 0),
        button("附件2", (276, 290, 350, 309), 12, YELLOW, 0),
        button("信息", (278, 324, 370, 340), 13, CYAN, 0),
        button("职业", (125, 75, 178, 91), 13, YELLOW, 0),
        button("等级", (129, 128, 182, 149), 18),
        button("经验", (149, 153, 183, 171), 13),
        button("下级", (126, 178, 184, 198), 13),
        button("列表", (495, 107, 536, 121), 12, YELLOW, 0),
    ] + [button(text, box, 12) for text, box in stat_labels]
    patch_sprite("status", 0, status_base)

    for idx, text, color in [
        (9, "魔法", WHITE), (10, "魔法", YELLOW),
        (11, "必杀技", WHITE), (12, "必杀技", YELLOW),
        (13, "技能", WHITE), (14, "技能", YELLOW),
        (15, "装备", WHITE), (16, "装备", YELLOW),
        (17, "武器", WHITE), (18, "武器", YELLOW), (19, "武器", (90, 120, 140)),
        (20, "弹药", WHITE), (21, "弹药", YELLOW), (22, "弹药", (90, 120, 140)),
        (23, "防具/其他", WHITE), (24, "防具/其他", YELLOW), (25, "防具/其他", (90, 120, 140)),
    ]:
        src = find_sprite("status", idx)
        original = Image.open(src)
        w, h = original.size
        patch_sprite("status", idx, [button(text, (1, 1, w - 1, h - 1), min(16, h - 2), color)])


if __name__ == "__main__":
    main()
