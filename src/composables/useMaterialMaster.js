import { ref } from 'vue'
import request from '../api/request'

// ===== 物料主数据（模块级单例）=====
// 图片解析用：按识别出的物料名称反查编码，并把单位一并带出。
//
// ⚠️ 前端【不做】任何归一化、不做模糊匹配、不做候选排序 —— 规则只保留后端一份
// （hnd_factory 的 MaterialMatcher）。否则前后端会各自演化出不同的判定，
// 出现「页面上看着匹配上了、后端校验却拒了」这类难查的分歧。

export const materialLookupError = ref('')

function extractError(error, fallback) {
  if (error?.response?.status === 404) {
    return '物料主数据接口不存在，请确认后端已上线 /api/material/*。'
  }
  return error?.response?.data?.msg || error?.message || fallback
}

/**
 * 按物料名称匹配编码。
 *
 * @returns {{ matched: object|null, candidates: object[], failed: boolean }}
 *   matched 仅在「归一化后全等且唯一命中」时非空；查不到或多条命中一律为 null，
 *   由 candidates 供人工选择。failed 表示接口调用本身失败（与「没查到」是两回事，
 *   调用方需要区分，否则会误以为「主数据里就是没有」）。
 */
export async function matchMaterial(name) {
  const keyword = String(name ?? '').trim()
  if (!keyword) {
    return { matched: null, candidates: [], failed: false }
  }

  try {
    const res = await request.get('/api/material/match', { params: { name: keyword } })
    const body = res.data || {}

    // 后端统一返回体是 { code, msg, data, success }
    if (body.success === false || (body.code != null && body.code !== 200)) {
      throw new Error(body.msg || body.message || '物料匹配接口返回异常。')
    }

    const data = body.data || {}
    return {
      matched: data.matched || null,
      candidates: Array.isArray(data.candidates) ? data.candidates : [],
      failed: false,
    }
  } catch (error) {
    materialLookupError.value = extractError(error, '物料匹配失败。')
    return { matched: null, candidates: [], failed: true }
  }
}

/** 人工检索物料（编码单元格的搜索框用） */
export async function searchMaterials(keyword, limit = 20) {
  const text = String(keyword ?? '').trim()
  if (!text) {
    return []
  }

  try {
    const res = await request.get('/api/material/search', { params: { keyword: text, limit } })
    const body = res.data || {}
    if (body.success === false || (body.code != null && body.code !== 200)) {
      throw new Error(body.msg || body.message || '物料检索接口返回异常。')
    }
    return Array.isArray(body.data) ? body.data : []
  } catch (error) {
    materialLookupError.value = extractError(error, '物料检索失败。')
    return []
  }
}

export function useMaterialMaster() {
  return { materialLookupError, matchMaterial, searchMaterials }
}
