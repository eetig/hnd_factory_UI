import { computed, ref } from 'vue'
import request from '../api/request'
import { getToday, getFirstDayOfCurrentYear, pickField } from '../utils/format'
import { normalizeImageList } from '../utils/image'

// ===== 月底储罐液位记录（模块级单例）=====
// 数据来自 hnd_factory：GET /api/tank-level/list（库表 tank_level_record，变更-004）。
//
// 默认区间取「本年度」而不是「本月」：记录是按月产生的（每月月底下午 3 点抄录），
// 若默认本月，一个月里绝大多数时间打开都是空表，用户会以为功能坏了。
const tankLevelRecords = ref([])
const tankLevelTableData = ref([])
const tankLevelPageNum = ref(1)
const tankLevelPageSize = ref(10)
const tankLevelTotal = ref(0)
const tankLevelLoading = ref(false)
const tankLevelError = ref('')
// 是否已成功取过一次：Tab 是 v-show 常驻的，不记住这一点就会每次切换都打一次接口
const tankLevelLoaded = ref(false)
const tankLevelStartDate = ref(getFirstDayOfCurrentYear())
const tankLevelEndDate = ref(getToday())
const tankLevelLocation = ref('')
const tankLevelCategory = ref('')
const tankLevelKeyword = ref('')
const tankLevelLocations = ref([])

/** 所属（产品/原料）：Excel 表头里就只有这两类，属固定字典，不做成接口 */
export const TANK_LEVEL_CATEGORIES = ['产品', '原料']

/**
 * 属地（罐组）候选：录入时给的下拉项。
 *
 * <p>与查询区那个属地下拉**不是一回事**：查询区取的是「库里实际出现过的值」
 * （用于筛已有数据），这里是「厂里已知的罐组」固定字典，两者用途不同，不必合并。
 * 与 {@link TANK_LEVEL_CATEGORIES} 同一个理由不做成接口 —— 就这几个罐组，
 * 为一个下拉单开接口不划算；界面上是「可选可填」，将来加了新罐组不必改代码也能录进去。
 */
export const TANK_LEVEL_LOCATIONS = ['1#', '2#', '4#', '1#罐组', '2#罐组']

// 字段别名容错（后端字段名有出入时自动适配，与入库/领料两处的做法一致）
const TANK_LEVEL_FIELD_MAP = {
  recordDate: ['recordDate', 'recordTime', 'date'],
  location: ['location', 'area', 'territory', 'workArea'],
  category: ['category', 'belongType', 'materialCategory'],
  materialCode: ['materialCode', 'materialNo'],
  materialName: ['materialName', 'materialDesc'],
  tankName: ['tankName', 'containerName', 'tankNo'],
  // 容器编号（设备位号）：与记录日期一起构成台账唯一键（uk_date_tank），单列一栏展示
  tankCode: ['tankCode', 'containerCode', 'vesselCode', 'equipmentCode'],
  levelValue: ['levelValue', 'liquidLevel', 'level'],
  theoreticalWeight: ['theoreticalWeight', 'theoryWeight', 'theoreticalQty'],
  // 图据（可多张，变更-011）：元素是 { imageId, url, thumbnailUrl }，
  // 由 normalizeImageList 统一成前端内部结构（契约 2.3 的图片归一化）
  images: ['images', 'imageList'],
}

/**
 * 数值展示：空值一律显示空字符串（不要把 null 印成 "null"），
 * 数字去掉浮点尾巴（1500.0000 → 1500），非数字原样返回交人看。
 */
export function formatMeasure(value) {
  if (value === null || value === undefined || value === '') return ''

  const num = Number(value)
  if (!Number.isFinite(num)) return String(value)

  return String(Number(num.toFixed(3)))
}

/** 列表行归一化：日期截到 yyyy-MM-dd，数值与图据统一格式 */
export function normalizeTankLevelRecord(item) {
  if (!item) return null

  const record = Object.fromEntries(
    Object.entries(TANK_LEVEL_FIELD_MAP).map(([key, aliases]) => [key, pickField(item, aliases)]),
  )

  record.id = item.id ?? ''
  record.recordDate = String(record.recordDate ?? '').slice(0, 10)
  record.levelValue = formatMeasure(record.levelValue)
  record.theoreticalWeight = formatMeasure(record.theoreticalWeight)
  // 一定是数组（可能为空）：列表要读 images[0] 与 images.length，
  // 留成 undefined 的话每处都得再判一次
  record.images = normalizeImageList(record.images)

  return record
}

