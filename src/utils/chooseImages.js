// uni.chooseImage 的替身：**App 安卓端的「相册」分支改走手机自带的相册**。
//
// 为什么不用框架自带的那套：框架在 App 端把相册写死成 plus.gallery.pick({ system: false })，
// 也就是它自己画的那个「选择图片 / 完成(n/m) / 所有图片 / 原图 / 预览」界面 ——
// 轻击只勾选、点开大图要另按「预览」、也不能按住右下角圆圈滑动连选，
// 使用方 2026-10-10 明确要手机相册本身那套（小米手机上就是小米相册）。
// 而 system: true（走系统相册控件）这条路从 HBuilderX 2.9.6 起就被 DCloud 废弃了，改不回去。
// 所以这里自己发 intent 把系统相册的多选界面叫起来。
//
// 与 uni.chooseImage **同参数、同回调**（count / sizeType / sourceType / success / fail），
// 调用点基本只改个函数名：
//   · 「相册」与「拍照」分成两个按钮的地方（sourceType 只传 ['album']）—— App 端相册走系统相册；
//   · 相册+拍照共用一个入口的（sourceType 两个都给，框架自己先弹 ActionSheet）—— 原样不动，
//     免得改了人家的选择流程；
//   · 拍照、H5、小程序 —— 原样交给 uni.chooseImage。
//
// ⚠️ 系统相册给的是 content:// 凭据、且**只有原图**（没有「压缩」开关）。
//    所以选完必须立刻拷进 App 私有目录 —— 授权只在本次会话有效，而且 App 端只认本地文件。
//    拷完交出去的是 `file:///…` 形式的地址（见下面 paths 那段的说明）。
//    代价是几 MB 的原图会照原样上传，图片解析页那条 10MB 的单张上限会更容易拦下来。

import { copyContentUriToPrivateDir, isAndroidBridgeAvailable } from './androidContent'

/** 起系统相册用的 requestCode。别和 appFilePicker 的 0x51A7、uni 自己的值撞上 */
const ALBUM_REQUEST_CODE = 0x51a8

/** 选完拷进来的图放这儿（App 私有目录下）。名字挑得和框架的临时目录不沾边 */
const PICKED_DIR = 'picked'

/** 过期文件保留时长：一天。留够一天是怕「选完图、页面开着、晚点才提交」；超过一天的都是上一次的残留 */
const PICKED_KEEP_MS = 24 * 60 * 60 * 1000

/**
 * 选图。参数与 uni.chooseImage 一致。
 *
 * @param {object} options
 * @param {number}   [options.count=9]        最多选几张（超出的丢掉并提示）
 * @param {string[]} [options.sizeType]       只透传给框架；系统相册这条路拿到的就是原图
 * @param {string[]} [options.sourceType=['album']] 只有**恰好** ['album'] 才走系统相册
 * @param {Function} [options.success]        同 uni.chooseImage（tempFilePaths / tempFiles）
 * @param {Function} [options.fail]           同 uni.chooseImage；用户取消也会走这里（errMsg: chooseImage:fail cancel）
 */
