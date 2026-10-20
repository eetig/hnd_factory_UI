<script setup>
import { computed, onUnmounted, ref } from 'vue'
import { ElDatePicker, ElDialog, ElImage, ElMessageBox } from 'element-plus'
import request from '../api/request'
import { formatFileSize } from '../utils/format'
import { STATUS_TEXT, STATUS_TONE } from '../constants/statusTones'
import { matchMaterial, materialLookupError, searchMaterials } from '../composables/useMaterialMaster'
import { useLiveQuery } from '../composables/useLiveQuery'
import {
  BILL_TYPE_INBOUND,
  BILL_TYPE_PICK,
  confirmDocument,
  documentRowsToTableRows,
  fetchDocumentDetail,
  mergeRowsByMaterialCode,
  parseQty,
} from '../composables/useOcrConfirm'

/**
 * 确认入库**成功且有实际写入**后通知调用方。
 *
 * ⚠️ 这个事件此前是**死绑定**：本文件全文没有 `defineEmits` / `emit`，而当时的
 * 调用方（拆分前的 WorkOrderList.vue）一直挂着 `@confirmed` —— 表现与手机端修过的
 * 那个坑完全一样（「入库成功了、领料/入库汇总却不刷新」）。变更-047 两套前端同批，
 * 一并补上。
 *
 * 2026-10 路由化改造之后，本页是独立路由（views/maintain/ImageParseView.vue），
 * 事件仍然照发但**没有订阅者了** —— 列表页改为「进页即取数」，不再需要一条
 * 「数据脏了」的通知链（见那个包装层文件的头注）。
 */
const emit = defineEmits(['confirmed'])

// 一次最多上传的张数（总数上限，不是单次选择上限）
const MAX_COUNT = 5

// 与 myocr 的 ocr.max-image-bytes 默认值保持一致，避免选完才在服务端被拒
const MAX_SIZE = 10 * 1024 * 1024

// 只收 PNG / JPG —— 腾讯云 ExtractDocMulti 本身只支持 PNG/JPG/JPEG（不支持 WEBP/BMP），
// 而落库时单据图要存入 file-service，它同样只接受 jpg/png。
// 收进来却在识别或存图那一步失败，不如一开始就不让选。
const ACCEPT = 'image/png,image/jpeg'

// images[].status：idle 未提交 | loading 识别中 | success 成功 | error 失败
const images = ref([])
const message = ref('')
const dragActive = ref(false)
const submitting = ref(false)
const fileInputRef = ref(null)

let nextId = 1

const isFull = computed(() => images.value.length >= MAX_COUNT)
const remaining = computed(() => MAX_COUNT - images.value.length)
const submitted = computed(() => images.value.filter((image) => image.status !== 'idle'))
const successCount = computed(() => images.value.filter((i) => i.status === 'success').length)
const errorCount = computed(() => images.value.filter((i) => i.status === 'error').length)

const dropZoneClass = computed(() => {
  if (isFull.value) return 'border-line bg-region cursor-not-allowed'
  if (dragActive.value) return 'border-brand bg-brand-50'
  return 'border-slate-300 hover:border-brand cursor-pointer'
})

function openFilePicker() {
  if (isFull.value) return
  fileInputRef.value?.click()
}

// 部分来源（如从某些系统拖拽、相机导出）不带 MIME，退回按扩展名判断
function isImageFile(file) {
  return /^image\//.test(file.type || '') || /\.(png|jpe?g)$/i.test(file.name || '')
}

function handleDrop(event) {
  dragActive.value = false
  if (isFull.value) return
  addFiles(Array.from(event.dataTransfer?.files || []))
}

function handleFileInputChange(event) {
  const files = Array.from(event.target.files || [])
  // 清空，否则连续选同一个文件不会再触发 change
  event.target.value = ''
  addFiles(files)
}

function addFiles(files) {
  if (!files.length) return
  message.value = ''

  let notImage = 0
  let oversized = 0
  const accepted = []

  for (const file of files) {
    if (!isImageFile(file)) {
      notImage += 1
    } else if (file.size > MAX_SIZE) {
      oversized += 1
    } else {
      accepted.push(file)
    }
  }

  const room = remaining.value
  const overflow = Math.max(0, accepted.length - room)
  const added = accepted.slice(0, room)

  for (const file of added) {
    images.value.push({
      id: nextId,
      file,
      // 预览用 objectURL：必须在移除/卸载时 revoke，否则整页生命周期内持续占用内存
      url: URL.createObjectURL(file),
      name: file.name,
      size: file.size,
      status: 'idle',
      result: null,
      table: null,
      // 'ocr' 显示识别结果待入库 | 'edit' 已「载入编辑」库中单据（变更-047）
      mode: 'ocr',
      // 单据号核对：null 未核对 | 'checking' 核对中 | detail 结果对象 | { error }（变更-047）
      docCheck: null,
      // 核对请求序号与防抖计时器：单据号改得快时丢弃过期响应（变更-047）
      checkToken: 0,
      checkTimer: null,
      // 「载入编辑」时库中行数，保存时作为 expectedRowCount 带回（并发校验，变更-047）
      expectedRowCount: null,
      // 确认入库状态：null | { status: 'submitting'|'done'|'error'|'skipped', message }
      confirm: null,
      error: '',
    })
    nextId += 1
  }

  // 把「为什么有的没进来」一次说清，避免用户反复试
  const problems = []
  if (notImage) problems.push(`${notImage} 个文件不是图片`)
  if (oversized) problems.push(`${oversized} 张超过 ${MAX_SIZE / 1024 / 1024}MB`)
  if (overflow) problems.push(`${overflow} 张超出 ${MAX_COUNT} 张上限`)

  if (problems.length) {
    message.value = added.length
      ? `${problems.join('；')}，已添加 ${added.length} 张。`
      : `${problems.join('；')}，未添加任何图片。`
  } else if (!added.length) {
    message.value = `最多只能上传 ${MAX_COUNT} 张，请先移除后再添加。`
  }
}

function removeImage(id) {
  const index = images.value.findIndex((image) => image.id === id)
  if (index === -1) return

  URL.revokeObjectURL(images.value[index].url)
  images.value.splice(index, 1)
  message.value = ''
}

function clearAll() {
  images.value.forEach((image) => URL.revokeObjectURL(image.url))
  images.value = []
  message.value = ''
}

// ------------------------------------------------------------------
// 提交识别
// ------------------------------------------------------------------

async function recognizeOne(image) {
  const formData = new FormData()
  formData.append('file', image.file)
  formData.append('fileName', image.name)

  const res = await request.post('/api/ocr/recognize', formData)
  const body = res.data || {}

  // myocr 的业务错误是 HTTP 200 + code≠200（异常处理器未设响应状态），
  // axios 不会 reject，必须自己判 code，否则失败会被当成成功
  if (body.code !== 200) {
    throw new Error(body.message || '识别失败')
  }
  return body.data || {}
}

function toErrorText(error) {
  if (error?.response) {
    const body = error.response.data || {}
    return body.message || body.msg || `识别服务返回 ${error.response.status}`
  }
  if (error?.code === 'ERR_NETWORK') {
    return '无法连接识别服务，请确认 myocr 已启动（默认 8085）'
  }
  return error?.message || '识别失败'
}

