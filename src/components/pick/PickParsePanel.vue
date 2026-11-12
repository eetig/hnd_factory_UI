<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { exportPickExcel, listPickTemplates, recognizePickDoc, uploadPickTemplate } from '../../api/pickParse'

/*
 * 领料解析（变更-190，2026-11-12）。
 *
 * 使用方的真实动作是：拍一张纸质《物资领料单》→ 手工把每行物料编码敲进 SAP。
 * 这里把「拍照 → 认编码 → 按 SAP 模板排版 → 导出 xlsx」串起来，粘进 SAP 就完事。
 *
 * 三条不能变的规矩（都与后端口径对齐）：
 * 1) 部门是分 sheet 的依据，也决定用哪张模板；识别出来一律可改（手写体认不准）。
 * 2) 数量只写「单据数量」列，不猜「需求数量 / 提货数量」。
 * 3) 模板不是写死的列号：上传时由后端按表头认列，这里只展示认出来的结果。
 */

const DEPT_SUGGESTIONS = ['行政部', '生产部', '安环部', '设备部', '质量部', '仓储部']

const photo = ref(null) // { file, url, name }
const recognizing = ref(false)
const doc = ref({ documentType: '', documentNo: '', docDate: '', department: '', requester: '' })
const items = ref([])
const itemsWarn = ref('')

const templates = ref([])
const templateId = ref(null)
const templateLoading = ref(false)
const exporting = ref(false)

const showTemplateForm = ref(false)
const templateFile = ref(null)
const templateName = ref('')
const templateDocType = ref('')
const templateDept = ref('')
const uploading = ref(false)

const currentTemplate = computed(() => templates.value.find((t) => t.id === templateId.value) || null)
const filledRows = computed(() => items.value.filter((it) => String(it.materialCode || '').trim()).length)
const canExport = computed(() => Boolean(templateId.value) && filledRows.value > 0 && !exporting.value)

function pickFile() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = () => {
    const file = input.files?.[0]
    if (file) setPhoto(file)
  }
  input.click()
}

function setPhoto(file) {
  if (photo.value?.url) URL.revokeObjectURL(photo.value.url)
  photo.value = { file, name: file.name, url: URL.createObjectURL(file) }
}

function onDrop(event) {
  const file = event.dataTransfer?.files?.[0]
  if (file) {
    if (!file.type.startsWith('image/')) {
      ElMessage.warning('请拖入单据照片')
      return
    }
    setPhoto(file)
  }
}

function valueOf(field) {
  if (!field) return ''
  if (typeof field === 'string') return field
  return field.value == null ? '' : String(field.value)
}

async function recognize() {
  if (!photo.value || recognizing.value) return
  recognizing.value = true
  try {
    const data = await recognizePickDoc(photo.value.file, photo.value.name)
    doc.value = {
      documentType: valueOf(data.documentType),
      documentNo: valueOf(data.documentNo),
      docDate: valueOf(data.docDate),
      department: valueOf(data.department),
      requester: valueOf(data.requester),
    }
    items.value = (data.items || []).map((it) => ({
      materialCode: valueOf(it.materialCode),
      materialName: valueOf(it.materialName),
      quantity: valueOf(it.quantity),
      unit: valueOf(it.unit),
    }))
    if (!items.value.length) items.value = [blankItem()]
    itemsWarn.value = data.documentType && !doc.value.documentType ? '没认出单据类型，请手动补' : ''
    await loadTemplates()
    ElMessage.success(`已识别 ${filledRows.value} 行，请核对后导出`)
  } catch (error) {
    ElMessage.error(error?.message || '识别失败')
  } finally {
    recognizing.value = false
  }
}

function blankItem() {
  return { materialCode: '', materialName: '', quantity: '', unit: '' }
}

function addItem() {
  items.value.push(blankItem())
}

function removeItem(index) {
  items.value.splice(index, 1)
  if (!items.value.length) items.value = [blankItem()]
}

