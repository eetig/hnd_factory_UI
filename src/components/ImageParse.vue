<script setup>
import { computed, onUnmounted, ref } from 'vue'
import request from '../api/request'
import { uploadFile } from '../api/upload'
import { formatFileSize } from '../utils/format'
import { matchMaterial, materialLookupError, searchMaterials } from '../composables/useMaterialMaster'
import { useKeyboardLift } from '../composables/useKeyboardLift'
import {
  BILL_TYPE_INBOUND,
  BILL_TYPE_PICK,
  confirmDocument,
  mergeRowsByMaterialCode,
  parseQty,
} from '../composables/useOcrConfirm'

// 一次最多上传的张数（总数上限，不是单次选择上限）
const MAX_COUNT = 5

// 与 myocr 的 ocr.max-image-bytes 默认值保持一致，避免选完才在服务端被拒
const MAX_SIZE = 10 * 1024 * 1024

// images[].status：idle 未提交 | loading 识别中 | success 成功 | error 失败
const images = ref([])
const message = ref('')
const dragActive = ref(false)
const submitting = ref(false)

let nextId = 1

const isFull = computed(() => images.value.length >= MAX_COUNT)
const remaining = computed(() => MAX_COUNT - images.value.length)
const submitted = computed(() => images.value.filter((image) => image.status !== 'idle'))
const successCount = computed(() => images.value.filter((i) => i.status === 'success').length)
const errorCount = computed(() => images.value.filter((i) => i.status === 'error').length)

const dropZoneClass = computed(() => {
  if (isFull.value) return 'border-slate-200 bg-slate-50 cursor-not-allowed'
  if (dragActive.value) return 'border-gold-500 bg-gold-50'
  return 'border-slate-300 hover:border-gold-400'
})

/** 图片来源弹层（App / 小程序）：替掉平台自带的那个 ActionSheet，见 openFilePicker */
const sourceSheetVisible = ref(false)

// 从相册 / 相机选图。
// 改造前是隐藏的 <input type="file" multiple> + .click()；App 与小程序端没有 DOM，
// 改用 uni.chooseImage —— 三端统一，App/小程序端还能直接调相机。
//
// ⚠️ 这里刻意**一次只给一个 sourceType**，是为了躲开平台自带的
//    「拍摄 / 从相册选择 / 取消」ActionSheet：那是系统 UI，样式改不了，
//    各机型还不一样（深色主题下尤其突兀）。两端各让一步：
//      · H5：本来就没有相机/相册之分（底层是 <input type="file">），直接开选择器；
//      · App / 小程序：自己画一个底部弹层（见模板 .source-sheet），
//        选完再带着**单个** sourceType 调 chooseImage —— 只有一个来源时平台不再弹自己的框。
function openFilePicker() {
  if (isFull.value) return

  // #ifdef H5
  pickImages('album')
  // #endif

  // #ifndef H5
  sourceSheetVisible.value = true
  // #endif
}

/** 弹层里选定来源后真正调起选择器。source 只取一个值，理由见 openFilePicker */
function pickImages(source) {
  sourceSheetVisible.value = false

  uni.chooseImage({
    count: remaining.value,
    sizeType: ['original', 'compressed'],
    sourceType: [source],
    success: (res) => {
      const paths = res.tempFilePaths || []
      const tempFiles = res.tempFiles || []

      addFiles(
        paths.map((path, index) => ({
          filePath: path,
          // uni.chooseImage 不保证给出原始文件名（App/小程序端根本没有这个信息）。
          // 后端拿 fileName 辅助判断单据类型，所以有名字更好、没有也别因此失败。
          name: tempFiles[index]?.name || fileNameFromPath(path, index),
          size: Number(tempFiles[index]?.size) || 0,
          mime: 'image/*',
        })),
      )
    },
  })
}

