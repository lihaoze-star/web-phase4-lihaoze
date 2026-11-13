#!/usr/bin/env python3
"""Generate the editorial cover art used by the site.

The output is deliberately small: every image is exported as WebP and kept
well under the 300 KB limit from the brief.
"""

from __future__ import annotations

import math
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "img"
OUT.mkdir(parents=True, exist_ok=True)

FONT_SANS = r"C:\Windows\Fonts\NotoSansSC-VF.ttf"
FONT_SERIF = r"C:\Windows\Fonts\NotoSerifSC-VF.ttf"
FONT_GEORGIA = r"C:\Windows\Fonts\georgiab.ttf"

PAPER = "#F2EEE5"
CREAM = "#F8F5EE"
INK = "#141414"
ORANGE = "#FF4D1F"
LIME = "#D8FF47"
BLUE = "#2B44FF"

random.seed(7)
np.random.seed(7)


def font(path: str, size: int, weight: str | None = None) -> ImageFont.FreeTypeFont:
    face = ImageFont.truetype(path, size)
    if weight:
        try:
            face.set_variation_by_name(weight)
        except Exception:
            pass
    return face


def tracking(draw: ImageDraw.ImageDraw, xy, text: str, face, fill, gap: float = 0):
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=face, fill=fill)
        x += draw.textlength(ch, font=face) + gap


def grain(img: Image.Image, strength: float = 6.0) -> Image.Image:
    arr = np.asarray(img).astype(np.int16)
    noise = np.random.normal(0, strength, arr.shape[:2])[..., None]
    arr[..., :3] = np.clip(arr[..., :3] + noise, 0, 255)
    return Image.fromarray(arr.astype(np.uint8), "RGB")


def vignette(img: Image.Image, amount: float = 0.13) -> Image.Image:
    w, h = img.size
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = w / 2, h / 2
    dist = np.sqrt(((xx - cx) / (w * 0.72)) ** 2 + ((yy - cy) / (h * 0.72)) ** 2)
    mask = np.clip(dist - 0.35, 0, 1) ** 2 * amount
    arr = np.asarray(img).astype(np.float32)
    arr[..., :3] *= (1 - mask[..., None])
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


def grid(draw: ImageDraw.ImageDraw, w: int, h: int, step: int, fill: str):
    for x in range(0, w + step, step):
        draw.line([(x, 0), (x, h)], fill=fill, width=1)
    for y in range(0, h + step, step):
        draw.line([(0, y), (w, y)], fill=fill, width=1)


def cover_shiguang() -> Image.Image:
    w, h = 1200, 900
    img = Image.new("RGB", (w, h), INK)
    d = ImageDraw.Draw(img)
    grid(d, w, h, 75, "#202020")

    sans = font(FONT_SANS, 17, "SemiBold")
    sans_sm = font(FONT_SANS, 13, "Medium")
    georgia_sm = font(FONT_GEORGIA, 24)
    serif = font(FONT_SERIF, 116, "Bold")
    serif_body = font(FONT_SERIF, 36, "Medium")
    timer = font(FONT_GEORGIA, 132)

    # top labels
    d.text((70, 56), "01", font=georgia_sm, fill=LIME)
    tracking(d, (108, 61), "/ INTERACTION", sans_sm, CREAM, 3.2)
    tracking(d, (930, 61), "2026 — 11", sans_sm, CREAM, 3.2)

    # rules
    d.line([(70, 112), (1130, 112)], fill="#3A3A3A", width=1)
    d.line([(70, 806), (1130, 806)], fill="#3A3A3A", width=1)

    # timer ring
    cx, cy, r = 808, 452, 238
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline="#2E2E2E", width=22)
    d.arc([cx - r, cy - r, cx + r, cy + r], start=-92, end=176, fill=ORANGE, width=22)
    d.arc([cx - r, cy - r, cx + r, cy + r], start=176, end=214, fill=LIME, width=22)
    # end cap
    angle = math.radians(-92)
    ex, ey = cx + (r - 11) * math.cos(angle), cy + (r - 11) * math.sin(angle)
    d.ellipse([ex - 11, ey - 11, ex + 11, ey + 11], fill=LIME)

    for i in range(48):
        a = (i / 48) * math.tau
        x = cx + math.cos(a) * 198
        y = cy + math.sin(a) * 198
        d.ellipse([x - 1.3, y - 1.3, x + 1.3, y + 1.3], fill="#595959")

    d.text((cx, cy - 22), "25:00", font=timer, fill=CREAM, anchor="mm")
    tracking(d, (cx - 64, cy + 78), "FOCUS / 05:00", sans_sm, "#B9B4AA", 3.0)

    # left typography
    d.text((70, 292), "拾光", font=serif, fill=CREAM, stroke_width=2, stroke_fill=CREAM)
    d.multiline_text(
        (72, 468),
        "把 25 分钟\n还给自己。",
        font=serif_body,
        fill=LIME,
        spacing=18,
    )
    tracking(d, (72, 620), "VANILLA FOCUS TIMER", sans_sm, "#8F8B83", 2.6)
    d.rectangle([72, 660, 138, 664], fill=ORANGE)

    tracking(d, (70, 834), "HTML", sans_sm, CREAM, 2.5)
    tracking(d, (160, 834), "CSS", sans_sm, CREAM, 2.5)
    tracking(d, (238, 834), "JAVASCRIPT", sans_sm, CREAM, 2.5)
    tracking(d, (984, 834), "PAUSE / BREATHE", sans_sm, "#8F8B83", 2.2)

    # live dot
    d.ellipse([70, 137, 80, 147], fill=LIME)
    tracking(d, (92, 132), "AVAILABLE FOR FOCUS", sans_sm, "#B9B4AA", 2.5)

    return grain(vignette(img, 0.18), 4.5)