export function chooseImages(options = {}) {
  const {
    count = 9,
    sizeType = ['original', 'compressed'],
    sourceType = ['album'],
    success,
    fail,
  } = options

  const albumOnly = sourceType.length === 1 && sourceType[0] === 'album'

  if (albumOnly && isAndroidBridgeAvailable()) {
    pickFromSystemAlbum(count)
      .then((result) => {
        const notes = []
        if (result.dropped) notes.push(`最多选 ${count} 张，已取前 ${count} 张`)
        if (result.failed) notes.push(`${result.failed} 张读不出来，已跳过`)
        if (notes.length) {
          uni.showToast({ title: notes.join('；'), icon: 'none', duration: 2500 })
        }

        if (success) {
          success({
            errMsg: 'chooseImage:success',
            tempFilePaths: result.paths,
            tempFiles: result.files,
          })
        }
      })
      .catch((error) => {
        // 只要「相册已经开起来了」（用户取消、图读不出来、拷不进来），就**不能**再退回框架那套 ——
        // 那会立刻又弹一个选图界面出来，用户以为自己刚选的图弄丢了。该说原因的说原因。
        if (error && (error.cancelled || error.noFallback)) {
          if (error.cancelled) {
            // 取消就照 uni 的约定报 cancel —— 调用方是按这个字符串判断"用户自己放弃"的
            if (fail) fail({ errMsg: 'chooseImage:fail cancel' })
            return
          }

          uni.showToast({ title: error.message || '选图失败', icon: 'none', duration: 3000 })
          if (fail) fail({ errMsg: `chooseImage:fail ${error.message || '选图失败'}` })
          return
        }

        // 起不来（ROM 没注册这类 intent 等）：退回框架那套。宁可界面难看，也不能选不了图
        console.warn('[chooseImages] 系统相册用不了，退回 uni.chooseImage', error)
        uni.chooseImage({ count, sizeType, sourceType, success, fail })
      })
    return
  }

  uni.chooseImage({ count, sizeType, sourceType, success, fail })
}

/**
 * 起系统相册多选，等到结果后把选中的图拷进 App 私有目录。
 *
 * @param {number} max 最多要几张
 * @returns {Promise<{paths: string[], files: Array, dropped: number, failed: number}>}
 */
function pickFromSystemAlbum(max) {
  return new Promise((resolve, reject) => {
    cleanStalePickedFiles() // 顺手清上次的残留，不 await：清不掉也不能影响选图

    let main
    let Intent
    try {
      main = plus.android.runtimeMainActivity()
      Intent = plus.android.importClass('android.content.Intent')
    } catch (error) {
      reject(new Error(`第①步 初始化 Android 环境失败：${error.message}`))
      return
    }

    // uni 自己也挂在同一个 onActivityResult 上，先存下来；不是我们这次请求的照样转交回去
    const previousHandler = main.onActivityResult
    const restore = () => {
      main.onActivityResult = previousHandler || null
    }
    const fail = (message, extra) => {
      restore()
      reject(Object.assign(new Error(message), extra || {}))
    }

    main.onActivityResult = function handleActivityResult(requestCode, resultCode, data) {
      if (requestCode !== ALBUM_REQUEST_CODE) {
        if (typeof previousHandler === 'function') {
          previousHandler.apply(this, arguments)
        }
        return
      }

      try {
        // Activity.RESULT_OK === -1；按返回键 / 取消是 0
        if (resultCode !== -1 || !data) {
          fail('没有选择图片', { cancelled: true })
          return
        }

        const uris = readPickedUris(data)
        if (!uris.length) {
          fail('第②步 相册没有返回选中的图片', { noFallback: true })
          return
        }

        // 拷贝可能要几秒（原图 + 跨桥），先把回调还原回去，别再拦着别的结果
        restore()

        const dropped = Math.max(0, uris.length - max)
        copyAll(uris.slice(0, max)).then(({ files, errors }) => {
          if (!files.length) {
            reject(Object.assign(new Error(errors[0] || '第③步 图片没能拷进 App'), { noFallback: true }))
            return
          }
          resolve({
            // 交出去的是 `file:///…` 形式的地址（不是 _doc/…）：模板里的**原生 `<img>` 不会**
            // 把 _doc/… 转成 file://，只会当成相对地址拼在页面后面 → 真机上缩略图是裂的。
            // file:// 则原生 <img>、uni 的 <image>、uploadFile、previewImage 通吃。
            paths: files.map((file) => file.url),
            files: files.map((file) => ({ path: file.url, size: file.size, name: file.name })),
            dropped,
            failed: errors.length,
          })
        })
      } catch (error) {
        // 已经走到这儿了，说明相册确实返回过结果 —— 一律不退回框架（见上面的注释）
        fail(error.message || String(error), { noFallback: true })
      }
    }

    // 优先 ACTION_GET_CONTENT：这是官方支持多选的那种；小米机器上一般直接落到小米相册。
    // 少数 ROM 没给它注册图片选择，换老的 ACTION_PICK + 相册的 MediaStore 地址再试一次。
    try {
      const intent = new Intent(Intent.ACTION_GET_CONTENT)
      intent.addCategory(Intent.CATEGORY_OPENABLE)
      intent.setType('image/*')
      intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) // 少了这个，读 content:// 会 SecurityException
      main.startActivityForResult(intent, ALBUM_REQUEST_CODE)
      return
    } catch (error) {
      console.warn('[chooseImages] ACTION_GET_CONTENT 起不来，换 ACTION_PICK 再试', error)
    }

    try {
      const MediaStore = plus.android.importClass('android.provider.MediaStore$Images$Media')
      const intent = new Intent(Intent.ACTION_PICK, MediaStore.EXTERNAL_CONTENT_URI)
      intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      main.startActivityForResult(intent, ALBUM_REQUEST_CODE)
    } catch (error) {
      fail(`第①步 打开系统相册失败：${error.message}`)
    }
  })
}

