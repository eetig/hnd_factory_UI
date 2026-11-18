/**
 * 手机 App 自己的更新（2026-11-17）。
 *
 * 为什么要有：APK 装到手机上就"定住"了，以后改了功能，负责打包的人得挨个喊
 * "去首页重新下一个"—— 车间里没人会干这事。所以让 App 自己去问一句：
 * 「服务器上那个最新版，比我新吗？」
 *
 * 版本信息从哪来：和 PC 客户端同一个发布目录 ——
 *   https://hbhnd.cloud/desktop/app/latest.json
 * 由 scripts/publish_app.sh 每次上传 APK 时顺手写（version / versionCode / size /
 * sizeText / url）。**不在 App 里写死版本号**，否则每发一版都要改两处，早晚漏一处。
 *
 * 交互口径（与 PC 一致，使用方定的）：
 *   · 开机**安静地问一句**，有新版只点个红点，不弹窗打扰 —— 车间早上是来记账的；
 *   · 用户自己点「版本 v1.0.5」时才走下载/安装；
 *   · 查不到（断网 / 通道挂了）就当作没新版，不报错。
 *
 * 只在 App 端有效（plus 运行时）。H5 / 小程序里 checkAppUpdate() 直接返回 null，
 * 调用方不用写平台判断。
 */
import { ACTIVE_ENV } from '../api/env'

/** latest.json 的地址：跟发布脚本共用同一个目录，别再另起一份 */
export const UPDATE_MANIFEST_URL = `${ACTIVE_ENV.apiOrigin}/desktop/app/latest.json`

/**
 * 读本机 App 的版本号。
 * plus.runtime.getProperty 是异步回调，且 H5 里没有 plus —— 所以包在 Promise 里，
 * 拿不到就返回 null（调用方据此隐藏入口）。
 */
export function readLocalVersion() {
  // #ifdef APP-PLUS
  return new Promise((resolve) => {
    try {
      plus.runtime.getProperty(plus.runtime.appid, (info) => {
        resolve({
          version: info?.version || plus.runtime.version || '',
          versionCode: String(info?.versionCode || plus.runtime.versionCode || ''),
        })
      })
    } catch {
      resolve(null)
    }
  })
  // #endif
  // #ifndef APP-PLUS
  return Promise.resolve(null)
  // #endif
}

/** "1.0.10" vs "1.0.9" 要按数字比，不能按字符串比（字符串里 '1.0.9' > '1.0.10'） */
function compareVersion(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

/**
 * 问一次服务器：我是不是旧了？
 *
 * 返回 { hasUpdate, current, latest } 或 null（App 端以外 / 请求失败 / 数据不可信）。
 * 判断顺序：先比 versionCode（打包时递增的整数，最可靠），没有再比 version 字符串。
 */
export async function checkAppUpdate() {
  const current = await readLocalVersion()
  if (!current) return null

  let latest = null
  try {
    const res = await uni.request({
      url: `${UPDATE_MANIFEST_URL}?t=${Date.now()}`,
      method: 'GET',
      timeout: 8000,
    })
    // uni.request 在 App 端会返回 { data, statusCode }
    const body = res?.data || res?.[1]?.data
    if (body && typeof body === 'object' && body.version) latest = body
  } catch {
    return null
  }
  if (!latest) return null

  let hasUpdate = false
  const curCode = parseInt(current.versionCode, 10) || 0
  const newCode = parseInt(latest.versionCode, 10) || 0
  if (curCode && newCode) hasUpdate = newCode > curCode
  else hasUpdate = compareVersion(latest.version, current.version) > 0

  return { hasUpdate, current, latest }
}

/**
 * 下载并拉起系统安装器。
 *
 * 为什么不用 uni.downloadFile：它下到临时目录、且没有进度回调；
 * plus.downloader 能给百分比，装在车间弱网下有个进度条要安心得多。
 * APK 存到 _doc/update/ 下（固定文件名，每次覆盖，不占空间）。
 *
 * 注意 Android 8+ 要两件事，缺一个都会"点了没反应"：
 *   ① manifest.json 里申请 REQUEST_INSTALL_PACKAGES（见 src/manifest.json）；
 *   ② 系统里允许本应用"安装未知应用"，否则系统会弹一次授权页让用户开。
 */
export function downloadAndInstall(url, options) {
  // 兼容老调用：第二个参数直接给函数时当作 onProgress
  const opts = typeof options === 'function' ? { onProgress: options } : options || {}
  const { onProgress, onTask, onInstalling } = opts
  // #ifdef APP-PLUS
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error('下载地址为空'))
      return
    }
    const task = plus.downloader.createDownload(
      url,
      { filename: '_doc/update/hnd-app.apk' },
      (download, status) => {
        if (status === 200 && download?.filename) {
          // 交给系统安装器之前告知调用方：界面从「下载中」切到「正在安装」
          try {
            onInstalling && onInstalling()
          } catch {
            /* 回调里的异常不能影响安装 */
          }
          plus.runtime.install(
            download.filename,
            { force: false },
            () => resolve(download.filename),
            (error) => reject(new Error(error?.message || '安装失败')),
          )
        } else {
          reject(new Error(`下载失败（${status}）`))
        }
      },
    )
    task.addEventListener('statechanged', (download) => {
      if (!onProgress) return
      const total = download.totalSize || 0
      const done = download.downloadedSize || 0
      // 一次给全：比例可能拿不到（total 为 0），但已下载字节数总是有的，
      // 界面可以据此显示「已下载 3.2 MB」之类，不至于只有一句「正在连接」。
      onProgress({ ratio: total > 0 ? done / total : null, loaded: done, total })
    })
    // 把 task 交出去：界面上的「取消」要能 abort 它
    try {
      onTask && onTask(task)
    } catch {
      /* 同上，回调异常不影响下载 */
    }
    task.start()
  })
  // #endif
  // #ifndef APP-PLUS
  return Promise.reject(new Error('只有手机 App 能安装更新'))
  // #endif
}