/** 组装查询参数：空白条件不传（后端把「未传」当作不限制） */
export function buildTankLevelQuery({ startDate, endDate, location, category, keyword } = {}) {
  const params = {}

  if (startDate) params.startDate = startDate
  if (endDate) params.endDate = endDate
  if (location) params.location = location
  if (category) params.category = category

  const trimmedKeyword = String(keyword ?? '').trim()
  if (trimmedKeyword) params.keyword = trimmedKeyword

  return params
}

/**
 * 列表行 → 编辑草稿（行内编辑按这个结构存正在改的值）。
 *
 * <p>数值列沿用列表里的**展示字符串**直接喂输入框：`normalizeTankLevelRecord` 已经把
 * `1250.0000` 规整成 `1250`，再转一次数字、等 input 回写成字符串，等于白转两趟。
 */
export function buildTankLevelDraft(record) {
  return {
    id: record?.id ?? null,
    recordDate: record?.recordDate ?? '',
    location: record?.location ?? '',
    category: record?.category ?? '',
    materialCode: record?.materialCode ?? '',
    materialName: record?.materialName ?? '',
    tankName: record?.tankName ?? '',
    tankCode: record?.tankCode ?? '',
    levelValue: record?.levelValue ?? '',
    theoreticalWeight: record?.theoreticalWeight ?? '',
  }
}

/**
 * 草稿 → 提交给后端的 payload。
 *
 * <p>空串一律转 null：这些列在库里都可空，送空串等于「填了一个空值」，
 * 与「没填」在语义上是两回事 —— 后端 BigDecimal 收到空串也只会解析失败。
 *
 * <p>`id` 保持 null 表示新增（后端按 id 有无分流的规则见 TankLevelSaveDTO）。
 */
export function buildTankLevelSavePayload(draft) {
  const text = (value) => {
    const trimmed = String(value ?? '').trim()
    return trimmed === '' ? null : trimmed
  }

  // id 单独归一化：`??` 只挡 null / undefined，空串会漏过去，
  // 而空串到后端会被当成「编辑一条不存在的记录」而不是「新增」
  const rawId = draft?.id
  const id = rawId === undefined || rawId === null || rawId === '' ? null : rawId

  return {
    id,
    recordDate: text(draft?.recordDate),
    location: text(draft?.location),
    category: text(draft?.category),
    materialCode: text(draft?.materialCode),
    materialName: text(draft?.materialName),
    tankName: text(draft?.tankName),
    tankCode: text(draft?.tankCode),
    levelValue: text(draft?.levelValue),
    theoreticalWeight: text(draft?.theoreticalWeight),
  }
}

// 属地下拉选项：以库中实际值为准，并把「当前已选但不在选项里」的值补进去，
// 否则重新取选项后下拉会显示成空值，用户看不出自己筛了什么
const tankLevelLocationOptions = computed(() => {
  const options = [...tankLevelLocations.value]

  if (tankLevelLocation.value && !options.includes(tankLevelLocation.value)) {
    options.unshift(tankLevelLocation.value)
  }

  return options
})

function getTankLevelPageData(page = tankLevelPageNum.value) {
  tankLevelPageNum.value = page
  const startIndex = (tankLevelPageNum.value - 1) * tankLevelPageSize.value
  tankLevelTableData.value = tankLevelRecords.value.slice(
    startIndex,
    startIndex + tankLevelPageSize.value,
  )
}

async function fetchTankLevelRecords(options) {
  // 模板里 @click / @change 直接绑了这个函数，会把事件对象当第一个参数传进来 ——
  // 所以只有显式传 { keepPage: true } 才保持当前页，传进来别的东西一律当没传
  const keepPage = options?.keepPage === true

  tankLevelLoading.value = true
  tankLevelError.value = ''

  try {
    const res = await request.get('/api/tank-level/list', {
      params: buildTankLevelQuery({
        startDate: tankLevelStartDate.value,
        endDate: tankLevelEndDate.value,
        location: tankLevelLocation.value,
        category: tankLevelCategory.value,
        keyword: tankLevelKeyword.value,
      }),
    })

    if (res.data?.success === false) {
      throw new Error(res.data.msg || '月底储罐液位接口返回异常，请稍后重试。')
    }

    const dataList = Array.isArray(res.data?.dataList) ? res.data.dataList : []
    tankLevelRecords.value = dataList.map(normalizeTankLevelRecord).filter(Boolean)
    tankLevelTotal.value = tankLevelRecords.value.length
    tankLevelLoaded.value = true

    if (keepPage) {
      // 保存/删除后停在当前页，用户不会因为改了一行就被弹回第 1 页。
      // 但页码要防越界：删掉某页最后一条后当前页可能已超出总页数，
      // 那样表格空着、分页器却停在第 5 页，看着像数据丢了
      const maxPage = Math.max(1, Math.ceil(tankLevelTotal.value / tankLevelPageSize.value))
      getTankLevelPageData(Math.min(tankLevelPageNum.value, maxPage))
    } else {
      getTankLevelPageData(1)
    }
  } catch (error) {
    tankLevelRecords.value = []
    tankLevelTableData.value = []
    tankLevelTotal.value = 0
    // 失败不置 loaded：离开再回来会重试一次，比停在一张空表上好
    tankLevelLoaded.value = false

    if (error?.response?.status === 404) {
      tankLevelError.value = '月底储罐液位接口不存在，请确认后端服务已实现该接口。'
    } else {
      tankLevelError.value =
        error?.response?.data?.msg || error?.message || '月底储罐液位记录加载失败，请稍后重试。'
    }
  } finally {
    tankLevelLoading.value = false
  }
}