async function loadTemplates() {
  templateLoading.value = true
  try {
    const dept = doc.value.department || ''
    templates.value = await listPickTemplates(dept)
    /*
     * 选模板的优先级：**本部门专属的 > 当前这张（如果它还在列表里）> 列表第一个**。
     *
     * 为什么不能只写「当前不在列表里才换」：通用模板（P7）永远在列表里，
     * 于是从「行政部」切到「生产部」时会一直停在 P7 —— 使用方以为选好了 E5，
     * 实际导出的是 P7 的列，粘贴就错位。
     */
    const own = dept ? templates.value.find((t) => t.dept && t.dept === dept) : null
    if (own) {
      templateId.value = own.id
    } else if (!templates.value.some((t) => t.id === templateId.value)) {
      templateId.value = templates.value.find((t) => t.dept)?.id ?? templates.value[0]?.id ?? null
    }
  } catch (error) {
    templates.value = []
    ElMessage.error(error?.message || '模板加载失败')
  } finally {
    templateLoading.value = false
  }
}

function pickTemplateFile() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.xlsx'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    templateFile.value = file
    if (!templateName.value) templateName.value = file.name.replace(/\.xlsx$/i, '')
  }
  input.click()
}

async function submitTemplate() {
  if (!templateFile.value) {
    ElMessage.warning('先选一张 SAP 导出的空模板（.xlsx）')
    return
  }
  uploading.value = true
  try {
    const saved = await uploadPickTemplate({
      file: templateFile.value,
      name: templateName.value,
      docType: templateDocType.value,
      dept: templateDept.value,
    })
    ElMessage.success(`模板已保存：${saved?.columns || '已认列'}`)
    showTemplateForm.value = false
    templateFile.value = null
    templateDocType.value = ''
    templateDept.value = ''
    await loadTemplates()
    if (saved?.id) templateId.value = saved.id
  } catch (error) {
    ElMessage.error(error?.message || '模板上传失败')
  } finally {
    uploading.value = false
  }
}

