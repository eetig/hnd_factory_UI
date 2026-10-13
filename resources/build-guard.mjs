// 构建期硬闸：**剔底图 + 环境自检**，挂在 vite 配置上 —— 不管从哪个入口发起的构建都会跑。
//
// 为什么要有这道闸（两起真实事故）：
//   1) 变更-006：旧包连开发机。API_ORIGIN 是**构建期内联**的常量，包装错了，
//      症状是「装得上、打得开、就是连不上后端」，现场极难判断；小程序端还多一层，
//      IP:端口连微信的「request 合法域名」都进不去（只收 HTTPS 备案域名），
//      真机上必报 `request:fail url not in domain list:<开发机IP>`（2026-10-13 真机反馈）。
//   2) 修复-007：小程序上传报 80051（主包超 2 MB）。剔图与自检原本挂在 npm 脚本链尾
//      （`uni build && node strip-vessel-images.mjs && node …`），而 **HBuilderX 发起的
//      构建不执行 npm 脚本**：图被原样拷回包内，同一晚上传两次都被拒。
//   → 结论：这两件事不能挂在「npm 脚本链」上，要进 **vite 配置本身**。
//     只要这次构建加载了本项目的 vite.config.js（npm / HBuilderX / 任何入口），就跑得到。
//     本文件即该配置插件的实现；挂载点见 vite.config.js 的 plugins。
//
// 触发范围：
//   - 仅 production 构建（`uni build` / HBuilderX「发行」）。dev/watch（`npm run dev:*`、
//     HBuilderX「运行」）直接跳过 —— 开发期就要包内底图（离线可用、零延迟），
//     且 dev 产物从不外发。
//   - 只处理**本次构建自己的产物目录**（uni 的 UNI_OUTPUT_DIR），不越界动别的平台。
//
// 两道闸（语义与既有 `strip-vessel-images` / `check-app-env` 一致，可重复执行）：
//
//   A. 剔底图（仅 remote）：8 张容器底图在 remote 包内是纯死重量（改由
//      `hbhnd.cloud/vessels/` 网络加载，见 变更-024），剔掉后不再占小程序主包。
//      ⚠️ remote 却没配 VESSEL_IMAGE_ORIGIN 是**坏包**（取图地址会退回 `/static/`，
//      而包内那份已被剔空）——必须拦住构建，见下面的 throw。
//
//   B. 环境自检：remote 产物**不允许**出现 RFC1918 私网地址，且必须命中线上域名；
//      违反即 throw → 构建当场失败，坏包根本产不出来。
//      local 产物内联私网地址是预期行为（联调包），只提示、不拦。
//
// 与 resources/check-app-env.mjs 的分工：
//   本文件负责「构建时拦」，check-app-env 负责「打包后独立复验」（它还能看见 APK、wgt
//   这些 vite 管不到的产物）。两边共用下面导出的检测常量，口径保持一处。

import { readdirSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs'
import { join, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_ENV, ACTIVE_ENV, VESSEL_IMAGE_ORIGIN } from '../src/api/env.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const rel = (p) => relative(ROOT, p).split(sep).join('/')

/** RFC1918 私网地址：产物里出现即说明开发机地址被内联进去了 */
export const LAN_RE =
  /(?<![0-9.])(?:10[.][0-9]{1,3}|172[.](?:1[6-9]|2[0-9]|3[01])|192[.]168)[.][0-9]{1,3}[.][0-9]{1,3}(?![0-9])/g

/**
 * 底图在 static/ 下的命名约定：都以 vessel 开头。
 * `compress-vessel-images.py` 产出的就是这些名字（含 -dark 与 -product150 之类的后缀）。
 */
export const VESSEL_IMAGE_RE = /^vessel.*\.png$/i

// 扫产物只读文本类文件。`.map` 刻意排除：那是调试产物、里面本来就带 src 全文
// （而 env.js 源码里两套预设都写着），拿它当「包内有没有私网地址」的依据会误报 ——
// 要看的是真正发出去的那份代码。
const TEXT_RE = /[.](?:js|mjs|cjs|json|wxml|wxss|wxs|css|html|htm|txt)$/i

/**
 * 把一个产物目录里所有文本文件的正文拼起来（给环境自检用）。
 * 目录不存在返回 null（= 这次没打这个平台的包，调用方跳过即可）。
 */
export function readTextTree(dir) {
  if (!existsSync(dir)) return null
  const parts = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (TEXT_RE.test(e.name)) parts.push(readFileSync(p, 'utf8'))
    }
  }
  walk(dir)
  return parts.join('\u000a')
}