async function submit() {
  if (!images.value.length || submitting.value) return

  submitting.value = true
  message.value = ''

  images.value.forEach((image) => {
    image.status = 'loading'
    image.result = null
    image.table = null
    image.error = ''
    // 重识别 = 重来一遍：编辑态、核对结果、上次的入库结果全部作废（变更-047），
    // 也把在途的单据号核对作废（checkToken +1），免得旧响应落到新识别结果上
    image.mode = 'ocr'
    image.expectedRowCount = null
    image.docCheck = null
    image.confirm = null
    clearTimeout(image.checkTimer)
    image.checkToken = (image.checkToken || 0) + 1
  })

  // 并发发起：单张约 1.5~4.5s，串行 5 张会逼近 20s，用户会以为卡死
  await Promise.all(
    images.value.map(async (image) => {
      try {
        const result = await recognizeOne(image)
        image.result = result
        image.table = buildTable(result)
        image.status = 'success'
      } catch (error) {
        image.error = toErrorText(error)
        image.status = 'error'
      }
    }),
  )

  // 识别完成后再补物料编码。与识别分开：补码失败不应把「识别成功」标成失败
  await Promise.all(
    images.value
      .filter((image) => image.status === 'success')
      .map((image) => enrichMaterials(image)),
  )

  // 识别出单据号的成功卡片立刻核对一次库中是否已有该单据（变更-047）：
  // 存在 → 卡片横幅给出「载入编辑 / 整单跳过」；不存在 → 直接可入库。
  // 不 await：核对是旁路，卡片先以「核对中」渲染，结果回来自行更新。
  //
  // ⚠️ 这一段不能省（第一版漏了）：确认入库的预检是 fail-closed 的 —— 没核对过
  // 一律不放行，而「重试」按钮只在核对**失败**的分支里渲染。少了这一次自动核对，
  // 刚识别出来的卡片会停在「尚未核对该单据号」上，且没有任何可点的出路，
  // 只有去改一次单据号（change）才解得开。
  images.value
    .filter((image) => image.status === 'success')
    .forEach((image) => {
      if (String(image.table?.doc.documentNo || '').trim()) {
        checkDocument(image)
      }
    })

  submitting.value = false
}

// ------------------------------------------------------------------
// 物料主数据：按名称补编码与单位
// ------------------------------------------------------------------

/**
 * 逐行按物料名称反查编码。
 *
 * <p>只在后端返回<b>唯一严格命中</b>时才填。匹配规则全在后端
 * （hnd_factory 的 MaterialMatcher），前端不另做一套 —— 否则前后端会各自演化，
 * 出现「页面填上了、后端校验却拒了」这类难查的分歧。
 *
 * <p>查不到就留空，这是既定策略：纸质单的物料编码列本就是空白的，
 * 随便猜一个「看起来像」的编码比留空危险得多。
 */
async function enrichMaterials(image) {
  const rows = image.table?.rows || []
  await Promise.all(
    rows.map(async (row) => {
      row.candidates = []
      if (!row.materialName) {
        return
      }
      const { matched, candidates, failed } = await matchMaterial(row.materialName)
      if (failed) {
        // 失败与「主数据里没有」是两回事，不能混为一谈（错误经 materialLookupError 统一提示）
        return
      }
      row.candidates = candidates
      if (matched) {
        row.materialCode = matched.code
        row.unit = matched.unit || ''
      }
    }),
  )
}

/** 人工改正名称后重查一次 —— 编码应跟着补上 */
async function handleNameChange(row, image) {
  // 数据改了，上一次的入库结果就不再代表当前内容，先清掉免得误导
  clearConfirm(image)

  if (!row.materialName) {
    return
  }
  const { matched, candidates, failed } = await matchMaterial(row.materialName)
  if (failed) {
    return
  }
  row.candidates = candidates
  if (matched) {
    row.materialCode = matched.code
    row.unit = matched.unit || ''
  }
  // 未唯一命中时不动已有编码：那可能是人工刚从搜索里选定的，不该被清掉。
  // 编码不可手填，所以这里「保留」不会有手打错码的风险。
}

// ------------------------------------------------------------------
// 物料候选选择
// ------------------------------------------------------------------

const pickerVisible = ref(false)
const pickerRow = ref(null)
/** 候选所属的卡片：选中后要清掉该卡上一次的入库结果 */
const pickerImage = ref(null)
const pickerKeyword = ref('')
const pickerResults = ref([])
const pickerLoading = ref(false)

/**
 * 请求序号：快速输入时先发的请求可能后返回，用它丢弃过期响应，否则旧结果会盖掉新结果。
 *
 * ⚠️ 这一层**必须贴着请求写**（只有这里知道谁先回来），所以留在本文件；「什么时候发」
 * 那半截已收进公共的 `useLiveQuery`（变更-060）：原先这里是自己手写的
 * `setTimeout` + 300ms 静默期，与物料/储罐/台账三处的写法与静默期都不一致 ——
 * 同一件事四份实现，必然漂移。
 */
let pickerSearchSeq = 0

async function runPickerSearch() {
  const seq = ++pickerSearchSeq
  pickerLoading.value = true
  try {
    const results = await searchMaterials(pickerKeyword.value, 30)
    if (seq !== pickerSearchSeq) {
      return
    }
    pickerResults.value = results
  } finally {
    if (seq === pickerSearchSeq) {
      pickerLoading.value = false
    }
  }
}

/*
 * 输入**边打边查**（变更-060）：停 250ms 就发，不用回车。
 *
 * 走公共接线（防抖 + 查询签名去重 + 卸载时撤销）；这里额外获益的是**输入法**：
 * 原先挂的是 `@input`（原生事件在组字期间照样发），选词过程中的拼音串会变成一次查询；
 * 换成 `watch(pickerKeyword)` 之后只在落字时触发 —— 与另外三个查询框统一。
 */
const { flush: flushPickerSearch, cancel: cancelPickerSearch, sync: syncPickerSearch } = useLiveQuery(
  pickerKeyword,
  runPickerSearch,
)

async function openMaterialPicker(row, image) {
  pickerRow.value = row
  pickerImage.value = image
  pickerKeyword.value = row.materialName || ''
  // 先用自动匹配时已取到的候选，打开即有内容；为空再立刻查一次（不必等防抖）
  pickerResults.value = row.candidates?.length ? [...row.candidates] : []
  // ⚠️ 上面那次赋值会触发 watch 排一次防抖：不同步签名的话，250ms 后它会拿
  // /api/material/search 的结果**盖掉刚 seed 的候选**（与"打开即有内容"正相反），
  // 而且多打一次参数相同的请求。sync() 只同步签名、不发请求（变更-066）。
  syncPickerSearch()
  pickerVisible.value = true

  if (!pickerResults.value.length) {
    // 打开就要有内容：走 flush（取消待发的那次 + 立刻查），不等 250ms 防抖
    await flushPickerSearch()
  }
}

function selectMaterial(material) {
  const row = pickerRow.value
  if (row) {
    // 名称与编码一起回填：人是从名称维度找物料的，只填编码会让名称与编码对不上，
    // 落库后两个字段自相矛盾。单位按编码从主数据带出。
    row.materialName = material.name
    row.materialCode = material.code
    row.unit = material.unit || ''
    // 内容变了，上一次的入库结果不再代表当前数据
    clearConfirm(pickerImage.value)
  }
  pickerVisible.value = false
  pickerRow.value = null
  pickerImage.value = null
}

