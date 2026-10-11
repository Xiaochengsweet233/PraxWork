#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
橙曦澎湃 / Prax —— 新 logo 导入脚本

把「橙曦澎湃logo内容」目录里的透明底 logo 套件，按语义映射到 public/assets/brand/，
并重新生成 favicon 与 PWA 图标。

素材映射（源目录 C:\\Users\\Administrator\\Pictures\\橙曦澎湃logo内容）：

    透底彩图logo.png            (797x797 彩色方形图标)
        -> logo-mark.png       页头 / 加载动效 / 登录页 / 后台侧栏图标
        -> logo-icon.png       PWA 方形图标（透明底）
        -> logo-icon-512/192/180  实心米白底 PWA 图标
        -> public/favicon.ico  浏览器图标（多尺寸）

    透底彩图带字横板.png         (1920x797 彩色横版：图标在左 + 字标在右)
        -> logo-lockup.png     页脚完整标识

    透底白图带字横板.png         (1920x797 白色横版)
        -> logo-lockup-knockout.png   深色底反白版（备用）

    透底白图logo.png            (797x797 白色方形图标)
        -> logo-mark-knockout.png     深色底反白图标（备用）

说明：新素材已是透明底 PNG，无需再走 generate_assets.py 的抠图逻辑；
本脚本独立存在，换新素材后重新运行即可。旧文件会被覆盖，可用 git 回滚。
"""

import os
import shutil

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = r"C:\Users\Administrator\Pictures\橙曦澎湃logo内容"
DIR_BRAND = os.path.join(ROOT, "public", "assets", "brand")
CREAM = (246, 245, 239)

SRC = {
    "color_mark": "透底彩图logo.png",
    "color_lockup": "透底彩图带字横板.png",
    "white_mark": "透底白图logo.png",
    "white_lockup": "透底白图带字横板.png",
}


def ensure_dir():
    os.makedirs(DIR_BRAND, exist_ok=True)


def open_src(key):
    p = os.path.join(SRC_DIR, SRC[key])
    if not os.path.exists(p):
        raise FileNotFoundError("缺少素材：%s" % p)
    return Image.open(p)


def write_pwa(base_rgba, size, name):
    """PWA 图标用实心米白底，避免透明底在部分启动器上发黑。"""
    art = base_rgba.resize((size, size), Image.LANCZOS)
    bg = Image.new("RGBA", (size, size), CREAM + (255,))
    bg.alpha_composite(art)
    out = bg.convert("RGB")
    out.save(os.path.join(DIR_BRAND, name), optimize=True)
    print("  -> %s" % name)


def main():
    ensure_dir()

    print("[1/3] 方形彩色图标 -> 页头/加载/登录/后台图标")
    color_mark = open_src("color_mark").convert("RGBA")
    # 透明底原样保存为 mark 与 icon
    color_mark.save(os.path.join(DIR_BRAND, "logo-mark.png"))
    print("  -> logo-mark.png")
    color_mark.save(os.path.join(DIR_BRAND, "logo-icon.png"))
    print("  -> logo-icon.png")

    print("[2/3] 生成 PWA 图标与 favicon")
    for size, name in ((512, "logo-icon-512.png"), (192, "logo-icon-192.png"), (180, "logo-icon-180.png")):
        write_pwa(color_mark, size, name)
    ico_path = os.path.join(ROOT, "public", "favicon.ico")
    color_mark.resize((256, 256), Image.LANCZOS).save(
        ico_path, sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    )
    print("  -> favicon.ico")

    print("[3/3] 完整标识（页脚）与反白备用")
    shutil.copy(os.path.join(SRC_DIR, SRC["color_lockup"]), os.path.join(DIR_BRAND, "logo-lockup.png"))
    print("  -> logo-lockup.png")
    shutil.copy(os.path.join(SRC_DIR, SRC["white_lockup"]), os.path.join(DIR_BRAND, "logo-lockup-knockout.png"))
    print("  -> logo-lockup-knockout.png")
    shutil.copy(os.path.join(SRC_DIR, SRC["white_mark"]), os.path.join(DIR_BRAND, "logo-mark-knockout.png"))
    print("  -> logo-mark-knockout.png")

    print("\n新 logo 已导入完成。")


if __name__ == "__main__":
    main()
