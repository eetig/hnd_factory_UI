<script setup>
import { computed, nextTick, ref, watch } from 'vue'
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
  modelValue: { type: Boolean, default: false },
  mode: { type: String, default: 'edit' }, // 'create' | 'edit'
  row: { type: Object, default: null },
  canEdit: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
  /** 扁平化的分类选项：[{ value, label, disabled }] */
  categoryOptions: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:modelValue', 'save', 'delete', 'upload'])

const isCreate = computed(() => props.mode === 'create')
const title = computed(() => (isCreate.value ? '新增资料' : '资料详情'))

const form = ref(blank())
let snapshot = ''
/** 上传中（上传是独立的一步：先传文件拿对象名，再保存表单） */
const uploading = ref(false)
const fileInput = ref(null)

const dirty = computed(() => JSON.stringify(form.value) !== snapshot)

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
  const file = event.target?.files?.[0]
  event.target.value = ''
  if (!file) return
  uploading.value = true
  try {
    const res = await emitUpload(file)
    if (res) {
      form.value.fileName = res.fileName
      form.value.origName = res.origName || file.name
      form.value.fileSize = res.size || file.size
      form.value.mimeType = res.contentType || file.type
    }
  } finally {
    uploading.value = false
  }
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
    direction="rtl"
    :size="'min(520px, 100vw)'"
    :close-on-press-escape="false"
    :before-close="beforeClose"
    :show-close="false"
    class="archive-drawer"
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
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

    <div class="flex min-h-full flex-col gap-6 pb-2" @keydown.enter.exact="onEnter" @keydown.esc.stop.prevent="requestClose">
      <p v-if="errorMessage" role="alert" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
        {{ errorMessage }}
      </p>

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
              <span class="text-xs text-slate-500">支持 PDF / Word / Excel / 图片 / ZIP，≤30MB</span>
            </div>
            <input ref="fileInput" type="file" class="hidden"
                   accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.txt,.csv,.zip"
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
    </div>

    <template #footer>
      <div class="flex w-full items-center justify-between gap-3">
        <el-button v-if="canEdit && !isCreate && row" type="danger" plain :disabled="saving" @click="onDelete">
          删除
        </el-button>
        <span v-else />
        <div class="flex items-center gap-2">
          <el-button :disabled="saving || uploading" @click="requestClose">取消</el-button>
          <el-button v-if="canEdit" type="primary" :loading="saving" :disabled="uploading" @click="submit">
            保存
          </el-button>
        </div>
      </div>
    </template>
  </el-drawer>
</template>

<style scoped>
/* 与采购抽屉同一条曲线（Ionic --ease-drawer），只动 transform 不动 width/left */
.archive-drawer :deep(.el-drawer) {
  transition: transform 260ms cubic-bezier(0.32, 0.72, 0, 1);
}

.archive-drawer :deep(.el-drawer__body) {
  overscroll-behavior: contain;
}

@media (prefers-reduced-motion: reduce) {
  .archive-drawer :deep(.el-drawer) {
    transition: none;
  }
}
</style>