function closeMaterialPicker() {
  // 取消待发的防抖请求，避免弹窗已关还在打接口
  cancelPickerSearch()
  pickerVisible.value = false
  pickerRow.value = null
}

// ------------------------------------------------------------------
// 展示辅助
// ------------------------------------------------------------------

function text(value) {
  return value === null || value === undefined || value === '' ? '' : String(value)
}

function fieldText(field) {
  return text(field?.value)
}

/**
 * 单据类型 → 展示口径。
 *
 * <p>按关键词匹配而非精确相等：实测识别结果不稳定（同一类单据会出现
 * 「物资领料单」「原材料领料单」等变体），精确匹配会漏判。
 */
function resolveDocKind(documentType) {
  const type = fieldText(documentType)
  if (type.includes('领料')) return 'pick'
  if (type.includes('入库')) return 'inbound'
  return 'unknown'
}

// 各口径的列定义，对齐列表页的领料汇总 / 入库汇总；
// 差异只有时间与数量两列的标题，以及未知类型退化为通用列。
//
// 变更-047 起：**单据号不再是列**（它是单据级的，只该在单据信息区有一份，
// 改一处全表同步；逐行渲染会让人以为「每行各有一个单号」），
// **日期从单据级下沉到每一行**（D4：日期是行身份的一部分）——
// 于是「序号」后面紧跟「日期」，与手机端同一个顺序。
const PICK_COLUMNS = [
  { key: 'index', label: '序号', align: 'center' },
  { key: 'date', label: '领料时间', align: 'center' },
  { key: 'materialName', label: '物料名称' },
  { key: 'materialCode', label: '物料编码' },
  { key: 'quantity', label: '领料数量', align: 'right' },
  { key: 'unit', label: '单位', align: 'center' },
  { key: 'image', label: '线下单据', align: 'center' },
  { key: 'actions', label: '操作', align: 'center' },
]

const INBOUND_COLUMNS = [
  { key: 'index', label: '序号', align: 'center' },
  { key: 'date', label: '入库时间', align: 'center' },
  { key: 'materialName', label: '物料名称' },
  { key: 'materialCode', label: '物料编码' },
  { key: 'quantity', label: '入库数量', align: 'right' },
  { key: 'unit', label: '单位', align: 'center' },
  { key: 'image', label: '线下单据', align: 'center' },
  { key: 'actions', label: '操作', align: 'center' },
]

const UNKNOWN_COLUMNS = [
  { key: 'index', label: '序号', align: 'center' },
  { key: 'date', label: '日期', align: 'center' },
  { key: 'materialName', label: '物料名称' },
  { key: 'materialCode', label: '物料编码' },
  { key: 'quantity', label: '数量', align: 'right' },
  { key: 'actions', label: '操作', align: 'center' },
]

const COLUMNS = { pick: PICK_COLUMNS, inbound: INBOUND_COLUMNS, unknown: UNKNOWN_COLUMNS }

/** 单据信息区里「统一设置日期」那一项的标题，跟着单据口径走（与列定义的日期列同名） */
function dateLabel(kind) {
  if (kind === 'pick') return '领料时间'
  if (kind === 'inbound') return '入库时间'
  return '日期'
}

/**
 * 把识别结果摊成表格：单据头字段（单据号）单独一份，行里只有行项目。
 *
 * <p>行项目来自识别结果，所以「一行」= 识别出的一条物料。
 * 单位不识别（见变更-003 字段范围：单位由业务方按物料编码查主数据带出），故留空待人工补。
 *
 * <p>单据号属于整张单据，放在 {@code doc} 里只渲染一份；日期自变更-047 起<b>下沉到每一行</b>
 * —— 它是行身份的一部分（D4），识别到的单据日期只作为每行的初值。单据头那格日期
 * 降级为批量快捷（写入所有行，见 applyBulkDate），当前值存在 {@code bulkDate}。
 *
 * <p>返回的是<b>可编辑副本</b>，{@code image.result} 保留识别原始值不动 ——
 * 人工校准后仍需能对照「模型原本给了什么」。
 */
function buildTable(result) {
  const kind = resolveDocKind(result?.documentType)

  // 识别到的单据日期：每行的日期初值，也是「统一设置日期」的起点
  const docDate = fieldText(result?.docDate)

  const rows = (result?.items || []).map((item) => ({
    ...blankRow(),
    materialName: fieldText(item.materialName),
    // 物料编码【不取识别值】，一律从空开始，等主数据按名称反查填入。
    // 理由：纸质单该列本就空白，模型对空白列会吐占位值或误取相邻的「规格」列
    // （实测出现过 materialCode="不存在"、"2.260813"）。留着它只会让人误以为是真编码。
    // 识别原值仍保留在 image.result 里，需要追溯时看得到。
    quantity: fieldText(item.quantity),
    date: docDate,
  }))

  const table = {
    kind,
    columns: COLUMNS[kind],
    doc: {
      documentNo: fieldText(result?.documentNo),
    },
    // 「统一设置日期」的当前值（只做批量快捷，不是每行的真值）
    bulkDate: docDate,
    rows,
  }
  renumber(table)
  return table
}

// ------------------------------------------------------------------
// 行增删（识别结果需要人工校准行数）
// ------------------------------------------------------------------

/**
 * 行的稳定标识，与「序号」刻意分开。
 *
 * <p>{@code index} 是给人看的行号，删掉中间一行后其余行都要往前挪，所以它会变；
 * 拿它当 {@code :key} 会让 Vue 在重排时复用错组件，表现为输入框内容/焦点串行。
 */
let rowUid = 0

/** 一张空白行。物料编码与单位照旧留空 —— 只能靠名称反查带出，不允许手填 */
function blankRow() {
  return {
    key: ++rowUid,
    index: 0, // 由 renumber 统一编
    // 库中行主键（变更-047）：「载入编辑」带出的行走这里带 id，保存时随 payload 回传，
    // 后端据此保住行身份（D2）；新行恒为 null
    id: null,
    materialName: '',
    materialCode: '',
    quantity: '',
    unit: '',
    // 行日期 yyyy-MM-dd（变更-047）：日期是行身份的一部分（D4），提交时不允许为空
    date: '',
    // 该行的物料候选（由 enrichMaterials 填充），供「查不到时人工选」
    candidates: [],
  }
}

/** 序号对齐数组下标：它是对外展示的行号，删掉中间一行后不能留空洞 */
function renumber(table) {
  table.rows.forEach((row, i) => {
    row.index = i + 1
  })
}

/**
 * 识别漏行时手工补一行。
 *
 * <p>新行为空，因此会立刻让「确认入库」变成不可点（缺物料编码）——
 * 这是预期的：补的行必须填完才能入库。
 */
function addRow(image) {
  clearConfirm(image)
  const row = blankRow()
  // 日期初值取「统一设置日期」那一格（变更-047）：手工补的行多半是识别漏掉的本单行，
  // 日期与本单一致；留空不但多一次点击，还会先被「有 N 行日期为空」拦一道
  row.date = image.table.bulkDate || ''
  image.table.rows.push(row)
  renumber(image.table)
}