/**
 * 对一次构建的产物目录跑两道闸。独立导出是为了能脱离 vite 直接调用（自测用）。
 * @param {string} outDir 产物目录（绝对路径）
 */
export function runGuard(outDir) {
  const isRemote = APP_ENV === 'remote'
  const expectedHost = ACTIVE_ENV.apiOrigin ? new URL(ACTIVE_ENV.apiOrigin).hostname : ''
  console.log(`[build-guard] 产物目录 = ${rel(outDir)}（APP_ENV=${APP_ENV}）`)

  // ── A. 剔底图 ────────────────────────────────────────────────────────────
  if (isRemote) {
    if (!VESSEL_IMAGE_ORIGIN) {
      throw new Error(
        '[build-guard] APP_ENV=remote 但 VESSEL_IMAGE_ORIGIN 为空：这个包会缺底图' +
          '（取图地址退回 /static/，而包内那份会被剔除）。先修 src/api/env.js 再构建。',
      )
    }
    const staticDir = join(outDir, 'static')
    if (existsSync(staticDir)) {
      const names = readdirSync(staticDir).filter((n) => VESSEL_IMAGE_RE.test(n))
      if (names.length) {
        let bytes = 0
        for (const n of names) bytes += statSync(join(staticDir, n)).size
        for (const n of names) rmSync(join(staticDir, n))
        console.log(
          `[build-guard] 剔掉 ${names.length} 张容器底图（${(bytes / 1024).toFixed(0)} KB）` +
            ` → remote 包改由 ${VESSEL_IMAGE_ORIGIN}/ 加载`,
        )
      }
    }
  }

  // ── B. 环境自检 ──────────────────────────────────────────────────────────
  const text = readTextTree(outDir)
  if (text === null) {
    console.log('[build-guard] 产物目录不存在，跳过环境自检')
    return
  }

  const ips = [...new Set(text.match(LAN_RE) || [])]

  if (!isRemote) {
    console.log(
      `[build-guard] ⚠️ APP_ENV=local：这是 production 构建却用的联调预设` +
        `${ips.length ? `，产物内联了 ${ips.join(', ')}` : ''} —— 该产物只能自己联调，不可上传/分发`,
    )
    return
  }

  const missingHost = expectedHost ? !text.includes(expectedHost) : false
  if (ips.length || missingHost) {
    throw new Error(
      [
        `[build-guard] ❌ 产物环境自检未通过：${rel(outDir)}`,
        `  私网地址: ${ips.length ? ips.join(', ') : '无'}        线上域名 ${expectedHost || '(空)'}: ${missingHost ? '缺失' : '命中'}`,
        '  原因：API_ORIGIN / 底图地址都是构建期内联的常量（改后端、改 hosts 都无效），',
        '        这个产物要么不是用 remote 预设构建的，要么代码里有写死的私网地址。',
        "  修法：1) 确认 src/api/env.js 的 APP_ENV === 'remote'   2) 重新构建（本闸会自动复验）",
      ].join('\n'),
    )
  }

  console.log(`[build-guard] ✅ 环境自检通过：无私网地址，命中 ${expectedHost}`)
}

/** vite 插件：挂到 vite.config.js 的 plugins 末尾（closeBundle 在所有写盘之后跑） */
export default function buildGuard() {
  /** @type {string} */
  let outDir = ''
  return {
    name: 'hnd-build-guard',
    apply: 'build',
    configResolved(config) {
      // uni 在进入 vite 前就把本次构建的产物目录丢在环境变量里（dist/build/<platform>）；
      // 兜底用 vite 自己的 outDir（相对项目根）
      outDir = process.env.UNI_OUTPUT_DIR || resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      // dev/watch 跳过：`npm run dev:*` 与 HBuilderX「运行」都不产正式包，
      // 且开发期就要包内底图。NODE_ENV 与产物路径两道都看，防单点判断失灵。
      const isDevOutput = /[\\/]dist[\\/]dev[\\/]/.test(outDir)
      if (process.env.NODE_ENV !== 'production' || isDevOutput) return
      runGuard(outDir)
    },
  }
}
