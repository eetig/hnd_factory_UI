"""压缩储罐底图，让小程序主包回到 2MB 上限以内。

用法：
    python resources/compress-vessel-images.py

输入：resources/vessel-source/{vessel,vessel-product150}.png（原图，未压缩）
输出：src/static/{vessel,vessel-product150}.png（压缩后的实际打包版本）

## 为什么要压

小程序主包上限 2MB。压缩前实测：
    代码（js/wxml/wxss/json）  385 KB
    static/ 两张底图          1689 KB   ← 630 + 1059
    合计                      ≈ 2.0 MB   ← 卡在上限上，传不上去

## 三个杠杆

1. **去透明通道**。原图是 RGBA，实测约 90% 像素 alpha=0（完全透明）、9% 不透明、
   1.5% 是抗锯齿过渡带 —— 也就是黑线稿 + 透明底。
   底图只被 canvas 用（`/static/vessel*.png` → `ctx.drawImage`），而 canvas 所在的
   卡片是 `bg-white`，canvas 自身没设背景。所以把透明区域合成为白色后，
   渲染结果与原来逐像素一致，却省下一整个 alpha 通道。

2. **降采样 1/2**。底图在画布上按逻辑宽 1075px 绘制（VESSEL_CANVAS_WIDTH），
   而画布整体还要再缩放到屏幕尺寸：
       H5 桌面最宽 680 CSS px → 底图实际显示约 532 CSS px（2× 屏 1064 设备px）
       手机约 318 CSS px     → 底图实际显示约 248 CSS px（3× 屏 744 设备px）
   原图 2150 宽是需求的 2~4 倍，纯属浪费。
   取 1/2 是刻意的：2150 → 1075 正好等于 VESSEL_CANVAS_WIDTH，
   于是代码里的 `s = IMAGE_W / bounds.width` 变成精确的 1.0，映射不再有舍入。

3. **PNG-8 调色板**。线稿只有黑、白与抗锯齿灰阶，实测 256 色量化后
   PSNR 53+ dB（45 dB 以上人眼基本分辨不出）。

## ⚠️ 改了图就必须同步改代码里的 imageBounds

index.vue 的 VESSELS 配置里有一组 `imageBounds`，描述**罐体在原图像素坐标系中的位置**。
图一缩放，这套坐标就得等比缩放，否则液位线会与图纸对不上。

本脚本会按新的图像尺寸重算并打印出 imageBounds，直接替换过去即可。
如果换了缩放倍数，务必重新跑一遍脚本、重新替换这组数字。
"""

import io
import math
import os

from PIL import Image

BASE = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(BASE, 'vessel-source')
OUT_DIR = os.path.join(os.path.dirname(BASE), 'src', 'static')

FACTOR = 2  # 降采样倍数（1/2）

# 原图尺寸与罐体在原图坐标系里的边界（取自 index.vue 的 VESSELS.imageBounds）
VESSELS = [
    {
        'file': 'vessel.png',
        'orig_size': (2150, 1060),
        # 横卧罐：椭圆封头 + 直边 + 圆筒
        'bounds': {'width': 2150, 'height': 1060, 'left': 75, 'right': 2069, 'top': 131, 'bottom': 931},
    },
    {
        'file': 'vessel-product150.png',
        'orig_size': (1760, 1938),
        # 立式罐：顶部半椭球封头 + 等径筒体（多一个 tangent）
        'bounds': {'width': 1760, 'height': 1938, 'left': 131, 'right': 1351, 'top': 63, 'tangent': 310, 'bottom': 1930},
    },
]


def psnr(a, b, step=2):
    """峰值信噪比。线稿的验收线：> 45 dB 即视觉无损。"""
    pa, pb = a.load(), b.load()
    w, h = a.size
    total = 0
    count = 0
    for y in range(0, h, step):
        for x in range(0, w, step):
            for i in range(3):
                d = pa[x, y][i] - pb[x, y][i]
                total += d * d
                count += 1
    mse = total / count
    return 99.0 if mse == 0 else 10 * math.log10(255 * 255 / mse)


def compress(entry):
    src_path = os.path.join(SRC_DIR, entry['file'])
    out_path = os.path.join(OUT_DIR, entry['file'])

    src = Image.open(src_path).convert('RGBA')
    if src.size != entry['orig_size']:
        raise SystemExit(
            f'{entry["file"]}: 原图尺寸 {src.size} 与脚本记录的 {entry["orig_size"]} 不符。\n'
            '  换过原图的话，请同步更新本脚本里的 orig_size 与 bounds。'
        )

    # 1) 合成到白底（canvas 所在卡片是 bg-white，视觉上与透明底一致）
    flat = Image.new('RGB', src.size, (255, 255, 255))
    flat.paste(src, mask=src.split()[3])

    # 2) 降采样
    new_size = (src.size[0] // FACTOR, src.size[1] // FACTOR)
    small = flat.resize(new_size, Image.LANCZOS)

    # 3) PNG-8 调色板
    quant = small.convert('P', palette=Image.ADAPTIVE, colors=256)
    quant.save(out_path, optimize=True)

    # 校验
    quality = psnr(small, quant.convert('RGB'))
    orig_kb = os.path.getsize(src_path) / 1024
    new_kb = os.path.getsize(out_path) / 1024

    print(f'{entry["file"]}')
    print(f'    {src.size[0]}x{src.size[1]}  {orig_kb:7.1f} KB')
    print(f' →  {new_size[0]}x{new_size[1]}  {new_kb:7.1f} KB   '
          f'（{orig_kb / new_kb:.1f}x）  画质 PSNR {quality:.1f} dB')

    new_bounds = {k: round(v / FACTOR, 4) for k, v in entry['bounds'].items()}
    return new_bounds, new_kb, quality


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    total = 0
    results = []

    for entry in VESSELS:
        bounds, kb, quality = compress(entry)
        total += kb
        results.append((entry['file'], bounds, quality))
        print()

    print(f'两张合计 {total:.1f} KB（原 1689 KB）')

    print('\n===== 把下面这组 imageBounds 替换进 index.vue 的 VESSELS =====')
    for name, bounds, _ in results:
        pairs = ', '.join(f'{k}: {v}' for k, v in bounds.items())
        print(f'  {name}')
        print(f'    imageBounds: {{ {pairs} }},')
    print('\n（数值 = 原值 ÷ %d，因为图等比缩了 %d 倍；不改这组坐标液位线会与图纸错位）'
          % (FACTOR, FACTOR))


if __name__ == '__main__':
    main()
