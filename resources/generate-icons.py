"""从原始 logo 图生成各端图标。

用法：
    python resources/generate-icons.py

输入：resources/source-logo.png（原始图，1536x1536）
输出：
    resources/icons/          App 全套尺寸（Android + iOS）
    resources/icons/_preview.png   预览拼图，用于人工确认
    public/favicon.ico        H5 站点图标（多尺寸）
    public/apple-touch-icon.png

处理步骤：
  1. 擦水印：原始图右下角有「豆包AI生成」水印。经像素级验证，水印完全落在
     八边形之外的白色背景上（水印框 x≥1263，而同高度处八边形右边界仅到 x≈897），
     所以直接填白即可，不损失任何图形内容。
  2. 抠底：八边形是凸多边形，逐行扫描左右边界，把边界之外的白色换成背景色。
     比 floodfill 快一个量级（纯 Python 无 numpy 时差别很明显），且对凸形状是精确的。
  3. 合成：八边形缩到画布 72% 居中，放在深蓝径向渐变底上。
     留 28% 边距是因为 iOS/Android 启动器会把图标裁成圆角矩形或圆形，
     八边形铺满画布时四个尖角会被切掉。
  4. 导出：按各端要求的像素尺寸缩放。

注意：输出目录刻意不放 src/static/ —— 那些文件会被打进小程序/App 包体，
而 App 图标是打包期由原生工具读取的，不该占用包体（小程序主包已逼近 2MB 上限）。
"""

import math
import os

from PIL import Image

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, 'source-logo.png')
OUT = os.path.join(BASE, 'icons')

MASTER = 1024
BADGE_RATIO = 0.72  # 八边形占画布的比例（其余是安全边距）

# 背景：比八边形外沿（#072348~#164072）更深一档，
# 这样八边形的轮廓在图标里仍然读得出来，不会糊成一片。
BG_CENTER = (0x12, 0x30, 0x5A)
BG_EDGE = (0x04, 0x12, 0x26)

# 水印擦除矩形（验证过：该区域不含八边形本体）
WATERMARK_BOX = (945, 1420, 1536, 1536)

# 判定「白色背景」的阈值：三通道最小值高于此值算背景
WHITE_THR = 232


def is_background(pixel):
    return min(pixel[0], pixel[1], pixel[2]) >= WHITE_THR


def erase_watermark(im):
    """把水印区域填白。水印完全在背景上，填白即无损。"""
    px = im.load()
    x0, y0, x1, y1 = WATERMARK_BOX
    for y in range(y0, min(y1, im.size[1])):
        for x in range(x0, min(x1, im.size[0])):
            px[x, y] = (255, 255, 255)


def find_badge_span(im):
    """逐行扫出八边形的左右边界与整体外接框。

    凸形状才能这么扫 —— 每行八边形只占一段连续区间，边界之外必是背景。
    """
    w, h = im.size
    px = im.load()
    spans = []
    bbox = [w, h, 0, 0]

    for y in range(h):
        left = None
        for x in range(w):
            if not is_background(px[x, y]):
                left = x
                break

        if left is None:
            spans.append(None)  # 整行都是背景
            continue

        right = left
        for x in range(w - 1, left - 1, -1):
            if not is_background(px[x, y]):
                right = x
                break

        spans.append((left, right))
        bbox[0] = min(bbox[0], left)
        bbox[1] = min(bbox[1], y)
        bbox[2] = max(bbox[2], right)
        bbox[3] = max(bbox[3], y)

    return spans, tuple(bbox)


def build_gradient_master(size):
    """深蓝径向渐变底：中心略亮、四角压暗，比纯色更有体积感。"""
    # 先在低分辨率上算渐变再放大 —— 渐变足够平滑，视觉上与逐像素计算无异，
    # 但纯 Python 下快 60 倍以上
    small = 96
    tile = Image.new('RGB', (small, small))
    tpx = tile.load()
    half = (small - 1) / 2
    max_d = math.hypot(half, half)

    for y in range(small):
        for x in range(small):
            d = math.hypot(x - half, y - half) / max_d
            d = min(1.0, d)
            tpx[x, y] = tuple(
                round(BG_CENTER[i] + (BG_EDGE[i] - BG_CENTER[i]) * d) for i in range(3)
            )

    return tile.resize((size, size), Image.BICUBIC)


