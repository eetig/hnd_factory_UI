#!/usr/bin/env bash
# 发布手机端 APK：把打包好的 apk 推进 nginx 容器（与桌面版同一个 /desktop/app/ 目录）。
#
# 为什么放在 desktop/ 下面：scripts/deploy-web.ps1 整目录切换时已经会把 desktop/ 保住
# （变更-211 的教训），放在这里就不会被网页发版抹掉。
#
# 用法：
#   bash scripts/publish_app.sh                     # 自动挑 dist/release/apk 里最新的 apk
#   bash scripts/publish_app.sh <apk 路径> 1.0.5    # 指定文件 + 版本号
set -euo pipefail

UNI_REPO="${UNI_REPO:-D:/project/hnd_factory_UI_uni_APP}"
APK_DIR="$UNI_REPO/dist/release/apk"
KEY='C:\Users\Administrator\.ssh\id_ed25519_hnd_deploy'
HOST='eetig@124.220.60.154'
PORT=9002

APK="${1:-}"
if [ -z "$APK" ]; then
  # 按文件名里的时间戳挑最新的（2026-11-13 教训：MSYS 的 `ls -t` 在这些文件上
  # 给出的顺序是旧的在前，会误发一个月前的包；文件名 __UNI__xxx__yyyyMMddHHmmss.apk 更可靠）
  APK=$(python -c "
import glob
fs = glob.glob(r'$APK_DIR/*.apk')
print(max(fs, key=lambda p: p.split('__')[-1]) if fs else '')
")
fi
[ -f "$APK" ] || { echo "找不到 apk: $APK"; exit 1; }

VER="${2:-}"
if [ -z "$VER" ]; then
  VER=$(python -c "
import json,re,io
s=io.open(r'$UNI_REPO/src/manifest.json',encoding='utf-8-sig').read()
s=re.sub(r'^\s*//.*\$','',s,flags=re.M)
print(json.loads(s).get('versionName',''))
")
fi
[ -n "$VER" ] || { echo "拿不到版本号，请手动传第二个参数"; exit 1; }

NAME="HND生产助手_App_${VER}.apk"
ALIAS='HND生产助手_App_最新版.apk'
SIZE=$(stat -c%s "$APK")

# 手机版版本信息：落地页靠它显示「手机端 v1.0.x」并把按钮指向稳定别名。
# 以前只能靠文件名猜版本，页面没法显示号码（变更-217）。
META=$(mktemp)
python - "$META" "$APK" "$VER" "$SIZE" <<'PY'
import io, json, os, sys, time
out, apk, ver, size = sys.argv[1:5]
man = r'D:/project/hnd_factory_UI_uni_APP/src/manifest.json'
try:
    import re
    raw = io.open(man, encoding='utf-8-sig').read()
    raw = re.sub(r'^\s*//.*$', '', raw, flags=re.M)
    code = json.loads(raw).get('versionCode', '')
except Exception:
    code = ''
mb = round(int(size) / 1048576, 1)
data = {
    'version': ver,
    'versionCode': code,
    'size': int(size),
    'sizeText': f'{mb:g} MB',
    'fileName': os.path.basename(apk),
    'url': 'https://hbhnd.cloud/desktop/app/HND%E7%94%9F%E4%BA%A7%E5%8A%A9%E6%89%8B_App_%E6%9C%80%E6%96%B0%E7%89%88.apk',
    'publishedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
}
json.dump(data, io.open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('   meta:', data['version'], data['sizeText'])
PY

echo "== 0/4 目标"
echo "   源: $APK"
echo "   版本: $VER   大小: $SIZE bytes"

echo "== 1/4 上传到跳板目录"
scp -P "$PORT" -i "$KEY" "$APK" "$HOST:/home/eetig/$NAME"
scp -P "$PORT" -i "$KEY" "$(cygpath -w "$META")" "$HOST:/home/eetig/app-latest.json"

echo "== 2/4 拷进容器 /desktop/app/"
ssh -p "$PORT" -i "$KEY" "$HOST" "
  docker exec myOpenresty mkdir -p /www/sites/hnd-ui/index/desktop/app &&
  docker cp '/home/eetig/$NAME' 'myOpenresty:/www/sites/hnd-ui/index/desktop/app/$NAME' &&
  docker cp '/home/eetig/$NAME' 'myOpenresty:/www/sites/hnd-ui/index/desktop/app/$ALIAS' &&
  docker cp '/home/eetig/app-latest.json' 'myOpenresty:/www/sites/hnd-ui/index/desktop/app/latest.json'
"

echo "== 3/4 自检"
curl -s -o /dev/null -w "版本包      %{http_code} %{size_download} bytes %{content_type}\n" "https://hbhnd.cloud/desktop/app/${NAME// /%20}"
curl -s -o /dev/null -w "最新版别名  %{http_code} %{size_download} bytes\n" "https://hbhnd.cloud/desktop/app/${ALIAS// /%20}"
curl -s -o /dev/null -w "版本信息    %{http_code} %{content_type}\n" "https://hbhnd.cloud/desktop/app/latest.json"

echo "== 4/4 完成"
