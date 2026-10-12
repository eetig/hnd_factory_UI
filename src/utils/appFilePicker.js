// App 端（Android）选择文件并拿到「可上传的本地路径」。
//
// 为什么不用 uni.chooseFile：**它在 App / 小程序端根本没有实现**（
// node_modules/@dcloudio 里只有 uni-h5 有 chooseFile，App 包里没有这个 API）。
// 小程序端有 chooseMessageFile，App 端则没有任何内置的文件选择器。
//
// 所以这里直接起 Android 系统的「文档」选择器（SAF），走的是标准三步：
//   ① Intent.ACTION_OPEN_DOCUMENT 起选择器；
//   ② 拿到 content:// URI（系统给的是一个「授权凭据」，不是路径）；
//   ③ 用 ContentResolver 把内容**拷进 App 私有目录**（_doc/），得到真实路径。
// 第 ③ 步不能省：uni.uploadFile 在 App 端要的是本地文件路径，喂 Blob / blob: URL
// 都会失败（那是 H5 端的玩法）。
// 第 ③ 步的实现在 utils/androidContent.js —— 相册选图（utils/chooseImages.js）用的是同一套
// 拷法，所以抽出去共用了一份，别在这里再写一遍。
//
// ⚠️ 只覆盖 Android（plus.android）。iOS 要另写 UIDocumentPicker（plus.ios），本次不做，
//    调到此函数会给出明确提示，而不是静默失败。
// ⚠️ 每一步失败都带上「第几步」，真机上点一下就知道卡在哪儿 —— 这些桥接代码在
//    电脑上没法验证，错误信息就是唯一的调试手段。

import { copyContentUriToPrivateDir, isAndroidBridgeAvailable } from './androidContent'

/** 选择文件时的 requestCode。用一个别处不会用到的值，避免和 uni 自己的回调串台 */
const PICK_REQUEST_CODE = 0x51A7

/** 当前平台是否支持（Android 才有 plus.android） */
export function isAppFilePickerSupported() {
  return isAndroidBridgeAvailable()
}

/**
 * 起系统选择器选一个文件。
 *
 * @param {string[]} extensions 允许的扩展名（小写、不带点）；不匹配的在选完之后直接拒绝。
 *                              选择器本身放开为通配 MIME —— 很多文件提供方把 xlsx 报成
 *                              application/octet-stream，按 MIME 过滤会把正常文件藏起来。
 * @returns {Promise<{path: string, name: string, size: number}>} path 是 _doc 下的绝对路径
 */
export function pickFileOnApp(extensions = ['xlsx', 'xls']) {
  return new Promise((resolve, reject) => {
    if (!isAppFilePickerSupported()) {
      reject(new Error('当前平台不支持 App 端文件选择（plus.android 不可用）'))
      return
    }

    let main
    let Intent
    try {
      main = plus.android.runtimeMainActivity()
      Intent = plus.android.importClass('android.content.Intent')
    } catch (error) {
      reject(new Error(`第①步 初始化 Android 环境失败：${error.message}`))
      return
    }

    // uni 自己也挂在同一个 onActivityResult 上（chooseImage / previewImage 都走它），
    // 所以先把原来的存下来，不是我这次请求的就原样转交回去
    const previousHandler = main.onActivityResult

    const restore = () => {
      main.onActivityResult = previousHandler || null
    }

    const fail = (message) => {
      restore()
      reject(new Error(message))
    }

    main.onActivityResult = function handleActivityResult(requestCode, resultCode, data) {
      if (requestCode !== PICK_REQUEST_CODE) {
        if (typeof previousHandler === 'function') {
          previousHandler.apply(this, arguments)
        }
        return
      }

      try {
        // Activity.RESULT_OK === -1；用户按返回键时是 0
        if (resultCode !== -1 || !data) {
          fail('没有选择文件')
          return
        }

        const uri = data.getData()
        if (!uri) {
          fail('第②步 选择器没有返回文件地址')
          return
        }

        const picked = copyContentUriToPrivateDir(uri, {
          defaultName: `import-${Date.now()}.xlsx`,
          prefix: 'import',
        })
        if (!extensions.length || matchesExtension(picked.name, extensions)) {
          restore()
          resolve(picked)
          return
        }

        const labels = extensions.map((ext) => '.' + ext).join(' / ')
        fail('只支持 ' + labels + ' 格式的文件')
      } catch (error) {
        fail(error.message || String(error))
      }
    }

    try {
      const intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
      intent.addCategory(Intent.CATEGORY_OPENABLE)
      intent.setType('*/*')
      main.startActivityForResult(intent, PICK_REQUEST_CODE)
    } catch (error) {
      fail(`第①步 打开系统选择器失败：${error.message}`)
    }
  })
}

/** 扩展名判断：只认后缀，不认 MIME（提供方报的 MIME 不可靠） */
function matchesExtension(name, extensions) {
  const lower = String(name || '').toLowerCase()
  return extensions.some((ext) => lower.endsWith(`.${ext}`))
}

