// 巡检离线队列（2026-11-19 建立，2026-11-21 变更-255 改成「整篇正文」模型）
//
// 使用方原话：「消防泵房经常没信号，得能先记下来，出来了再传上去」。
// 于是提交分两条路：
//   有网 → 照片先传成 /files/xxx，再整条 POST 过去（一步到位）；
//   没网 → 整条记录（照片还是手机本地路径）压进本地队列，页面立刻给"已暂存"。
//
// 两个容易踩的坑，这里都处理了：
//   1. 选图给的是**临时路径**，系统随时可能清理 —— 入队前先用 uni.saveFile
//      拷进应用沙箱（App 端才有，H5 端临时 blob 只能尽量保）。
//   2. 补传时照片要逐张换成服务端的 /files/xxx，否则记录里存的是手机路径，
//      换台手机就看不到了。
import { submitRecord, uploadRecordPhoto } from '../api/inspect'

const QUEUE_KEY = 'inspect_queue_v1'

function readQueue() {
  try {
    const raw = uni.getStorageSync(QUEUE_KEY)
    return Array.isArray(raw) ? raw : []
  } catch (e) {
    return []
  }
}

function writeQueue(list) {
  try {
    uni.setStorageSync(QUEUE_KEY, list)
  } catch (e) {
    // 存不下（配额/权限）不该把提交流程搞崩，交给调用方按"没暂存上"处理
    throw e
  }
}

/** 队列里还有几条没传上去（页面角标用） */
export function pendingCount() {
  return readQueue().length
}

export function readPending() {
  return readQueue()
}

function isRemote(src) {
  return typeof src === 'string' && src.indexOf('/files/') === 0
}

function saveOnce(path) {
  return new Promise((resolve) => {
    uni.saveFile({
      tempFilePath: path,
      success: (res) => resolve((res && res.savedFilePath) || path),
      fail: () => resolve(path),
    })
  })
}

/** 把临时照片固化到应用沙箱；拿不到长期路径时退回原路径（尽力而为） */
export function persistPhoto(path) {
  if (!path) return Promise.resolve('')
  // #ifdef APP-PLUS
  return saveOnce(path)
  // #endif
  // #ifndef APP-PLUS
  return Promise.resolve(path)
  // #endif
}

/**
 * 入队一条巡检记录。
 *
 * @param {object} record { clientUuid, templateId, startedAt, finishedAt, note, images }
 *        images 允许混着本地路径与 /files/ 路径，补传时会自动区分。
 * @returns {Promise<number>} 入队后的队列长度
 */
export async function enqueue(record) {
  const item = {
    clientUuid: record.clientUuid,
    templateId: record.templateId,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    note: record.note || '',
    images: [],
    queuedAt: Date.now(),
  }

  for (const src of record.images || []) {
    item.images.push(isRemote(src) ? src : await persistPhoto(src))
  }

  const queue = readQueue()
  const at = queue.findIndex((one) => one.clientUuid === item.clientUuid)
  if (at >= 0) queue[at] = item
  else queue.push(item)
  writeQueue(queue)
  return queue.length
}

let flushing = false

/**
 * 补传队列。
 *
 * 一条失败就停下（多半是还没网）：继续往下试只会让用户多等一轮超时。
 * 已有 /files/ 路径的照片直接复用，不重复上传。
 *
 * @returns {Promise<{ uploaded: number, left: number, busy?: boolean }>}
 */
export async function flushQueue() {
  if (flushing) return { uploaded: 0, left: pendingCount(), busy: true }

  const queue = readQueue()
  if (!queue.length) return { uploaded: 0, left: 0 }

  flushing = true
  let uploaded = 0
  const keep = []

  try {
    for (const item of queue) {
      if (keep.length) {
        keep.push(item)
        continue
      }

      try {
        const images = []
        for (const src of item.images || []) {
          if (isRemote(src)) {
            images.push(src)
            continue
          }
          const res = await uploadRecordPhoto(src)
          const body = (res && res.data) || {}
          const remote = body && body.data ? body.data.path : ''
          if (body.code !== 200 || !remote) throw new Error(body.msg || '照片没传上去')
          images.push(remote)
        }

        const res = await submitRecord({
          clientUuid: item.clientUuid,
          templateId: item.templateId,
          startedAt: item.startedAt,
          finishedAt: item.finishedAt,
          note: item.note,
          images,
        })
        const body = (res && res.data) || {}
        if (body.code !== 200) throw new Error(body.msg || '记录没传上去')
        uploaded += 1
      } catch (e) {
        keep.push(item)
      }
    }
  } finally {
    writeQueue(keep)
    flushing = false
  }

  return { uploaded, left: keep.length }
}

/** 生成幂等键：离线重传靠它去重，所以用设备+时间拼，不依赖自增 id */
export function makeClientUuid() {
  const now = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return 'insp-' + now + '-' + rand
}