async function doExport() {
  if (!canExport.value) return
  const rows = items.value
    .filter((it) => String(it.materialCode || '').trim())
    .map((it) => ({
      materialCode: String(it.materialCode).trim(),
      materialName: it.materialName,
      quantity: it.quantity === '' ? null : Number(it.quantity),
      unit: it.unit,
    }))
  if (rows.some((r) => r.quantity === null || Number.isNaN(r.quantity))) {
    ElMessage.warning('有行的数量不是数字，先改一下')
    return
  }
  exporting.value = true
  try {
    const { blob, name } = await exportPickExcel({
      templateId: templateId.value,
      orders: [
        {
          docNo: doc.value.documentNo,
          dept: doc.value.department,
          requester: doc.value.requester,
          items: rows,
        },
      ],
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('已导出，可直接粘进 SAP')
  } catch (error) {
    ElMessage.error(error?.message || '导出失败')
  } finally {
    exporting.value = false
  }
}

function reset() {
  if (photo.value?.url) URL.revokeObjectURL(photo.value.url)
  photo.value = null
  doc.value = { documentType: '', documentNo: '', docDate: '', department: '', requester: '' }
  items.value = []
  itemsWarn.value = ''
}

onMounted(loadTemplates)
</script>

<template>
  <div class="pick">
    <section class="pick__card pick__card--photo">
      <header class="pick__head">
        <h2 class="pick__title">领料单照片</h2>
        <div class="pick__acts">
          <button type="button" class="pick__btn pick__btn--ghost" @click="pickFile">选择照片</button>
          <button
            type="button"
            class="pick__btn"
            :disabled="!photo || recognizing"
            @click="recognize"
          >
            {{ recognizing ? '识别中…' : '开始识别' }}
          </button>
        </div>
      </header>

      <div v-if="!photo" class="pick__drop" @dragover.prevent @drop.prevent="onDrop" @click="pickFile">
        <p class="pick__drop-main">点击选择，或把单据照片拖到这里</p>
        <p class="pick__drop-sub">支持 PNG / JPG，单张不超过 10MB</p>
      </div>
      <div v-else class="pick__preview">
        <img :src="photo.url" alt="领料单照片" class="pick__img" />
        <div class="pick__preview-side">
          <p class="pick__file">{{ photo.name }}</p>
          <button type="button" class="pick__link" @click="pickFile">换一张</button>
          <button type="button" class="pick__link" @click="reset">清空重来</button>
        </div>
      </div>
    </section>

    <section class="pick__card">
      <header class="pick__head">
        <h2 class="pick__title">单据信息</h2>
        <span v-if="doc.documentType" class="pick__tag">{{ doc.documentType }}</span>
      </header>
      <div class="pick__grid">
        <label class="pick__field">
          <span class="pick__label">领料部门</span>
          <input v-model.trim="doc.department" class="pick__input" list="pick-dept" placeholder="决定分到哪个 sheet" @change="loadTemplates" />
          <datalist id="pick-dept">
            <option v-for="d in DEPT_SUGGESTIONS" :key="d" :value="d" />
          </datalist>
        </label>
        <label class="pick__field">
          <span class="pick__label">领料人</span>
          <input v-model.trim="doc.requester" class="pick__input" placeholder="手写体容易认错，请核对" />
        </label>
        <label class="pick__field">
          <span class="pick__label">单据编号</span>
          <input v-model.trim="doc.documentNo" class="pick__input" placeholder="选填" />
        </label>
        <label class="pick__field">
          <span class="pick__label">领料日期</span>
          <input v-model.trim="doc.docDate" class="pick__input" type="date" placeholder="选填" />
        </label>
      </div>
    </section>

    <section class="pick__card">
      <header class="pick__head">
        <h2 class="pick__title">物料明细</h2>
        <div class="pick__acts">
          <span class="pick__count">已填 {{ filledRows }} / {{ items.length }} 行</span>
          <button type="button" class="pick__btn pick__btn--ghost" @click="addItem">＋ 加一行</button>
        </div>
      </header>

      <p v-if="itemsWarn" class="pick__warn">{{ itemsWarn }}</p>

      <table v-if="items.length" class="pick__table">
        <colgroup>
          <col style="width: 40px" />
          <col style="width: 150px" />
          <col />
          <col style="width: 96px" />
          <col style="width: 76px" />
          <col style="width: 48px" />
        </colgroup>
        <thead>
          <tr>
            <th>#</th>
            <th>物料编码</th>
            <th>物料名称</th>
            <th>数量</th>
            <th>单位</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(it, i) in items" :key="i">
            <td class="pick__idx">{{ i + 1 }}</td>
            <td><input v-model.trim="it.materialCode" class="pick__input" placeholder="编码" /></td>
            <td><input v-model.trim="it.materialName" class="pick__input" placeholder="名称" /></td>
            <td><input v-model.trim="it.quantity" class="pick__input pick__input--num" placeholder="数量" /></td>
            <td><input v-model.trim="it.unit" class="pick__input" placeholder="单位" /></td>
            <td>
              <button type="button" class="pick__del" title="删掉这行" @click="removeItem(i)">×</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="pick__empty">还没有识别结果。先上传照片并点「开始识别」，也可以直接「＋ 加一行」手动录。</p>
    </section>

    <section class="pick__card">
      <header class="pick__head">
        <h2 class="pick__title">SAP 模板</h2>
        <div class="pick__acts">
          <button type="button" class="pick__link" @click="showTemplateForm = !showTemplateForm">
            {{ showTemplateForm ? '收起上传' : '上传新模板' }}
          </button>
        </div>
      </header>

      <div v-if="showTemplateForm" class="pick__tpl-form">
        <div class="pick__grid">
          <label class="pick__field">
            <span class="pick__label">模板文件（SAP 导出的空表）</span>
            <button type="button" class="pick__btn pick__btn--ghost" @click="pickTemplateFile">
              {{ templateFile ? templateFile.name : '选择 .xlsx' }}
            </button>
          </label>
          <label class="pick__field">
            <span class="pick__label">模板名称</span>
            <input v-model.trim="templateName" class="pick__input" placeholder="如 P7 资产领用" />
          </label>
          <label class="pick__field">
            <span class="pick__label">单据类型</span>
            <input v-model.trim="templateDocType" class="pick__input" placeholder="如 P7 / 维修物资领料" />
          </label>
          <label class="pick__field">
            <span class="pick__label">适用部门（留空=通用）</span>
            <input v-model.trim="templateDept" class="pick__input" placeholder="留空则任何部门都能用" />
          </label>
        </div>
        <div class="pick__tpl-acts">
          <button type="button" class="pick__btn" :disabled="uploading" @click="submitTemplate">
            {{ uploading ? '上传中…' : '保存模板' }}
          </button>
        </div>
      </div>

      <div class="pick__grid">
        <label class="pick__field pick__field--wide">
          <span class="pick__label">用哪张模板</span>
          <select v-model="templateId" class="pick__input" :disabled="templateLoading || !templates.length">
            <option v-if="!templates.length" :value="null">还没有模板，先上传一张</option>
            <option v-for="t in templates" :key="t.id" :value="t.id">
              {{ t.name }}{{ t.docType ? ` · ${t.docType}` : '' }}{{ t.dept ? ` · ${t.dept}` : ' · 通用' }}
            </option>
          </select>
        </label>
      </div>
      <p v-if="currentTemplate" class="pick__meta">
        认到的列：{{ currentTemplate.columns }}
        <span v-if="currentTemplate.factory || currentTemplate.warehouse" class="pick__meta-dim">
          · 工厂 {{ currentTemplate.factory || '—' }} / 仓库 {{ currentTemplate.warehouse || '—' }}
        </span>
      </p>
      <p v-else-if="!templates.length" class="pick__meta pick__meta-dim">
        还没有模板。点右上「上传新模板」，把 SAP 导出的空 Excel 传进来（表头里要有「物料」和「单据数量」）。
      </p>

      <div class="pick__foot">
        <p class="pick__hint">导出后直接按 Ctrl+C 复制表格，粘到 SAP 里即可；一行对应一条物料。</p>
        <button type="button" class="pick__btn pick__btn--primary" :disabled="!canExport" @click="doExport">
          {{ exporting ? '导出中…' : '导出 Excel' }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* 颜色一律走 Tailwind 的 token（bg-raised / border-line / bg-region / text-brand-ink …），
   PC 仓没有 --ink / --line 这类 CSS 变量，也不许在 .vue 里写裸色值（守卫会拦）。 */
.pick {
  @apply flex flex-col gap-3.5;
}
.pick__card {
  @apply rounded-xl border border-line bg-raised p-4;
}
.pick__head {
  @apply mb-3 flex items-center justify-between gap-3;
}
.pick__title {
  @apply text-[15px] font-semibold text-slate-900;
}
.pick__acts {
  @apply flex items-center gap-2.5;
}
.pick__tag {
  @apply rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-ink;
}
.pick__count {
  @apply text-xs text-slate-500;
}
.pick__drop {
  @apply cursor-pointer rounded-xl border border-dashed border-slate-300 bg-region p-8 text-center;
}
.pick__drop-main {
  @apply mb-1.5 text-sm text-slate-900;
}
.pick__drop-sub {
  @apply text-xs text-slate-500;
}
.pick__preview {
  @apply flex items-start gap-4;
}
.pick__img {
  @apply max-h-[280px] w-[220px] rounded-lg border border-line bg-white object-contain;
}
.pick__preview-side {
  @apply flex flex-col gap-2 text-[13px];
}
.pick__file {
  @apply break-all text-slate-900;
}
.pick__link {
  @apply self-start text-[13px] text-brand-ink hover:underline;
}
.pick__grid {
  @apply grid grid-cols-4 gap-3;
}
.pick__field {
  @apply flex min-w-0 flex-col gap-1.5;
}
.pick__field--wide {
  @apply col-span-2;
}
.pick__label {
  @apply text-xs text-slate-500;
}
.pick__input {
  @apply h-8 w-full rounded-lg border border-line bg-white px-2.5 text-[13px] text-slate-900 focus:border-brand focus:outline-none;
}
.pick__input--num {
  @apply text-right;
}
.pick__btn {
  @apply rounded-lg border border-brand bg-brand px-3.5 py-1.5 text-[13px] text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50;
}
.pick__btn--ghost {
  @apply bg-white text-brand-ink hover:bg-brand-50;
}
.pick__btn--primary {
  @apply px-5 py-2;
}
.pick__table {
  @apply w-full table-fixed border-collapse;
}
.pick__table th {
  @apply border-b border-line px-1.5 pb-2 pt-1.5 text-left text-xs font-medium text-slate-500;
}
.pick__table td {
  @apply border-b border-line px-1.5 py-1 align-middle;
}
.pick__idx {
  @apply text-center text-xs text-slate-500;
}
.pick__del {
  @apply cursor-pointer border-0 bg-transparent text-base leading-none text-slate-500 hover:text-brand-ink;
}
.pick__warn {
  @apply mb-2.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800;
}
.pick__empty {
  @apply text-[13px] text-slate-500;
}
.pick__tpl-form {
  @apply mb-3.5 rounded-xl border border-dashed border-slate-300 bg-region p-3.5;
}
.pick__tpl-acts {
  @apply mt-3 flex justify-end;
}
.pick__meta {
  @apply mt-2.5 text-xs text-slate-500;
}
.pick__meta-dim {
  @apply text-slate-500;
}
.pick__foot {
  @apply mt-4 flex items-center justify-between gap-4 border-t border-line pt-3.5;
}
.pick__hint {
  @apply text-xs text-slate-500;
}
</style>
