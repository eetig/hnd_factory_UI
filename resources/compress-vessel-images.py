"""压缩储罐底图，让小程序主包回到 2MB 上限以内；同时产出深色主题用的「亮线版」。

用法：
    python resources/compress-vessel-images.py

输入：resources/vessel-source/{vessel,vessel-product150}.png（原图，未压缩）
输出：src/static/{vessel,vessel-product150}.png          白纸版：透明区域合成为白，
                                                         深色线稿 —— 浅色主题用
      src/static/{vessel,vessel-product150}-dark.png     亮线版：透明底 + 亮色线稿
                                                         —— 深色主题用

## 为什么要压

小程序主包上限 2MB。压缩前实测：
    代码（js/wxml/wxss/json）  385 KB
    static/ 两张底图          1689 KB   ← 630 + 1059
    合计                      ≈ 2.0 MB   ← 卡在上限上，传不上去

## 三个杠杆

1. **去透明通道**。原图是 RGBA，实测约 90% 像素 alpha=0（完全透明）、8% 不透明、
   1.5% 是抗锯齿过渡带 —— 也就是黑线稿 + 透明底。
   白纸版把透明区域合成为白色：底图显示在卡片上，而卡片本身就是白的，
   渲染结果与原来逐像素一致，却省下一整个 alpha 通道。

2. **降采样 1/2**。底图按逻辑宽 1075px 显示（index.vue 的 VESSEL_IMAGE_WIDTH），
   而整幅图还要再缩放到屏幕尺寸：
       H5 桌面最宽 680 CSS px → 底图实际显示约 532 CSS px（2× 屏 1064 设备px）
       手机约 318 CSS px     → 底图实际显示约 248 CSS px（3× 屏 744 设备px）
   原图 2150 宽是需求的 2~4 倍，纯属浪费。
   取 1/2 是刻意的：2150 → 1075 正好等于 VESSEL_IMAGE_WIDTH，
   于是代码里的 s = VESSEL_IMAGE_WIDTH / bounds.width 变成精确的 1.0，
   映射不再有舍入。

3. **PNG-8 调色板**。线稿只有黑、白与抗锯齿灰阶，实测 256 色量化后
   PSNR 53+ dB（45 dB 以上人眼基本分辨不出）。

## 深色主题为什么另存一张图

深色主题的卡片底是 #17171c。白纸版那块白纸会成为整个界面上最亮的一块，
和主题底对不上（改造前的 canvas 版也一样，见 UNIAPP迁移说明.md 5.3）。
把白纸"反色"这件事，DOM 层没有既省事又三端可靠的做法：
    · canvas 已经拆掉（三端没有标准 Canvas2D，且每帧重绘，见 5.3）；
    · CSS filter: invert(1) 只能把白纸反成黑底，跟主题底仍然对不齐
      （底图只占整幅图左侧 78%，右侧标注栏会露出原始底色，接缝藏不住）；
    · filter + mix-blend-mode: screen 能让黑底透掉、只留亮线，
      但 blend 模式在小程序端的支持面不明确 —— 本项目对这类写法一律先求证。
所以干脆在资源侧再出一张：**透明底 + 亮色线稿**（线色 = DARK_INK）。
浅色读白纸版、深色读亮线版，切主题只换 <image> 的 src，三端行为完全一致；
透明底又让卡片底色直接透出来 —— 图片背景与主题背景天然一致，不用对齐任何色值。

亮线版的画法：墨量 c = α × (1 − 灰度/255)，也就是"白纸版比纯白暗了多少"；
把 c 当作 alpha、线色当作 RGB 写出去，就与白纸版严格互补 ——
同一组抗锯齿、同一组线宽，两张图叠在同一位置上连笔画粗细都对得上。
存法用 PNG-8 调色板 + tRNS（调色板 256 项全是线色，索引本身就是不透明度），
比 RGBA 小约 1/3，解码后与逐像素 RGBA 完全一致。

## ⚠️ 改了图就必须同步改代码里的 imageBounds

index.vue 的 VESSELS 配置里有一组 `imageBounds`，描述**罐体在原图像素坐标系中的位置**。
图一缩放，这套坐标就得等比缩放，否则液位线会与图纸对不上。
两张图（白纸版 / 亮线版）尺寸必须一致，否则切主题时液位线会跳 —— 见 compress() 里的校验。

本脚本会按新的图像尺寸重算并打印出 imageBounds，直接替换过去即可。
如果换了缩放倍数，务必重新跑一遍脚本、重新替换这组数字。
"""

import io
import math
import os

from PIL import Image, ImageChops, ImageOps

BASE = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(BASE, 'vessel-source')
OUT_DIR = os.path.join(os.path.dirname(BASE), 'src', 'static')

FACTOR = 2  # 降采样倍数（1/2）

