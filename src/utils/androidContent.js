// Android 原生桥的公共件：把 content:// 的内容拷进 App 私有目录。
//
// 抽出来是因为两处要用同一套拷法：
//   · utils/appFilePicker.js —— 系统「文档」选择器选的 xlsx（工单导入）
//   · utils/chooseImages.js  —— 系统相册选的图片
// 这种桥接代码在电脑上跑不了，坑又全在细节里（拷贝 0 字节不报错、流不 close 不落盘、
// 桥接返回的 Java 对象不能当属性调方法），所以只留一份，别各写各的。

/** 当前平台有没有 Android 原生桥（只有 App 的安卓端有） */
export function isAndroidBridgeAvailable() {
  return typeof plus !== 'undefined' && !!plus.android
}

/** 读取缓冲区大小：64KB。跨桥读写是按次调用的，太小会调用次数暴涨 */
const COPY_BUFFER_SIZE = 64 * 1024

/**
 * 把 content:// 的内容拷进 App 私有目录，返回真实路径。
 *
 * <p>不能省这一步：uni.uploadFile 在 App 端要的是本地文件路径，喂 content:// 会失败；
 * <image> 同理（后面网格里要显示这些图）。
 *
 * <p>拷贝优先用系统的 android.os.FileUtils.copy（API 29+，一次调用拷完）；
 * 拿不到或没写出东西时，退回 64KB 缓冲区分块读写 —— 跨桥调用按 64KB 一次，
 * 16MB 文件约 256 次，可以接受。桥接里创建 Java 数组只能走 Array.newInstance。
 *
 * <p>结束前用**文件系统里的真实长度**校验，0 字节直接抛错 —— 见下面的注释。
 *
 * @param {string} uri content:// 地址（系统给的是「授权凭据」，不是路径）
 * @param {object} [options]
 * @param {string} [options.defaultName] 取不到原始文件名时的兜底名
 * @param {string} [options.prefix]      落盘时的前缀，用来防重名（同一秒连选两张）
 * @param {string} [options.subdir]      私有目录下的子目录（会自动创建），默认根目录
 * @param {string} [options.fallbackExtension] 原始名没有扩展名时补一个（图片用得上，文档不用）
 * @returns {{path: string, url: string, name: string, size: number}}
 *          path = 平台绝对路径（plus.uploader 那种老写法能吃的）；
 *          url  = `file:///…` 形式，**显示要用这个** —— uni 的 <image> 组件和 uni 的 API 都会
 *                 把 `_doc/…` 自动转成 file://，但**模板里写原生 `<img>` 时不会转**，
 *                 浏览器只会把它当成相对地址拼在当前页面后面（真机踩过：缩略图裂了，
 *                  而上传是好的 —— 因为上传走的是 uni API）。
 */
export function copyContentUriToPrivateDir(uri, options = {}) {
  const { defaultName = `picked-${Date.now()}`, prefix = 'picked', subdir = '', fallbackExtension = '' } = options

  let name
  try {
    name = resolveDisplayName(uri) || defaultName
  } catch {
    name = defaultName
  }
  if (fallbackExtension && !/\.[a-z0-9]+$/i.test(name)) name += `.${fallbackExtension}`

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

  const relDir = subdir ? subdir.replace(/\/+$/, '') + '/' : ''
  if (relDir) {
    // 子目录不会凭空出现：不给它 mkdirs，FileOutputStream 直接抛 FileNotFoundException
    const dir = new File(docDir, relDir)
    if (!plus.android.invoke(dir, 'exists')) plus.android.invoke(dir, 'mkdirs')
  }

  const fileName = `${prefix}-${Date.now()}-${safeFileName(name)}`
  const target = new File(docDir, relDir + fileName)
  const output = new FileOutputStream(target)

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

  // ⚠️ 真机踩过：只手写循环时，拷出来是 0 字节却**不报错** —— 后端读了个空文件，
  //    返回「解析成功、0 条记录」，前端看着一切正常。所以一定要用真实长度校验。
  const size = readLength(target)
  if (size <= 0) {
    throw new Error('第③步 拷出来的文件是 0 字节：可能选到的是云盘/在线文件，或系统没给读取权限')
  }

  const absolute = plus.android.invoke(target, 'getAbsolutePath')

  return {
    path: absolute,
    url: `file://${absolute}`,
    name,
    size,
  }
}

/**
 * 落盘用的文件名：只留 ASCII 的字母数字与 `. _ -`。
 *
 * <p>为什么不能直接用相册里的原始名：空格、`#`、`?`、中文在 `file://` 地址里会让 `<img>` 加载不到
 * （`#` 后面会被当成片段、中文要百分号编码，WebView 不一定给补），而这是一条真机上才暴露的坑。
 * 原始名不丢 —— 它以 `name` 原样返回，后端要的文件名是随请求一起传的表单字段（见各调用点的
 * `formData: { fileName }`），跟磁盘上的名字无关。
 */
function safeFileName(name) {
  const cleaned = String(name || '').replace(/[^\w.-]+/g, '_')
  // 从尾部截：保住扩展名。一个字母数字都没有（整串中文）时退回一个安全的默认名
  return /[A-Za-z0-9]/.test(cleaned) ? cleaned.slice(-64) : 'image.jpg'
}

/** 用文件系统里的真实长度做校验（不信自己数了多少字节） */
function readLength(file) {
  const value = Number(plus.android.invoke(file, 'length'))
  return Number.isFinite(value) ? value : 0
}

/** 尽量取出原始文件名（取不到就由调用方用兜底名） */
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
