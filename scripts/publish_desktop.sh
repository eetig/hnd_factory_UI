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

[ -f "$DIR/$EXE" ] || { echo "missing $DIR/$EXE"; exit 1; }

# latest.json 必须按本次版本现生成，不能复用目录里上一次的：
# 2026-11-21 踩过 —— 脚本原样上传旧清单，1.0.44 的包配着 1.0.43 的清单上线，
# 客户端一直显示"已是最新"，exe 明明已经换了。
node scripts/make-latest.mjs "$VER" "${DESKTOP_NOTES:-}" || exit 1
grep -q "\"version\": \"$VER\"" "$DIR/latest.json" || { echo "latest.json 的 version 不是 $VER，停发"; exit 1; }

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
# 中文文件名必须 URL 编码后再比大小：不编码时 curl 在 git bash 里拿到的不是安装包，
# 曾经打出"200 842 bytes"这种看着成功、其实没下到东西的自检结果。
ENC=$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$EXE")
ENC_ALIAS=$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$ALIAS")
LOCAL_SIZE=$(stat -c %s "$DIR/$EXE")
S1=$(curl -s -o /dev/null -w "%{size_download}" "https://hbhnd.cloud/desktop/$ENC")
S2=$(curl -s -o /dev/null -w "%{size_download}" "https://hbhnd.cloud/desktop/$ENC_ALIAS")
echo "setup.exe   $S1 bytes（本地 $LOCAL_SIZE）"
echo "最新版别名  $S2 bytes"
if [ "$S1" != "$LOCAL_SIZE" ] || [ "$S2" != "$LOCAL_SIZE" ]; then
  echo "线上文件和本地安装包大小不一致，停发"
  exit 1
fi
curl -s https://hbhnd.cloud/desktop/latest.json | head -c 120; echo

echo "== 4/4 完成"
