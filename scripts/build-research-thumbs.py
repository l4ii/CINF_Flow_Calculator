# -*- coding: utf-8 -*-
"""
为「科研创新中心」介绍页的大图生成列表缩略图，并对高清原图做一次有损重采样，
以显著缩短首屏加载时间（对应 MainContent.tsx 中的 researchThumbFromFull 机制）。

处理对象：frontend/public/info{N}.jpg（N=1..*，按实际文件扫描）
产出：
  1) frontend/public/info{N}-thumb.jpg     （列表缩略，宽 1400px，质量 78）
  2) frontend/public/info{N}.jpg 本身      （重采样到 1920px 宽 + 质量 85，肉眼无损）
  3) frontend/public/_originals/info{N}.jpg（首次运行时的原图备份）

幂等：若 _originals/info{N}.jpg 已存在，则视为"原图已备份且已被压过"，不会再次覆盖。
     如果你替换了新的大图，请先把 frontend/public/_originals/info{N}.jpg 删除再运行。
"""

from __future__ import annotations

import os
import re
import shutil
import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    print("[ERROR] Pillow 未安装。请先执行：python -m pip install Pillow", file=sys.stderr)
    sys.exit(1)


# ---- 可调参数 ----
THUMB_MAX_WIDTH = 1400
THUMB_QUALITY = 78

FULL_MAX_WIDTH = 1920
FULL_QUALITY = 85

# 仅处理 "info" 前缀的大图，避免误伤 pic1/pic3 等其它资产
SOURCE_PATTERN = re.compile(r"^info\d+\.(jpg|jpeg)$", re.IGNORECASE)


def human_size(n_bytes: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n_bytes < 1024.0 or unit == "GB":
            return f"{n_bytes:.1f} {unit}"
        n_bytes /= 1024.0
    return f"{n_bytes:.1f} GB"


def resize_keep_aspect(img: Image.Image, max_width: int) -> Image.Image:
    if img.width <= max_width:
        return img
    ratio = max_width / float(img.width)
    new_size = (max_width, max(1, int(round(img.height * ratio))))
    return img.resize(new_size, Image.LANCZOS)


def save_jpeg(img: Image.Image, dst: Path, quality: int) -> None:
    # 统一转为 RGB，规避 CMYK/带 alpha 导致的保存异常
    if img.mode not in ("RGB",):
        img = img.convert("RGB")
    dst.parent.mkdir(parents=True, exist_ok=True)
    img.save(
        dst,
        format="JPEG",
        quality=quality,
        optimize=True,
        progressive=True,
    )


def process_one(src: Path, originals_dir: Path) -> None:
    rel = src.name
    stem = src.stem
    ext = src.suffix
    thumb_path = src.with_name(f"{stem}-thumb{ext}")
    backup_path = originals_dir / rel

    size_before = src.stat().st_size

    # 1) 备份原图（仅首次）
    first_run = not backup_path.exists()
    if first_run:
        originals_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, backup_path)

    # 2) 生成缩略图（始终根据当前较高清的图生成；首次运行时当前还是原图，效果最好）
    # EXIF 旋转信息：确保横竖向正确
    with Image.open(backup_path if first_run else src) as im0:
        im = ImageOps.exif_transpose(im0)
        thumb_img = resize_keep_aspect(im, THUMB_MAX_WIDTH)
        save_jpeg(thumb_img, thumb_path, THUMB_QUALITY)
    thumb_size = thumb_path.stat().st_size

    # 3) 压缩高清原图本身（仅首次：避免反复有损压缩）
    if first_run:
        with Image.open(backup_path) as im0:
            im = ImageOps.exif_transpose(im0)
            full_img = resize_keep_aspect(im, FULL_MAX_WIDTH)
            save_jpeg(full_img, src, FULL_QUALITY)
    size_after = src.stat().st_size

    status = "新建" if first_run else "已存在备份，仅刷新缩略图"
    print(
        f"  - {rel:15s}  "
        f"original: {human_size(size_before)} -> {human_size(size_after)}   "
        f"thumb: {human_size(thumb_size)}   [{status}]"
    )


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    public_dir = repo_root / "frontend" / "public"
    originals_dir = public_dir / "_originals"

    if not public_dir.is_dir():
        print(f"[ERROR] 未找到 {public_dir}", file=sys.stderr)
        return 2

    sources = sorted(
        p for p in public_dir.iterdir()
        if p.is_file() and SOURCE_PATTERN.match(p.name) and "-thumb" not in p.stem
    )
    if not sources:
        print("[WARN] 未在 frontend/public 下发现 infoN.jpg 源图")
        return 0

    print(f"[info] 目标目录: {public_dir}")
    print(f"[info] 原图备份: {originals_dir}")
    print(f"[info] 将处理 {len(sources)} 张：{[p.name for p in sources]}")
    print("-" * 72)

    for src in sources:
        try:
            process_one(src, originals_dir)
        except Exception as e:
            print(f"[ERROR] 处理 {src.name} 失败：{e}", file=sys.stderr)

    print("-" * 72)
    print("[done] 缩略图与压缩完成。代码里的 researchThumbFromFull 会自动命中 *-thumb.jpg。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
