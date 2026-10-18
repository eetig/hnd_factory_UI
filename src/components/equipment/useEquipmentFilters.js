import { ref } from 'vue'

/**
 * 设备台账的筛选状态（2026-10-18，变更-118）。
 *
 * ## 哪些筛选走服务端、哪些只能是前端
 *
 * 后端 `/api/equipment/ledger/list` 只认三个参数：`pageNum` / `pageSize` / `keyword`，
 * 外加一个 `onlyEnabled` 布尔。**没有** `containerType`，也没有"只看停用"。
 *
 * 而本轮的硬约束是「不改接口契约」，所以：
 *
 *   · 关键字        → 服务端（分页正确）
 *   · 只看启用      → 服务端（`onlyEnabled=true`，分页正确）
 *   · 只看停用      → **前端过滤当前页**（服务端没有这个开关）
 *   · 容器类型      → **前端过滤当前页**
 *
 * ⚠️ 两个前端筛选都是「只过滤当前这一页」，翻页就换了样本。
 * 这不是偷懒 —— 数据量现在只有一百来行，一眼能看完；**哪天台账涨到几千行，
 * 这两个筛选必须挪到后端**，否则"筛出来的条数"会和分页器上的总数打架。
 * 界面上也照实说了（见 FilterBar 的提示文案），不做无声的假象。
 */
export const containerFilter = ref('') // '' = 全部；否则是容器类型值（1/2/3）
export const statusScope = ref('all') // 'all' | 'on' | 'off'

/** 有没有启用任何"只作用于当前页"的筛选（用来在计数处提示口径） */
export function hasClientFilter() {
  return statusScope.value === 'off' || containerFilter.value !== ''
}

/**
 * 一行是否通过**前端**筛选。
 *
 * 「只看启用」不在里面：那条走服务端 `onlyEnabled`，前端再滤一次会让
 * 两种情况下的判定依据分裂（服务端已筛过的结果被本函数二次判断）。
 */
export function matchesClientFilters(row) {
  if (statusScope.value === 'off' && row.enabled === 1) return false
  if (containerFilter.value !== '') {
    if (String(row.containerType ?? '') !== String(containerFilter.value)) return false
  }
  return true
}

/** 只给测试用：把状态复位，避免用例之间互相污染 */
export function resetEquipmentFilters() {
  containerFilter.value = ''
  statusScope.value = 'all'
}
