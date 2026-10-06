// 正式包里不该有容器底图 —— 构建后从**三端**产物里把它们剔掉。
//
// 为什么需要这一步：
//   `src/static/` 里的东西是**全量打进包体**的（没有按需加载可言）。
//   底图 2026-10-06 起改回原图（不再降采样，见 compress-vessel-images.py），
//   八张合计 **2.4 MB**；小程序主包上限 2 MB，App 的 APK 也会白白胖一圈。
//   改成走网络加载后（`hbhnd.cloud/vessels/`，`downloadFile` 合法域名本来就配着、
//   单据图片走的就是这条通道），**包体不再随容器种类与分辨率增长**。
//
// 为什么是「构建后从产物里剔」而不是「一开始就不放进 src/static/」：
//   开发期（`APP_ENV=local`）要包内图才能离线跑、且进 Tab 零加载延迟；
//   只有正式包（`APP_ENV=remote`）需要剔。产物是派生物，剔它没有副作用、可重复执行；
//   若改成构建前从 `src/` 挪走再挪回，一旦构建中途失败就会**留下半截状态**。
//
// ⚠️ 忘了跑这一步的后果是**包变大**，不是包坏掉：remote 下图片地址是绝对的 https，
//    本来就不读包内那一份（见 `src/api/config.js` 的 resolveVesselImage）。
//    但「remote 却没配 VESSEL_IMAGE_ORIGIN」是真的会出坏包（地址会退回 /static/，
//    而那时包内那份已经被剔了），所以那种情况**要拦住构建**，见下面的退出码 2。
//
// 用法：
//   npm run build:{h5,app,mp-weixin}   构建后自动跑（见 package.json）
//   npm run strip:vessel-images        单独复验
//
// 退出码：0 = 通过（已剔，或本来就该保留）；2 = remote 却没配取图地址（坏包，必须拦住）。

import { readdirSync, rmSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_ENV, VESSEL_IMAGE_ORIGIN } from '../src/api/env.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
/**
 * 三端的产物目录都要剔。**不只是小程序**：
 * 底图 2026-10-06 起改回原图（不再降采样，见 compress-vessel-images.py），
 * 八张合计 2.4 MB —— 只剔小程序的话，App 的 APK 会白白多带 2.4 MB
 * （远端模式下 App 也是从服务器取图的，包内那份纯属死重量）。
 */
const BUILD_DIRS = ['mp-weixin', 'app', 'h5'].map((p) => join(ROOT, 'dist', 'build', p, 'static'))
// 底图在 static/ 下的命名约定：都以 vessel 开头。`compress-vessel-images.py`
// 产出的就是这些名字（含 -dark 与 -product150 之类的后缀）
const VESSEL_IMAGE_RE = /^vessel.*\.png$/i

function dirSizeKb(dir, names) {
  let bytes = 0
  for (const name of names) bytes += statSync(join(dir, name)).size
  return bytes / 1024
}

if (APP_ENV !== 'remote') {
  console.log(`[strip-vessel-images] APP_ENV=${APP_ENV} → 开发/联调包保留包内底图，跳过`)
  process.exit(0)
}

if (!VESSEL_IMAGE_ORIGIN) {
  console.error('[strip-vessel-images] APP_ENV=remote 但 VESSEL_IMAGE_ORIGIN 为空，产物会缺底图')
  process.exit(2)
}

let touched = 0
for (const dir of BUILD_DIRS) {
  if (!existsSync(dir)) continue

  const names = readdirSync(dir).filter((n) => VESSEL_IMAGE_RE.test(n))
  if (!names.length) continue

  const before = dirSizeKb(dir, names)
  for (const name of names) rmSync(join(dir, name))
  touched += 1

  const platform = dir.split(/[\\/]/).slice(-2)[0]
  console.log(
    `[strip-vessel-images] ${platform}：剔掉 ${names.length} 张底图（${before.toFixed(0)} KB）`,
  )
}

console.log(
  touched
    ? `[strip-vessel-images] remote 包改由 ${VESSEL_IMAGE_ORIGIN}/ 加载底图`
    : '[strip-vessel-images] 产物里没有容器底图，无需处理（或先跑构建）',
)
