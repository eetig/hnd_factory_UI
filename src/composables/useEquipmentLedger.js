import { ref } from 'vue'
import request from '../api/request'

// ===== 设备台账（静设备）检索（模块级单例）=====
//
// 只服务于一件事：给「容器名称」这类该从台账里挑的输入框提供候选。
// 接口是变更-005 就落地的 GET /api/equipment/search（免登录只读）；
// 变更-012 起它**允许空关键字**（返回前 limit 条、按名称拼音排序），
// 所以下拉框点开就能直接列出全部候选，不必先打字。

/** 候选条数上限：直接取接口上限 100 —— 台账现有 91 行，「点开即列出全部」要一次拿完 */
const SEARCH_LIMIT = 100

/** 输入防抖：敲字停下来才发请求，免得每按一键打一次接口（同图片解析页的物料选择）*/
const SEARCH_DEBOUNCE_MS = 300

const equipmentOptions = ref([])
const equipmentSearching = ref(false)

/** 请求序号：快速输入时先发的可能后返回，用它丢弃过期响应，否则旧结果会盖掉新结果 */
let searchSeq = 0
let searchTimer = null

/** 台账行 → 候选。name 为空的行没有可选项的意义，调用方会滤掉 */
function toOption(item) {
  return {
    code: item?.equipmentCode || '',
    name: item?.equipmentName || '',
    spec: item?.spec || '',
    workshop: item?.workshop || '',
  }
}

/**
 * 立刻检索。**只发请求并更新候选**，不弹提示 —— 下拉是辅助输入，
 * 取不到不该打断填表（同属地下拉「失败只清空」的处理）。
 *
 * @returns {Promise<Array>} 本次候选（过期响应返回空数组，调用方据此别覆盖新结果）
 */
export async function searchEquipment(keyword) {
  const seq = ++searchSeq
  equipmentSearching.value = true

  try {
    const res = await request.get('/api/equipment/search', {
      params: { keyword: String(keyword ?? '').trim(), limit: SEARCH_LIMIT },
    })
    if (seq !== searchSeq) {
      return []
    }

    const list = Array.isArray(res.data?.data) ? res.data.data : []
    const options = list.map(toOption).filter((option) => option.name)
    equipmentOptions.value = options
    return options
  } catch {
    if (seq === searchSeq) {
      equipmentOptions.value = []
    }
    return []
  } finally {
    if (seq === searchSeq) {
      equipmentSearching.value = false
    }
  }
}

/**
 * 防抖检索，并把结果交给回调 —— el-autocomplete 的 fetch-suggestions 就是这个形状。
 *
 * <p>**空关键字不防抖**：那正是「刚点开下拉、还没打字」的场景，再等 300ms 只会让候选
 * 迟一拍才出现；有输入时才需要等敲字停下来。顺序由后端保证（按名称拼音）。
 *
 * @param {string} keyword
 * @param {(options: Array) => void} callback
 */
export function fetchEquipmentSuggestions(keyword, callback) {
  clearTimeout(searchTimer)

  if (!String(keyword ?? '').trim()) {
    searchEquipment('').then(callback)
    return
  }

  searchTimer = setTimeout(async () => {
    const options = await searchEquipment(keyword)
    callback(options)
  }, SEARCH_DEBOUNCE_MS)
}

/** 取消待发的检索（离开面板时用，免得已经不打字了还在打接口）*/
export function cancelEquipmentSearch() {
  clearTimeout(searchTimer)
}

export function useEquipmentLedger() {
  return {
    equipmentOptions,
    equipmentSearching,
    searchEquipment,
    fetchEquipmentSuggestions,
    cancelEquipmentSearch,
  }
}
