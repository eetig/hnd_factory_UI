<script setup>
import { computed, onUnmounted, ref } from 'vue'
import request from '../api/request'
import { uploadFile } from '../api/upload'
import { formatFileSize } from '../utils/format'
import { matchMaterial, materialLookupError, searchMaterials } from '../composables/useMaterialMaster'
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
  if (dragActive.value) return 'border-sky-500 bg-sky-50'
  return 'border-slate-300 hover:border-sky-400'
})

// 从相册 / 相机选图。
// 改造前是隐藏的 <input type="file" multiple> + .click()；App 与小程序端没有 DOM，
// 改用 uni.chooseImage —— 三端统一，App/小程序端还能直接调相机。
function openFilePicker() {
  if (isFull.value) return

  uni.chooseImage({
    count: remaining.value,
    sizeType: ['original', 'compressed'],
    sourceType: ['camera', 'album'],
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
  pickerVisible.value = false
  pickerRow.value = null
  pickerImage.value = null
}

function closeMaterialPicker() {
  // 取消待发的防抖请求，避免弹窗已关还在打接口
  clearTimeout(pickerSearchTimer)
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
// 差异只有时间与数量两列的标题，以及未知类型退化为通用列
const PICK_COLUMNS = [
  { key: 'index', label: '序号', align: 'center' },
  { key: 'documentNo', label: '单据号' },
  { key: 'date', label: '领料时间' },
  { key: 'materialName', label: '物料名称' },
  { key: 'materialCode', label: '物料编码' },
  { key: 'quantity', label: '领料数量', align: 'right' },
  { key: 'unit', label: '单位', align: 'center' },
  { key: 'image', label: '线下单据', align: 'center' },
]

const INBOUND_COLUMNS = [
  { key: 'index', label: '序号', align: 'center' },
  { key: 'documentNo', label: '单据号' },
  { key: 'date', label: '入库时间' },
  { key: 'materialName', label: '物料名称' },
  { key: 'materialCode', label: '物料编码' },
  { key: 'quantity', label: '入库数量', align: 'right' },
  { key: 'unit', label: '单位', align: 'center' },
  { key: 'image', label: '线下单据', align: 'center' },
]

const UNKNOWN_COLUMNS = [
  { key: 'index', label: '序号', align: 'center' },
  { key: 'documentNo', label: '单据号' },
  { key: 'date', label: '日期' },
  { key: 'materialName', label: '物料名称' },
  { key: 'materialCode', label: '物料编码' },
  { key: 'quantity', label: '数量', align: 'right' },
]

const COLUMNS = { pick: PICK_COLUMNS, inbound: INBOUND_COLUMNS, unknown: UNKNOWN_COLUMNS }

/**
 * 把识别结果摊成表格：单据头字段（单据号 / 日期）下放到每一行。
 *
 * <p>行项目来自识别结果，所以「一行」= 识别出的一条物料。
 * 单位不识别（见变更-003 字段范围：单位由业务方按物料编码查主数据带出），故留空待人工补。
 *
 * <p>单据号与日期单独放在 {@code doc} 而不是每行各存一份：它们属于整张单据，
 * 逐行存会让同一张单出现两个单号。表格里仍按列渲染，但改一处全表同步。
 *
 * <p>返回的是<b>可编辑副本</b>，{@code image.result} 保留识别原始值不动 ——
 * 人工校准后仍需能对照「模型原本给了什么」。
 */
function buildTable(result) {
  const kind = resolveDocKind(result?.documentType)

  const rows = (result?.items || []).map((item, index) => ({
    index: index + 1,
    materialName: fieldText(item.materialName),
    // 物料编码【不取识别值】，一律从空开始，等主数据按名称反查填入。
    // 理由：纸质单该列本就空白，模型对空白列会吐占位值或误取相邻的「规格」列
    // （实测出现过 materialCode="不存在"、"2.260813"）。留着它只会让人误以为是真编码。
    // 识别原值仍保留在 image.result 里，需要追溯时看得到。
    materialCode: '',
    quantity: fieldText(item.quantity),
    unit: '',
    // 该行的物料候选（由 enrichMaterials 填充），供「查不到时人工选」
    candidates: [],
  }))

  return {
    kind,
    columns: COLUMNS[kind],
    doc: {
      documentNo: fieldText(result?.documentNo),
      date: fieldText(result?.docDate),
    },
    rows,
  }
}

/** 可编辑单元格：静默时不显边框，悬停/聚焦才提示可改，避免整表看起来像表单控件 */
function inputClass(col) {
  return [
    'w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm text-slate-900 outline-none',
    'transition placeholder:text-slate-300 hover:border-slate-300 focus:border-sky-500 focus:bg-white',
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
      file: image.file,
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
          :class="isFull ? 'bg-slate-100 text-slate-400' : 'bg-sky-50 text-sky-600'"
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
          已选 <span class="font-semibold text-sky-600">{{ images.length }}</span> /
          {{ MAX_COUNT }} 张
        </p>
        <button
          type="button"
          class="text-sm text-slate-500 transition hover:text-rose-600 focus:outline-none disabled:cursor-not-allowed disabled:text-slate-300"
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
        class="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
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
      <div class="flex items-center justify-between border-b border-slate-100 px-6 py-3.5">
        <p class="text-sm text-slate-600">
          解析结果 · 成功
          <span class="font-semibold text-emerald-600">{{ successCount }}</span>
          <template v-if="errorCount">
            · 失败 <span class="font-semibold text-rose-600">{{ errorCount }}</span>
          </template>
        </p>
      </div>

      <div class="space-y-5 p-6">
        <article
          v-for="image in submitted"
          :key="image.id"
          class="overflow-hidden rounded-lg border border-slate-200"
        >
          <header class="flex items-center gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
            <img
              :src="image.url"
              :alt="image.name"
              class="h-10 w-10 shrink-0 rounded border border-slate-200 object-cover"
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
            <p class="px-4 pb-3 pt-4 text-sm text-slate-600">
              单据类型
              <span class="ml-1 font-medium text-slate-900">
                {{ fieldText(image.result.documentType) || '未识别' }}
              </span>
            </p>

            <div class="px-4 pb-4">
              <table v-if="image.table?.rows.length" class="w-full border-collapse text-sm">
                <thead>
                  <tr class="bg-slate-50 text-slate-600">
                    <th
                      v-for="col in image.table.columns"
                      :key="col.key"
                      class="border border-slate-200 px-3 py-2 font-medium"
                      :class="alignClass(col)"
                    >
                      {{ col.label }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in image.table.rows" :key="row.index">
                    <td
                      v-for="col in image.table.columns"
                      :key="col.key"
                      class="border border-slate-200 px-1.5 py-1 align-middle"
                    >
                      <!-- 线下单据：原图缩略图，点开可放大 -->
                      <div v-if="col.key === 'image'" class="flex justify-center">
                        <!-- el-image 的自带预览（preview-src-list）在 uni 里没有对应物，
                             改用 uni.previewImage 这个原生大图预览能力 -->
                        <image
                          class="picker-thumb"
                          :src="image.url"
                          mode="aspectFill"
                          @click="previewImage(image.url)"
                        />
                      </div>

                      <!-- 序号：识别顺序，不参与校正 -->
                      <span v-else-if="col.key === 'index'" class="block text-center text-slate-500">
                        {{ row.index }}
                      </span>

                      <!-- 单据号 / 日期：整张单据共用一个值，改一处即全表同步 -->
                      <input
                        v-else-if="col.key === 'documentNo'"
                        v-model="image.table.doc.documentNo"
                        type="text"
                        placeholder="—"
                        :class="inputClass(col)"
                      />
                      <input
                        v-else-if="col.key === 'date'"
                        v-model="image.table.doc.date"
                        type="text"
                        placeholder="—"
                        :class="inputClass(col)"
                      />

                      <!-- 物料名称：改完重查一次编码；右侧搜索图标可手工挑物料（选中后名称与编码一起回填） -->
                      <div v-else-if="col.key === 'materialName'" class="relative">
                        <input
                          v-model="row.materialName"
                          type="text"
                          placeholder="—"
                          class="pr-6"
                          :class="inputClass(col)"
                          @change="handleNameChange(row, image)"
                        />
                        <button
                          type="button"
                          class="absolute right-0.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-slate-400 transition hover:bg-sky-50 hover:text-sky-600"
                          title="搜索物料（选中后自动填名称与编码）"
                          @click="openMaterialPicker(row, image)"
                        >
                          <wd-icon name="search" size="14px" />
                        </button>
                      </div>

                      <!-- 物料编码：只读 —— 只能由主数据按名称带出，不允许手填。
                           手填的编码格式合法、能一路混到落库，是错码的主要来源；
                           要改编码请走「物料名称」右侧的搜索入口，名称与编码一起换。 -->
                      <span
                        v-else-if="col.key === 'materialCode'"
                        class="block px-1.5 py-1 text-sm"
                        :class="row.materialCode ? 'text-slate-900' : 'text-slate-300'"
                      >
                        {{ row.materialCode || '—' }}
                      </span>

                      <!-- 其余字段：逐行独立编辑 -->
                      <input
                        v-else
                        v-model="row[col.key]"
                        type="text"
                        placeholder="—"
                        :class="inputClass(col)"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>

              <p v-else class="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-500">
                未识别到行项目。
              </p>

              <p class="mt-2 text-xs text-slate-400">
                识别引擎 {{ image.result.engine || '—' }} · 耗时
                {{ image.result.costMillis != null ? `${image.result.costMillis} ms` : '—' }}
              </p>
            </div>

            <!-- 确认入库：按单据类型分流（领料单→领料汇总，入库单→入库汇总），落库复用文件导入那条管线 -->
            <div
              class="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 border-t border-slate-100 px-4 py-3"
            >
              <p
                v-if="image.confirm?.message"
                class="mr-auto text-xs"
                :class="image.confirm.status === 'error' ? 'text-rose-600' : 'text-emerald-700'"
              >
                {{ image.confirm.message }}
              </p>
              <p v-else-if="confirmBlockReason(image)" class="mr-auto text-xs text-amber-700">
                {{ confirmBlockReason(image) }}
              </p>

              <button
                type="button"
                class="shrink-0 rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
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
    <!-- 物料选择器。原为 el-dialog（width="640px" 居中弹窗）。
         移动端改成底部弹层 + scroll-view —— 注意小程序的 <view> 上写
         overflow-y: auto 是不会滚的，必须用 scroll-view 才滚得起来。 -->
    <wd-popup
      v-model="pickerVisible"
      position="bottom"
      round
      safe-area-inset-bottom
      custom-style="max-height: 80vh; display: flex; flex-direction: column;"
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

      <scroll-view v-else-if="pickerResults.length" class="picker-list" scroll-y>
        <view
          v-for="item in pickerResults"
          :key="`${item.code}|${item.name}`"
          class="picker-item"
          @click="selectMaterial(item)"
        >
          <text class="picker-item__code">{{ item.code }}</text>
          <text class="picker-item__name">{{ item.name }}</text>
          <text class="picker-item__unit">{{ item.unit || '' }}</text>
        </view>
      </scroll-view>

      <p v-else class="py-6 text-center text-sm text-slate-500">没有匹配的物料，请换个关键词。</p>
    </wd-popup>
  </div>
</template>

<style scoped lang="scss">
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
  padding: 0 12px;
  border: 1px solid $slate-300;
  border-radius: 8px;
  color: $slate-400;

  &__input {
    flex: 1;
    min-height: 40px;
    color: $slate-900;
    font-size: 14px;
  }

  &__ph {
    color: $slate-400;
  }
}

.picker-list {
  /* scroll-view 必须有确定高度才会滚动 */
  height: 56vh;
  margin: 0 20px 20px;
  border: 1px solid $slate-200;
  border-radius: 8px;
}

.picker-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;

  &:not(:first-child) {
    border-top: 1px solid $slate-100;
  }

  &__code {
    flex-shrink: 0;
    width: 112px;
    color: $slate-900;
    font-family: ui-monospace, monospace;
    font-size: 14px;
  }

  &__name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: $slate-700;
    font-size: 14px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__unit {
    flex-shrink: 0;
    color: $slate-400;
    font-size: 12px;
  }
}

/* 识别结果里的物料缩略图（替代 el-image 的 fit="cover"） */
.picker-thumb {
  width: 32px;
  height: 32px;
  border: 1px solid $slate-200;
  border-radius: 4px;
}
</style>