/** 识别多出幽灵行 / 重复行时删掉该行 */
function removeRow(image, row) {
  clearConfirm(image)
  const rows = image.table.rows
  const at = rows.indexOf(row)
  if (at >= 0) {
    rows.splice(at, 1)
  }
  renumber(image.table)
}

/** 可编辑单元格：静默时不显边框，悬停/聚焦才提示可改，避免整表看起来像表单控件 */
function inputClass(col) {
  return [
    'w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-slate-900 outline-none',
    'transition placeholder:text-slate-500 hover:border-slate-300 focus:border-brand focus:bg-raised',
      'focus-visible:ring-2 focus-visible:ring-brand-ink/35 focus-visible:ring-inset',
    col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : '',
  ]
}

function alignClass(col) {
  if (col.align === 'right') return 'text-right'
  if (col.align === 'center') return 'text-center'
  return 'text-left'
}

function statusText(image) {
  if (image.status === 'loading') return '识别中…'
  if (image.status === 'success') return '识别成功'
  if (image.status === 'error') return '识别失败'
  return '未提交'
}

function statusClass(image) {
  if (image.status === 'loading') return STATUS_TONE.neutral
  if (image.status === 'success') return STATUS_TONE.success
  if (image.status === 'error') return STATUS_TONE.error
  return STATUS_TONE.neutral
}

// ------------------------------------------------------------------
// 单据号核对与「载入 / 跳过」（变更-047）
//
// 单据号是单据的身份。库中已有同号单据时如果直接入库，等于把老单据当新单据再写一遍
// —— 卡片上必须给出路（D1）：载入编辑 / 整单跳过 / （识别错了就）改单据号重查。
// 识别结果【不】与库中数据合并（D5）：载入编辑后表格里只有库中行，能改能删能加。
// ------------------------------------------------------------------

/** 单据号核对（防抖 300ms —— 逐字改单号时不该每个字符都打一次接口） */
const CHECK_DEBOUNCE_MS = 300

/** 单据口径 → 后端单据大类（与 Excel 导入 / 落库同一套取值） */
function billTypeOf(image) {
  return image.table?.kind === 'inbound' ? BILL_TYPE_INBOUND : BILL_TYPE_PICK
}

/** 查这张卡的单据号在库中是否存在，结果落到 image.docCheck */
async function checkDocument(image) {
  const documentNo = String(image.table?.doc.documentNo || '').trim()
  // 记下「核对的就是这个单据号」：onDocumentNoChange 靠它识别「值没变」的空转
  image.checkedDocNo = documentNo
  if (!documentNo) {
    image.docCheck = null
    return
  }

  // 请求序号守卫：单据号改得快时先发的请求可能后回来，过期响应直接丢
  const token = (image.checkToken || 0) + 1
  image.checkToken = token
  image.docCheck = 'checking'
  try {
    const detail = await fetchDocumentDetail({ billType: billTypeOf(image), documentNo })
    if (token !== image.checkToken) return
    image.docCheck = detail
  } catch (error) {
    if (token !== image.checkToken) return
    image.docCheck = { error: error?.message || '查询失败' }
  }
}

/**
 * 单据号改了：作废在途核对、退出编辑态，防抖后重查（换号 = 换了一张单据）。
 *
 * <p>这里挂的是 `@change`（模板里注明）：电脑端是真 DOM 输入框，`change` 在
 * 「值确实变了 + 失焦」时正常触发 —— 手机端那边因为 uni 的 `<input>` 两端都不发
 * change 才必须改挂 `@blur`（见手机端同文件里的注释），**不是**电脑端也要照抄。
 *
 * <p>守卫：值没变就原地返回。`change` 只在值变时来，但「确认入库」前的自动重查
 * （见 submitConfirm）也会走 checkDocument，两处都不能把「载入编辑」刚拉进来的
 * 库中行踢回识别态、把整单跳过的状态抹掉。
 */
function onDocumentNoChange(image) {
  clearTimeout(image.checkTimer)
  const documentNo = String(image.table?.doc.documentNo || '').trim()
  if (documentNo === (image.checkedDocNo || '')) {
    return
  }

  clearConfirm(image)
  // 退出编辑态要连表格一起还原：只翻 mode 不还原本行的话，横幅已经在说「新单据，
  // 可直接入库」，表格里留着的却还是上一张单据的库中行（连它的行 id 一起）——
  // 两处指的不是一张单据。那些带 id 的行提交上去会被后端按「第X行已不存在」409 拦住
  // （不会写错数据，但对着「新单据」的横幅没法读）。立住这条等式：
  // **mode='ocr' ⟺ 表格是识别结果**。
  // 只还原行，单据头的单据号不动 —— 那是人刚改的值（防「改正误读的号」被识别原值盖回去）；
  // 也只在 edit 时还原 —— 识别态里人工修过的行不能被一次失焦清掉。
  if (image.mode === 'edit' && image.table) {
    image.table.rows = buildTable(image.result).rows
    // 还原出来的行没有物料编码（buildTable 一律留空、等主数据反查），要跟识别完成时
    // 一样再补一遍；不 await —— 补码期间按钮被「缺物料编码」拦住，回来才放行。
    // matchMaterial 自己吞异常，这里不会产生 unhandled rejection。
    enrichMaterials(image)
  }
  image.mode = 'ocr'
  image.expectedRowCount = null
  image.checkToken = (image.checkToken || 0) + 1

  if (!documentNo) {
    image.docCheck = null
    return
  }
  // 防抖这 300ms 里也得摆出「核对中」：docCheck 不能还留着上一个单据号的结论，
  // 否则「改完单号立刻点确认入库」会拿旧结论放行（confirmBlockReason 读的就是它）
  image.docCheck = 'checking'
  image.checkTimer = setTimeout(() => checkDocument(image), CHECK_DEBOUNCE_MS)
}

/** 「载入编辑」：把库中该单据的全部明细填进表格（D1/D5：本次识别结果不合并进来） */
function loadDocument(image) {
  const detail = image.docCheck
  if (!detail?.exists) {
    return
  }
  // blankRow() 补 key / 序号 / 候选等本地字段；documentRowsToTableRows 带出 id 与数据
  const rows = documentRowsToTableRows(detail.rows).map((row) => ({ ...blankRow(), ...row }))
  image.table.rows = rows
  renumber(image.table)
  image.mode = 'edit'
  // 载入时的库中行数：保存时作为 expectedRowCount 带回（严格模式 + 并发校验）
  image.expectedRowCount = detail.rowCount ?? rows.length
  clearConfirm(image)
}

/** 「整单跳过」：本次一个字节都不写（不发请求、不 emit），可撤销（D1） */
function skipDocument(image) {
  clearTimeout(image.checkTimer)
  image.checkToken = (image.checkToken || 0) + 1 // 跳过之后不再需要核对答案
  image.mode = 'ocr'
  image.expectedRowCount = null
  image.confirm = { status: 'skipped', message: '' }
}

/** 撤销跳过：回到待入库状态，顺手重新核对一次单据号 */
function undoSkip(image) {
  image.confirm = null
  checkDocument(image)
}

/** 「统一设置日期」：选中的日期写进所有行（只是批量快捷，逐行仍可各改各的） */
function applyBulkDate(image, date) {
  clearConfirm(image)
  image.table.rows.forEach((row) => {
    row.date = date
  })
}