/**
 * 从返回的 Intent 里取选中的图片地址。
 *
 * 多选走 getClipData()（每一 item 一个 uri）；单选、或提供方不支持多选时走 getData()。
 */
function readPickedUris(data) {
  const uris = []

  const clip = plus.android.invoke(data, 'getClipData')
  if (clip) {
    const total = Number(plus.android.invoke(clip, 'getItemCount')) || 0
    for (let i = 0; i < total; i++) {
      const item = plus.android.invoke(clip, 'getItemAt', i)
      const uri = item ? plus.android.invoke(item, 'getUri') : null
      if (uri) uris.push(uri)
    }
    return uris
  }

  const single = plus.android.invoke(data, 'getData')
  if (single) uris.push(single)
  return uris
}

/** 逐张拷进私有目录。串行：跨桥拷贝是重活，别并行去抢主线程；单张失败不中断整批 */
async function copyAll(uris) {
  const files = []
  const errors = []

  for (let i = 0; i < uris.length; i++) {
    try {
      files.push(
        copyContentUriToPrivateDir(uris[i], {
          prefix: 'picked',
          subdir: PICKED_DIR,
          defaultName: `picked-${Date.now()}-${i}.jpg`,
          fallbackExtension: 'jpg',
        }),
      )
    } catch (error) {
      errors.push(error.message || String(error))
    }
  }

  return { files, errors }
}

/**
 * 清掉 _doc/picked/ 里超过一天的旧文件。
 *
 * <p>为什么要有这一下：选中的原图是**拷进来的**，不清理就一直占着手机存储。
 * 框架自己给的临时路径（_doc/uniapp_temp_<时间戳>/…）不用我们管，它下次启动会自动清，
 * 而我们的目录在它那套规则之外，只能自己收。
 *
 * <p>只删一天前的：正在页面上显示的那些一定是刚选的，不可能被误删。
 */
function cleanStalePickedFiles() {
  try {
    plus.io.resolveLocalFileSystemURL(`_doc/${PICKED_DIR}/`, (entry) => {
      entry.createReader().readEntries(
        (entries) => {
          const cutoff = Date.now() - PICKED_KEEP_MS
          entries.forEach((item) => {
            if (!item.isFile) return
            const modified = item.lastModifiedDate ? item.lastModifiedDate.getTime() : 0
            if (!modified || modified < cutoff) {
              try {
                item.remove()
              } catch {
                // 单个删不掉无所谓，下次再说
              }
            }
          })
        },
        () => {
          // 读不出来就算了
        },
      )
    }, () => {
      // 目录还不存在（第一次选图），什么都不用做
    })
  } catch {
    // 清理只是顺手为之，任何失败都不该影响选图
  }
}
