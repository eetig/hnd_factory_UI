import { ref } from 'vue'
import request from '../api/request'

// ===== 物料检索（2026-10-16，变更-092）=====
//
// 给采购进度跟踪的「物料名称 / 物料编码」两个输入框用：边打边查、选中后互相带出。
//
// 数据源是**现成的** `/api/stock/list`（物料查询页那个接口）——
// 它本来就是 `material_master`（SAP 主数据）与 `material_stock` 的**双源合并**，
// 而且关键字同时命中 物料编码 / 物料名称 / 规格。
// 所以「按名称搜」和「按编码搜」是同一个接口，不需要为这个页面新增后端接口。
//
// ⚠️ 只读不写：**绝不往 material_master 写**（那是 SAP 物料主数据，见 ADR-0005）。
//
// 形状照抄 `useEquipmentLedger.js` 里那套（储罐液位页的设备检索）：
//   searchMaterials()      —— 只发请求并更新候选，**不弹提示**（下拉是辅助输入，
//                             取不到不该打断填表）；过期响应返回空数组，调用方据此不覆盖新结果。
//   fetchMaterialSuggestions() —— 防抖包装，正是 el-autocomplete 的 fetch-suggestions 形状。
//   cancelMaterialSearch() —— 离开面板时撤销待发的检索。

/** 候选条数上限。够看即可：下拉是用来"点一下带出来"的，不是用来翻页的 */
const SEARCH_LIMIT = 20
/** 打字后等停 250ms 再发（与 useLiveQuery 的防抖同一个值） */
const SEARCH_DEBOUNCE_MS = 250

const materialOptions = ref([])
const materialSearching = ref(false)

let searchSeq = 0
let searchTimer = null

/**
 * 一条候选：`{ code, name, spec, label }`。
 *
 * `name` 可能为空 —— `/api/stock/list` 的注释写明「两边都没有时为 null（不是空串）」。
 * 那时用编码当显示值，绝不显示空白项（点了个空白项等于什么都没选）。
 */
function toOption(row) {
  const code = (row?.materialCode ?? '').toString().trim()
  const name = (row?.materialName ?? '').toString().trim()
  const spec = (row?.spec ?? '').toString().trim()
  return { code, name, spec, label: name || code }
}

/**
 * 立刻检索（返回本次候选；过期响应返回空数组）。
 */
export async function searchMaterials(keyword) {
  const seq = ++searchSeq
  materialSearching.value = true
  try {
    const res = await request.get('/api/stock/list', {
      params: {
        keyword: String(keyword ?? '').trim(),
        // 后端 PageQueryDTO 要求这两个参数必传（缺参 400）：下拉取第 1 页、20 条
        pageNum: 1,
        pageSize: SEARCH_LIMIT,
      },
    })
    if (seq !== searchSeq) {
      return []
    }
    if (res.data?.success === false) {
      throw new Error(res.data.msg || '物料接口返回异常。')
    }
    const list = Array.isArray(res.data?.dataList) ? res.data.dataList : []
    // 没有编码的行对采购登记没意义（登记靠编码），直接滤掉
    const options = list.map(toOption).filter((option) => option.code)
    materialOptions.value = options
    return options
  } catch {
    if (seq === searchSeq) {
      materialOptions.value = []
    }
    return []
  } finally {
    if (seq === searchSeq) {
      materialSearching.value = false
    }
  }
}

/**
 * 防抖检索并交给回调 —— el-autocomplete 的 `fetch-suggestions` 就是这个形状。
 *
 * **空关键字不防抖**：那正是「刚点开下拉、还没打字」的场景，再等 250ms 只会让候选迟一拍。
 */
export function fetchMaterialSuggestions(keyword, callback) {
  clearTimeout(searchTimer)

  if (!String(keyword ?? '').trim()) {
    searchMaterials('').then(callback)
    return
  }

  searchTimer = setTimeout(async () => {
    const options = await searchMaterials(keyword)
    callback(options)
  }, SEARCH_DEBOUNCE_MS)
}

/** 撤销待发的检索（离开面板时用，免得已经不打字了还在打接口） */
export function cancelMaterialSearch() {
  clearTimeout(searchTimer)
}

export function useMaterialLookup() {
  return {
    materialOptions,
    materialSearching,
    searchMaterials,
    fetchMaterialSuggestions,
    cancelMaterialSearch,
  }
}
