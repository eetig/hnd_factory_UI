<script setup>
import { computed, h, nextTick, ref, watch } from 'vue'
import { ElButton, ElDatePicker, ElDrawer, ElInput, ElMessage, ElMessageBox, ElSelect, ElOption } from 'element-plus'
import { expireBadge, fileSizeText } from './useArchiveColumns'

/**
 * 资料抽屉（变更-126）：**新建与编辑共用一个抽屉**。
 *
 * <p>为什么是抽屉不是行内编辑：沿用 变更-117 的结论 —— 行内录入在宽表里填到后面要横滚、
 * 还要在表头与输入框之间来回对位；资料有 8 个字段，竖排一屏能看完。
 *
 * <p>与采购抽屉同一条不易：Esc / 点遮罩 / 点 × 都先问「有未保存改动」，别让改了半天悄悄丢。
 */
const props = defineProps({
  /*
   * 遮罩要不要挂到 body（默认 true，2026-10-22 变更-141）。
   *
   * 必须是 true：抽屉如果渲染在页面容器里，页面头卡所在的兄弟层叠上下文会把它压住
   * （采购需求抽屉的标题就这样被吃掉过）。留成 prop 只为一件事 —— 组件测试可以传 false，
   * 让 DOM 留在原地供 wrapper.find 查询（teleport 打桩在 ElSelect 上会触发递归更新）。
   */
  appendToBody: { type: Boolean, default: true },
  modelValue: { type: Boolean, default: false },
  mode: { type: String, default: 'edit' }, // 'create' | 'edit'
  row: { type: Object, default: null },
  canEdit: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
  /** 扁平化的分类选项：[{ value, label, disabled }] */
  categoryOptions: { type: Array, default: () => [] },
  /**
   * AI 归类建议（2026-11-05）。null 表示还没有。
   * 由 ArchivePanel 在上传成功后异步拿回来，不阻塞保存。
   */
  aiSuggestion: { type: Object, default: null },
})

const emit = defineEmits([
  'update:modelValue',
  'save',
  'delete',
  'upload',
  // 拖进来多个文件（2026-11-17，变更-225）：父组件负责逐个上传 + 问 AI，回调把结果原样回传
  'upload-batch',
  // 批量落库：一次把这几份各存成一条资料
  'save-batch',
])

const isCreate = computed(() => props.mode === 'create')
const title = computed(() => (isCreate.value ? '新增资料' : '资料详情'))

const form = ref(blank())
let snapshot = ''
/** 上传中（上传是独立的一步：先传文件拿对象名，再保存表单） */
const uploading = ref(false)
const fileInput = ref(null)

/*
 * 拖拽归档（2026-11-17，变更-225，使用方 m07610 的五个回答）
 *
 *   · 落点 = **整个抽屉**（不是在「选择文件」那个小按钮上对准）；
 *   · 拖 1 个 → 走原来的单条表单（还能填有效期、原件在哪）；
 *   · 拖多个 → 落成「多条资料」，每一份自己一行，名称与分类都齐了才允许保存；
 *   · 上传**立刻**发生（不等点保存），所以关抽屉前必须问一句，否则白传；
 *   · 不合规的文件**一次列全**（类型不对 / 超 30MB / 超过 20 个），不一个个弹。
 */
const ALLOWED_EXT = [
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'txt', 'md',
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'zip', 'rar', '7z',
]
const MAX_FILE_BYTES = 30 * 1024 * 1024
const MAX_BATCH = 20

const dragging = ref(false)
let dragDepth = 0
/** 批量列表：[{ key, name, categoryId, fileName, origName, fileSize, mimeType, confidence, state, error }] */
const batch = ref([])

function extOf(name) {
  const matched = /\.([A-Za-z0-9]+)$/.exec(String(name || ''))
  return matched ? matched[1].toLowerCase() : ''
}

function bytesText(bytes) {
  const n = Number(bytes) || 0
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

/** 文件名当默认名：去掉扩展名，下划线换成空格（`安全许可证_2026.pdf` → `安全许可证 2026`） */
function nameFromFile(fileName) {
  const base = String(fileName || '').replace(/\.[^.]+$/, '')
  return base.replace(/[_]+/g, ' ').trim().slice(0, 128)
}

function rejectReason(file) {
  if (!file) return '读不到文件'
  if (file.size > MAX_FILE_BYTES) return `超过 30MB（${bytesText(file.size)}）`
  if (!ALLOWED_EXT.includes(extOf(file.name))) return '类型不支持'
  return ''
}

function onDragEnter() {
  if (!props.canEdit) return
  dragDepth += 1
  dragging.value = true
}

function onDragOver(event) {
  // 不 preventDefault 的话浏览器会「打开这个文件」，把当前页面换掉
  event?.preventDefault?.()
}

function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dragging.value = false
}