# 亮线版的线色。它不是主题令牌，而是图纸自身的"墨色"：白纸版是原图的深色墨，
# 亮线版就是这个浅灰蓝（#cbd5e1，在深色卡片 #17171c 上约 12:1 对比度）。
# 改色号必须重跑本脚本重新出图。
DARK_INK = (0xcb, 0xd5, 0xe1)

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
    # 深色主题用的亮线版：与白纸版同尺寸、透明底
    dark_path = os.path.join(OUT_DIR, entry['file'].replace('.png', '-dark.png'))

    src = Image.open(src_path).convert('RGBA')
    if src.size != entry['orig_size']:
        raise SystemExit(
            f'{entry["file"]}: 原图尺寸 {src.size} 与脚本记录的 {entry["orig_size"]} 不符。\n'
            '  换过原图的话，请同步更新本脚本里的 orig_size 与 bounds。'
        )

    # 1) 合成到白底（底图所在的卡片本就是白的，视觉上与透明底一致）
    alpha = src.split()[3]
    flat = Image.new('RGB', src.size, (255, 255, 255))
    flat.paste(src, mask=alpha)

    # 2) 降采样
    new_size = (src.size[0] // FACTOR, src.size[1] // FACTOR)
    small = flat.resize(new_size, Image.LANCZOS)

    # 3) 白纸版：PNG-8 调色板（顺带去掉 alpha 通道）
    quant = small.convert('P', palette=Image.ADAPTIVE, colors=256)
    quant.save(out_path, optimize=True)

    # 4) 亮线版：墨量 = 白纸版"比纯白暗了多少"，得到的是覆盖率 c = α × (1 − 灰度/255)。
    #    先在全分辨率上算墨量再降采样，与白纸版共用同一组抗锯齿。
    ink = ImageOps.invert(ImageOps.grayscale(flat)).resize(new_size, Image.LANCZOS)

    #    存成 PNG-8 + tRNS：调色板 256 项全是线色，透明度直接取索引（索引即覆盖率）。
    dark = Image.frombytes('P', new_size, ink.tobytes())
    dark.putpalette(list(DARK_INK) * 256)
    dark.info['transparency'] = bytes(range(256))
    dark.save(dark_path, optimize=True)

    # 校验：① 两张图必须同尺寸（否则切主题时液位线会错位）；
    #       ② 墨量互补 —— 白纸版的"暗"应与亮线版的"亮"逐像素对得上
    #          （灰度换算与降采样的先后顺序不同，允许 2 个色阶的舍入差）。
    dark_size = Image.open(dark_path).size
    if dark_size != new_size:
        raise SystemExit(f'{entry["file"]}: 亮线版尺寸 {dark_size} 与白纸版 {new_size} 不一致')

    spread = ImageChops.difference(ImageOps.invert(ImageOps.grayscale(small)), ink).getextrema()[1]
    if spread > 2:
        raise SystemExit(f'{entry["file"]}: 亮线版与白纸版的墨量对不上（最大差 {spread} 个色阶）')

    quality = psnr(small, quant.convert('RGB'))
    orig_kb = os.path.getsize(src_path) / 1024
    new_kb = os.path.getsize(out_path) / 1024
    dark_kb = os.path.getsize(dark_path) / 1024

    print(f'{entry["file"]}')
    print(f'    {src.size[0]}x{src.size[1]}  {orig_kb:7.1f} KB')
    print(f' →  白纸版 {new_size[0]}x{new_size[1]}  {new_kb:7.1f} KB   '
          f'（{orig_kb / new_kb:.1f}x）  画质 PSNR {quality:.1f} dB')
    print(f'    亮线版 {new_size[0]}x{new_size[1]}  {dark_kb:7.1f} KB   '
          f'（透明底 + #{DARK_INK[0]:02x}{DARK_INK[1]:02x}{DARK_INK[2]:02x}，'
          f'墨量互补差 {spread} 阶 / 尺寸校验通过）')

    new_bounds = {k: round(v / FACTOR, 4) for k, v in entry['bounds'].items()}
    return new_bounds, new_kb, dark_kb, quality


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    total = 0
    results = []

    for entry in VESSELS:
        bounds, kb, dark_kb, quality = compress(entry)
        total += kb + dark_kb
        results.append((entry['file'], bounds, quality))
        print()

    print(f'四张合计 {total:.1f} KB（原 1689 KB；深浅两版按主题二选一，不会同时下载）')

    print('\n===== 把下面这组 imageBounds 替换进 index.vue 的 VESSELS =====')
    for name, bounds, _ in results:
        pairs = ', '.join(f'{k}: {v}' for k, v in bounds.items())
        print(f'  {name}')
        print(f'    imageBounds: {{ {pairs} }},')
    print('\n（数值 = 原值 ÷ %d，因为图等比缩了 %d 倍；不改这组坐标液位线会与图纸错位）'
          % (FACTOR, FACTOR))


if __name__ == '__main__':
    main()