def make_master(src_im):
    im = src_im.copy()
    erase_watermark(im)

    spans, bbox = find_badge_span(im)
    bw = bbox[2] - bbox[0] + 1
    bh = bbox[3] - bbox[1] + 1
    print(f'  八边形外接框: {bbox}  尺寸 {bw} x {bh}')

    canvas = build_gradient_master(MASTER)
    target = round(MASTER * BADGE_RATIO)
    scale = min(target / bw, target / bh)
    out_size = (max(1, round(bw * scale)), max(1, round(bh * scale)))
    pos = ((MASTER - out_size[0]) // 2, (MASTER - out_size[1]) // 2)

    # 背景替换：八边形之外刷成背景色。
    #
    # 两个坑：
    # 1) 不能用固定纯色。贴入的矩形四角会与渐变底对不上，在图标上显现为一圈
    #    明显的方块接缝。改为先把目标位置上的渐变换算出来再回填，边界才不可见。
    # 2) 必须在 crop 之前填。crop 返回的是副本，裁完再改原图是改不到 badge 上的
    #    —— 那样四角会保留原始白底，贴上去变成一块白方块。
    patch = canvas.crop((pos[0], pos[1], pos[0] + out_size[0], pos[1] + out_size[1]))
    patch = patch.resize((bw, bh), Image.BICUBIC)
    ppx = patch.load()
    off_x, off_y = bbox[0], bbox[1]
    pw_, ph_ = patch.size

    def bg_at(x, y):
        """整图坐标 → 贴图坐标（整图坐标比贴图坐标大出外接框的偏移量）"""
        u, v = x - off_x, y - off_y
        if 0 <= u < pw_ and 0 <= v < ph_:
            return ppx[u, v]
        # 外接框之外（八边形上方/下方的整行留白），用渐变最暗端兜底
        return BG_EDGE

    px = im.load()
    w = im.size[0]
    for y, span in enumerate(spans):
        if span is None:
            for x in range(w):
                px[x, y] = bg_at(x, y)
            continue
        left, right = span
        # 边界外多刷 1 像素，覆盖抗锯齿过渡带
        for x in range(0, max(0, left - 1)):
            px[x, y] = bg_at(x, y)
        for x in range(min(w, right + 2), w):
            px[x, y] = bg_at(x, y)

    badge = im.crop((bbox[0], bbox[1], bbox[2] + 1, bbox[3] + 1))
    badge = badge.resize(out_size, Image.LANCZOS)
    canvas.paste(badge, pos)
    return canvas


def main():
    if not os.path.exists(SRC):
        raise SystemExit(f'找不到源图：{SRC}')

    src = Image.open(SRC).convert('RGB')
    print(f'源图 {src.size[0]}x{src.size[1]}')

    master = make_master(src)
    os.makedirs(OUT, exist_ok=True)
    master.save(os.path.join(OUT, '1024x1024.png'))

    # App 图标尺寸集合。
    # Android：hdpi~xxxhdpi；iOS：iPhone/iPad 各档去重后共 13 种。
    # iOS 的 App Store 图标（1024）不允许带透明通道 —— 本脚本全程 RGB，无 alpha，符合要求。
    sizes = {20, 29, 40, 48, 58, 60, 72, 76, 80, 87, 96, 120, 144, 152, 167, 180, 192, 512, 1024}
    for size in sorted(sizes):
        if size == MASTER:
            continue
        master.resize((size, size), Image.LANCZOS).save(
            os.path.join(OUT, f'{size}x{size}.png')
        )

    # 预览拼图：把几个关键尺寸并排渲染，方便一眼确认裁切与边距
    preview_sizes = [192, 120, 80, 48]
    gap = 24
    pw = sum(preview_sizes) + gap * (len(preview_sizes) + 1)
    ph = max(preview_sizes) + gap * 2
    preview = Image.new('RGB', (pw, ph), (0xF1, 0xF5, 0xF9))
    x = gap
    for size in preview_sizes:
        preview.paste(master.resize((size, size), Image.LANCZOS), (x, gap))
        x += size + gap
    preview.save(os.path.join(OUT, '_preview.png'))

    # H5 站点图标。直接写到 public/ —— 这两个文件是 index.html 引用的，
    # 跟 App 图标不同，它们要参与 H5 构建（vite 会把 public/ 原样拷进产物）。
    public = os.path.join(os.path.dirname(BASE), 'public')
    os.makedirs(public, exist_ok=True)
    master.resize((180, 180), Image.LANCZOS).save(os.path.join(public, 'apple-touch-icon.png'))
    master.save(os.path.join(public, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])
    print(f'  favicon.ico / apple-touch-icon.png → {public}')

    print(f'\n已输出到 {OUT}')
    print(f'  master 1024x1024.png + {len(sizes) - 1} 个尺寸 + _preview.png')
    for name in sorted(os.listdir(OUT)):
        if name.endswith('.png') and name != '_preview.png':
            path = os.path.join(OUT, name)
            print(f'    {name:16} {os.path.getsize(path) / 1024:7.1f} KB')


if __name__ == '__main__':
    main()