def cover_this_page() -> Image.Image:
    w, h = 1200, 900
    img = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(img)
    grid(d, w, h, 60, "#E4DED2")

    sans_sm = font(FONT_SANS, 13, "Medium")
    sans_tiny = font(FONT_SANS, 12, "Medium")
    georgia_sm = font(FONT_GEORGIA, 24)
    sans_bold = font(FONT_SANS, 78, "Bold")
    serif = font(FONT_SERIF, 96, "Bold")
    mono = font(FONT_GEORGIA, 14)

    d.text((64, 56), "02", font=georgia_sm, fill=ORANGE)
    tracking(d, (102, 61), "/ THIS PAGE", sans_sm, INK, 3.2)
    tracking(d, (998, 61), "PORTFOLIO 2026", sans_sm, INK, 2.6)

    # browser window
    x0, y0, x1, y1 = 92, 158, 1108, 772
    d.rectangle([x0 + 10, y0 + 12, x1 + 10, y1 + 12], fill="#DCD5C7")
    d.rectangle([x0, y0, x1, y1], fill=CREAM, outline=INK, width=3)
    d.rectangle([x0, y0, x1, y0 + 56], fill=INK)

    for i, color in enumerate([ORANGE, LIME, PAPER]):
        d.ellipse([x0 + 24 + i * 28, y0 + 22, x0 + 36 + i * 28, y0 + 34], fill=color)
    d.text((x0 + 126, y0 + 17), "lihaoze-star.github.io", font=mono, fill="#D8D2C6")

    # headline inside the window
    d.text((x0 + 46, y0 + 104), "把想法，", font=sans_bold, fill=INK)
    d.text((x0 + 46, y0 + 196), "做成能运行的", font=sans_bold, fill=INK)
    d.text((x0 + 46, y0 + 292), "网页", font=serif, fill=INK)
    d.text((x0 + 46 + d.textlength("网页", font=serif), y0 + 292), "。", font=serif, fill=ORANGE)

    # lime block with monogram
    d.rectangle([x0 + 660, y0 + 120, x1 - 46, y1 - 118], fill=LIME)
    d.text((x0 + 702, y0 + 150), "HZ", font=font(FONT_SANS, 190, "Black"), fill=INK)
    d.text((x0 + 702, y0 + 380), "FRONT-END", font=sans_tiny, fill=INK)
    d.text((x0 + 702, y0 + 400), "LEARNER / 2026", font=sans_tiny, fill=INK)

    # tags
    tag_y = y1 - 76
    for i, label in enumerate(["SEMANTIC", "RESPONSIVE", "VANILLA JS"]):
        tw = d.textlength(label, font=sans_tiny)
        bx = x0 + 46 + i * 182
        d.rectangle([bx, tag_y, bx + tw + 26, tag_y + 30], outline="#B9B1A2", width=1)
        d.text((bx + 13, tag_y + 8), label, font=sans_tiny, fill=INK)

    tracking(d, (64, 806), "03 PAGES  /  0 FRAMEWORKS  /  1 FETCH", sans_tiny, "#5F5A51", 2.0)
    tracking(d, (905, 806), "DESIGNED & CODED BY HZ", sans_tiny, "#5F5A51", 2.0)

    return grain(vignette(img, 0.09), 3.0)


