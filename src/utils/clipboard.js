/**
 * 复制到剪贴板（2026-10-22，变更-144）。
 *
 * 使用方要求：点序号复制「物料名称 + 物料编码 + 规格型号」；点那三列各自复制单项。
 *
 * 为什么要手写一个：仓里原先没有复制工具，而两种复制方式各有一处坑 ——
 *   · `navigator.clipboard.writeText` 需要 **安全上下文**（https / localhost）。
 *     内网站点 http://192.168.3.7:9091 不是安全上下文，这个方法直接不存在或抛错；
 *   · `document.execCommand('copy')` 虽已废弃但仍在所有浏览器里能用，且**不需要**
 *     安全上下文 —— 正是内网场景需要的兜底。
 * 所以先试新 API、失败退回老办法，两条都失败才返回 false（由调用方提示"复制失败"）。
 */

/**
 * @param {string} text 要复制的文本（空串也照走，由调用方判断要不要提示）
 * @returns {Promise<boolean>} 是否成功
 */
export async function copyText(text) {
  const value = String(text ?? '')

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // 权限被拒 / 非安全上下文：继续走老办法
    }
  }

  return legacyCopy(value)
}

/**
 * 老的 execCommand 兜底：塞一个离屏 textarea、选中、复制、立刻移除。
 *
 * ⚠️ textarea 必须留在文档流里（`position: fixed; opacity: 0` 而不是 `display: none`）——
 * 隐藏元素选不中，execCommand 会静默失败。
 */
export function legacyCopy(value) {
  if (typeof document === 'undefined') return false

  try {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.top = '-9999px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

/**
 * 单元格点击要点什么：序号复制三样，其它三列各复制自己（2026-10-22 使用方确认）。
 *
 * 三样用 **Tab 分隔一行** —— 直接粘进 Excel 就是三列（这是使用方选的形式）。
 */
export const COPY_COLUMN_KEYS = ['index', 'materialName', 'materialCode', 'spec']

export function isCopyColumn(key) {
  return COPY_COLUMN_KEYS.includes(key)
}

/**
 * 生成要复制的文本。
 *
 * @param {object} row 行数据
 * @param {string} key 列 key
 * @returns {{ text: string, label: string, empty: boolean }}
 */
export function buildCopyText(row, key) {
  const name = String(row?.materialName ?? '').trim()
  const code = String(row?.materialCode ?? '').trim()
  const spec = String(row?.spec ?? '').trim()

  if (key === 'index') {
    const text = [name, code, spec].join('\t')
    return { text, label: '物料名称 / 编码 / 规格', empty: !name && !code && !spec }
  }
  if (key === 'materialName') return { text: name, label: '物料名称', empty: !name }
  if (key === 'materialCode') return { text: code, label: '物料编码', empty: !code }
  if (key === 'spec') return { text: spec, label: '规格型号', empty: !spec }

  return { text: '', label: '', empty: true }
}
