# 前端发布（2026-10-23，变更-163）
#
# 用法（在 hnd_factory_UI 仓根目录）：
#   .\scripts\deploy-web.ps1              # 门禁 + 构建 + 发布 + 验收
#   .\scripts\deploy-web.ps1 -SkipVerify  # 跳过 lint/test（急发时用，不推荐）
#
# 做三件事，缺一不可（顺序错了会导致"切换成功但线上还是旧 JS"，见 docs/部署手册.md）：
#   ① 备份现站 + 建空暂存目录
#   ② 上传 dist 到暂存目录
#   ③ 整目录原子切换（不是逐文件覆盖）
#
# 依赖：仓根目录的 _deploy-common.ps1（从后端仓同步过来的那份）

param(
    [switch]$SkipVerify,
    [switch]$KeepGoing
)

# ⚠️ 不用 $ErrorActionPreference = 'Stop'：Windows PowerShell 5.1 会把原生命令写到 stderr 的
#    警告（比如 vitest 的 [Vue warn]）当成致命错误抛 NativeCommandError。
#    这里改成每一步显式检查 $LASTEXITCODE（下方每个外部命令后都有）。
$ErrorActionPreference = 'Continue'

# 共用参数文件：优先本仓 scripts/，其次同级后端仓（通常只有后端仓那份，避免两份漂移）
$common = Join-Path $PSScriptRoot '_deploy-common.ps1'
if (-not (Test-Path $common)) {
    $common = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'hnd_factory\scripts\_deploy-common.ps1'
}
if (-not (Test-Path $common)) { throw "找不到 _deploy-common.ps1（找过本仓 scripts/ 与 ../hnd_factory/scripts/）" }
. $common

$repo = Split-Path $PSScriptRoot -Parent
Push-Location $repo
try {
    Write-Step '0) 前置检查'
    '  仓库: ' + $repo
    '  分支: ' + (& git rev-parse --abbrev-ref HEAD)
    $dirty = (& git status --porcelain | Measure-Object).Count
    '  未提交改动: ' + $dirty + ' 项'
    if ($dirty -gt 0 -and -not $KeepGoing) {
        '  ⚠️ 工作区不干净。发布的是**磁盘上的代码**，不是 git 里的。'
        '     确认要发就加 -KeepGoing 重跑。'
        throw '工作区有未提交改动'
    }

    Write-Step '1) 门禁（lint + vitest）'
    if ($SkipVerify) {
        '  已跳过（-SkipVerify）'
    }
    else {
        & npm run lint
        if ($LASTEXITCODE -ne 0) { throw 'lint 未通过，不发布' }
        & npx vitest run --reporter dot
        if ($LASTEXITCODE -ne 0) { throw 'vitest 未通过，不发布' }
    }

    Write-Step '2) 构建'
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'build 失败' }
    $dist = Join-Path $repo 'dist'
    if (-not (Test-Path (Join-Path $dist 'index.html'))) { throw "构建产物缺 index.html：$dist" }
    $localJs = (Get-ChildItem (Join-Path $dist 'assets') -Filter 'index-*.js' | Select-Object -First 1)
    '  dist js: ' + $localJs.Name + '  md5=' + (Get-FileMd5 $localJs.FullName)

    Write-Step '3) 备份现站 + 建空暂存目录'
    # ⚠️ 这一步会 rm -rf 暂存目录：必须在**上传之前**做，否则刚传的文件被删、线上还是旧版
    $sudo = Get-HndSudo
    Invoke-HndScript -Name 'hnd-web-prep' -Body @"
#!/bin/bash
S=$SiteRoot
TS=`$(date +%Y%m%d-%H%M%S)
echo '  backup current site:'
echo '$sudo' | sudo -S -p '' cp -a `$S/index `$S/index.bak-`$TS && echo "    -> index.bak-`$TS"
rm -rf $StagingDir && mkdir -p $StagingDir/assets && echo "  staging dir rebuilt: $StagingDir"
"@

    Write-Step '4) 上传 dist'
    # 逐个传（assets 里文件多，用 scp -r 一次传目录）
    Send-HndFile -LocalPath (Join-Path $dist 'index.html') -RemotePath "$StagingDir/index.html"
    if (Test-Path (Join-Path $dist 'favicon.png')) {
        Send-HndFile -LocalPath (Join-Path $dist 'favicon.png') -RemotePath "$StagingDir/favicon.png"
    }
    & scp -q -r -i $HndKey -P $HndPort (Join-Path $dist 'assets') "$($HndHost):$StagingDir/"
    if ($LASTEXITCODE -ne 0) { throw '上传 assets 失败' }
    '  已上传 index.html + assets/'

    Write-Step '5) 整目录原子切换 + 验收'
    $out = Invoke-HndScript -Name 'hnd-web-swap' -Body @"
#!/bin/bash
S=$SiteRoot
P() { echo '$sudo' | sudo -S -p '' "`$@"; }
TS=`$(date +%Y%m%d-%H%M%S)
P rm -rf `$S/index.new
P cp -a $StagingDir `$S/index.new && echo '  index.new ready'
P chown -R root:root `$S/index.new
P mv `$S/index `$S/index.prev.`$TS && echo "  旧的留作 index.prev.`$TS"
P mv `$S/index.new `$S/index && echo '  atomic swap done'

echo '--- served assets ---'
curl -s http://127.0.0.1:$SitePort/ -o /tmp/i.html -w '  index http=%{http_code}\n'
grep -o 'assets/index-[A-Za-z0-9_-]*\.\(js\|css\)' /tmp/i.html | sort -u | sed 's/^/  /'
for f in `$(grep -o 'assets/index-[A-Za-z0-9_-]*\.\(js\|css\)' /tmp/i.html | sort -u); do
  curl -s -o /dev/null -w "  /`$f http=%{http_code} size=%{size_download}\n" "http://127.0.0.1:$SitePort/`$f"
done
echo '--- md5 (site vs staging) ---'
echo -n '  site: '; md5sum `$S/index/assets/index-*.js | awk '{print `$1}'
echo -n '  staging: '; md5sum $StagingDir/assets/index-*.js | awk '{print `$1}'
"@
    $out | ForEach-Object { '  ' + $_ }

    # 用本地 md5 做最终判定（不依赖远端输出解析）
    $servedJs = ((& ssh -o BatchMode=yes -i $HndKey -p $HndPort $HndHost "ls -1 $SiteRoot/index/assets/index-*.js | head -1") | Out-String).Trim()
    $servedName = Split-Path $servedJs -Leaf
    Write-Step '6) 结论'
    if ($servedName -eq $localJs.Name) {
        '  ✅ 线上跑的正是刚构建的 ' + $localJs.Name
    }
    else {
        '  ❌ 线上是 ' + $servedName + '，本地是 ' + $localJs.Name + ' —— 没切上，别当成功'
        throw '前端切换未生效'
    }
    '  提醒用户 Ctrl+F5 清缓存'
}
finally {
    Pop-Location
}