def cover_404() -> Image.Image:
    w, h = 1200, 900
    img = Image.new("RGB", (w, h), BLUE)
    d = ImageDraw.Draw(img)
    grid(d, w, h, 75, "#3A50FF")

    sans_sm = font(FONT_SANS, 13, "SemiBold")
    georgia_sm = font(FONT_GEORGIA, 24)
    numeral = font(FONT_GEORGIA, 400)
    serif = font(FONT_SERIF, 44, "Medium")
    sans_tiny = font(FONT_SANS, 12, "Medium")

    tracking(d, (66, 58), "03 / ERROR PAGE", sans_sm, CREAM, 3.2)
    d.text((1010, 51), "404", font=georgia_sm, fill=CREAM)

    # big numerals, middle one orange
    base_y = 600
    d.text((92, base_y), "4", font=numeral, fill=CREAM, anchor="ls")
    d.text((444, base_y), "0", font=numeral, fill=ORANGE, anchor="ls")
    d.text((796, base_y), "4", font=numeral, fill=CREAM, anchor="ls")

    # underline / path
    d.line([(92, 662), (1108, 662)], fill="#6B7BFF", width=1)
    d.line([(92, 662), (92, 690)], fill=CREAM, width=2)
    d.line([(1108, 662), (1108, 690)], fill=CREAM, width=2)

    d.multiline_text((92, 716), "迷路了，\n就回到首页。", font=serif, fill=CREAM, spacing=16)
    tracking(d, (900, 748), "LOST & FOUND", sans_tiny, "#C8D0FF", 4.0)
    d.line([(900, 776), (1040, 776)], fill=LIME, width=3)
    # arrow
    d.line([(1040, 776), (1024, 766)], fill=LIME, width=3)
    d.line([(1040, 776), (1024, 786)], fill=LIME, width=3)

    tracking(d, (66, 132), "THE PAGE YOU WANTED DOES NOT EXIST — BUT THE WAY HOME DOES.", sans_tiny, "#C8D0FF", 1.8)

    return grain(vignette(img, 0.2), 4.0)


def og_cover() -> Image.Image:
    w, h = 1200, 630
    img = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(img)
    grid(d, w, h, 55, "#E4DED2")

    sans_sm = font(FONT_SANS, 12, "Medium")
    sans_bold = font(FONT_SANS, 66, "Bold")
    serif = font(FONT_SERIF, 82, "Bold")
    georgia = font(FONT_GEORGIA, 28)

    d.text((64, 48), "李昊泽", font=font(FONT_SANS, 20, "Bold"), fill=INK)
    tracking(d, (64, 84), "FRONT-END LEARNER / 2026", sans_sm, "#5F5A51", 2.6)
    d.text((894, 50), "HZ.", font=font(FONT_SANS, 78, "Black"), fill=INK)
    d.ellipse([1072, 44, 1104, 76], fill=ORANGE)

    d.text((64, 214), "把想法，", font=sans_bold, fill=INK)
    d.text((64, 292), "做成能运行的", font=sans_bold, fill=INK)
    d.text((64, 378), "网页", font=serif, fill=INK)
    d.text((64 + d.textlength("网页", font=serif), 378), "。", font=serif, fill=ORANGE)

    d.rectangle([64, 530, 200, 534], fill=ORANGE)
    tracking(d, (64, 552), "SEMANTIC HTML  /  RESPONSIVE CSS  /  VANILLA JS", sans_sm, "#5F5A51", 1.8)
    d.text((975, 548), "01", font=georgia, fill="#8E877B")

    return grain(vignette(img, 0.08), 2.5)


def save(img: Image.Image, name: str, quality: int = 82):
    path = OUT / name
    img.save(path, "WEBP", quality=quality, method=6)
    print(f"{path.name}: {path.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    save(cover_shiguang(), "cover-shiguang.webp", 84)
    save(cover_this_page(), "cover-this-page.webp", 84)
    save(cover_404(), "cover-404.webp", 84)
    save(og_cover(), "og-cover.webp", 84)