/** 属地下拉选项：取不到不影响主表（日期/关键字仍可查），所以失败只清空、不弹错误 */
async function fetchTankLevelLocations() {
  try {
    const res = await request.get('/api/tank-level/locations')
    const list = Array.isArray(res.data?.data) ? res.data.data : []
    tankLevelLocations.value = list.map((value) => String(value ?? '').trim()).filter(Boolean)
  } catch {
    tankLevelLocations.value = []
  }
}

/** 首次进入 Tab 时才请求（含属地下拉选项），已取过就不重复打接口 */
function ensureTankLevelLoaded() {
  if (tankLevelLoaded.value || tankLevelLoading.value) return

  fetchTankLevelLocations()
  fetchTankLevelRecords()
}

function resetTankLevelFilters() {
  tankLevelStartDate.value = getFirstDayOfCurrentYear()
  tankLevelEndDate.value = getToday()
  tankLevelLocation.value = ''
  tankLevelCategory.value = ''
  tankLevelKeyword.value = ''

  return fetchTankLevelRecords()
}

// ===== 写操作（需权限，仅管理员）=====
//
// 三个约定，改这里之前先看：
//   1. 后端业务失败也是 HTTP 200 + `success:false`（README 约定 1），所以每个写方法
//      都要自己判一次 `success`，只看状态码会把「保存失败」当成功弹提示；
//   2. 统一**抛带可读消息的 Error**，由调用方 ElMessage 提示 —— 本文件不引 UI 库，
//      与 useOrderImages.js 那种「composable 内部直接弹提示」的写法不同；
//   3. 写成功后**重新拉全量**而不是就地改内存里那一行：列表是前端本地分页 + 后端按
//      (日期, 属地, 编号) 排序，就地改会让「序号」和分页位置与库里对不上。
//      带 keepPage 是为了不把用户从正在看的那一页弹走。

/** 取后端给的业务错误消息；拿不到就用兜底文案 */
function toWriteError(error, fallback) {
  return new Error(error?.response?.data?.msg || error?.message || fallback)
}

/**
 * 新增（draft.id 为空）或编辑一条记录。
 *
 * @returns 保存后的记录（含图据双字段），供调用方就地更新或做后续提示
 */
async function saveTankLevelRecord(draft) {
  let saved
  try {
    const res = await request.post('/api/tank-level/save', buildTankLevelSavePayload(draft))
    if (res.data?.success === false) {
      throw new Error(res.data?.msg || '保存失败，请稍后重试。')
    }
    saved = res.data?.data ?? null
  } catch (error) {
    throw toWriteError(error, '保存失败，请稍后重试。')
  }

  // 刷新放在 try 之外：保存已经成功了，这里失败不该被报成「保存失败」。
  // fetchTankLevelRecords 自己吞错误并落到 tankLevelError，面板会给出提示
  await fetchTankLevelRecords({ keepPage: true })
  return saved
}

async function deleteTankLevelRecord(id) {
  try {
    const res = await request.delete('/api/tank-level/delete', { params: { id } })
    if (res.data?.success === false) {
      throw new Error(res.data?.msg || '删除失败，请稍后重试。')
    }
  } catch (error) {
    throw toWriteError(error, '删除失败，请稍后重试。')
  }
  await fetchTankLevelRecords({ keepPage: true })
}

export function useTankLevelData() {
  return {
    tankLevelRecords,
    tankLevelTableData,
    tankLevelPageNum,
    tankLevelPageSize,
    tankLevelTotal,
    tankLevelLoading,
    tankLevelError,
    tankLevelStartDate,
    tankLevelEndDate,
    tankLevelLocation,
    tankLevelCategory,
    tankLevelKeyword,
    tankLevelLocations,
    tankLevelLocationOptions,
    getTankLevelPageData,
    fetchTankLevelRecords,
    fetchTankLevelLocations,
    ensureTankLevelLoaded,
    resetTankLevelFilters,
    saveTankLevelRecord,
    deleteTankLevelRecord,
  }
}
