"""产出容器底图的**浅色/深色两版**，并打印库里的 `image_bounds`。

用法：
    python resources/compress-vessel-images.py

输入：resources/vessel-source/*.png（原图）
输出：src/static/*.png        白纸版：透明区域合成为白、深色线稿 —— 浅色主题用
      src/static/*-dark.png   亮线版：透明底 + 亮色线稿        —— 深色主题用

## 这个脚本在做什么（与它最初的样子不同了）

一开始它叫「压缩底图」：那会儿底图打进小程序主包，2MB 上限卡得死，靠**降采样 1/2 +
PNG-8 调色板**压下来。**2026-10-06 的 变更-024 把底图移出了小程序包**（改从服务器按 URL 加载），
压包体这个动机就没了 —— 于是 `FACTOR` 改回 1：**不再降采样，两套前端共用同一份原图**。

为什么不干脆别降采样、也别归一化坐标：底图分辨率一旦不一致（电脑端原图 / uni-app 压图），
`image_bounds` 就得做成与分辨率无关的表示（曾用过「按图片宽度归一化」），
多一层换算就多一个会错的地方。统一成一份图，坐标直接是原图像素坐标，两端通用。

代价要知道：**手机端首次进这个页面要下载的是原图**（四台合计约 1.8 MB，此前是 446 KB）。
若哪天嫌大，正解是在**服务器侧**放一份降采样版（那就又回到两份分辨率了），
而不是再改这里的 `FACTOR` —— 那会让两端的坐标对不上。

## 仍然保留的两个杠杆

1. **去透明通道**。原图是 RGBA（黑线稿 + 透明底）。白纸版把透明区域合成为白色：
   底图显示在卡片上，而卡片本身就是白的，渲染结果与原来逐像素一致，
   却省下一整个 alpha 通道。
2. **PNG-8 调色板**。线稿只有黑、白与抗锯齿灰阶，量化后 PSNR 50+ dB
   （45 dB 以上人眼基本分辨不出）。

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

## ⚠️ 改了图就必须同步改库里的 image_bounds

`equipment_ledger.image_bounds` 描述**罐体在底图里的位置**，前端按它画罐体路径与液面。
图一换，这套坐标就得跟着改，否则液位线会与图纸错位。
两张图（白纸版 / 亮线版）尺寸必须一致，否则切主题时液位线会跳 —— 见 compress() 里的校验。

**坐标就是原图像素坐标**（本表的 `bounds` 本来就是按原图量的，直接贴进库即可）。
本脚本会把它们打印成一行 JSON。
"""

import io
import json
import math
import os

from PIL import Image, ImageChops, ImageOps

BASE = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(BASE, 'vessel-source')
OUT_DIR = os.path.join(os.path.dirname(BASE), 'src', 'static')

FACTOR = 1  # 不降采样（2026-10-06 起）

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
    {
        'file': 'vessel-reboiler.png',
        'orig_size': (1616, 820),
        # 卧式再沸器：椭圆封头 + 圆筒（直边为 0）。与另两张不同，这张底图里
        # 罐体内部还画着 U 型管束、罐外右侧接着管箱 —— 液面填充裁在 bounds 路径内，
        # 管束与管箱不会被填色，这是刻意的（管箱不在容器内部，见 vesselVolume.js）。
        # ⚠️ 原始图纸（1920x1184）右下角有「豆包AI生成」水印，入库前已裁掉：
        #    裁剪框 (200,174,1816,994)，故本表坐标是**裁剪后**坐标系。
        'bounds': {'width': 1616, 'height': 820, 'left': 53, 'right': 1377, 'top': 92, 'bottom': 659},
    },
    {
        'file': 'vessel-methanol.png',
        'orig_size': (708, 1520),
        # 立式甲醇计量罐：**上下都有封头**（150 产品储罐只有上封头，是平底），
        # 所以比另两台多一个 tangentBottom（下封头与筒体的切线）。
        # 底图由厂家图纸加工而来：原始图纸（1312x1664，白底不透明）右下角有
        # 「豆包AI生成」水印（x 1079~1283 / y 1593~1639），与罐体（x 348~1038 / y 42~1543）
        # 不重叠，裁剪时自然排除；裁剪框 (338,32,1046,1552) → 708x1520（取偶数便于 1/2 降采样）。
        # ⚠️ 穹顶被顶部管口（N1/N4/M1）遮住，顶点没法直接量 —— 用对称位置的干净列
        #    （x=655 与 720 都在 y=116）反解椭圆得到：上切线 250 / 顶点 115，
        #    下切线 1146 / 顶点 1279。复核方式：画出的长径比 2.095 与实际的 2.082 差 0.65%。
        'bounds': {
            'width': 708, 'height': 1520, 'left': 72, 'right': 627.5,
            'top': 83, 'tangent': 218, 'tangentBottom': 1114, 'bottom': 1247,
        },
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

    # 坐标就是**原图像素坐标**（本表的 bounds 本来就是按原图量的）。
    # 两套前端用同一份原图（2026-10-06 起），所以坐标不必再缩放、也不必归一化 ——
    # 直接把这组值贴进 equipment_ledger.image_bounds 即可，两端通用。
    return {k: v for k, v in entry['bounds'].items()}, new_kb, dark_kb, quality


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

    print('\n===== 把下面这组 image_bounds 贴进 equipment_ledger 对应行 =====')
    print('（原图像素坐标 —— 两套前端用同一份原图，直接贴，两端通用）\n')
    for name, bounds, _ in results:
        print(f'  {name}')
        print('    ' + json.dumps(bounds, ensure_ascii=False))
        print()
    print('注意：改了图就要重跑本脚本并更新库里那组坐标，否则液位线与图纸会错位。')


if __name__ == '__main__':
    main()