async function onDrop(event) {
  dragDepth = 0
  dragging.value = false
  const files = Array.from(event?.dataTransfer?.files || [])
  await takeFiles(files)
}

/** 拖拽与「选择文件」共用的入口（选择文件在创建态也允许多选） */
async function takeFiles(files) {
  if (!props.canEdit || !files.length) return
  const rejected = []
  const accepted = []
  for (const file of files) {
    const why = rejectReason(file)
    if (why) rejected.push(`${file.name}：${why}`)
    else accepted.push(file)
  }
  if (accepted.length > MAX_BATCH) {
    rejected.push(`一次最多 ${MAX_BATCH} 个，多出的 ${accepted.length - MAX_BATCH} 个没上传`)
    accepted.length = MAX_BATCH
  }
  if (rejected.length) {
    // 用 VNode 而不是 HTML 字符串：文件名是不可信输入，拼 HTML 等于自己开 XSS 口子
    ElMessageBox.alert(
      h('div', { style: 'white-space: pre-line; line-height: 1.7' }, rejected.join('\n')),
      '这几个没上传',
      { confirmButtonText: '知道了', type: 'warning' },
    ).catch(() => {})
  }
  if (!accepted.length) return
  // 拖到编辑态 / 只拖一个 → 单条：沿用原来的「先传文件、再填表单」
  if (!isCreate.value || (accepted.length === 1 && batch.value.length === 0)) {
    if (accepted.length > 1) ElMessage.info('这次只放了第一个，批量归档请用「新增资料」')
    await uploadSingle(accepted[0])
    return
  }
  await addToBatch(accepted)
}

async function uploadSingle(file) {
  uploading.value = true
  try {
    const res = await emitUpload(file)
    if (res) {
      form.value.fileName = res.fileName
      form.value.origName = res.origName || file.name
      form.value.fileSize = res.size || file.size
      form.value.mimeType = res.contentType || file.type
      if (!form.value.name.trim()) form.value.name = nameFromFile(file.name)
    }
  } finally {
    uploading.value = false
  }
}

async function addToBatch(files) {
  const start = batch.value.length
  files.forEach((file, offset) => {
    batch.value.push({
      key: `batch-${Date.now()}-${start + offset}`,
      name: nameFromFile(file.name),
      categoryId: null,
      fileName: '',
      origName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      confidence: '',
      state: 'uploading',
      error: '',
    })
  })
  const pending = files.map((file) => file)
  const results = await new Promise((resolve) => emit('upload-batch', pending, resolve))
  const list = Array.isArray(results) ? results : []
  list.forEach((result, offset) => {
    const item = batch.value[start + offset]
    if (!item) return
    if (!result || result.ok === false) {
      item.state = 'failed'
      item.error = result?.error || '上传失败'
      return
    }
    item.state = 'ready'
    item.fileName = result.fileName || ''
    item.origName = result.origName || item.origName
    item.fileSize = result.size || item.fileSize
    item.mimeType = result.contentType || item.mimeType
    const suggestion = result.suggestion || null
    if (suggestion) {
      item.confidence = suggestion.confidence || ''
      // 只填还空着的：AI 不覆盖人已经改过的字
      if (!String(item.name || '').trim() && suggestion.name) item.name = suggestion.name
      if ((item.categoryId === null || item.categoryId === undefined) && suggestion.categoryId) {
        item.categoryId = suggestion.categoryId
      }
    }
  })
}

function removeBatch(index) {
  batch.value.splice(index, 1)
}

function clearBatch() {
  batch.value = []
}

function confidenceText(level) {
  if (level === 'high') return '置信度高'
  if (level === 'medium') return '置信度中'
  return '置信度低，请确认'
}