/** 从临时路径抠文件名；抠不到就给一个带序号的兜底名 */
function fileNameFromPath(path, index) {
  const fromPath = /([^/\\?#]+\.(?:png|jpe?g))$/i.exec(String(path || ''))
  if (fromPath) return fromPath[1]

  const fromDataUrl = /^data:image\/(png|jpe?g)/i.exec(String(path || ''))
  const ext = fromDataUrl ? fromDataUrl[1].replace(/^jpeg$/i, 'jpg') : 'jpg'
  return `image_${index + 1}.${ext}`
}

/**
 * 大图预览。
 * 替代 el-image 的 preview-src-list —— uni-app 有原生的 uni.previewImage，
 * 各端都会调起平台自己的图片查看器（可缩放、可保存），比自己实现好得多。
 */
function previewImage(url) {
  if (!url) return
  uni.previewImage({ urls: [url], current: url })
}

// 部分来源（如从某些系统拖拽、相机导出）不带 MIME，退回按扩展名判断
function isImageFile(entry) {
  return /^image\//.test(entry?.mime || '') || /\.(png|jpe?g)$/i.test(entry?.name || '')
}

/**
 * H5 端的拖拽上传。
 *
 * 拖拽是纯 DOM 能力（dataTransfer），App / 小程序端没有 —— 所以整段实现只在 H5 编译进去，
 * 其它端这个函数是空的，模板上的 @dragover / @drop 也就成了无害的空绑定。
 */
function handleDrop(event) {
  dragActive.value = false
  if (isFull.value) return

  // #ifdef H5
  addFiles(
    Array.from(event.dataTransfer?.files || []).map((file) => {
      // 拖进来的是真正的 File 对象：原始文件名、MIME、大小都齐全（这些正是
      // chooseImage 给不了的），转成 blob URL 后走同一条上传链路
      const objectUrl = URL.createObjectURL(file)
      return { filePath: objectUrl, name: file.name, size: file.size, mime: file.type, objectUrl }
    }),
  )
  // #endif
}

function addFiles(entries) {
  if (!entries.length) return
  message.value = ''

  let notImage = 0
  let oversized = 0
  const accepted = []

  for (const entry of entries) {
    if (!isImageFile(entry)) {
      notImage += 1
    } else if (entry.size > MAX_SIZE) {
      oversized += 1
    } else {
      accepted.push(entry)
    }
  }

  const room = remaining.value
  const overflow = Math.max(0, accepted.length - room)
  const added = accepted.slice(0, room)

  for (const entry of added) {
    images.value.push({
      id: nextId,
      // 上传用的路径：chooseImage 的临时路径，或 H5 拖拽时创建的 blob URL
      filePath: entry.filePath,
      // 只有拖拽进来的 blob URL 需要 revoke；chooseImage 的临时文件由平台管理
      objectUrl: entry.objectUrl || '',
      // 预览直接用同一个路径即可（<image> 能吃本地临时路径和 blob URL）
      url: entry.filePath,
      name: entry.name,
      size: entry.size,
      status: 'idle',
      result: null,
      table: null,
      // 确认入库状态：null | { status: 'submitting'|'done'|'error', message }
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

/**
 * 释放 blob URL。
 *
 * 改造前一律 revoke image.url —— 因为那时每张预览图都是 createObjectURL 出来的。
 * 现在预览路径同时可能是 uni.chooseImage 给的临时文件路径（由平台管理，不能也不该 revoke），
 * 所以按 objectUrl 字段区分：只有 H5 拖拽上传进来的才需要释放。
 */
function releaseObjectUrl(image) {
  // #ifdef H5
  if (image?.objectUrl) URL.revokeObjectURL(image.objectUrl)
  // #endif
}

function removeImage(id) {
  const index = images.value.findIndex((image) => image.id === id)
  if (index === -1) return

  releaseObjectUrl(images.value[index])
  images.value.splice(index, 1)
  message.value = ''
}

function clearAll() {
  images.value.forEach(releaseObjectUrl)
  images.value = []
  message.value = ''
}

// ------------------------------------------------------------------
// 提交识别
// ------------------------------------------------------------------

async function recognizeOne(image) {
  // 改造点：原来是 FormData + request.post。
  // uni.request 在任何端都发不了 multipart（H5 端也一样），改走 uni.uploadFile。
  // 这个接口本来就是单文件，正好对上 uploadFile 一次一个文件的限制。
  const res = await uploadFile({
    url: '/api/ocr/recognize',
    filePath: image.filePath,
    name: 'file',
    formData: { fileName: image.name },
  })

  const body = res.data || {}

  // myocr 的业务错误是 HTTP 200 + code≠200（异常处理器未设响应状态），
  // 不判 code 会把失败当成成功
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
  // 改造前判的是 axios 的 error.code === 'ERR_NETWORK'；
  // 新的请求层没有这个码，网络层失败统一标 isNetworkError（见 api/http-common.js）
  if (error?.isNetworkError) {
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

// 弹层里的搜索框会被软键盘盖住（弹层是 fixed 的，uni 的 adjust-position 管不着），
// 拿到键盘高度后垫成 padding-bottom，把内容顶到键盘上沿之上，见 useKeyboardLift
const {
  keyboardHeight: pickerKeyboardHeight,
  start: startKeyboardLift,
  stop: stopKeyboardLift,
} = useKeyboardLift()

const pickerCustomStyle = computed(() => {
  const base =
    'max-height: 80vh; display: flex; flex-direction: column; background-color: var(--ui-glass-fill); overscroll-behavior: contain;'
  const kb = pickerKeyboardHeight.value
  if (!kb) return base

  // ⚠️ 键盘弹起时**不能用 padding 把内容顶上去**：本项目没有全局 box-sizing 重置
  //    （preflight 关着，uni.css 只给 uni-button / uni-page-* 少数几个元素设了 border-box），
  //    .wd-popup 是 content-box —— padding 不占 max-height 的额度，弹层会被撑得比
  //    max-height 还高，整个顶出屏幕上沿（真机实测：搜索框跑到状态栏里去了）。
  //
  // ⚠️ 高度要写成**确定值 height**，不能只给 max-height：键盘高度是系统报的，
  //    实测不可靠（同一台机器上换个输入法就报得偏大）。只给 max-height 时，弹层高度
  //    由内容决定 —— 内容比上限矮时它就按内容来，`bottom: 键盘高` 一偏大，整块就被顶到
  //    屏幕外（真机现象：列表从一个被截断的行开始，输入框跑到屏幕上方）。
  //    写成 height 后顶边恒等于下面这个 12px：height + bottom 是联动算出来的，
  //    键盘报多少都只会让弹层变矮，不会溢出屏幕。
  //    padding-bottom 显式清零，是因为 wd-popup 会自动追加一条安全区的 padding-bottom
  //    （同样是 content-box，留着就白白多出 30 多像素）。
  return `${base} bottom: ${kb}px; padding-bottom: 0; height: min(80vh, calc(100vh - ${kb}px - 12px));`
})

/** 列表空状态文案。三种情况轮着出现，但列表区高度始终是 56vh（见模板里的说明） */
const pickerEmptyText = computed(() => {
  if (pickerLoading.value && !pickerResults.value.length) return '检索中…'
  if (!pickerKeyword.value.trim()) return '输入名称、编码或规格开始搜索'
  return '没有匹配的物料，请换个关键词。'
})

/** 输入防抖：输入停下 300ms 才发请求，避免每敲一个字都打一次接口 */
const PICKER_DEBOUNCE_MS = 300
let pickerSearchTimer = null
/** 请求序号：快速输入时先发的请求可能后返回，用它丢弃过期响应，否则旧结果会盖掉新结果 */
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

function handlePickerInput() {
  clearTimeout(pickerSearchTimer)
  pickerSearchTimer = setTimeout(runPickerSearch, PICKER_DEBOUNCE_MS)
}

async function openMaterialPicker(row, image) {
  pickerRow.value = row
  pickerImage.value = image
  pickerKeyword.value = row.materialName || ''
  // 先用自动匹配时已取到的候选，打开即有内容；为空再立刻查一次（不必等防抖）
  pickerResults.value = row.candidates?.length ? [...row.candidates] : []
  pickerVisible.value = true
  // 只在这个弹层开着的时候听键盘高度（监听是全局的，挂久了会和别的弹层互相覆盖）
  startKeyboardLift()

  if (!pickerResults.value.length) {
    await runPickerSearch()
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
  closeMaterialPicker()
}

function closeMaterialPicker() {
  // 取消待发的防抖请求，避免弹窗已关还在打接口
  clearTimeout(pickerSearchTimer)
  stopKeyboardLift()
  pickerVisible.value = false
  pickerRow.value = null
  pickerImage.value = null
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

// 各口径的列定义，对齐列表页的领料汇总 / 入库汇总。
//
// ⚠️ 这里只列「明细行」自己的列。单据号与时间属于整张单据，已经上提到卡片顶部的
//    单据信息区（见模板 .doc）—— 改造前它们各占一列、逐行重复渲染，同一个单号在
//    N 行里出现 N 次：既占地方，手机上那点宽度还要被它们吃掉两列，读起来也像是
//    「每行各有一个单号」。线下单据缩略图同理（整张单据同一张图），
//    现在只留卡片头部那张可点开大图的缩略图。
const PICK_COLUMNS = [
  { key: 'index', label: '序号', align: 'center' },
  { key: 'materialName', label: '物料名称' },
  { key: 'materialCode', label: '物料编码' },
  { key: 'quantity', label: '领料数量', align: 'right' },
  { key: 'unit', label: '单位', align: 'center' },
  // 操作列：逐行删除。列定义里只占一个 key，具体渲染见模板的 actions 分支
  { key: 'actions', label: '操作', align: 'center' },
]

const INBOUND_COLUMNS = [
  { key: 'index', label: '序号', align: 'center' },
  { key: 'materialName', label: '物料名称' },
  { key: 'materialCode', label: '物料编码' },
  { key: 'quantity', label: '入库数量', align: 'right' },
  { key: 'unit', label: '单位', align: 'center' },
  { key: 'actions', label: '操作', align: 'center' },
]

// 未知单据类型：没有单位这一列（识别不出类型时不敢假定它有单位栏）
const UNKNOWN_COLUMNS = [
  { key: 'index', label: '序号', align: 'center' },
  { key: 'materialName', label: '物料名称' },
  { key: 'materialCode', label: '物料编码' },
  { key: 'quantity', label: '数量', align: 'right' },
  { key: 'actions', label: '操作', align: 'center' },
]

const COLUMNS = { pick: PICK_COLUMNS, inbound: INBOUND_COLUMNS, unknown: UNKNOWN_COLUMNS }

/** 单据信息区里那一项的标题，跟着单据口径走 */
function dateLabel(kind) {
  if (kind === 'pick') return '领料时间'
  if (kind === 'inbound') return '入库时间'
  return '日期'
}

/**
 * 把识别结果摊成表格：单据头字段（单据号 / 日期）单独存一份，行里只有行项目。
 *
 * <p>行项目来自识别结果，所以「一行」= 识别出的一条物料。
 * 单位不识别（见变更-003 字段范围：单位由业务方按物料编码查主数据带出），故留空待人工补。
 *
 * <p>单据号与日期单独放在 {@code doc} 而不是每行各存一份：它们属于整张单据，
 * 逐行存会让同一张单出现两个单号。模板里它们只在卡片顶部的单据信息区渲染一次。
 *
 * <p>返回的是<b>可编辑副本</b>，{@code image.result} 保留识别原始值不动 ——
 * 人工校准后仍需能对照「模型原本给了什么」。
 */
function buildTable(result) {
  const kind = resolveDocKind(result?.documentType)

  const rows = (result?.items || []).map((item) => ({
    // 行的公共字段（key / 序号 / 物料编码 / 单位 / 候选）统一由 blankRow 造，
    // 这里只覆盖识别出来的两个字段
    ...blankRow(),
    materialName: fieldText(item.materialName),
    // 物料编码【不取识别值】，一律从空开始，等主数据按名称反查填入（见 blankRow）。
    // 理由：纸质单该列本就空白，模型对空白列会吐占位值或误取相邻的「规格」列
    // （实测出现过 materialCode="不存在"、"2.260813"）。留着它只会让人误以为是真编码。
    // 识别原值仍保留在 image.result 里，需要追溯时看得到。
    quantity: fieldText(item.quantity),
  }))

  const table = {
    kind,
    columns: COLUMNS[kind],
    doc: {
      documentNo: fieldText(result?.documentNo),
      date: fieldText(result?.docDate),
    },
    rows,
  }
  renumber(table)
  return table
}

// ------------------------------------------------------------------
// 行增删（识别结果需要人工校准行数）
//
// 移植自旧库 hnd_factory_UI 的 a52c457（原路径 src/views/ImageParse.vue）：
// 识别会漏行（字迹潦草）也会多行（串到相邻单据），行数只能靠人眼对着原图数，
// 所以给一对增删入口，而不是让流程中断。
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
    materialName: '',
    materialCode: '',
    quantity: '',
    unit: '',
    // 该行的物料候选（由 enrichMaterials 填充），供「查不到时人工选」
    candidates: [],
  }
}

/**
 * 序号对齐数组下标：它是对外展示的行号，删掉中间一行后不能留空洞。
 *
 * <p>落库时 mergeRowsByMaterialCode 会拿 index 当 seqNo，所以更不能有洞。
 */
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
  image.table.rows.push(blankRow())
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

/**
 * 列的对齐口径 → 类名。
 *
 * <p>只在桌面端生效（见样式里的 @media）：手机端每行是一张「标签 + 值」的卡片，
 * 每个字段都靠左，右对齐的数字反而会跟自己的标签对不上。
 */
function alignClass(col) {
  if (col.align === 'right') return 'is-right'
  if (col.align === 'center') return 'is-center'
  return ''
}

function statusText(image) {
  if (image.status === 'loading') return '识别中…'
  if (image.status === 'success') return '识别成功'
  if (image.status === 'error') return '识别失败'
  return '未提交'
}

function statusClass(image) {
  if (image.status === 'loading') return 'bg-slate-100 text-slate-500'
  if (image.status === 'success') return 'bg-emerald-50 text-emerald-700'
  if (image.status === 'error') return 'bg-rose-50 text-rose-700'
  return 'bg-slate-100 text-slate-500'
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
 */
function confirmBlockReason(image) {
  if (!image.table) {
    return '无解析结果'
  }
  if (!String(image.table.doc.documentNo || '').trim()) {
    return '单据号为空，无法入库'
  }

  // 行可以删到 0（增删入口允许这么做），但 0 行的单据没有意义，别让它提交上去
  if (!image.table.rows.length) {
    return '没有可入库的明细行，请至少保留一行'
  }

  const bad = image.table.rows.filter(
    (row) => !String(row.materialCode || '').trim() || parseQty(row.quantity) === null,
  )
  if (bad.length) {
    return `有 ${bad.length} 行缺物料编码、或数量无法解析，请先补齐`
  }
  return ''
}

async function submitConfirm(image) {
  const status = image.confirm?.status
  if (status === 'submitting' || confirmBlockReason(image)) {
    return
  }

  image.confirm = { status: 'submitting', message: '' }

  const { rows: merged, merges } = mergeRowsByMaterialCode(image.table.rows)
  const billType = image.table.kind === 'inbound' ? BILL_TYPE_INBOUND : BILL_TYPE_PICK

  try {
    const data = await confirmDocument({
      billType,
      documentNo: String(image.table.doc.documentNo).trim(),
      date: String(image.table.doc.date || '').trim(),
      rows: merged.map((row) => ({
        seqNo: row.seqNo,
        materialName: row.materialName,
        materialCode: row.materialCode,
        qty: String(row.qty),
        unit: row.unit,
      })),
      // 单据图随 payload 一起 multipart 提交（后端存进 file_name，
      // 汇总列表的「线下单据」列靠它回溯）。走 uni.uploadFile，见 useOcrConfirm。
      // 注意是 filePath 而不是 File 对象 —— 图片列表里存的一直是各端的本地路径。
      filePath: image.filePath,
    })
    image.confirm = { status: 'done', message: buildConfirmMessage(data, merges) }
  } catch (error) {
    image.confirm = { status: 'error', message: error?.message || '入库失败' }
  }
}

function buildConfirmMessage(data, merges) {
  const parts = [`新增 ${data.addCount ?? 0} 条`, `更新 ${data.updateCount ?? 0} 条`]
  if (data.skipCount) {
    parts.push(`跳过 ${data.skipCount} 条（库中已有且数量相同）`)
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
  if (image.confirm?.status === 'submitting') return '入库中…'
  // 成功后仍可再提交：后端按「单据号+物料编码+数量」去重，
  // 数据没变会整行跳过，改过数量则走更新，所以重提是安全的
  if (image.confirm?.status === 'done') return '重新入库'
  return '确认入库'
}

onUnmounted(() => {
  clearTimeout(pickerSearchTimer)
  images.value.forEach(releaseObjectUrl)
})
</script>

<template>
  <div class="space-y-4">
    <section
      class="rounded-xl border-2 border-dashed bg-white p-10 text-center transition"
      :class="dropZoneClass"
      @click="openFilePicker"
      @dragover.prevent="dragActive = true"
      @dragleave.prevent="dragActive = false"
      @drop.prevent="handleDrop"
    >
      <div class="flex flex-col items-center gap-2">
        <div
          class="mb-1 flex h-12 w-12 items-center justify-center rounded-full"
          :class="isFull ? 'bg-slate-100 text-slate-400' : 'bg-gold-50 text-gold-600'"
        >
          <!-- 占位图标：原来用内联 <svg>，小程序不支持 svg 标签，换组件库图标 -->
          <wd-icon name="picture" size="24px" />
        </div>

        <p class="text-base font-semibold" :class="isFull ? 'text-slate-400' : 'text-slate-900'">
          {{ isFull ? `已达上限（${MAX_COUNT} 张）` : '点击选择图片，或将图片拖到此处' }}
        </p>
        <p class="text-sm" :class="isFull ? 'text-slate-400' : 'text-slate-500'">
          支持 PNG / JPG，单张不超过 {{ MAX_SIZE / 1024 / 1024 }}MB，最多 {{ MAX_COUNT }} 张
        </p>
      </div>
    </section>

    <p
      v-if="message"
      class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800"
    >
      {{ message }}
    </p>

    <section v-if="images.length" class="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div class="flex items-center justify-between border-b border-slate-100 px-6 py-3.5">
        <p class="text-sm text-slate-600">
          已选 <span class="font-semibold text-gold-600">{{ images.length }}</span> /
          {{ MAX_COUNT }} 张
        </p>
        <button type="button" class="clear-btn" :disabled="submitting" @click="clearAll">
          清空
        </button>
      </div>

      <ul class="grid grid-cols-2 gap-4 p-6 sm:grid-cols-3 lg:grid-cols-5">
        <li
          v-for="image in images"
          :key="image.id"
          class="group relative overflow-hidden rounded-lg border border-slate-200"
        >
          <img
            :src="image.url"
            :alt="image.name"
            class="h-32 w-full bg-slate-50 object-cover"
            loading="lazy"
            decoding="async"
          />

          <div class="border-t border-slate-100 px-2.5 py-2">
            <p class="truncate text-xs text-slate-600" :title="image.name">{{ image.name }}</p>
            <p class="text-xs text-slate-400">{{ formatFileSize(image.size) }}</p>
          </div>

          <button
            type="button"
            class="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-sm text-[#fff] opacity-0 transition hover:bg-rose-600 focus:opacity-100 group-hover:opacity-100"
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
        class="rounded-full bg-slate-900 px-6 py-2.5 text-sm font-medium text-on-light transition hover:bg-slate-700 ip__cta focus:outline-none"
        :disabled="!images.length || submitting"
        @click="submit"
      >
        {{ submitting ? '识别中…' : '提交' }}
      </button>
    </div>

    <p
      v-if="materialLookupError"
      class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800"
    >
      {{ materialLookupError }}（物料编码将全部留空，可手工填写）
    </p>

    <section v-if="submitted.length" class="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div class="result__head">
        <p class="text-sm text-slate-600">
          解析结果 · 成功
          <span class="font-semibold text-emerald-600">{{ successCount }}</span>
          <template v-if="errorCount">
            · 失败 <span class="font-semibold text-rose-600">{{ errorCount }}</span>
          </template>
        </p>
      </div>

      <div class="result__body">
        <article
          v-for="image in submitted"
          :key="image.id"
          class="overflow-hidden rounded-lg border border-slate-200"
        >
          <header class="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
            <!-- 缩略图本身就是「看原图」的入口：整张单据只有这一张图，
                 点开进平台原生的图片查看器（可缩放可保存） -->
            <img
              :src="image.url"
              :alt="image.name"
              class="h-10 w-10 shrink-0 rounded border border-slate-200 object-cover"
              @click="previewImage(image.url)"
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
            <!-- 单据信息：整张单据一份。单据号 / 时间 / 类型都属于单据本身，
                 放在这里是唯一一份，改一处全表同步（改造前它们是逐行重复的表格列） -->
            <div class="doc">
              <div class="doc__row">
                <span class="doc__label">单据类型</span>
                <span class="doc__type">{{ fieldText(image.result.documentType) || '未识别' }}</span>
                <button type="button" class="doc__preview" @click="previewImage(image.url)">
                  查看原图
                </button>
              </div>

              <div class="doc__fields">
                <div class="field">
                  <span class="field__label">单据号</span>
                  <input
                    v-model="image.table.doc.documentNo"
                    class="field__input"
                    type="text"
                    placeholder-class="ui-placeholder" placeholder="—"
                  />
                </div>
                <div class="field">
                  <span class="field__label">{{ dateLabel(image.table.kind) }}</span>
                  <input
                    v-model="image.table.doc.date"
                    class="field__input"
                    type="text"
                    placeholder-class="ui-placeholder" placeholder="—"
                  />
                </div>
              </div>
            </div>

            <div class="body">
              <!-- 明细行。
                   桌面端：表头 + 网格行，像一张表；
                   手机端：表头藏起来，每行变成一张卡片，字段各自带标签 —— 改造前是
                   9 列硬塞进手机宽度，列宽被压到只剩一两个汉字，表头直接竖排成单字，
                   横向滚动也救不回来（表格一滚动，行首的序号就看不见了）。 -->
              <div :class="`rows rows--${image.table.kind}`">
                <div v-if="image.table.rows.length" class="rows__head">
                  <span
                    v-for="col in image.table.columns"
                    :key="col.key"
                    class="rows__th"
                    :class="alignClass(col)"
                  >
                    {{ col.label }}
                  </span>
                </div>

                <!-- :key 用 row.key（稳定标识）而不是 row.index：
                     序号删行后会重排，拿它当 key 会让 Vue 复用错行组件，输入框内容串行 -->
                <div v-for="row in image.table.rows" :key="row.key" class="row">
                  <!-- 手机端行首：序号 + 删除。桌面端这两项各自占一列，这条不显示 -->
                  <div class="row__bar">
                    <span class="row__seq">第 {{ row.index }} 行</span>
                    <button type="button" class="row__del" @click="removeRow(image, row)">
                      <wd-icon name="decrease" size="14px" />
                      删除
                    </button>
                  </div>

                  <div
                    v-for="col in image.table.columns"
                    :key="col.key"
                    class="cell"
                    :class="[`cell--${col.key}`, alignClass(col)]"
                  >
                    <!-- 字段名：手机端每个字段自己的标签，桌面端由表头承担 -->
                    <span class="cell__label">{{ col.label }}</span>

                    <!-- 序号：识别顺序，不参与校正（手机端挪到行首的 bar 上） -->
                    <span v-if="col.key === 'index'" class="cell__text">{{ row.index }}</span>

                    <!-- 物料名称：改完重查一次编码；右侧搜索图标可手工挑物料
                         （选中后名称与编码一起回填） -->
                    <template v-else-if="col.key === 'materialName'">
                      <input
                        v-model="row.materialName"
                        class="cell__input"
                        type="text"
                        placeholder-class="ui-placeholder" placeholder="—"
                        @change="handleNameChange(row, image)"
                      />
                      <button
                        type="button"
                        class="cell__search"
                        title="搜索物料（选中后自动填名称与编码）"
                        @click="openMaterialPicker(row, image)"
                      >
                        <wd-icon name="search" size="14px" />
                      </button>
                    </template>

                    <!-- 物料编码：只读 —— 只能由主数据按名称带出，不允许手填。
                         手填的编码格式合法、能一路混到落库，是错码的主要来源；
                         要改编码请走「物料名称」右侧的搜索入口，名称与编码一起换。 -->
                    <span
                      v-else-if="col.key === 'materialCode'"
                      class="cell__code"
                      :class="{ 'is-empty': !row.materialCode }"
                    >
                      {{ row.materialCode || '—' }}
                    </span>

                    <!-- 操作：删除该行（识别多出幽灵行 / 重复行时用）。
                         decrease 与 wd-input-number 的减号同一个字形，和提示里的「−」对得上。 -->
                    <button
                      v-else-if="col.key === 'actions'"
                      type="button"
                      class="cell__del"
                      title="删除该行"
                      @click="removeRow(image, row)"
                    >
                      <wd-icon name="decrease" size="14px" />
                    </button>

                    <!-- 其余字段（数量 / 单位）：逐行独立编辑 -->
                    <input
                      v-else
                      v-model="row[col.key]"
                      class="cell__input"
                      type="text"
                      placeholder-class="ui-placeholder" placeholder="—"
                    />
                  </div>
                </div>
              </div>

              <p v-if="!image.table.rows.length" class="empty">
                暂无行项目，可点下方「增加一行」手工补充。
              </p>

              <!-- 行数校准：识别会漏行（字迹潦草）也会多行（串到相邻单据），
                   两者都只能靠人眼对着原图数，所以给一对增删入口而不是让流程中断 -->
              <div class="rows-actions">
                <button type="button" class="row-add" @click="addRow(image)">
                  <wd-icon name="add" size="14px" />
                  增加一行
                </button>
                <p class="rows-hint">
                  对着原图核对行数，多行点该行的「−」删除，改完再点「确认入库」
                </p>
              </div>

              <p class="engine-line">
                识别引擎 {{ image.result.engine || '—' }} · 耗时
                {{ image.result.costMillis != null ? `${image.result.costMillis} ms` : '—' }}
              </p>
            </div>

            <!-- 确认入库：按单据类型分流（领料单→领料汇总，入库单→入库汇总），落库复用文件导入那条管线 -->
            <div class="confirm">
              <p
                v-if="image.confirm?.message"
                class="confirm__msg"
                :class="image.confirm.status === 'error' ? 'is-error' : 'is-done'"
              >
                {{ image.confirm.message }}
              </p>
              <p v-else-if="confirmBlockReason(image)" class="confirm__msg is-warn">
                {{ confirmBlockReason(image) }}
              </p>

              <button
                type="button"
                class="confirm__btn shrink-0 rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-on-light transition hover:bg-slate-700 ip__cta focus:outline-none"
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

    <!-- 图片来源选择（App / 小程序）。
         替掉 uni.chooseImage 自带的那个系统 ActionSheet —— 它是系统 UI，样式不可控，
         深色主题下是一块突兀的白板。H5 端不会打开它（没有相机这一说），见 openFilePicker。 -->
    <wd-popup
      v-model="sourceSheetVisible"
      position="bottom"
      round
      safe-area-inset-bottom
      custom-style="background-color: var(--ui-glass-fill);"
      @close="sourceSheetVisible = false"
    >
      <view class="source-sheet">
        <text class="source-sheet__title">添加单据图片</text>

        <view class="source-sheet__item" @click="pickImages('camera')">
          <view class="source-sheet__icon">
            <wd-icon name="camera" size="20px" />
          </view>
          <text class="source-sheet__label">拍摄</text>
        </view>

        <view class="source-sheet__item" @click="pickImages('album')">
          <view class="source-sheet__icon">
            <wd-icon name="picture" size="20px" />
          </view>
          <text class="source-sheet__label">从相册选择</text>
        </view>

        <view class="source-sheet__cancel" @click="sourceSheetVisible = false">取消</view>
      </view>
    </wd-popup>

    <!-- 物料候选：识别出的名称查不到唯一主数据时，给人一个挑选的入口。
         用对话框而不是下拉，是因为表格单元格里放弹层容易被裁切、也不好定位。 -->
    <!-- 物料选择器。原为 el-dialog（width="640px" 居中弹窗）。
         移动端改成底部弹层 + scroll-view —— 注意小程序的 <view> 上写
         overflow-y: auto 是不会滚的，必须用 scroll-view 才滚得起来。 -->
    <!-- ⚠️ custom-style 里的 background-color 不能省：wd-popup 给 .wd-popup 写死了
         `background: #fff`，只有挂 .wot-theme-dark 时才变（本项目用的是自己那套
         .theme-light / CSS 变量主题，没有这个类）——不覆盖的话，深色主题下整个弹层是块白板，
         里面的文字反而是 $ui-text 的浅色，等于白底白字。 -->
    <wd-popup
      v-model="pickerVisible"
      position="bottom"
      round
      safe-area-inset-bottom
      :custom-style="pickerCustomStyle"
      @close="closeMaterialPicker"
    >
      <view class="picker-head">
        <text class="picker-head__title">选择物料</text>
      </view>

      <view class="picker-search">
        <wd-icon name="search" size="14px" />
        <input
          v-model="pickerKeyword"
          class="picker-search__input"
          type="text"
          placeholder="输入名称、编码或规格，边打边查"
          placeholder-class="picker-search__ph"
          confirm-type="search"
          @input="handlePickerInput"
          @confirm="runPickerSearch"
        />
      </view>

      <!-- ⚠️ 列表区**始终**占着固定高度（56vh），空状态放在它里面，不要用 v-if 把整个
           scroll-view 换掉。换掉的话弹层高度会随结果条数变：2 条结果时弹层只有一百多像素，
           搜索框贴着键盘；结果一多弹层长到 56vh，搜索框又跑到屏幕上半截 ——
           人正在打字，位置一直在动。固定住高度，搜索框的位置就与结果条数无关了。
           （ProductSelectDialog 本来就是这么写的，两边保持一致。） -->
      <scroll-view class="picker-list" scroll-y>
        <view v-if="!pickerResults.length" class="picker-state">
          <text>{{ pickerEmptyText }}</text>
        </view>

        <template v-else>
          <view
            v-for="item in pickerResults"
            :key="`${item.code}|${item.name}`"
            class="picker-item"
            @click="selectMaterial(item)"
          >
            <text class="picker-item__code">{{ item.code }}</text>
            <text class="picker-item__name">{{ item.name }}</text>
          </view>
        </template>
      </scroll-view>
    </wd-popup>
  </div>
</template>

<style scoped lang="scss">
/* ===== 按钮基线复位 =====
   uni 给每个 <button> 都预置了一套外观（见 uni.css 的 uni-button）：
   18px 字号、line-height 2.55（≈47px 的行高）、#f8f8f8 灰底、margin: auto（按钮被推到中间），
   外加一个用 ::after 画的边框（1px rgba(0,0,0,.2)，再缩放 0.5 描出来的细线）。
   凡是自己写样式的按钮都得先清掉这套 —— 否则高度、位置、边框全都不受控，
   两个按钮摆在一起就是一个大一个小、底色描边对不上。
   （走 Tailwind 那几个类名的按钮不受影响：它们每条属性都写在类里，且类选择器优先级更高。）

   ⚠️ **禁用态还有一条独立的坑**（2026-10-09 修）：uni.css 里
       `uni-button[disabled] { color: rgba(255,255,255,.6) }`
   优先级 (0,1,1)，**高于任何单类选择器** —— 也就是说禁用时它会盖掉你写的字色。
   它假设禁用按钮是深色填充（浅色主题下成立）；而深色主题里本项目的"实心墨块"
   （bg-slate-900）会翻成**近白**，于是白字压白块、整个按钮的文字看不见
   （「提交」按钮就是这样坏的，实机截图与计算值 color=rgba(255,255,255,0.6) 都对得上）。
   两条出路，按按钮类型选：
     · 实心块按钮：加 Tailwind 的 `disabled:text-on-light`（生成 `.x:disabled`，(0,2,0) 能压过它）；
     · 自绘按钮：在 `:disabled` 里**显式写 color**（见下面 .clear-btn:disabled 的说明）。
   顺带记住它还有 `[type=default]` / `:not([type])` 两条分支（禁用时给灰底），
   所以自己写底色的按钮一律要带 `type="button"`。

   ⚠️ 这一块必须放在**所有按钮样式之前**：同样是单类选择器，靠后的那条胜出。
   起初放在文件中间，结果后面的复位把前面已写好的 .clear-btn 底色/字色全清了，
   按钮在页面上变成一行几乎看不见的浅灰字。 */
.doc__preview,
.row__del,
.row-add,
.cell__del,
.cell__search,
.clear-btn {
  margin: 0;
  border: 0;
  border-radius: 0;
  background-color: transparent;
  color: inherit;
  font-size: inherit;
  line-height: 1;
  overflow: visible;

  &::after {
    border: 0;
  }
}
/* ===== 图片来源选择弹层 =====
   替掉 uni.chooseImage 自带的系统 ActionSheet。沿用物料弹层那套观感：
   大圆角、条目是带底色的卡片、底部一颗整宽的胶囊取消键。 */
.source-sheet {
  padding: 20px 16px 12px;
}

.source-sheet__title {
  display: block;
  padding: 0 4px 14px;
  color: $ui-text-3;
  font-size: 13px;
}

.source-sheet__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: $ui-radius-md;
  background-color: $ui-surface-2;
  color: $ui-text;
  font-size: 15px;
  transition: background-color $ui-dur $ui-ease;
}

.source-sheet__item + .source-sheet__item {
  margin-top: 8px;
}

.source-sheet__item:active {
  background-color: $ui-accent-soft;
  color: $ui-accent-text;
}

.source-sheet__icon {
  display: flex;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: $ui-radius-sm;
  background-color: $ui-accent-soft;
  color: $ui-accent-text;
}

.source-sheet__label {
  flex: 1;
  min-width: 0;
}

.source-sheet__cancel {
  margin-top: 18px;
  padding: 15px;
  border-radius: $ui-radius-pill;
  background-color: $ui-raise-2;
  color: $ui-text-2;
  font-size: 15px;
  text-align: center;
  transition: background-color $ui-dur $ui-ease;
}

.source-sheet__cancel:active {
  background-color: $ui-raise-3;
}

/* ===== 物料选择器 =====
   原来这里是 Element Plus 的 el-dialog，内部样式全靠 Tailwind 工具类撑着。
   改成 wd-popup 之后，弹层结构变了，且滚动必须由 scroll-view 承担
   （小程序的 <view> 上写 overflow-y: auto 不会滚），所以落成显式样式。 */
.picker-head {
  padding: 24px 20px 8px;

  &__title {
    color: $slate-900;
    font-size: 16px;
    font-weight: 600;
  }
}

.picker-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 20px 12px;
  padding: 0 18px;
  border: 1px solid $ui-border;
  border-radius: $ui-radius-pill;
  background-color: $ui-surface-2;
  color: $ui-text-3;

  &__input {
    flex: 1;
    min-height: 44px;
    color: $ui-text;
    font-size: 14px;
  }

  &__ph {
    color: $ui-text-3;
  }
}

.picker-list {
  /* 高度的「基准」是 56vh（键盘收起时弹层按内容撑，就是它顶着）；
     键盘弹起后弹层有了确定高度，这里靠 flex-grow 把剩余空间吃掉、
     靠 flex-shrink 在空间不够时缩 —— 内容正好等于弹层高，弹层自己就不会溢出滚动，
     也就不会把滚动链甩给下层页面。min-height: 0 是缩的前提（flex 子项默认 auto 不肯缩）。 */
  height: 56vh;
  min-height: 0;
  flex-grow: 1;
  /* 列表滑到头之后**不要**把滚动继续传给页面（真机现象：继续上滑会把下层
     「图片解析」整页一起带着滚，弹层跟着页面跑）。 */
  overscroll-behavior: contain;
  /* ⚠️ width: auto 不能省：uni.css 里 `uni-scroll-view { width: 100% }`，
     而 **width: 100% 是不扣 margin 的** —— 光写 margin 0 16px 的话，盒子仍是整屏宽、
     再往右溢出 16px，整个弹层因此可以左右滑（真机实测：列表能横向拖走）。
     写成 auto，块级元素才会按「父宽 - margin」算宽。 */
  width: auto;
  margin: 0 16px 20px;
  border: 1px solid $ui-hairline;
  border-radius: $ui-radius-md;
}

/* 「清空」：与结果区那族胶囊同一套尺寸与配色。
   它是唯一一个没写底色的按钮 —— uni 给 <button> 预置的 #f8f8f8 灰底 + ::after 描边
   在没有底色覆盖时就会露出来，页面上看就是「一个小灰方块」，很扎眼。 */
.clear-btn {
  display: flex;
  height: 32px;
  flex-shrink: 0;
  align-items: center;
  border-radius: $ui-radius-pill;
  padding: 0 16px;
  background-color: $ui-raise-2;
  color: $ui-text-2;
  font-size: 13px;
  line-height: 1;
  transition: background-color $ui-dur $ui-ease, color $ui-dur $ui-ease;
}

.clear-btn:active {
  background-color: $ui-danger-soft;
  color: $ui-danger;
}

/* ===== 实心 CTA（提交 / 确认入库）=====
   两个按钮原来写的是 Tailwind 的 `disabled:opacity-60` / `disabled:text-on-light`，
   但那两个类**从来没有生效过**：uni-app 的 <button> 渲染成自定义元素 <uni-button>，
   而 CSS 的 `:disabled` 伪类只对真正的表单元素生效 —— Tailwind 的 disabled: 变体
   编出来就是 `.x:disabled`，对自定义元素永远不匹配。uni 自己是用**属性**选择器
   （uni-button[disabled]）绕开这一点的。
   所以这里改用 [disabled]（uni 渲染出来的属性是 disabled="true"），并且：
     · 显式给 color —— uni.css 的 `uni-button[disabled]{color:rgba(255,255,255,.6)}`
       优先级 (0,1,1)，假设禁用按钮是深色填充；深色主题下 bg-slate-900 会翻成近白，
       不覆盖就成了白字压白块（「提交」按钮就是这样看不见的）；
     · 带上 opacity 与 cursor，把原先那两个失效的 disabled: 类想表达的东西补回来。
   本条的优先级：类 + scoped 属性 + [disabled] = (0,3,0)，压得过 uni 的 (0,1,1)。 */
.ip__cta[disabled] {
  color: $ui-on-light;
  opacity: 0.6;
  cursor: not-allowed;
}

.clear-btn:disabled {
  opacity: 0.5;
  /* ⚠️ 这一条别删。uni 内置的 `uni-button[disabled]{color:rgba(255,255,255,.6)}`
     优先级 (0,1,1) 高于本条的类选择器 (0,1,0)，不显式写 color 就会**被它盖掉** ——
     白字压在 $ui-raise-2 的浅底上，浅色主题下直接看不见（与「提交」按钮同源，
     那段说明见文件顶部"按钮基线复位"一节）。 */
  color: $ui-text-3;
}

/* 列表区的空状态：与 ProductSelectDialog 的 .picker__empty 同款（靠上留白），
   它占的是列表区里的一行，不改变弹层高度 */
.picker-state {
  padding: 40px 16px;
  color: $ui-text-3;
  font-size: 14px;
  text-align: center;
}

.picker-item {
  display: flex;
  /* 名称可能换行，编码跟第一行齐（居中的话多行名称会把编码吊在中间） */
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;

  &:not(:first-child) {
    border-top: 1px solid $ui-hairline;
  }

  &__code {
    flex-shrink: 0;
    width: 112px;
    color: $ui-text;
    font-family: ui-monospace, monospace;
    font-size: 14px;
  }

  /* 名称不截断：主数据里的名字普遍二三十个字（HND-D150_200KG_塑料桶…），
     单行省略号下根本认不出是哪个。让它换行，行高跟着内容走。
     单位不再单独占一列 —— 选中物料时本来就会按编码带出单位（见 selectMaterial），
     列在这里只是白占宽度、把名称挤没。 */
  &__name {
    flex: 1;
    min-width: 0;
    color: $ui-text-2;
    font-size: 14px;
    line-height: 1.45;
    word-break: break-all;
    white-space: normal;
  }
}

/* ===== 解析结果 =====
   两套排版共用一份 DOM，靠下面这个断点切换（不用两套模板 —— 两套模板意味着
   以后加一列要改两处，迟早会漂移）：
     · < 768px（手机/竖屏）：每行一张卡片，字段竖排、各自带标签，不横向滚动；
     · ≥ 768px（桌面 H5）：表头 + 网格行，回到表格观感。
   断点用 px 而不是 rpx：这里判断的是「屏幕有多宽」，不是「设计稿缩放比」。 */
$parse-breakpoint: 768px;

.result__head {
  padding: 14px 16px;
  border-bottom: 1px solid $ui-hairline;
}

.result__body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}

/* ---- 单据信息：整张单据一份 ---- */
.doc {
  padding: 14px 16px;
  border-bottom: 1px solid $ui-hairline;
}

.doc__row {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 标签列宽固定，让「单据号 / 领料时间 / 物料名称…」这些字段的输入框左边缘对齐 */
.doc__label,
.field__label,
.cell__label {
  flex: 0 0 68px;
  color: $ui-text-3;
  font-size: 13px;
}

.doc__type {
  min-width: 0;
  overflow: hidden;
  color: $ui-text;
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc__preview {
  display: flex;
  flex-shrink: 0;
  margin-left: auto;
  align-items: center;
  border: 0;
  padding: 4px 0 4px 8px;
  background-color: transparent;
  color: $ui-accent-text;
  font-size: 13px;
}

.doc__fields {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 20px;
  margin-top: 12px;
}

/* 手机端一行放不下两个字段（flex-basis 220 放不进 ~300px 的卡片），会自动各占一行 */
.field {
  display: flex;
  min-width: 0;
  flex: 1 1 220px;
  align-items: center;
  gap: 10px;
}

/* ---- 输入框 ----
   手机端常显底色与描边：触屏没有 hover，静默无边框的话根本看不出这里能改；
   桌面端仍回到「静默无边框、hover / focus 才显形」，免得整张表看起来像一屏表单控件。 */
.field__input,
.cell__input {
  min-width: 0;
  flex: 1 1 auto;
  height: 36px;
  border: 1px solid $ui-border;
  border-radius: $ui-radius-sm;
  padding: 0 10px;
  background-color: $ui-surface;
  color: $ui-text;
  font-size: 14px;
  outline: none;
  transition: border-color $ui-dur $ui-ease, background-color $ui-dur $ui-ease;
}

/* 占位符走 placeholder-class（uni 各端的写法，和登录页一致）；
   下面那条 ::placeholder 是给 H5 原生 input 兜底的 —— 两边都留着，
   哪一端认得哪一个都行，认不得的那条就是个空规则 */
.ui-placeholder {
  color: $ui-text-3;
}

.field__input::placeholder,
.cell__input::placeholder {
  color: $ui-text-3;
}

.body {
  padding: 14px 16px;
}

/* ---- 明细行 ---- */
/* 列宽：序号给够「序号」两个字的宽度（40px 会把表头挤成两行）；
   物料名称封顶在 340px —— 让它跟着 fr 一路撑开的话，名称右侧的搜索图标会被推到
   几百像素之外，跟它要搜的那一格对不上；
   富余的宽度留给物料编码（纯文本，右边空着最不碍事）；数量列定宽，保证小数点对齐 */
.rows--pick,
.rows--inbound {
  --row-cols: 56px minmax(160px, 340px) minmax(130px, 1fr) 104px 64px 56px;
}

.rows--unknown {
  --row-cols: 56px minmax(160px, 340px) minmax(130px, 1fr) 104px 56px;
}

.rows__head {
  // 手机端不给表头留位置：几百像素宽塞 6 列，表头只会被挤成竖排单字
  display: none;
}

.row {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  border-radius: $ui-radius-md;
  padding: 12px;
  background-color: $ui-surface-2;
}

.row:not(:first-child) {
  margin-top: 10px;
}

.row__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.row__seq {
  color: $ui-text-3;
  font-size: 12px;
  font-weight: 600;
}

/* 「删除该行」与「增加一行」是同一族控件：胶囊、同高同底色同字色，
   只有按下时的语义色不同（删=危险色、增=强调色）。
   高度写死而不是靠内容撑 —— 行首那颗和列表底部那颗必须一样高，
   否则一行一个字号的差异就会让它们看着不像一套东西。 */
.row__del,
.row-add {
  display: flex;
  height: 32px;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  border-radius: $ui-radius-pill;
  padding: 0 14px;
  background-color: $ui-raise-2;
  color: $ui-text-2;
  font-size: 13px;
  line-height: 1;
  transition: background-color $ui-dur $ui-ease, color $ui-dur $ui-ease;
}

.row-add:active {
  background-color: $ui-accent-soft;
  color: $ui-accent-text;
}

.row__del:active {
  background-color: $ui-danger-soft;
  color: $ui-danger;
}

.cell {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

/* 序号与删除在手机端挪到了行首的操作条上，不占字段位 */
.cell--index,
.cell--actions {
  display: none;
}

.cell__text {
  color: $ui-text-3;
  font-size: 13px;
}

.cell__code {
  min-width: 0;
  overflow: hidden;
  flex: 1 1 auto;
  color: $ui-text;
  font-family: ui-monospace, monospace;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 编码为空 = 这行还不能入库，用警示色让它在一片「—」里显出来 */
.cell__code.is-empty {
  color: $ui-warning;
}

.cell__search {
  display: flex;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 1px solid $ui-border;
  border-radius: $ui-radius-sm;
  background-color: $ui-surface;
  color: $ui-text-2;
}

.cell__search:active {
  border-color: $ui-accent-strong;
  background-color: $ui-accent-soft;
  color: $ui-accent-text;
}

.cell__del {
  display: flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: $ui-radius-sm;
  background-color: transparent;
  color: $ui-text-3;
}

.cell__del:active {
  background-color: $ui-danger-soft;
  color: $ui-danger;
}

.empty {
  border-radius: $ui-radius-md;
  padding: 12px;
  background-color: $ui-surface-2;
  color: $ui-text-2;
  font-size: 13px;
}

.rows-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  margin-top: 12px;
}

.rows-hint {
  color: $ui-text-3;
  font-size: 12px;
  line-height: 1.6;
}

.engine-line {
  margin-top: 8px;
  color: $ui-text-3;
  font-size: 12px;
}

/* ---- 确认入库 ---- */
.confirm {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  border-top: 1px solid $ui-hairline;
  padding: 14px 16px;
}

/* 手机端：提示在上、按钮整宽在下（挤在一行里按钮会被压成小半条） */
.confirm__msg {
  width: 100%;
  font-size: 12px;
  line-height: 1.6;
}

.confirm__msg.is-warn {
  color: $ui-warning;
}

.confirm__msg.is-error {
  color: $ui-danger;
}

.confirm__msg.is-done {
  color: $ui-success;
}

.confirm__btn {
  width: 100%;
}

/* ===== 桌面端（≥ 768px）：回到表格观感 ===== */
@media (min-width: $parse-breakpoint) {
  .result__head {
    padding: 14px 24px;
  }

  .result__body {
    gap: 20px;
    padding: 24px;
  }

  .doc,
  .body {
    padding: 16px 20px;
  }

  /* 表头行与数据行共享 --row-cols，列宽逐列对齐 */
  .rows__head,
  .row {
    display: grid;
    grid-template-columns: var(--row-cols);
    align-items: center;
  }

  .rows {
    overflow: hidden;
    border: 1px solid $ui-hairline;
    border-radius: $ui-radius-md;
  }

  .rows__head {
    border-bottom: 1px solid $ui-hairline;
  }

  .rows__th {
    padding: 8px 10px;
    color: $ui-text-3;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
  }

  /* 表头行与数据行共享 --row-cols，列宽逐列对齐 */
  .row {
    gap: 0;
    border-radius: 0;
    padding: 0;
    background-color: transparent;
  }

  .row:not(:first-child) {
    margin-top: 0;
    border-top: 1px solid $ui-hairline;
  }

  /* 序号 / 删除回到各自的列里 */
  .row__bar {
    display: none;
  }

  .cell {
    padding: 4px 10px;
    gap: 6px;
  }

  .cell__label {
    display: none;
  }

  .cell--index,
  .cell--actions {
    display: flex;
  }

  .cell--actions {
    justify-content: center;
  }

  .cell.is-center {
    justify-content: center;
  }

  .cell.is-center .cell__input {
    text-align: center;
  }

  .cell.is-right .cell__input {
    text-align: right;
  }

  .rows__th.is-center {
    text-align: center;
  }

  .rows__th.is-right {
    text-align: right;
  }

  .field__input,
  .cell__input,
  .cell__search {
    border-color: transparent;
    background-color: transparent;
  }

  .field__input:hover,
  .cell__input:hover {
    border-color: $ui-border;
  }

  .field__input:focus,
  .cell__input:focus {
    border-color: $ui-accent;
    background-color: $ui-surface;
  }

  .cell__search:hover {
    background-color: $ui-raise-2;
    color: $ui-text;
  }

  .rows-actions {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
  }

  .row-add:hover {
    background-color: $ui-accent-soft;
    color: $ui-accent-text;
  }

  .row__del:hover,
  .cell__del:hover,
  .clear-btn:hover {
    background-color: $ui-danger-soft;
    color: $ui-danger;
  }

  /* 按钮与提示可以同处一行了：提示左、按钮右 */
  .confirm__msg {
    width: auto;
    flex: 1 1 auto;
    margin-right: auto;
  }

  .confirm__btn {
    width: auto;
    flex: 0 0 auto;
  }
}
</style>
