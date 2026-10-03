#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
橙曦澎湃 / Project Rootpi & Xiaocheng (Prax) —— 门户网站配图生成器

设计基准（全部取自 PRAX.png 官方 logo 实测采样）：
    橙红  #C34C18
    明黄  #F2B603
    米白  #F6F5EF

输出目录：
    public/assets/brand/    品牌标识（从官方 logo 派生，含透明底）
    public/assets/img/      门户主视觉、子页视觉、项目封面、纹样
    public/assets/pattern/  SVG 矢量纹样与装饰

运行：  python tools/generate_assets.py
"""

import math
import os
import random

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

# ---------------------------------------------------------------- 路径与常量

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_LOGO = os.path.join(ROOT, "PRAX.png")

DIR_BRAND = os.path.join(ROOT, "public", "assets", "brand")
DIR_IMG = os.path.join(ROOT, "public", "assets", "img")
DIR_PATTERN = os.path.join(ROOT, "public", "assets", "pattern")

ORANGE = (195, 76, 24)
ORANGE_DEEP = (150, 52, 12)
ORANGE_DARKER = (92, 32, 10)
YELLOW = (242, 182, 3)
YELLOW_LIGHT = (250, 208, 74)
CREAM = (246, 245, 239)
CREAM_DEEP = (233, 227, 212)
INK = (38, 28, 22)

# 图标在整个 logo 画布中的实测分界
ICON_TOP, ICON_BOTTOM = 123, 1547
MARK_TOP, MARK_BOTTOM = 1613, 1893


def ensure_dirs():
    for d in (DIR_BRAND, DIR_IMG, DIR_PATTERN):
        os.makedirs(d, exist_ok=True)


def save(img, folder, name, **kw):
    path = os.path.join(folder, name)
    img.save(path, **kw)
    print("  -> %-46s %s" % (os.path.relpath(path, ROOT), size_of(img)))


def size_of(img):
    return "%dx%d" % img.size


# ---------------------------------------------------------------- 颜色工具


def mix(c1, c2, t):
    """线性插值两个 RGB 颜色。"""
    return tuple(int(round(a + (b - a) * t)) for a, b in zip(c1, c2))


def with_alpha(c, a):
    return (c[0], c[1], c[2], max(0, min(255, int(a))))


# ---------------------------------------------------------------- 渐变工具


def linear_gradient(size, stops, angle_deg=135):
    """
    生成线性渐变图。
    stops: [(pos0..1, (r,g,b)), ...]
    """
    w, h = size
    stops = sorted(stops, key=lambda s: s[0])
    # 先做一条水平渐变（长度取对角线），再旋转裁剪 —— 与角度解耦，质量稳定
    diag = int(math.hypot(w, h)) + 2
    line = Image.new("RGB", (diag, 1))
    px = line.load()
    for x in range(diag):
        t = x / max(1, diag - 1)
        c = _sample_stops(stops, t)
        px[x, 0] = c
    grad = line.resize((diag, diag), Image.NEAREST)
    grad = grad.rotate(-angle_deg, resample=Image.BICUBIC, expand=False)
    left = (diag - w) // 2
    top = (diag - h) // 2
    return grad.crop((left, top, left + w, top + h))


def _sample_stops(stops, t):
    if t <= stops[0][0]:
        return stops[0][1]
    if t >= stops[-1][0]:
        return stops[-1][1]
    for i in range(len(stops) - 1):
        p0, c0 = stops[i]
        p1, c1 = stops[i + 1]
        if p0 <= t <= p1:
            local = 0.0 if p1 == p0 else (t - p0) / (p1 - p0)
            return mix(c0, c1, local)
    return stops[-1][1]


def radial_glow(size, center, radius, color, peak=210, falloff=2.0):
    """生成一个柔和的径向光斑图层（RGBA）。"""
    w, h = size
    small = 256
    layer = Image.new("L", (small, small), 0)
    px = layer.load()
    cx = cy = (small - 1) / 2.0
    for y in range(small):
        for x in range(small):
            d = math.hypot(x - cx, y - cy) / (small / 2.0)
            if d >= 1.0:
                v = 0
            else:
                v = (1.0 - d) ** falloff * peak
            px[x, y] = int(max(0, min(255, v)))
    layer = layer.resize((int(radius * 2), int(radius * 2)), Image.BICUBIC)
    canvas = Image.new("L", (w, h), 0)
    canvas.paste(layer, (int(center[0] - radius), int(center[1] - radius)))
    out = Image.new("RGBA", (w, h), with_alpha(color, 0))
    out.putalpha(canvas)
    solid = Image.new("RGBA", (w, h), with_alpha(color, 255))
    solid.putalpha(canvas)
    return solid


def add_noise(img, amount=6, seed=7):
    """叠加极细颗粒，避免大色块出现色带。"""
    rnd = random.Random(seed)
    noise = Image.new("L", img.size)
    noise.putdata([128 + rnd.randint(-amount, amount) for _ in range(img.size[0] * img.size[1])])
    noise = noise.filter(ImageFilter.GaussianBlur(0.4))
    base = img.convert("RGB")
    n = noise.convert("RGB")
    return ImageChops.overlay(base, n).convert(img.mode if img.mode == "RGBA" else "RGB")


def vignette(img, strength=0.45):
    w, h = img.size
    mask = radial_glow((w, h), (w / 2, h / 2), max(w, h) * 0.78, (255, 255, 255), peak=255, falloff=1.25)
    dark = Image.new("RGB", (w, h), (0, 0, 0))
    m = mask.getchannel("A").point(lambda v: 255 - int(v * strength))
    rgb = img.convert("RGB")
    return Image.composite(rgb, Image.blend(rgb, dark, 1.0), m).convert(img.mode)


# ---------------------------------------------------------------- 字体


def load_font(size, bold=True):
    """寻找一个可用的中文字体，找不到则回退。"""
    candidates = [
        r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\Dengb.ttf",
        r"C:\Windows\Fonts\Deng.ttf",
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\arial.ttf",
    ]
    for c in candidates:
        if os.path.exists(c):
            try:
                return ImageFont.truetype(c, size)
            except Exception:
                continue
    return ImageFont.load_default()


def text_size(draw, text, font):
    box = draw.textbbox((0, 0), text, font=font)
    return box[2] - box[0], box[3] - box[1], box


# ================================================================ 1. 品牌标识


def _outside_mask(src, tol=18):
    """
    找出「与画面外缘连通的米白区域」= 真正的背景。
    关键：logo 图标内部的米白空隙不连通外缘，必须保留为不透明，
    否则放到深色底上会露出底色、图标被掏空。
    """
    W, H = src.size
    bg = Image.new("RGB", (W, H), CREAM)
    diff = ImageChops.difference(src, bg).convert("L")
    work = diff.point(lambda v: 255 if v <= tol else 0)
    for corner in ((0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1)):
        if work.getpixel(corner) == 255:
            ImageDraw.floodfill(work, corner, 128, thresh=0)
    return work.point(lambda v: 255 if v == 128 else 0)


def _split_mark(full):
    """
    把裁切后的完整标识切成「图标」与「字标」两部分。

    为什么用固定阈值而不是自动找最大间隙：
    本 logo 的柑橘图标内部本身就有一道横断（上半橙弧 / 下半黄瓣），
    实测两条间隙分别约 57px（图标内部）与 68px（图标与字标之间），仅差 11px，
    任何自适应规则都会在两者之间摇摆。由于官方 logo 是固定资源，
    这里采用一次精确测量后的确定性阈值：

        间隙 > 60px 的第一处 = 图标与字标的分界

    若规则失效（换成别的 logo），则退回「整体当图标」，绝不产出错位的裁切。
    """
    W, H = full.size
    a = full.split()[3]
    vals = list(a.resize((1, H), Image.BOX).getdata())
    bands = []
    prev = False
    for y, v in enumerate(vals):
        on = v > 4
        if on and not prev:
            bands.append([y, y])
        elif on:
            bands[-1][1] = y
        prev = on
    bands = [b for b in bands if b[1] - b[0] >= 4]

    if len(bands) < 2:
        return full, Image.new("RGBA", (1, 1), (0, 0, 0, 0))

    SPLIT_GAP_PX = 60
    cut = None
    for i in range(len(bands) - 1):
        if bands[i + 1][0] - bands[i][1] > SPLIT_GAP_PX:
            cut = i
            break

    if cut is None:
        return full, Image.new("RGBA", (1, 1), (0, 0, 0, 0))

    pad = int(H * 0.008)
    icon = full.crop((0, max(0, bands[0][0] - pad), W, min(H, bands[cut][1] + pad)))
    icon = icon.crop(icon.getbbox())

    y0 = bands[cut + 1][0] - pad
    y1 = bands[-1][1] + pad
    mark = full.crop((0, max(0, y0), W, min(H, y1)))
    mark = mark.crop(mark.getbbox())

    if mark.size[0] < 8 or mark.size[1] < 8:
        mark = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    return icon, mark


def build_brand():
    print("[1/5] 品牌标识（从官方 logo 派生）")
    src = Image.open(SRC_LOGO).convert("RGB")
    W, H = src.size

    # 抠掉与边缘连通的米白底 -> 透明底（内部米白保留）
    outside = _outside_mask(src)
    alpha = outside.point(lambda v: 255 - v)
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.7))

    rgba = src.convert("RGBA")
    # 边缘像素的 RGB 仍混有米白，做一次去底色收敛，避免透明边缘发白
    px = rgba.load()
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            if a < 250:
                t = a / 255.0
                nr = (r - CREAM[0] * (1 - t)) / t if t > 0.02 else r
                ng = (g - CREAM[1] * (1 - t)) / t if t > 0.02 else g
                nb = (b - CREAM[2] * (1 - t)) / t if t > 0.02 else b
                px[x, y] = (
                    max(0, min(255, int(nr))),
                    max(0, min(255, int(ng))),
                    max(0, min(255, int(nb))),
                    a,
                )
    rgba.putalpha(alpha)
    rgba = rgba.crop(rgba.getbbox())

    full = rgba.copy()
    full.save(os.path.join(DIR_BRAND, "logo-lockup.png"))
    print("  -> %-46s %s" % ("public/assets/brand/logo-lockup.png", size_of(full)))

    # 在裁切后的实际画面上重新探测「图标 / 字标」分界，不依赖硬编码比例
    icon, mark = _split_mark(full)

    icon.save(os.path.join(DIR_BRAND, "logo-mark.png"))
    print("  -> %-46s %s" % ("public/assets/brand/logo-mark.png", size_of(icon)))
    mark.save(os.path.join(DIR_BRAND, "logo-wordmark.png"))
    print("  -> %-46s %s" % ("public/assets/brand/logo-wordmark.png", size_of(mark)))

    # 方形图标：裁掉字标并居中补成正方形，留出安全边距
    icon_sq = _square_pad(icon, pad_ratio=0.10)
    icon_sq.resize((512, 512), Image.LANCZOS).save(os.path.join(DIR_BRAND, "logo-icon-512.png"))
    print("  -> %-46s %s" % ("public/assets/brand/logo-icon-512.png", size_of(icon_sq.resize((512, 512)))))
    for s in (180, 192, 512):
        _write_ico_png(icon_sq, DIR_BRAND, s)
    icon_sq.save(os.path.join(DIR_BRAND, "logo-icon.png"))

    # favicon.ico 多尺寸
    ico = os.path.join(ROOT, "public", "favicon.ico")
    icon_sq.resize((256, 256), Image.LANCZOS).save(
        ico, sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    )
    print("  -> %-46s multi-size" % "public/favicon.ico")

    # 反白版（用于深色底）
    _write_knockout(rgba, full)

    # 纯色字标（用于浅底/深底不同场景）
    return icon_sq


def _square_pad(img, pad_ratio=0.1):
    w, h = img.size
    side = int(max(w, h) * (1 + pad_ratio * 2))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - w) // 2, (side - h) // 2), img)
    return canvas


def _write_ico_png(icon_sq, folder, size):
    name = "logo-icon-%d.png" % size
    # 安卓/PWA 图标用实心米白底，避免透明底在部分启动器上发黑
    bg = Image.new("RGB", (size, size), CREAM)
    art = icon_sq.resize((size, size), Image.LANCZOS)
    bg.paste(art, (0, 0), art)
    save(bg, folder, name)


def _write_knockout(rgba, full):
    """生成米白单色反白版，便于放在深色/橙色背景上。"""
    r, g, b, a = rgba.split()
    white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    white.putalpha(a)
    white.save(os.path.join(DIR_BRAND, "logo-lockup-knockout.png"))
    print("  -> %-46s %s" % ("public/assets/brand/logo-lockup-knockout.png", size_of(white)))

    cream = Image.new("RGBA", full.size, with_alpha(CREAM, 255))
    cream.putalpha(full.split()[3])
    cream.save(os.path.join(DIR_BRAND, "logo-lockup-cream.png"))
    print("  -> %-46s %s" % ("public/assets/brand/logo-lockup-cream.png", size_of(cream)))


# ================================================================ 2. 主视觉


def build_hero():
    print("[2/4] 门户主视觉（橙色现代）")
    W, H = 2400, 1350

    base = linear_gradient(
        (W, H),
        [
            (0.00, (232, 108, 40)),
            (0.28, (203, 80, 28)),
            (0.62, (180, 64, 20)),
            (1.00, (118, 44, 16)),
        ],
        angle_deg=132,
    )
    base = add_noise(base, 5, seed=11)

    # 下方暖光（日落余晖，克制使用以免发闷）
    glow = radial_glow((W, H), (W * 0.24, H * 1.06), W * 0.58, YELLOW, peak=112, falloff=2.4)
    base = Image.alpha_composite(base.convert("RGBA"), glow)

    # 右上冷调高光，增加层次
    cool = radial_glow((W, H), (W * 0.86, H * 0.08), W * 0.42, (255, 232, 200), peak=118, falloff=1.9)
    base = Image.alpha_composite(base, cool)

    # 斜向高光扫过，制造现代感的光泽
    sweep = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    swd = ImageDraw.Draw(sweep)
    for i in range(3):
        off = i * 260
        swd.polygon(
            [(-200 + off, H), (240 + off, 0), (430 + off, 0), (-10 + off, H)],
            fill=with_alpha((255, 240, 220), 26 - i * 7),
        )
    sweep = sweep.filter(ImageFilter.GaussianBlur(26))
    base = Image.alpha_composite(base, sweep)

    layer = base.copy()

    # 同心圆弧（呼应 logo 的柑橘切面结构）
    rings = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rings)
    cx, cy = W * 0.74, H * 0.50
    for i in range(9):
        r = 150 + i * 108
        a = int(92 - i * 8.2)
        if a <= 6:
            continue
        rd.ellipse(
            [cx - r, cy - r, cx + r, cy + r],
            outline=with_alpha(YELLOW_LIGHT, a),
            width=max(2, 5 - i // 3),
        )
    rings = rings.filter(ImageFilter.GaussianBlur(0.5))
    layer = Image.alpha_composite(layer, rings)

    # 放射状光带（柑橘瓣的抽象化）
    rays = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rdraw = ImageDraw.Draw(rays)
    rnd = random.Random(23)
    for i in range(26):
        ang = (i / 26.0) * 360 + rnd.uniform(-4, 4)
        rad = math.radians(ang)
        length = rnd.uniform(W * 0.30, W * 0.72)
        inner = rnd.uniform(140, 340)
        width = rnd.uniform(2.0, 7.5)
        x0 = cx + math.cos(rad) * inner
        y0 = cy + math.sin(rad) * inner
        x1 = cx + math.cos(rad) * length
        y1 = cy + math.sin(rad) * length
        a = int(rnd.uniform(42, 132))
        rdraw.line([x0, y0, x1, y1], fill=with_alpha(YELLOW_LIGHT, a), width=int(width))
    rays = rays.filter(ImageFilter.GaussianBlur(1.1))
    layer = Image.alpha_composite(layer, rays)

    # 品牌水印：米白单色，在橙色底上才立得住
    layer = _overlay_logo(layer, alpha=64, scale=0.44, center=(W * 0.745, H * 0.50), tint=CREAM)

    # 暗角 + 底部压暗，给标题留出干净区域
    layer = _bottom_scrim(layer, H, 0.50)
    final = _apply_vignette_rgba(layer, 0.30)
    save(final.convert("RGB"), DIR_IMG, "hero-portal.jpg", quality=93, optimize=True, progressive=True)

    # 官网 OG 分享图
    og = _build_og(W, H)
    save(og, DIR_IMG, "og-cover.jpg", quality=92, optimize=True, progressive=True)

    # 进入站点的加载动效底纹
    loadbg = linear_gradient((1600, 900), [(0.0, (30, 21, 17)), (1.0, (17, 13, 11))], 120)
    loadbg = _overlay_logo(loadbg.convert("RGBA"), alpha=150, scale=0.24, center=(800, 450), tint=YELLOW)
    save(loadbg.convert("RGB"), DIR_IMG, "preloader-bg.jpg", quality=88, optimize=True)


def _overlay_logo(canvas, alpha, scale, center, tint=None):
    """把 logo 图标以低透明度压入背景，形成品牌水印；tint 可指定单色。"""
    mark = Image.open(os.path.join(DIR_BRAND, "logo-icon.png")).convert("RGBA")
    tw = int(canvas.size[0] * scale)
    th = int(mark.size[1] * tw / mark.size[0])
    mark = mark.resize((tw, th), Image.LANCZOS)
    a = mark.split()[3].point(lambda v: int(v * alpha / 255.0))
    if tint is not None:
        solid = Image.new("RGBA", mark.size, with_alpha(tint, 255))
        mark = solid
    mark.putalpha(a)
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    layer.paste(mark, (int(center[0] - tw / 2), int(center[1] - th / 2)), mark)
    return Image.alpha_composite(canvas, layer)


def _bottom_scrim(img, H, strength):
    grad = Image.new("L", (1, H))
    px = grad.load()
    for y in range(H):
        t = y / (H - 1.0)
        v = 0 if t < 0.42 else int(((t - 0.42) / 0.58) ** 1.5 * 255 * strength)
        px[0, y] = min(255, v)
    grad = grad.resize(img.size, Image.BICUBIC)
    dark = Image.new("RGBA", img.size, (58, 22, 8, 255))
    out = img.copy()
    out.paste(dark, (0, 0), grad)
    return out


def _apply_vignette_rgba(img, strength):
    w, h = img.size
    mask = radial_glow((w, h), (w / 2, h / 2), max(w, h) * 0.80, (255, 255, 255), peak=255, falloff=1.2)
    m = mask.getchannel("A").point(lambda v: 255 - int(v * strength))
    dark = Image.new("RGBA", (w, h), (20, 10, 6, 255))
    return Image.composite(img, Image.alpha_composite(img, Image.merge("RGBA", (dark.split()[0], dark.split()[1], dark.split()[2], m))), m)


def _build_og(W, H):
    """1200x630 社交分享封面。"""
    og = Image.new("RGB", (1200, 630))
    hero = Image.open(os.path.join(DIR_IMG, "hero-portal.jpg")).convert("RGB")
    ratio = max(1200 / hero.size[0], 630 / hero.size[1])
    hero = hero.resize((int(hero.size[0] * ratio), int(hero.size[1] * ratio)), Image.LANCZOS)
    left = (hero.size[0] - 1200) // 2
    top = (hero.size[1] - 630) // 2
    og.paste(hero.crop((left, top, left + 1200, top + 630)), (0, 0))

    d = ImageDraw.Draw(og, "RGBA")
    d.rectangle([0, 0, 1200, 630], fill=(58, 22, 8, 96))

    mark = Image.open(os.path.join(DIR_BRAND, "logo-icon.png")).convert("RGBA")
    mh = 260
    mw = int(mark.size[0] * mh / mark.size[1])
    mark = mark.resize((mw, mh), Image.LANCZOS)
    og.paste(mark, (96, 92), mark)

    f1 = load_font(66, True)
    f2 = load_font(30, False)
    d.text((96 + mw + 44, 172), "橙曦澎湃", font=f1, fill=(255, 255, 255, 255))
    d.text((96 + mw + 48, 258), "Project Rootpi & Xiaocheng  ·  Prax", font=f2, fill=(255, 224, 190, 240))
    d.text((96, 470), "门户 · 项目 · 工坊 · 协同", font=load_font(40, True), fill=(255, 236, 205, 255))

    bar = Image.new("RGB", (1200, 10), YELLOW)
    og.paste(bar, (0, 620))
    return og


# ================================================================ 3. 子页视觉


def build_subpage():
    print("[3/5] 子页面视觉（米白 + 橙色）")
    W, H = 2200, 1240

    base = linear_gradient(
        (W, H),
        [(0.0, (250, 249, 244)), (0.45, (245, 241, 232)), (1.0, (236, 228, 212))],
        angle_deg=118,
    )

    # 米白纸面质感：极淡的暖色渐晕
    warm = radial_glow((W, H), (W * 0.14, H * 0.10), W * 0.52, (255, 233, 196), peak=104, falloff=1.9)
    base = Image.alpha_composite(base.convert("RGBA"), warm)

    layer = base.copy()

    # 右侧柑橘切面主视觉（复刻 logo 的品牌语言）
    cx, cy = W * 1.01, H * 0.50
    layer = Image.alpha_composite(layer, _citrus_petals(W, H, (cx, cy)))

    # 细网格（工程感 / 设计稿感），只在左半区显现
    grid = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grid)
    step = 56
    for x in range(0, int(W * 0.72), step):
        fade = int(20 * (1 - x / (W * 0.72)))
        gd.line([x, 0, x, H], fill=with_alpha(ORANGE, max(0, fade)), width=1)
    for y in range(0, H, step):
        gd.line([0, y, int(W * 0.72), y], fill=with_alpha(ORANGE, 14), width=1)
    layer = Image.alpha_composite(layer, grid)

    # 左侧几处克制的刻度与十字准星，强化"设计稿"气质
    marks = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    md = ImageDraw.Draw(marks)
    for (mx, my) in [(W * 0.10, H * 0.22), (W * 0.30, H * 0.74), (W * 0.52, H * 0.16)]:
        s = 16
        md.line([mx - s, my, mx + s, my], fill=with_alpha(ORANGE, 92), width=2)
        md.line([mx, my - s, mx, my + s], fill=with_alpha(ORANGE, 92), width=2)
        md.ellipse([mx - 3, my - 3, mx + 3, my + 3], fill=with_alpha(ORANGE, 130))
    layer = Image.alpha_composite(layer, marks)

    layer = _apply_vignette_rgba(layer, 0.10)
    save(layer.convert("RGB"), DIR_IMG, "subpage-hero.jpg", quality=93, optimize=True, progressive=True)

    # 子页头图（更矮，用于内页 banner）
    tall = layer.crop((0, 0, W, int(H * 0.60))).resize((2000, 600), Image.LANCZOS)
    save(tall.convert("RGB"), DIR_IMG, "subpage-banner.jpg", quality=92, optimize=True, progressive=True)

    # 空白纸纹（米白底，用于卡片/区块背景）
    paper = linear_gradient((1400, 900), [(0.0, (251, 250, 245)), (1.0, (242, 236, 224))], 150)
    paper = add_noise(paper, 3, seed=31)
    save(paper, DIR_IMG, "paper-cream.jpg", quality=90, optimize=True)


def _citrus_petals(W, H, center):
    """
    直接复刻 logo 的「柑橘切面」结构：同心色环 + 放射状分隔缝。
    比随机散落的扇形碎片干净得多，也让子页面一眼就是 Prax 的品牌语言。
    """
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy = center
    R_OUT = 700

    # 同心色环（由外到内：橙红 -> 明黄 -> 米白）
    for r, col in ((R_OUT, ORANGE), (470, YELLOW), (250, CREAM)):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=with_alpha(col, 255))

    # 放射状分隔缝，切开色环形成柑橘瓣（严格止于外圆半径，避免溢出）
    segments = 11
    for i in range(segments):
        ang = math.radians(i * 360.0 / segments + 8)
        x0 = cx + math.cos(ang) * 140
        y0 = cy + math.sin(ang) * 140
        x1 = cx + math.cos(ang) * R_OUT
        y1 = cy + math.sin(ang) * R_OUT
        d.line([x0, y0, x1, y1], fill=with_alpha(CREAM, 255), width=28)

    # 外圈描边
    d.ellipse([cx - R_OUT, cy - R_OUT, cx + R_OUT, cy + R_OUT],
              outline=with_alpha(ORANGE_DEEP, 90), width=3)

    # 用圆形遮罩裁掉所有溢出部分（线帽、描边外侧）
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).ellipse(
        [cx - R_OUT, cy - R_OUT, cx + R_OUT, cy + R_OUT], fill=255
    )
    layer.putalpha(ImageChops.multiply(layer.split()[3], mask))

    return layer.filter(ImageFilter.GaussianBlur(0.6))


# ================================================================ 4. 项目封面


COVER_THEMES = [
    ("cover-aurora", [(0.0, (208, 88, 30)), (1.0, (120, 42, 14))], 1, False),
    ("cover-dusk", [(0.0, (150, 52, 12)), (1.0, (58, 24, 14))], 2, False),
    ("cover-sunrise", [(0.0, (242, 182, 3)), (1.0, (208, 92, 32))], 3, False),
    ("cover-ember", [(0.0, (196, 70, 26)), (1.0, (88, 28, 12))], 4, False),
    ("cover-amber", [(0.0, (250, 208, 74)), (1.0, (196, 76, 24))], 5, False),
    ("cover-slate", [(0.0, (86, 74, 68)), (1.0, (32, 26, 22))], 6, False),
    # 下面三张是给工坊（米白底）用的：底色浅、橙色点睛。
    # 放在米白页面上才协调，也不会像纯深色块那样显得"图没加载出来"。
    ("cover-linen", [(0.0, (252, 249, 241)), (0.5, (246, 238, 219)), (1.0, (233, 206, 158))], 7, True),
    ("cover-petal", [(0.0, (253, 246, 230)), (0.65, (247, 219, 172)), (1.0, (240, 172, 82))], 8, True),
    ("cover-grove", [(0.0, (247, 242, 227)), (1.0, (211, 138, 62))], 9, True),
]


def build_covers():
    print("[4/5] 项目封面与纹样")
    for name, stops, seed, light in COVER_THEMES:
        W, H = 1200, 800
        base = linear_gradient((W, H), stops, angle_deg=120 + seed * 11)
        base = add_noise(base, 6, seed=seed * 13)

        layer = base.convert("RGBA")

        # 浅色封面上的装饰要用暖深色，否则白条纹在米白底上完全看不见
        deco_rgb = (150, 84, 30) if light else (255, 255, 255)
        deco_alpha = 20 if light else 12

        # 斜向条纹
        stripes = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        sd = ImageDraw.Draw(stripes)
        for i in range(-H, W + H, 78):
            sd.line([i, H, i + H, 0], fill=with_alpha(deco_rgb, deco_alpha), width=26)
        layer = Image.alpha_composite(layer, stripes)

        # 角落光斑
        glow_col = (255, 250, 235) if light else (255, 232, 200)
        glow = radial_glow((W, H), (W * 0.82, H * 0.18), W * 0.52,
                           glow_col, peak=96 if not light else 130, falloff=2.1)
        layer = Image.alpha_composite(layer, glow)

        # 网格 + 圆弧
        deco = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        dd = ImageDraw.Draw(deco)
        gcol = (150, 84, 30) if light else (255, 255, 255)
        galpha = 26 if light else 9
        for x in range(0, W, 60):
            dd.line([x, 0, x, H], fill=with_alpha(gcol, galpha), width=1)
        for y in range(0, H, 60):
            dd.line([0, y, W, y], fill=with_alpha(gcol, galpha), width=1)
        cx, cy = W * 0.78, H * 0.72
        for i in range(4):
            r = 90 + i * 88
            dd.ellipse([cx - r, cy - r, cx + r, cy + r],
                       outline=with_alpha(gcol, (52 if light else 46) - i * 8), width=2)
        layer = Image.alpha_composite(layer, deco)

        # 浅色封面不要重暗角，否则会脏
        layer = _apply_vignette_rgba(layer, 0.10 if light else 0.40)
        save(layer.convert("RGB"), DIR_IMG, name + ".jpg", quality=90, optimize=True, progressive=True)

    # OA / 后台侧栏装饰
    side = linear_gradient((900, 1400), [(0.0, (36, 26, 21)), (1.0, (22, 16, 13))], 160)
    side = _overlay_logo(side.convert("RGBA"), alpha=16, scale=0.62, center=(450, 520)).convert("RGB")
    save(side, DIR_IMG, "admin-side.jpg", quality=88, optimize=True)


# ================================================================ 5. SVG 纹样


def build_svg():
    print("[5/5] SVG 矢量纹样")
    # 柑橘切面分割纹样
    parts = []
    for i in range(12):
        a0 = i * 30 + 1.6
        a1 = (i + 1) * 30 - 1.6
        parts.append(
            '<path d="M100,100 L{:.3f},{:.3f} A86,86 0 0,1 {:.3f},{:.3f} Z"/>'.format(
                100 + 86 * math.cos(math.radians(a0)), 100 + 86 * math.sin(math.radians(a0)),
                100 + 86 * math.cos(math.radians(a1)), 100 + 86 * math.sin(math.radians(a1)),
            )
        )
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">'
        '<g fill="currentColor" fill-opacity="0.14">' + "".join(parts) + "</g>"
        '<circle cx="100" cy="100" r="86" fill="none" stroke="currentColor" stroke-opacity="0.28" stroke-width="2"/>'
        '<circle cx="100" cy="100" r="20" fill="none" stroke="currentColor" stroke-opacity="0.28" stroke-width="2"/>'
        "</svg>"
    )
    _write(os.path.join(DIR_PATTERN, "citrus-wheel.svg"), svg)

    dots = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">'
        '<circle cx="2" cy="2" r="1.6" fill="currentColor" fill-opacity="0.30"/></svg>'
    )
    _write(os.path.join(DIR_PATTERN, "dot-grid.svg"), dots)

    wave = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 120" width="1440" height="120" '
        'preserveAspectRatio="none"><path d="M0,64 C240,120 480,8 720,48 C960,88 1200,16 1440,56 L1440,120 L0,120 Z" '
        'fill="currentColor"/></svg>'
    )
    _write(os.path.join(DIR_PATTERN, "wave-divider.svg"), wave)


def _write(path, content):
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print("  -> %-46s svg" % os.path.relpath(path, ROOT))


# ================================================================ 主流程


def main():
    ensure_dirs()
    build_brand()
    build_hero()
    build_subpage()
    build_covers()
    build_svg()
    print("\n配图生成完成。")


if __name__ == "__main__":
    main()
