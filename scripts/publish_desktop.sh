#!/usr/bin/env bash
# 发布桌面版：把安装包 + latest.json 推进 nginx 容器（不走 MinIO）。
# 用法：bash publish_desktop.sh <version>
set -euo pipefail

VER="${1:?usage: publish_desktop.sh 1.0.7}"
DIR="src-tauri/target/release/bundle/nsis"
EXE="HND生产助手_${VER}_x64-setup.exe"
KEY='C:\Users\Administrator\.ssh\id_ed25519_hnd_deploy'
HOST='eetig@124.220.60.154'
PORT=9002

for f in "$DIR/$EXE" "$DIR/$EXE.sig" "$DIR/latest.json"; do
  [ -f "$f" ] || { echo "missing $f"; exit 1; }
done

echo "== 1/4 上传到跳板目录"
scp -P "$PORT" -i "$KEY" "$DIR/$EXE" "$DIR/$EXE.sig" "$DIR/latest.json" "$HOST:/home/eetig/"

# 稳定别名（2026-11-13）：每次发布都顺手覆盖一份「最新版」，
# 这样落地页 / 二维码 / 邮件里只写这一个地址，永远指向当前安装包。
ALIAS='HND生产助手_最新版_x64-setup.exe'

echo "== 2/4 拷进容器的静态目录"
# 第二次 docker cp 用的是新名字，等于在容器里留了一份「永远指向最新版」的稳定别名
ssh -p "$PORT" -i "$KEY" "$HOST" "
  docker exec myOpenresty mkdir -p /www/sites/hnd-ui/index/desktop &&
  docker cp /home/eetig/latest.json myOpenresty:/www/sites/hnd-ui/index/desktop/latest.json &&
  docker cp '/home/eetig/$EXE' 'myOpenresty:/www/sites/hnd-ui/index/desktop/$EXE' &&
  docker cp '/home/eetig/$EXE' 'myOpenresty:/www/sites/hnd-ui/index/desktop/$ALIAS'
"

echo "== 3/4 自检"
curl -s -o /dev/null -w "latest.json %{http_code} %{content_type}\n" https://hbhnd.cloud/desktop/latest.json
curl -s -o /dev/null -w "setup.exe   %{http_code} %{size_download} bytes\n" "https://hbhnd.cloud/desktop/${EXE// /%20}"
curl -s -o /dev/null -w "最新版别名  %{http_code} %{size_download} bytes\n" "https://hbhnd.cloud/desktop/${ALIAS// /%20}"
curl -s https://hbhnd.cloud/desktop/latest.json | head -c 120; echo

echo "== 4/4 完成"
