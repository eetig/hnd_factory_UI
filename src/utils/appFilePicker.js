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
//
// ⚠️ 只覆盖 Android（plus.android）。iOS 要另写 UIDocumentPicker（plus.ios），本次不做，
//    调到此函数会给出明确提示，而不是静默失败。
// ⚠️ 每一步失败都带上「第几步」，真机上点一下就知道卡在哪儿 —— 这些桥接代码在
//    电脑上没法验证，错误信息就是唯一的调试手段。


/** 选择文件时的 requestCode。用一个别处不会用到的值，避免和 uni 自己的回调串台 */
const PICK_REQUEST_CODE = 0x51A7

/** 读取缓冲区大小：64KB。跨桥读写是按次调用的，太小会调用次数暴涨 */
const COPY_BUFFER_SIZE = 64 * 1024

/** 当前平台是否支持（Android 才有 plus.android） */
export function isAppFilePickerSupported() {
  return typeof plus !== 'undefined' && !!plus.android
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

        const picked = copyToPrivateDir(uri)
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

/**
 * 把 content:// 的内容拷进 App 私有目录，返回真实路径。
 *
 * <p>拷贝优先用系统的 android.os.FileUtils.copy（API 29+，一次调用拷完）；
 * 拿不到或没写出东西时，退回 64KB 缓冲区分块读写 —— 跨桥调用按 64KB 一次，
 * 16MB 文件约 256 次，可以接受。桥接里创建 Java 数组只能走 Array.newInstance。
 *
 * <p>结束前用**文件系统里的真实长度**校验，0 字节直接抛错 —— 见下面的注释。
 */
function copyToPrivateDir(uri) {
  let name
  try {
    name = resolveDisplayName(uri) || `import-${Date.now()}.xlsx`
  } catch {
    name = `import-${Date.now()}.xlsx`
  }

  const main = plus.android.runtimeMainActivity()
  // ⚠️ 桥接返回的 Java 对象，方法不能当属性直接调（会报 xxx is not a function）——
  //    要么先 importClass 把方法挂上去，要么一律用 plus.android.invoke。
  //    这里统一用 invoke（真机实测：写成 resolver.openInputStream(uri) 直接报
  //    「resolver.openInputStream is not a function」）。
  plus.android.importClass('android.content.ContentResolver')
  const resolver = main.getContentResolver()
  const input = plus.android.invoke(resolver, 'openInputStream', uri)
  if (!input) {
    throw new Error('第③步 读不到文件内容（系统未授予读取权限）')
  }

  const docDir = plus.io.convertLocalFileSystemURL('_doc/')
  const File = plus.android.importClass('java.io.File')
  const FileOutputStream = plus.android.importClass('java.io.FileOutputStream')

  const target = new File(docDir, `import-${Date.now()}-${name}`)
  const output = new FileOutputStream(target)

  // 拷贝：先试系统的 FileUtils.copy（API 29+ 一次调用把流拷完），
  // 没写出东西再走缓冲区逐块拷贝兜底。
  // ⚠️ 真机踩过：只手写循环时，拷出来是 0 字节却**不报错** ——
  //    后端读了个空文件，返回「解析成功、0 条记录」，前端看着一切正常。
  //    所以最后一定要用文件系统里的真实长度校验，0 字节直接报错。
  try {
    try {
      plus.android.importClass('android.os.FileUtils')
      plus.android.invoke('android.os.FileUtils', 'copy', input, output)
    } catch {
      // 低版本没有这个方法，交给下面的分块拷贝
    }

    if (readLength(target) <= 0) {
      const Byte = plus.android.importClass('java.lang.Byte')
      // 静态方法用「类名字符串 + invoke」最稳；Byte.TYPE 是静态字段，读法同 Intent.ACTION_*
      const buffer = plus.android.invoke('java.lang.reflect.Array', 'newInstance', Byte.TYPE, COPY_BUFFER_SIZE)
      let read = plus.android.invoke(input, 'read', buffer)
      while (read > 0) {
        plus.android.invoke(output, 'write', buffer, 0, read)
        read = plus.android.invoke(input, 'read', buffer)
      }
    }
  } finally {
    // ⚠️ 必须先关流再量长度：FileOutputStream 不 close 不保证 flush，
    //    没落盘的字节长度是 0，会被下面误判成「拷了个空文件」
    plus.android.invoke(input, 'close')
    plus.android.invoke(output, 'close')
  }

  const size = readLength(target)
  if (size <= 0) {
    throw new Error('第③步 拷出来的文件是 0 字节：可能选到的是云盘/在线文件，或系统没给读取权限')
  }

  return { path: plus.android.invoke(target, 'getAbsolutePath'), name, size }
}

/** 尽量取出原始文件名（取不到就用时间戳兜底，后端主要看扩展名） */
/** 用文件系统里的真实长度做校验（不信自己数了多少字节） */
function readLength(file) {
  const value = Number(plus.android.invoke(file, 'length'))
  return Number.isFinite(value) ? value : 0
}

function resolveDisplayName(uri) {
  const main = plus.android.runtimeMainActivity()
  plus.android.importClass('android.content.ContentResolver')
  const resolver = main.getContentResolver()
  const cursor = plus.android.invoke(resolver, 'query', uri, null, null, null, null)
  if (!cursor) {
    return ''
  }
  try {
    if (!plus.android.invoke(cursor, 'moveToFirst')) {
      return ''
    }
    const index = plus.android.invoke(cursor, 'getColumnIndex', '_display_name')
    if (index < 0) {
      return ''
    }
    const value = plus.android.invoke(cursor, 'getString', index)
    return value ? String(value) : ''
  } finally {
    plus.android.invoke(cursor, 'close')
  }
}