function saveBatch() {
  if (!props.canEdit || props.saving) return
  let firstProblem = ''
  batch.value.forEach((item, index) => {
    item.error = ''
    if (item.state === 'failed') {
      item.error = '这个文件没传上去，先删掉重传'
    } else if (item.state === 'uploading') {
      item.error = '还在上传，等一下再保存'
    } else if (!String(item.name || '').trim()) {
      item.error = '资料名称空着'
    } else if (item.categoryId === null || item.categoryId === undefined) {
      item.error = '还没选分类'
    }
    if (item.error && !firstProblem) firstProblem = `第 ${index + 1} 条${item.error}`
  })
  if (firstProblem) {
    ElMessage.warning(firstProblem)
    return
  }
  emit(
    'save-batch',
    batch.value.map((item) => ({
      id: null,
      name: item.name.trim(),
      categoryId: item.categoryId,
      fileName: item.fileName,
      origName: item.origName,
      fileSize: item.fileSize,
      mimeType: item.mimeType,
      expireDate: '',
      originPlace: '',
      docNo: '',
      owner: '',
      remark: '',
    })),
  )
}

// 批量里还有没落库的资料也算「未保存」，否则关抽屉时会被静默丢掉（文件已经传上去了）
const dirty = computed(() => batch.value.length > 0 || JSON.stringify(form.value) !== snapshot)

/*
 * AI 建议落地（2026-11-05）
 *
 * 只填**还空着**的字段：人可能已经手动选了分类、敲了编号，覆盖上去就是越帮越忙。
 * 置信度原样保留，界面上一行小字说明来源（低置信度会写成"请确认"）。
 */
watch(
  () => props.aiSuggestion,
  (suggestion) => {
    if (!suggestion) return
    const fill = (key, value) => {
      if (!value && value !== 0) return false
      const current = form.value[key]
      if (current !== null && current !== undefined && String(current).trim() !== '') return false
      form.value[key] = value
      return true
    }
    fill('categoryId', suggestion.categoryId)
    fill('name', suggestion.name)
    fill('docNo', suggestion.docNo)
    fill('owner', suggestion.owner)
    fill('expireDate', suggestion.expireDate)
    fill('originPlace', suggestion.originPlace)
    // 备注摘要（2026-11-05）：AI 给的 summary 只在备注为空时写入 —— 你手写的不覆盖
    fill('remark', suggestion.summary)
  },
)

function blank() {
  return {
    id: null,
    name: '',
    categoryId: null,
    fileName: '',
    origName: '',
    fileSize: 0,
    mimeType: '',
    expireDate: '',
    originPlace: '',
    docNo: '',
    owner: '',
    remark: '',
  }
}

const expire = computed(() => {
  if (!form.value.expireDate) return { text: '未设置', className: 'text-slate-500' }
  const today = new Date()
  const d = new Date(`${form.value.expireDate}T00:00:00`)
  const days = Math.round((d - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000)
  return expireBadge(days)
})

const sizeText = computed(() => fileSizeText(form.value.fileSize))

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return
    form.value = props.mode === 'edit' && props.row ? { ...blank(), ...normalize(props.row) } : blank()
    // 每次打开都从干净的一批开始：上一次保存完就关抽屉了，残留的批量会串到下一次
    batch.value = []
    snapshot = JSON.stringify(form.value)
    await nextTick()
    if (isCreate.value) {
      // 抽屉的焦点陷阱会在首帧抢焦点，等一帧再聚焦（同 变更-117 的处理）
      setTimeout(() => document.getElementById('af-name')?.focus?.(), 60)
    }
  },
  { immediate: true },
)

/** VO → 表单：日期要转成 'YYYY-MM-DD' 字符串（el-date-picker 的 value-format） */
function normalize(row) {
  return {
    id: row.id,
    name: row.name || '',
    categoryId: row.categoryId,
    fileName: row.fileName || '',
    origName: row.origName || '',
    fileSize: row.fileSize || 0,
    mimeType: row.mimeType || '',
    expireDate: row.expireDate || '',
    originPlace: row.originPlace || '',
    docNo: row.docNo || '',
    owner: row.owner || '',
    remark: row.remark || '',
  }
}

function close() {
  emit('update:modelValue', false)
}

async function requestClose() {
  if (!dirty.value) {
    close()
    return
  }
  try {
    await ElMessageBox.confirm('关闭后未保存的改动会丢失，确定关闭？', '未保存的改动', {
      confirmButtonText: '关闭',
      cancelButtonText: '继续编辑',
      type: 'warning',
    })
  } catch {
    return
  }
  close()
}

function beforeClose(done) {
  if (!dirty.value) {
    done()
    return
  }
  requestClose()
}

/** 回车提交，但只在输入框里（下拉/日期面板里回车不该顺手保存） */
function onEnter(event) {
  if (event.target?.tagName !== 'INPUT') return
  event.preventDefault()
  submit()
}

