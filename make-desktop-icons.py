"""一次性脚本：按手机端新图标同一套语言重画桌面端图标族（暖白圆角块 + 墨色圆头 H）。
Windows/macOS 图标在圆角块外全透明，任务栏浅底深底都清楚。跑完保留复用。"""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'src-tauri', 'icons')

BG = (251, 250, 247)      # 与手机端、界面底色同族的暖白
INK = (21, 24, 29)        # 墨色，不用纯黑

SS = 4
BASE = 1024
W = BASE * SS


def rrect(d, box, r, fill):
    """Pillow 7.2 没有 rounded_rectangle，用矩形 + 四角圆拼（8.2 之前都得这么写）。"""
    x0, y0, x1, y1 = box
    r = max(0, min(r, (x1 - x0) // 2, (y1 - y0) // 2))
    d.rectangle([x0 + r, y0, x1 - r, y1], fill=fill)
    d.rectangle([x0, y0 + r, x1, y1 - r], fill=fill)
    for cx, cy in ((x0 + r, y0 + r), (x1 - r, y0 + r), (x0 + r, y1 - r), (x1 - r, y1 - r)):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)


def build():
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 底板：留 6% 透明边，避免在资源管理器里贴边太满
    pad = int(W * 0.06)
    tile = [pad, pad, W - pad, W - pad]
    rrect(d, tile, int((W - 2 * pad) * 0.22), BG)

    # 墨色圆头 H：与手机端同一比例（H 约占底板的 46% 高……这里按底板 47% 画，视觉更稳）
    side = W - 2 * pad
    bar_w = int(side * 0.135)
    bar_h = int(side * 0.470)
    gap = int(side * 0.200)
    cx = cy = W // 2
    left_x = cx - gap // 2 - bar_w // 2
    right_x = cx + gap // 2 - bar_w // 2
    top = cy - bar_h // 2
    r = bar_w // 2

    rrect(d, [left_x, top, left_x + bar_w, top + bar_h], r, INK)
    rrect(d, [right_x, top, right_x + bar_w, top + bar_h], r, INK)

    cross_h = bar_w
    cross_w = (right_x + bar_w) - left_x
    cross_top = cy - cross_h // 2 - int(side * 0.014)
    rrect(d, [left_x, cross_top, left_x + cross_w, cross_top + cross_h], cross_h // 2, INK)

    return img.resize((BASE, BASE), Image.LANCZOS)


def main():
    big = build()
    os.makedirs(OUT, exist_ok=True)

    # Tauri bundle.icon 里点名的四件 + 常用尺寸
    pngs = {
        '32x32.png': 32,
        '64x64.png': 64,
        '128x128.png': 128,
        '128x128@2x.png': 256,
        'icon.png': 512,
        'icon-1024.png': 1024,
    }
    for name, size in pngs.items():
        big.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)

    # Windows 商店磁贴族（宽高不同，按短边等比缩放后居中）
    store = {
        'Square30x30Logo.png': 30,
        'Square44x44Logo.png': 44,
        'Square71x71Logo.png': 71,
        'Square89x89Logo.png': 89,
        'Square107x107Logo.png': 107,
        'Square142x142Logo.png': 142,
        'Square150x150Logo.png': 150,
        'Square284x284Logo.png': 284,
        'Square310x310Logo.png': 310,
        'StoreLogo.png': 50,
    }
    for name, size in store.items():
        big.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)

    # icon.ico：多尺寸打一包（16/24/32/48/64/128/256），Windows 任务栏/开始菜单/安装器都用它
    big.save(
        os.path.join(OUT, 'icon.ico'),
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    # mac 的 .icns（本机不发 mac，但保持文件与视觉一致；Pillow 7.2 写入 icns 支持有限，失败就跳过）
    try:
        big.resize((1024, 1024), Image.LANCZOS).save(os.path.join(OUT, 'icon.icns'), sizes=[(512, 512), (1024, 1024)])
    except Exception as exc:  # noqa: BLE001
        print('icns 跳过：', exc)

    big.resize((256, 256), Image.LANCZOS).save(os.path.join(OUT, '_preview.png'), optimize=True)
    print('desktop icons written')


if __name__ == '__main__':
    main()
