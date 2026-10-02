import { ref } from 'vue'
import request from '../api/request'

// ===== 设备台账（静设备）检索（模块级单例）=====
//
// 只服务于一件事：给「容器名称」这类该从台账里挑的输入框提供候选。
// 接口是 GET /api/equipment/search（免登录只读）；电脑端 变更-012 起它**允许空关键字**
// （返回前 limit 条、按名称拼音排序），所以选择弹层一打开就能列出全部候选，不必先打字。
// 与电脑端 `useEquipmentLedger.js` 是同一条业务线，语义保持一致。
//
// ⚠️ 排序在**后端**做（Java 侧 Collator）：库的排序规则对汉字是按码点的，
//    「反 / 前 / 三」按码点排是 三 < 前 < 反，人扫列表时看不出规律。前端原样展示即可。

/** 候选条数上限：直接取接口上限 100 —— 台账现有 91 行，「点开即列出全部」要一次拿完 */
const EQUIPMENT_SEARCH_LIMIT = 100

/** 输入防抖：敲字停下来才发请求，免得每按一键打一次接口（同图片解析页的物料选择）*/
const EQUIPMENT_DEBOUNCE_MS = 300

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
 * 立刻检索。**只发请求并更新候选**，不弹提示 —— 候选是辅助输入，
 * 取不到不该打断填表（同属地下拉「失败只清空」的处理）。
 *
 * @returns {Promise<Array>} 本次候选（过期响应返回空数组，调用方据此别覆盖新结果）
 */
export async function searchEquipment(keyword) {
  const seq = ++searchSeq
  equipmentSearching.value = true

  try {
    const res = await request.get('/api/equipment/search', {
      params: { keyword: String(keyword ?? '').trim(), limit: EQUIPMENT_SEARCH_LIMIT },
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
 * 防抖检索，结果落到 equipmentOptions 里给弹层渲染。
 *
 * <p>**空关键字不防抖**：那正是「刚打开弹层、还没打字」的场景，再等 300ms 只会让候选
 * 迟一拍才出现；有输入时才需要等敲字停下来。顺序由后端保证（按名称拼音）。
 */
export function fetchEquipmentSuggestions(keyword) {
  clearTimeout(searchTimer)

  if (!String(keyword ?? '').trim()) {
    return searchEquipment('')
  }

  return new Promise((resolve) => {
    searchTimer = setTimeout(() => {
      searchEquipment(keyword).then(resolve)
    }, EQUIPMENT_DEBOUNCE_MS)
  })
}

/** 取消待发的检索（关闭弹层 / 组件卸载时用，免得已经不打字了还在打接口）*/
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