function submit() {
  if (!props.canEdit || props.saving) return
  if (!form.value.name.trim()) {
    ElMessage.warning('资料名称不能为空')
    return
  }
  if (form.value.categoryId === null || form.value.categoryId === undefined) {
    ElMessage.warning('请选择分类')
    return
  }
  if (!form.value.fileName && !form.value.originPlace.trim()) {
    // 与后端同一条跨字段规则，前端先拦一道（后端仍然会判，别指望前端）
    ElMessage.warning('请上传文件，或填写「原件在哪」')
    return
  }
  emit('save', { ...form.value })
}

function pickFile() {
  fileInput.value?.click?.()
}

async function onFileChange(event) {
  const files = Array.from(event.target?.files || [])
  event.target.value = ''
  if (!files.length) return
  // 选文件与拖拽走同一条路：单条 / 批量、只支持的类型、超限都在 takeFiles 里判
  await takeFiles(files)
}

/** 上传要走父组件（它有 toast 与统一的错误处理）；用 Promise 包一层方便这里 await */
function emitUpload(file) {
  return new Promise((resolve) => {
    emit('upload', file, resolve)
  })
}

function clearFile() {
  form.value.fileName = ''
  form.value.origName = ''
  form.value.fileSize = 0
  form.value.mimeType = ''
}

