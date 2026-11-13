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

echo "== 0/4 目标"
echo "   源: $APK"
echo "   版本: $VER   大小: $SIZE bytes"

echo "== 1/4 上传到跳板目录"
scp -P "$PORT" -i "$KEY" "$APK" "$HOST:/home/eetig/$NAME"

echo "== 2/4 拷进容器 /desktop/app/"
ssh -p "$PORT" -i "$KEY" "$HOST" "
  docker exec myOpenresty mkdir -p /www/sites/hnd-ui/index/desktop/app &&
  docker cp '/home/eetig/$NAME' 'myOpenresty:/www/sites/hnd-ui/index/desktop/app/$NAME' &&
  docker cp '/home/eetig/$NAME' 'myOpenresty:/www/sites/hnd-ui/index/desktop/app/$ALIAS'
"

echo "== 3/4 自检"
curl -s -o /dev/null -w "版本包      %{http_code} %{size_download} bytes %{content_type}\n" "https://hbhnd.cloud/desktop/app/${NAME// /%20}"
curl -s -o /dev/null -w "最新版别名  %{http_code} %{size_download} bytes\n" "https://hbhnd.cloud/desktop/app/${ALIAS// /%20}"

echo "== 4/4 完成"