/** 横幅是否要「醒目态」：单据号已存在且还没选出路（载入编辑 / 整单跳过） */
function isDocCheckAttention(image) {
  return Boolean(image.docCheck?.exists) && image.mode !== 'edit' && image.confirm?.status !== 'skipped'
}

/** 横幅底色：已存在且没选出路 → 琥珀（要人做决定）；已载入编辑 → 绿（已就位）；其余灰 */
function docCheckClass(image) {
  if (isDocCheckAttention(image)) return 'border-amber-200 bg-amber-50'
  if (image.mode === 'edit' && image.docCheck?.exists) return 'border-emerald-200 bg-emerald-50'
  return 'border-line bg-region/40'
}

/** 横幅里库中单据的物料名摘要：前 3 个（供人工核对是不是同一张单） */
function docCheckNames(image) {
  const rows = image.docCheck?.rows || []
  const names = rows.slice(0, 3).map((row) => row.materialName).filter(Boolean)
  if (!names.length) {
    return ''
  }
  return names.join('、') + (rows.length > names.length ? ' 等' : '')
}

/**
 * 横幅缩略图地址：`/thumbs/x.jpg`、`/files/x.jpg` 这类相对路径**原样用**——
 * 开发期由 vite 代理转给 file-service（见 vite.config.js 的 /files、/thumbs），
 * 生产由 Nginx 同源路由，两端都不必加工（与 vesselImageUrl 同口径）。
 */
function docCheckThumb(image) {
  return image.docCheck?.thumbnailUrl || image.docCheck?.imageUrl || ''
}

/** 整单删除的二次确认（变更-047 三重闸门的第一重），返回是否确认 */
async function confirmWholeDelete(count) {
  try {
    await ElMessageBox.confirm(
      count ? `确定删除该单据全部 ${count} 行？删除后不可恢复。` : '确定删除该单据全部明细？删除后不可恢复。',
      '删除整单',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
    )
    return true
  } catch {
    // 取消 / 关闭弹窗（Element Plus 用 reject 表示「没确认」）
    return false
  }
}

// ------------------------------------------------------------------
// 确认入库
// ------------------------------------------------------------------

/** 清掉上一次的入库结果 —— 数据一旦改动，旧结果就不代表当前内容了 */
function clearConfirm(image) {
  if (image) {
    image.confirm = null
  }
}

/**
 * 提交前的本地预检，返回拦截原因（可提交时返回空串）。
 *
 * <p>只是「提前告知」，不是校验规则的二次实现 —— 真正的闸门是后端的
 * `XxxImportUtil.validate`，这里的必填项与它保持一致，好让人在点之前就知道缺什么。
 *
 * <p>变更-047 追加四道闸：① 单据号核对没出结果（核对中 / 失败 / 未核对）不放行 ——
 * fail-closed，宁可让人点「重试」，也不能在「不知道库中有没有」的状态下写库；
 * ② 单据号已存在时必须先选「载入编辑」或「整单跳过」；③ 每行日期非空
 * （日期是行身份的一部分，后端同样整单拒绝）；④ 行内「物料编码 + 日期」不得重复
 * （同一天同一物料只能一行，重复多半是模型把一行拆成了两行，让人自己确认删哪行）。
 */
function confirmBlockReason(image) {
  if (!image.table) {
    return '无解析结果'
  }
  if (image.confirm?.status === 'skipped') {
    return '已整单跳过，本次不写入库'
  }
  if (!String(image.table.doc.documentNo || '').trim()) {
    return '单据号为空，无法入库'
  }
  if (image.mode !== 'edit') {
    if (image.docCheck === 'checking') {
      return '正在核对该单据号，请稍候…'
    }
    if (!image.docCheck) {
      return '尚未核对该单据号，请稍候或点「重试」'
    }
    if (image.docCheck.error) {
      return `单据号核对失败（${image.docCheck.error}），可点「重试」`
    }
    if (image.docCheck.exists) {
      return '单据号已存在：请先选「载入编辑」或「整单跳过」'
    }
  }

  // 行可以删到 0：新识别的单据删到 0 没有意义（拦住）；「载入编辑」删到 0 = 整单删除，
  // 是合法操作（走 submitConfirm 的弹框确认 + allowEmpty）
  if (!image.table.rows.length && image.mode !== 'edit') {
    return '没有可入库的明细行，请至少保留一行'
  }

  const missingDate = image.table.rows.filter((row) => !String(row.date || '').trim())
  if (missingDate.length) {
    return `有 ${missingDate.length} 行日期为空，请先补齐（日期是行身份的一部分）`
  }

  const bad = image.table.rows.filter(
    (row) => !String(row.materialCode || '').trim() || parseQty(row.quantity) === null,
  )
  if (bad.length) {
    return `有 ${bad.length} 行缺物料编码、或数量无法解析，请先补齐`
  }

  const seen = new Map()
  for (const row of image.table.rows) {
    const key = `${String(row.materialCode || '').trim()}\u0001${String(row.date || '').trim()}`
    const at = seen.get(key)
    if (at) {
      return `第${at}行：与第${row.index}行「物料编码 + 日期」重复，同一单据下同物料同日期只能有一行`
    }
    seen.set(key, row.index)
  }
  return ''
}

async function submitConfirm(image) {
  const status = image.confirm?.status
  if (status === 'submitting' || confirmBlockReason(image)) {
    return
  }

  const isEdit = image.mode === 'edit'
  const billType = billTypeOf(image)
  const documentNo = String(image.table.doc.documentNo).trim()
  const { rows: merged, merges } = mergeRowsByMaterialCode(image.table.rows)

  // 「载入编辑」删到 0 行 = 整单删除：先弹二次确认（三重闸门的第一重），
  // 确认后才带 allowEmpty=true 提交；取消则一个字节都不发
  let allowEmpty = false
  if (isEdit && !merged.length) {
    if (!(await confirmWholeDelete(image.expectedRowCount ?? 0))) {
      return
    }
    allowEmpty = true
  }

  image.confirm = { status: 'submitting', message: '' }

  try {
    const data = await confirmDocument({
      billType,
      documentNo,
      // document 模式（变更-047）：行 id 保行身份、行日期是身份的一部分。
      // 不带单据级 date —— 那是 legacy 口径，日期已下沉到行。
      mode: 'document',
      // edit 带 expectedRowCount = 严格模式（并发校验 + 允许删除）；
      // 新识别单据不带 = append（只增改跳，**永不删除**）
      expectedRowCount: isEdit ? image.expectedRowCount ?? undefined : undefined,
      allowEmpty: allowEmpty || undefined,
      rows: merged.map((row) => ({
        id: row.id ?? undefined,
        seqNo: row.seqNo,
        materialName: row.materialName,
        materialCode: row.materialCode,
        qty: String(row.qty),
        unit: row.unit,
        date: row.date,
      })),
      // 单据图随 payload 一起 multipart 提交（后端存进 file_name，汇总列表的
      // 「线下单据」列靠它回溯）。edit 模式也照传：后端惰性取图，没有实际写入时
      // 一张都不会落对象 —— 理由见 useOcrConfirm.js 里 confirmDocument 的说明。
      file: image.file,
    })

    const written = (data.addCount || 0) + (data.updateCount || 0) + (data.deleteCount || 0)
    image.confirm = { status: 'done', message: buildConfirmMessage(data, merges) }
    // 保存完成 = 这张卡回到起点：库中数据已与界面一致，重新核对一次单据号，
    // 横幅随即变成「已存在 → 载入编辑 / 整单跳过」（本次识别的行不再参与）
    image.mode = 'ocr'
    image.expectedRowCount = null
    await checkDocument(image)
    // 落库成功了**且有实际写入**才通知父组件（失败不通知：那会让页面白刷一次；
    // 整单跳过更不算写入）
    if (written > 0) {
      emit('confirmed', { billType, documentNo })
    }
  } catch (error) {
    image.confirm = { status: 'error', message: error?.message || '入库失败' }
    // 409 = 别人动过这张单据（行数变了 / 某行被删了）：本地的 expectedRowCount 已不可信，
    // 退出编辑态并重查，让人看到库中最新数据再决定（后端文案已给出处置指引）
    if (error?.businessCode === 409) {
      image.mode = 'ocr'
      image.expectedRowCount = null
      checkDocument(image)
    }
  }
}