function onDelete() {
  emit('delete', props.row)
}
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    :append-to-body="appendToBody"
    direction="rtl"
    :size="'min(520px, 100vw)'"
    :close-on-press-escape="false"
    :before-close="beforeClose"
    :show-close="false"
    class="archive-drawer"
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <!-- AI 归类建议（2026-11-05）：一行小字 + 置信度；低置信度明确要求人工确认 -->
    <div
      v-if="aiSuggestion"
      class="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-line bg-region px-3 py-2"
    >
      <span class="rounded bg-brand/10 px-1.5 py-0.5 text-[11px] font-medium text-brand-ink">AI 建议</span>
      <span class="text-[11px] text-slate-600">
        {{ aiSuggestion.categoryName || '未能判断分类' }}
        <template v-if="aiSuggestion.confidence === 'high'">· 置信度高</template>
        <template v-else-if="aiSuggestion.confidence === 'medium'">· 置信度中</template>
        <template v-else>· 置信度低，请确认</template>
      </span>
      <span v-if="aiSuggestion.reason" class="text-[11px] text-slate-500">（{{ aiSuggestion.reason }}）</span>
      <span v-if="aiSuggestion.source === 'rule'" class="text-[11px] text-amber-700">
        · 未配置模型，按文件名匹配
      </span>
    </div>

    <template #header>
      <div class="flex w-full items-center justify-between gap-3">
        <div class="min-w-0">
          <h2 class="truncate text-lg font-serif font-bold tracking-tight text-slate-900">
            {{ title }}
          </h2>
          <p v-if="!isCreate && row" class="mt-1 flex items-center gap-2 text-xs text-slate-500">
            <span>{{ row.categoryName || '未分类' }}</span>
            <span v-if="row.daysToExpire !== null && row.daysToExpire !== undefined" :class="expire.className">
              {{ expire.text }}
            </span>
          </p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-full p-1.5 text-slate-500 transition-colors hover:bg-region hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
          aria-label="关闭抽屉"
          @click="requestClose"
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </template>

    <div
      class="relative flex min-h-full flex-col gap-6 pb-2"
      @keydown.enter.exact="onEnter"
      @keydown.esc.stop.prevent="requestClose"
      @dragenter.prevent="onDragEnter"
      @dragover.prevent="onDragOver"
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
    >
      <!-- 拖进来时铺满抽屉（变更-225）：落点是整个抽屉，不是那个小按钮 -->
      <div v-if="dragging" class="adx-drop pointer-events-none" aria-hidden="true">
        <div class="adx-drop__box">
          <p class="adx-drop__title">松手就归档</p>
          <p class="adx-drop__hint">可一次拖多个 · PDF / Word / Excel / 图片 / ZIP，单个 ≤30MB</p>
          <p class="adx-drop__hint">拖 1 个进表单，拖多个存成多条资料</p>
        </div>
      </div>

      <p v-if="errorMessage" role="alert" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
        {{ errorMessage }}
      </p>

      <!-- 批量归档（变更-225）：每份单独存一条，名称 + 分类齐了才能保存 -->
      <section v-if="batch.length" class="space-y-2" aria-label="本批资料">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-xs font-semibold tracking-wide text-slate-500">本批 {{ batch.length }} 份</h3>
          <button
            type="button"
            class="rounded-full px-2 py-0.5 text-xs text-slate-500 transition-colors hover:bg-region hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
            @click="clearBatch"
          >
            清空
          </button>
        </div>

        <div v-for="(item, index) in batch" :key="item.key" class="adx-batch" :class="{ 'is-bad': item.error }">
          <div class="flex items-center gap-2">
            <span class="w-4 shrink-0 text-[11px] tabular-nums text-slate-500">{{ index + 1 }}</span>
            <span class="min-w-0 flex-1 truncate text-xs text-slate-500" :title="item.origName">
              {{ item.origName }} · {{ bytesText(item.fileSize) }}
            </span>
            <span v-if="item.state === 'uploading'" class="shrink-0 text-[11px] text-slate-500">上传中…</span>
            <span v-else-if="item.state === 'failed'" class="shrink-0 text-[11px] text-rose-600">没传上去</span>
            <span v-else-if="item.confidence" class="shrink-0 text-[11px] text-slate-500">
              AI {{ confidenceText(item.confidence) }}
            </span>
            <button
              type="button"
              class="shrink-0 rounded-full p-1 text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
              :aria-label="`移除第 ${index + 1} 份`"
              @click="removeBatch(index)"
            >
              <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <div class="mt-2 grid grid-cols-[minmax(0,1fr)_132px] gap-2">
            <el-input v-model="item.name" size="small" placeholder="资料名称" :aria-label="`第 ${index + 1} 份名称`"
                      maxlength="128" @input="item.error = ''" />
            <el-select v-model="item.categoryId" size="small" filterable clearable placeholder="分类"
                       :aria-label="`第 ${index + 1} 份分类`" class="!w-full" @change="item.error = ''">
              <el-option v-for="c in categoryOptions" :key="c.value" :label="c.label" :value="c.value" :disabled="c.disabled" />
            </el-select>
          </div>

          <p v-if="item.error" class="mt-1 text-[11px] text-rose-600">{{ item.error }}</p>
        </div>

        <p class="text-xs text-slate-500">文件已经在传，名称与分类都填好才能保存；每份都会存成一条资料。</p>
      </section>

      <template v-if="!batch.length">

      <!-- 基本信息 -->
      <section class="space-y-3">
        <h3 class="text-xs font-semibold tracking-wide text-slate-500">基本信息</h3>

        <div class="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
          <label for="af-name" class="text-sm text-slate-600">资料名称</label>
          <el-input id="af-name" v-model="form.name" placeholder="例如：安全生产许可证（2026-2029）"
                    aria-label="资料名称" :disabled="!canEdit" maxlength="128" />
        </div>

        <div class="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
          <label for="af-category" class="text-sm text-slate-600">分类</label>
          <el-select id="af-category" v-model="form.categoryId" filterable clearable
                     placeholder="选择分类" aria-label="分类" :disabled="!canEdit" class="!w-full">
            <el-option v-for="c in categoryOptions" :key="c.value" :label="c.label"
                       :value="c.value" :disabled="c.disabled" />
          </el-select>
        </div>

        <div class="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
          <label for="af-docno" class="text-sm text-slate-600">编号文号</label>
          <el-input id="af-docno" v-model="form.docNo" placeholder="可选" aria-label="编号文号"
                    :disabled="!canEdit" maxlength="64" />
        </div>

        <div class="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
          <label for="af-owner" class="text-sm text-slate-600">责任人</label>
          <el-input id="af-owner" v-model="form.owner" placeholder="可选" aria-label="责任人"
                    :disabled="!canEdit" maxlength="64" />
        </div>
      </section>

      <!-- 文件与原件 -->
      <section class="space-y-3">
        <h3 class="text-xs font-semibold tracking-wide text-slate-500">文件与原件</h3>

        <div class="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-x-3 gap-y-1">
          <span class="pt-1.5 text-sm text-slate-600">电子件</span>
          <div class="min-w-0 space-y-2">
            <div v-if="form.fileName" class="flex flex-wrap items-center gap-2 text-sm">
              <span class="min-w-0 truncate text-slate-900" :title="form.origName">{{ form.origName || form.fileName }}</span>
              <span v-if="sizeText" class="text-xs text-slate-500">{{ sizeText }}</span>
              <button v-if="canEdit" type="button"
                      class="rounded-full border border-line px-2 py-0.5 text-xs text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
                      @click="pickFile">替换</button>
              <button v-if="canEdit" type="button"
                      class="rounded-full border border-line px-2 py-0.5 text-xs text-slate-600 transition-colors hover:border-rose-300 hover:text-rose-600 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
                      @click="clearFile">清除</button>
            </div>
            <div v-else class="flex items-center gap-2 text-sm text-slate-500">
              <button v-if="canEdit" type="button" :disabled="uploading"
                      class="rounded-full border border-line px-3 py-1 text-xs text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-900 disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
                      @click="pickFile">
                {{ uploading ? '上传中…' : '选择文件' }}
              </button>
              <span v-else class="text-xs">无</span>
              <span class="text-xs text-slate-500">PDF / Word / Excel / 图片 / ZIP，≤30MB · 可直接拖进来</span>
            </div>
            <input ref="fileInput" type="file" class="hidden" :multiple="isCreate"
                   accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv,.zip,.rar,.7z"
                   @change="onFileChange" />
          </div>
        </div>

        <div class="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
          <label for="af-origin" class="text-sm text-slate-600">原件在哪</label>
          <el-input id="af-origin" v-model="form.originPlace" placeholder="部门 / 柜子 / 保管人"
                    aria-label="原件在哪" :disabled="!canEdit" maxlength="128" />
        </div>
        <p class="pl-[100px] text-xs text-slate-500">电子件与「原件在哪」至少填一个，否则这条资料找不回来。</p>

        <div class="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
          <label for="af-expire" class="text-sm text-slate-600">有效期至</label>
          <div class="min-w-0">
            <el-date-picker id="af-expire" v-model="form.expireDate" type="date" value-format="YYYY-MM-DD"
                            placeholder="证照/校验/培训类才填" aria-label="有效期至" :disabled="!canEdit" class="!w-full" />
            <p class="mt-1 text-xs" :class="expire.className">{{ form.expireDate ? expire.text : '不填 = 无有效期' }}</p>
          </div>
        </div>
      </section>

      <!-- 备注 -->
      <section class="space-y-3">
        <h3 class="text-xs font-semibold tracking-wide text-slate-500">备注</h3>
        <div class="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-x-3">
          <label for="af-remark" class="pt-1.5 text-sm text-slate-600">备注</label>
          <el-input id="af-remark" v-model="form.remark" type="textarea" :rows="3" maxlength="500"
                    show-word-limit aria-label="备注" :disabled="!canEdit" />
        </div>
      </section>
      </template>
    </div>

    <template #footer>
      <div class="flex w-full items-center justify-between gap-3">
        <el-button v-if="canEdit && !isCreate && row" type="danger" plain :disabled="saving" @click="onDelete">
          删除
        </el-button>
        <span v-else />
        <div class="flex items-center gap-2">
          <el-button :disabled="saving || uploading" @click="requestClose">取消</el-button>
          <el-button v-if="canEdit && batch.length" type="primary" :loading="saving" @click="saveBatch">
            保存 {{ batch.length }} 份
          </el-button>
          <el-button v-else-if="canEdit" type="primary" :loading="saving" :disabled="uploading" @click="submit">
            保存
          </el-button>
        </div>
      </div>
    </template>
  </el-drawer>
