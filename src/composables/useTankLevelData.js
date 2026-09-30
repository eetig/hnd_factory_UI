import { computed, ref } from 'vue'
import request from '../api/request'
import { getToday, getFirstDayOfCurrentYear, pickField } from '../utils/format'

// ===== 月底储罐液位记录（模块级单例）=====
// 数据来自 hnd_factory：GET /api/tank-level/list（库表 tank_level_record，变更-004）。
//
// 默认区间取「本年度」而不是「本月」：记录是按月产生的（每月月底下午 2 点抄录），
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
  // 列表缩略图（契约 2.3 双字段）：缺失时前端回退原图
  thumbnailUrl: ['thumbnailUrl', 'thumbUrl'],
  imageUrl: ['imageUrl', 'image', 'imagePath', 'fileUrl'],
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

/** 列表行归一化：日期截到 yyyy-MM-dd，数值与图片字段统一格式 */
export function normalizeTankLevelRecord(item) {
  if (!item) return null

  const record = Object.fromEntries(
    Object.entries(TANK_LEVEL_FIELD_MAP).map(([key, aliases]) => [key, pickField(item, aliases)]),
  )

  record.id = item.id ?? ''
  record.recordDate = String(record.recordDate ?? '').slice(0, 10)
  record.levelValue = formatMeasure(record.levelValue)
  record.theoreticalWeight = formatMeasure(record.theoreticalWeight)

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

async function fetchTankLevelRecords() {
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
    getTankLevelPageData(1)
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
  }
}