function buildConfirmMessage(data, merges) {
  const parts = [`新增 ${data.addCount ?? 0} 条`, `更新 ${data.updateCount ?? 0} 条`]
  if (data.deleteCount) {
    parts.push(`删除 ${data.deleteCount} 条`)
  }
  if (data.skipCount) {
    parts.push(`跳过 ${data.skipCount} 条（与库中相同，未改动）`)
  }
  if (merges.length) {
    // 合并必须显式报出来：模型有把一行拆成两行的情况，相加后会变成双倍数量，
    // 不报出来人就没机会发现被拆行
    const detail = merges.map((m) => `${m.code} ${m.before} + ${m.add} = ${m.after}`).join('；')
    parts.push(`合并同物料多行（${detail}）`)
  }
  if (data.imageUploadFailed) {
    parts.push('单据图片上传失败，本次未存线下单据图')
  }
  return parts.join('，')
}

function confirmButtonText(image) {
  if (image.confirm?.status === 'submitting') {
    return image.mode === 'edit' ? '保存中…' : '入库中…'
  }
  if (image.confirm?.status === 'skipped') return '已跳过'
  // 成功后仍可再提交：document 模式按行差量，数据没变整行跳过，改动过的走更新，
  // 所以重提是安全的（核对横幅会先把「载入编辑 / 整单跳过」摆出来）
  if (image.confirm?.status === 'done') return '重新入库'
  if (image.mode === 'edit') {
    // 载入编辑删到 0 行 = 整单删除，按钮上直说，让人点之前就知道要发生什么
    return image.table?.rows.length ? '保存更新' : '删除整单'
  }
  return '确认入库'
}

onUnmounted(() => {
  // 选料搜索待发的那次不用在这里清：useLiveQuery 自己注册了 onUnmounted(() => soon.cancel())
  images.value.forEach((image) => {
    clearTimeout(image.checkTimer)
    URL.revokeObjectURL(image.url)
  })
})
</script>