</template>

<style scoped>
/*
 * ⚠️ 这里**故意不写** transition（2026-10-22 变更-151 删掉）。
 * 原因同设备抽屉：曾经三个抽屉两个来源，改 theme.css 只对采购页生效。
 * 唯一来源：src/theme.css 的 .el-drawer 两段。
 */
.archive-drawer :deep(.el-drawer__body) {
  overscroll-behavior: contain;
}

/*
 * 拖拽提示层与批量卡片（变更-225）。
 * 用虚线 + 很淡的品牌底色，不抢表单的注意力；`pointer-events: none` 保证松手事件
 * 仍然落在下面那个 div 上（否则 mask 自己会吃掉 drop）。
 */
.adx-drop {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed var(--ds-brand, #be123c);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.92);
}

.adx-drop__box {
  text-align: center;
  padding: 0 16px;
}

.adx-drop__title {
  font-size: 15px;
  font-weight: 600;
  color: #111827;
}

.adx-drop__hint {
  margin-top: 6px;
  font-size: 12px;
  color: #6b7280;
}

.adx-batch {
  border: 1px solid var(--ds-line, #e4e7ec);
  border-radius: 8px;
  background: var(--ds-region, #f8f9fb);
  padding: 8px 10px;
}

.adx-batch.is-bad {
  border-color: #fda4af;
  background: #fff5f6;
}

@media (prefers-reduced-motion: reduce) {
  .archive-drawer :deep(.el-drawer) {
    transition: none;
  }
}
</style>
