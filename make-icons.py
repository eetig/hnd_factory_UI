"""按 ego (lite) 风格重画 App 图标：暖白底 + 极简墨色圆头「H」。

用法：python make-icons.py
依赖：Pillow（本机 7.2.0，没有 ImageDraw.rounded_rectangle，所以自己用
      rectangle + ellipse 拼圆角，别改成 rounded_rectangle）。
"""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'resources', 'icons')
SIZES = [1024, 512, 192, 180, 167, 152, 144, 120, 96, 87, 80, 76, 72, 60, 58, 48, 40, 29, 20]

BG = (251, 250, 247)      # 暖白纸色，和 App 界面底色同族
INK = (21, 24, 29)        # 近黑墨色，不用纯黑，屏幕上看更柔和

SS = 4                    # 超采样倍数
BASE = 1024
W = BASE * SS


def rrect(d, box, r, fill):
    """圆角矩形（Pillow 7 没有 rounded_rectangle，自己拼）。"""
    x0, y0, x1, y1 = box
    d.rectangle([x0 + r, y0, x1 - r, y1], fill=fill)
    d.rectangle([x0, y0 + r, x1, y1 - r], fill=fill)
    for cx, cy in ((x0 + r, y0 + r), (x1 - r, y0 + r), (x0 + r, y1 - r), (x1 - r, y1 - r)):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)


def draw_mark(img):
    d = ImageDraw.Draw(img)
    bar_w = 132 * SS
    bar_h = 470 * SS
    gap = 196 * SS
    cx, cy = W // 2, W // 2
    left_x = cx - gap // 2 - bar_w // 2
    right_x = cx + gap // 2 - bar_w // 2
    top = cy - bar_h // 2
    r = bar_w // 2

    rrect(d, [left_x, top, left_x + bar_w, top + bar_h], r, INK)
    rrect(d, [right_x, top, right_x + bar_w, top + bar_h], r, INK)

    cross_h = bar_w
    cross_w = (right_x + bar_w) - left_x
    cross_top = cy - cross_h // 2 - 14 * SS
    rrect(d, [left_x, cross_top, left_x + cross_w, cross_top + cross_h], cross_h // 2, INK)


def main():
    canvas = Image.new('RGB', (W, W), BG)
    draw_mark(canvas)
    big = canvas.resize((BASE, BASE), Image.LANCZOS)
    os.makedirs(OUT, exist_ok=True)
    for s in SIZES:
        big.resize((s, s), Image.LANCZOS).save(os.path.join(OUT, f'{s}x{s}.png'), optimize=True)

    preview = Image.new('RGB', (BASE // 2 + 40, BASE // 4 + 40), (238, 238, 238))
    preview.paste(big.resize((BASE // 4, BASE // 4), Image.LANCZOS), (10, 10))
    preview.paste(big.resize((BASE // 8, BASE // 8), Image.LANCZOS), (BASE // 4 + 20, 10))
    preview.paste(big.resize((72, 72), Image.LANCZOS), (BASE // 4 + 20 + BASE // 8 + 20, 10))
    preview.save(os.path.join(OUT, '_preview.png'), optimize=True)
    print('icons written:', len(SIZES))


if __name__ == '__main__':
    main()