<template>
  <div class="space-y-4">
    <input
      ref="fileInputRef"
      type="file"
      :accept="ACCEPT"
      multiple
      class="hidden"
      @change="handleFileInputChange"
    />

    <section
      class="rounded-card border-2 border-dashed bg-raised p-10 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:ring-offset-2"
      :class="dropZoneClass"
      role="button"
      :tabindex="isFull ? -1 : 0"
      aria-labelledby="ip-drop-title ip-drop-hint"
      @click="openFilePicker"
      @keydown.enter.prevent="openFilePicker"
      @keydown.space.prevent="openFilePicker"
      @dragover.prevent="dragActive = true"
      @dragleave.prevent="dragActive = false"
      @drop.prevent="handleDrop"
    >
      <div class="flex flex-col items-center gap-2">
        <div
          class="mb-1 flex h-12 w-12 items-center justify-center rounded-full"
          :class="isFull ? STATUS_TONE.neutral : STATUS_TONE.info"
        >
          <svg
            class="h-6 w-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </div>

        <p
          id="ip-drop-title"
          class="text-base font-semibold"
          :class="isFull ? 'text-slate-500' : 'text-slate-900'"
        >
          {{ isFull ? `已达上限（${MAX_COUNT} 张）` : '点击选择图片，或将图片拖到此处' }}
        </p>
        <p id="ip-drop-hint" class="text-sm" :class="isFull ? 'text-slate-500' : 'text-slate-600'">
          支持 PNG / JPG，单张不超过 {{ MAX_SIZE / 1024 / 1024 }}MB，最多 {{ MAX_COUNT }} 张
        </p>
      </div>
    </section>

    <p
      v-if="message"
      role="status"
      class="rounded-card border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800"
    >
      {{ message }}
    </p>

    <section v-if="images.length" class="rounded-card border border-line bg-raised shadow-card">
      <div class="flex items-center justify-between border-b border-line px-6 py-4">
        <p class="text-sm text-slate-600">
          已选 <span class="font-semibold text-brand-ink">{{ images.length }}</span> /
          {{ MAX_COUNT }} 张
        </p>
        <button
          type="button"
          class="text-sm text-slate-500 transition hover:text-rose-600 focus-visible:ring-2 focus-visible:ring-brand-ink/35 focus-visible:outline-none disabled:cursor-not-allowed disabled:text-slate-300"
          :disabled="submitting"
          @click="clearAll"
        >
          清空
        </button>
      </div>

      <ul class="grid grid-cols-2 gap-4 p-6 sm:grid-cols-3 lg:grid-cols-5">
        <li
          v-for="image in images"
          :key="image.id"
          class="group relative overflow-hidden rounded-card border border-line"
        >
          <img
            :src="image.url"
            :alt="image.name"
            class="h-32 w-full bg-region object-cover"
            loading="lazy"
            decoding="async"
          />

          <div class="border-t border-line px-2.5 py-2.5">
            <p class="truncate text-xs text-slate-600" :title="image.name">{{ image.name }}</p>
            <p class="text-xs text-slate-500">{{ formatFileSize(image.size) }}</p>
          </div>

          <button
            type="button"
            class="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/60 text-sm text-white opacity-0 transition hover:bg-rose-600 focus:opacity-100 group-hover:opacity-100"
            :aria-label="`移除 ${image.name}`"
            :disabled="submitting"
            @click="removeImage(image.id)"
          >
            ×
          </button>
        </li>
      </ul>
    </section>

    <div class="flex justify-end">
      <button
        type="button"
        class="rounded-full bg-brand px-6 py-3 text-sm font-medium text-on-brand transition hover:bg-brand-hover focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
        :disabled="!images.length || submitting"
        @click="submit"
      >
        {{ submitting ? '识别中…' : '提交' }}
      </button>
    </div>

    <p
      v-if="materialLookupError"
      role="alert"
      class="rounded-card border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800"
    >
      {{ materialLookupError }}（物料编码将全部留空，可手工填写）
    </p>

    <section v-if="submitted.length" class="rounded-card border border-line bg-raised shadow-card">
      <div class="flex items-center justify-between border-b border-line px-6 py-4">
        <p class="text-sm text-slate-600">
          解析结果 · 成功
          <span class="font-semibold text-emerald-700">{{ successCount }}</span>
          <template v-if="errorCount">
            · 失败 <span class="font-semibold text-rose-600">{{ errorCount }}</span>
          </template>
        </p>
      </div>

      <div class="space-y-6 p-6">
        <article
          v-for="image in submitted"
          :key="image.id"
          class="overflow-hidden rounded-card border border-line"
        >
          <header class="flex items-center gap-3 border-b border-line bg-region/60 px-4 py-3">
            <img
              :src="image.url"
              :alt="image.name"
              class="h-10 w-10 shrink-0 rounded-md border border-line object-cover"
            />
            <p class="min-w-0 flex-1 truncate text-sm font-medium text-slate-700" :title="image.name">
              {{ image.name }}
            </p>
            <span
              class="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium"
              :class="statusClass(image)"
            >
              {{ statusText(image) }}
            </span>
          </header>

          <template v-if="image.status === 'success'">
            <!-- 单据信息：整张单据一份。单据号属于单据本身，放这里只有一份、改一处全表同步
                 （改造前它是逐行重复的表格列）；日期自变更-047 起下沉到每一行
                 （日期是行身份的一部分，D4），头部这格降级为批量快捷 -->
            <div
              class="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-region/40 px-4 py-2.5"
            >
              <span class="text-sm text-slate-600">
                单据类型
                <span class="ml-1 font-medium text-slate-900">
                  {{ fieldText(image.result.documentType) || '未识别' }}
                </span>
              </span>

              <span class="flex items-center gap-2 text-sm text-slate-600">
                单据号
                <!-- 这里挂 @change：电脑端是真 DOM 输入框，「值确实变了 + 失焦」时正常触发。
                     手机端那边必须先改挂 @blur —— uni 的 <input> 在两端都不发 change
                     （见 hnd_factory_UI_uni_APP 同文件里的实测说明），两边不是一回事 -->
                <input
                  v-model="image.table.doc.documentNo"
                  type="text"
                  placeholder="—"
                  aria-label="单据号"
                  class="w-40 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-900 outline-none transition hover:border-slate-400 focus:border-brand focus-visible:ring-2 focus-visible:ring-brand-ink/35"
                  @change="onDocumentNoChange(image)"
                />
              </span>

              <span class="flex items-center gap-2 text-sm text-slate-600">
                {{ dateLabel(image.table.kind) }}
                <el-date-picker
                  v-model="image.table.bulkDate"
                  type="date"
                  value-format="YYYY-MM-DD"
                  placeholder="统一设置"
                  :aria-label="`统一设置${dateLabel(image.table.kind)}`"
                  :first-day-of-week="1"
                  style="width: 9.5rem"
                  @change="applyBulkDate(image, $event)"
                />
                <span class="text-xs text-slate-500">选一次写入所有行，逐行仍可单独改</span>
              </span>
            </div>

            <!-- 单据号核对横幅（变更-047）：这张卡的单据号在库中是否已存在。
                 已存在 → 必须二选一：「载入编辑」（把库中行拉进表格改）或
                 「整单跳过」（本次一个字节都不写），不允许直接入库。 -->
            <div
              v-if="image.docCheck"
              class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5 text-sm"
              :class="docCheckClass(image)"
            >
              <template v-if="image.confirm?.status === 'skipped'">
                <span class="text-slate-600">已整单跳过：本次不写库</span>
                <button type="button" class="shrink-0 rounded-full border border-slate-300 px-2.5 py-1 text-xs text-slate-700 transition hover:border-brand hover:bg-brand-50 hover:text-brand-ink" @click="undoSkip(image)">撤销跳过</button>
              </template>

              <template v-else-if="image.docCheck === 'checking'">
                <span class="text-slate-500">正在核对该单据号…</span>
              </template>

              <template v-else-if="image.docCheck.error">
                <span class="text-rose-600">单据号核对失败：{{ image.docCheck.error }}</span>
                <button type="button" class="shrink-0 rounded-full border border-slate-300 px-2.5 py-1 text-xs text-slate-700 transition hover:border-brand hover:bg-brand-50 hover:text-brand-ink" @click="checkDocument(image)">重试</button>
              </template>

              <template v-else-if="image.docCheck.exists">
                <span class="font-medium text-amber-800">
                  单据号已存在：库中 {{ image.docCheck.rowCount }} 行
                  <template v-if="docCheckNames(image)">（{{ docCheckNames(image) }}）</template>
                </span>
                <el-image
                  v-if="docCheckThumb(image)"
                  :src="docCheckThumb(image)"
                  :preview-src-list="[docCheckThumb(image)]"
                  :preview-teleported="true"
                  fit="cover"
                  class="h-8 w-8 shrink-0 rounded-md border border-line"
                  alt="库中单据图"
                />
                <template v-if="image.mode === 'edit'">
                  <span class="text-xs text-slate-600">
                    已载入库中数据：本张图片的识别结果不会合并进来，请直接增删改
                  </span>
                  <button type="button" class="shrink-0 rounded-full border border-slate-300 px-2.5 py-1 text-xs text-slate-700 transition hover:border-brand hover:bg-brand-50 hover:text-brand-ink" @click="skipDocument(image)">
                    整单跳过
                  </button>
                </template>
                <template v-else>
                  <button
                    type="button"
                    class="shrink-0 rounded-full bg-brand px-3 py-1 text-xs font-medium text-on-brand transition hover:bg-brand-hover"
                    @click="loadDocument(image)"
                  >
                    载入编辑
                  </button>
                  <button type="button" class="shrink-0 rounded-full border border-slate-300 px-2.5 py-1 text-xs text-slate-700 transition hover:border-brand hover:bg-brand-50 hover:text-brand-ink" @click="skipDocument(image)">
                    整单跳过
                  </button>
                </template>
              </template>

              <template v-else>
                <span class="text-slate-500">新单据（库中不存在），可直接入库</span>
              </template>
            </div>

            <div class="px-4 pb-4 pt-4">
              <table v-if="image.table?.rows.length" class="w-full max-w-[1400px] border-collapse text-sm">
                <thead>
                  <tr class="bg-region text-slate-600">
                    <th
                      v-for="col in image.table.columns"
                      :key="col.key"
                      scope="col"
                      class="border border-line px-3 py-2.5 font-medium"
                      :class="alignClass(col)"
                    >
                      {{ col.label }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in image.table.rows" :key="row.key">
                    <td
                      v-for="col in image.table.columns"
                      :key="col.key"
                      class="border border-line px-1.5 py-1 align-middle"
                    >
                      <!-- 线下单据：原图缩略图，点开可放大 -->
                      <div v-if="col.key === 'image'" class="flex justify-center">
                        <el-image
                          :src="image.url"
                          :preview-src-list="[image.url]"
                          :preview-teleported="true"
                          fit="cover"
                  alt="线下单据缩略图（点开可看原图）"
                  class="h-8 w-8 cursor-zoom-in rounded-md border border-line"
                        />
                      </div>

                      <!-- 序号：识别顺序，不参与校正 -->
                      <span v-else-if="col.key === 'index'" class="block text-center text-slate-500">
                        {{ row.index }}
                      </span>

                      <!-- 日期（变更-047）：每行独立，是行身份的一部分（D4）。
                           面板默认挂到 body，不会被单元格裁切；翻月 / 翻年由
                           utils/datePickerFlip.js 的全局委托兜住。
                           日期改了清掉上次的入库结果（旧结果不再代表当前内容）。 -->
                      <el-date-picker
                        v-else-if="col.key === 'date'"
                        v-model="row.date"
                        type="date"
                        value-format="YYYY-MM-DD"
                        placeholder="—"
                        :aria-label="col.label"
                        :first-day-of-week="1"
                        style="width: 9.5rem"
                        @change="clearConfirm(image)"
                      />

                      <!-- 物料名称：改完重查一次编码；右侧搜索图标可手工挑物料（选中后名称与编码一起回填） -->
                      <div v-else-if="col.key === 'materialName'" class="relative">
                        <input
                          v-model="row.materialName"
                          type="text"
                          placeholder="—"
                          class="pr-6"
                          :aria-label="col.label"
                          :class="inputClass(col)"
                          @change="handleNameChange(row, image)"
                        />
                        <button
                          type="button"
                          class="absolute right-0.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 transition hover:bg-brand-50 hover:text-brand-ink"
                          aria-label="搜索物料"
                          title="搜索物料（选中后自动填名称与编码）"
                          @click="openMaterialPicker(row, image)"
                        >
                          <svg
                            class="h-3.5 w-3.5"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2.2"
                            stroke-linecap="round"
                            aria-hidden="true"
                          >
                            <circle cx="11" cy="11" r="7" />
                            <path d="M20 20l-3.5-3.5" />
                          </svg>
                        </button>
                      </div>

                      <!-- 物料编码：只读 —— 只能由主数据按名称带出，不允许手填。
                           手填的编码格式合法、能一路混到落库，是错码的主要来源；
                           要改编码请走「物料名称」右侧的搜索入口，名称与编码一起换。 -->
                      <span
                        v-else-if="col.key === 'materialCode'"
                        class="block px-1.5 py-1 text-sm"
                        :class="row.materialCode ? 'text-slate-900' : 'text-slate-500'"
                      >
                        {{ row.materialCode || '—' }}
                      </span>

                      <!-- 操作：删除该行（识别多出幽灵行 / 重复行时用） -->
                      <div v-else-if="col.key === 'actions'" class="flex justify-center">
                        <button
                          type="button"
                          class="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"
                          aria-label="删除该行"
                          title="删除该行"
                          @click="removeRow(image, row)"
                        >
                          <svg
                            class="h-3.5 w-3.5"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2.2"
                            stroke-linecap="round"
                            aria-hidden="true"
                          >
                            <path d="M5 12h14" />
                          </svg>
                        </button>
                      </div>

                      <!-- 其余字段：逐行独立编辑 -->
                      <input
                        v-else
                        v-model="row[col.key]"
                        type="text"
                        placeholder="—"
                        :aria-label="col.label"
                        :class="inputClass(col)"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>

              <p v-else class="rounded-card bg-region px-3 py-2.5 text-sm text-slate-500">
                暂无行项目，可点下方「增加一行」手工补充。
              </p>

              <!-- 行数校准：识别会漏行（字迹潦草）也会多行（串到相邻单据），
                   两者都只能靠人眼对着原图数，所以给一对增删入口而不是让流程中断 -->
              <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <button
                  type="button"
                  class="flex items-center gap-1 rounded-full border border-slate-300 px-2.5 py-1 text-xs text-slate-600 transition hover:border-brand hover:bg-brand-50 hover:text-brand-ink"
                  @click="addRow(image)"
                >
                  <svg
                    class="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.2"
                    stroke-linecap="round"
                    aria-hidden="true"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  增加一行
                </button>
                <p class="text-xs text-slate-500">
                  对着原图核对行数，多行点该行的「−」删除，每行日期可单独改，改完再点「确认入库」
                </p>
              </div>

              <p class="mt-2 text-xs text-slate-500">
                识别引擎 {{ image.result.engine || '—' }} · 耗时
                {{ image.result.costMillis != null ? `${image.result.costMillis} ms` : '—' }}
              </p>
            </div>

            <!-- 确认入库：按单据类型分流（领料单→领料汇总，入库单→入库汇总），落库复用文件导入那条管线 -->
            <div
              class="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 border-t border-line px-4 py-3"
            >
              <p
                v-if="image.confirm?.message"
                :role="image.confirm.status === 'error' ? 'alert' : 'status'"
                class="mr-auto text-xs"
                :class="image.confirm.status === 'error' ? STATUS_TEXT.error : STATUS_TEXT.success"
              >
                {{ image.confirm.message }}
              </p>
              <p v-else-if="confirmBlockReason(image)" class="mr-auto text-xs text-amber-700">
                {{ confirmBlockReason(image) }}
              </p>

              <button
                type="button"
                class="shrink-0 rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-on-brand transition hover:bg-brand-hover focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
                :disabled="!!confirmBlockReason(image) || image.confirm?.status === 'submitting'"
                @click="submitConfirm(image)"
              >
                {{ confirmButtonText(image) }}
              </button>
            </div>
          </template>

          <p v-else-if="image.status === 'error'" class="px-4 py-4 text-sm text-rose-600">
            {{ image.error }}
          </p>

          <p v-else class="px-4 py-4 text-sm text-slate-500">识别中…</p>
        </article>
      </div>
    </section>

    <!-- 物料候选：识别出的名称查不到唯一主数据时，给人一个挑选的入口。
         用对话框而不是下拉，是因为表格单元格里放弹层容易被裁切、也不好定位。 -->
    <el-dialog
      append-to-body
      v-model="pickerVisible"
      title="选择物料"
      width="640px"
      @closed="closeMaterialPicker"
    >
      <div class="mb-3">
        <input
          v-model="pickerKeyword"
          type="text"
          placeholder="输入名称、编码或规格，边打边查"
          class="w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand-ink/35"
          @keyup.enter="flushPickerSearch"
        />
      </div>

      <!-- 已有结果时不清空：边打字边刷新，结果列表不闪 -->
      <p
        v-if="pickerLoading && !pickerResults.length"
        class="py-6 text-center text-sm text-slate-500"
      >
        检索中…
      </p>

      <p v-else-if="!pickerKeyword.trim()" class="py-6 text-center text-sm text-slate-500">
        输入名称、编码或规格开始搜索
      </p>

      <ul
        v-else-if="pickerResults.length"
        class="max-h-80 overflow-y-auto rounded-card border border-line"
      >
        <!-- 已有候选、又在查（细化阶段）：列表不换遮罩，只在列表顶部给一个"在查"的信号。
             放进 <ul> 里而不是外层，是为了不动上面那条 v-if / v-else-if 链（变更-066）。 -->
        <li v-if="pickerLoading" class="border-b border-line px-3 py-2 text-xs text-slate-500">
          查询中…
        </li>
        <li v-for="item in pickerResults" :key="`${item.code}|${item.name}`">
          <button
            type="button"
            class="flex w-full items-center gap-3 border-b border-line px-3 py-2.5 text-left transition last:border-b-0 hover:bg-brand-50"
            @click="selectMaterial(item)"
          >
            <span class="w-28 shrink-0 font-mono text-sm text-slate-900">{{ item.code }}</span>
            <span class="min-w-0 flex-1 truncate text-sm text-slate-700" :title="item.name">
              {{ item.name }}
            </span>
            <span class="shrink-0 text-xs text-slate-500">{{ item.unit || '' }}</span>
          </button>
        </li>
      </ul>

      <p v-else class="py-6 text-center text-sm text-slate-500">没有匹配的物料，请换个关键词。</p>
    </el-dialog>
  </div>
</template>
