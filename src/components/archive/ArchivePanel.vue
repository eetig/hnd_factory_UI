<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElButton, ElDialog, ElInput, ElMessage, ElMessageBox, ElOption, ElPagination, ElSelect } from 'element-plus'
import { hasPerm, isAdmin } from '../../api/auth'
import { downloadArchive, aiSuggestArchive, previewSpreadsheet } from '../../api/archive'
import { useArchive } from '../../composables/useArchive'
import { useArchiveBatch } from '../../composables/useArchiveBatch'
import ArchiveDetailDrawer from './ArchiveDetailDrawer.vue'
import { ARCHIVE_COLUMNS, expireBadge } from './useArchiveColumns.js'

/**
 * 资料归档（变更-126）。设计决策见 `docs/资料归档-开工方案.md`。
 *
 * ## 一屏两栏
 *
 *   左：分类树（两级，带每条分类下的资料数）—— 资料员的第一件事是分类，所以它常驻不折叠；
 *   右：台账列表（表格 + 分页钉底）。
 *
 * ## 三条不可回退的口径
 *
 *   · **到期天数由后端给**（`daysToExpire`），前端不自己算日期 —— 口径只一处；
 *   · **全员可看可下载**，增改删按 `archive:edit` 显隐（后端 `SaTokenConfigure` 还有一道
 *     "非 admin 的写方法一律 403"，所以藏按钮不是唯一防线）；
 *   · **保存失败不清表单**（抽屉里的内容原样保留），与采购页同一条。
 */
const canEdit = computed(() => hasPerm('archive:edit'))

const {
  rows,
  total,
  loading,
  saving,
  loadError,
  pageNum,
  pageSize,
  categoryId,
  expireWithinDays,
  categories,
  currentCategoryName,
  load,
  loadCategories,
  setCategory,
  setKeyword,
  setExpireWithin,
  goPage,
  changePageSize,
  save,
  remove,
  upload,
  saveCategory,
  removeCategory,
} = useArchive()

/* 批量上传（review S5：逻辑在 composables/useArchiveBatch.js） */
const {
  batchOpen,
  batchFiles,
  batchCategoryId,
  batchUseAi,
  batchRunning,
  batchDone,
  batchResults,
  batchInput,
  batchDirInput,
  batchValidCount,
  batchSkippedCount,
  onBatchPicked,
  pickBatchFiles,
  pickBatchFolder,
  runBatch,
  closeBatch,
} = useArchiveBatch({
  upload,
  save,
  load,
  loadCategories,
  categoryOptions,
  categoryId,
})

const searchText = ref('')

/** 抽屉 */
const drawerOpen = ref(false)
const drawerMode = ref('edit')
const drawerRow = ref(null)
const drawerMessage = ref('')

/**
 * 分类下拉选项：大类可选中（资料直接归到大类也行），子类缩进显示。
 *
 * <p>为什么允许选大类：不是每份资料都能立刻归到子类，硬要求两级会让人随手建一堆子类。
 */
const categoryOptions = computed(() => {
  const list = []
  for (const root of categories.value) {
    list.push({ value: root.id, label: root.name, disabled: false })
    for (const child of root.children || []) {
      list.push({ value: child.id, label: `　${child.name}`, disabled: false })
    }
  }
  return list
})

/** 到期徽标（三档 + 无有效期） */
function badgeOf(row) {
  return expireBadge(row.daysToExpire)
}

function onSearch() {
  setKeyword(searchText.value)
}

function clearSearch() {
  searchText.value = ''
  setKeyword('')
}

function toggleExpiring() {
  setExpireWithin(expireWithinDays.value > 0 ? 0 : 30)
}

function openCreate() {
  drawerMode.value = 'create'
  drawerRow.value = null
  drawerMessage.value = ''
  drawerOpen.value = true
}

function openEdit(row) {
  drawerMode.value = 'edit'
  drawerRow.value = row
  drawerMessage.value = ''
  drawerOpen.value = true
}

async function onSave(form) {
  drawerMessage.value = ''
  try {
    await save(form)
    ElMessage.success('已保存')
    drawerOpen.value = false
  } catch (e) {
    drawerMessage.value = e?.response?.data?.msg || e?.message || '保存失败'
  }
}

async function onDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除「${row.name}」？删除后文件仍会保留，可由管理员恢复。`, '删除资料', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    await remove(row.id)
    ElMessage.success('已删除')
    drawerOpen.value = false
  } catch (e) {
    ElMessage.error(e?.response?.data?.msg || e?.message || '删除失败')
  }
}

/**
 * 上传：交给抽屉的「选择文件」触发，这里负责调接口并把结果回给抽屉。
 *
 * <p>用回调而不是返回值，是因为抽屉里 `emit` 不能 await；抽屉包了一个 Promise 再 await。
 */
async function onUpload(file, resolve) {
  try {
    const res = await upload(file)
    resolve(res)
    /*
     * AI 归类（2026-11-05）：上传成功后再问一次，**不阻塞**保存 ——
     * 模型慢或挂了也不影响人继续手填。
     */
    askAi(file)
  } catch (e) {
    ElMessage.error(e?.response?.data?.msg || e?.message || '上传失败')
    resolve(null)
  }
}


/** AI 归类建议（2026-11-05）：给抽屉预填用；失败静默，不打扰录入 */
const aiSuggestion = ref(null)

async function askAi(file) {
  /*
   * 只给管理员（2026-11-05，使用方：「这个功能只能管理员用，如果所有人都能用，
   * 我的 token 成本会很高」）。后端 /api/archive/ai-suggest 也校验一次，这里是省一次请求。
   */
  aiSuggestion.value = null
  if (!isAdmin()) return
  try {
    const res = await aiSuggestArchive(file)
    const body = res?.data || {}
    if (body.success === false) return
    aiSuggestion.value = body.data || null
  } catch {
    // 没配 key / 网络不通 / 模型超时，都不该打断"新增资料"
    aiSuggestion.value = null
  }
}

/** 复制文件名（2026-11-05）：点资料名称时用，复制的是原文件名 */
async function copyFileName(row) {
  /*
   * 复制的顺序：原文件名 → 资料名称。
   * 名字是我们自己起的，原文件名才是去共享盘/邮箱里找文件时能用的那个。
   */
  const text = row.origName || row.fileName || row.name || ''
  if (!text) {
    ElMessage.info('这条资料没有文件名')
    return
  }
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
    } else {
      // http 或老浏览器：clipboard API 不可用，用临时 textarea 兜底
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    }
    ElMessage.success(`已复制文件名：${text}`)
  } catch {
    ElMessage.error('浏览器不让写剪贴板，请手动选中复制')
  }
}

/* ===== 预览（2026-11-05）=====
 * 状态：preview = { open, kind: 'image' | 'pdf' | 'other', url, name, loading, error }
 * url 是 objectURL，关闭时必须 revoke，否则一张图看十次就漏十份内存。
 */
const preview = ref({ open: false, kind: 'other', url: '', name: '', loading: false, error: '' })

/** 能不能在线预览：图片、PDF 可以；Word/Excel 浏览器渲染不了 */
function previewKind(row) {
  const name = String(row.origName || row.fileName || '').toLowerCase()
  const mime = String(row.mimeType || '').toLowerCase()
  if (mime.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp)$/.test(name)) return 'image'
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  // Excel 由后端读成结构化表格，前端画（2026-11-05）
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) return 'sheet'
  return 'other'
}

function closePreview() {
  if (preview.value.url) URL.revokeObjectURL(preview.value.url)
  preview.value = { open: false, kind: 'other', url: '', name: '', loading: false, error: '' }
}

/**
 * el-dialog 的 v-model 回写。关掉时顺手 revoke objectURL。
 * 单独抽一个函数是为了让模板里那一行保持短（模板里写箭头函数容易读不清）。
 */
function onPreviewVisible(visible) {
  if (!visible) closePreview()
}

async function openPreview(row) {
  const kind = previewKind(row)
  if (kind === 'other') {
    ElMessage.info('Word/Excel 浏览器打不开，用「下载」后用本机 Office 看')
    return
  }
  if (!row.hasFile) {
    ElMessage.info('这条资料只有纸质，没有电子件')
    return
  }
  preview.value = {
    open: true,
    kind,
    url: '',
    name: row.origName || row.name || '预览',
    loading: true,
    error: '',
    sheets: [],
  }
  try {
    if (kind === 'sheet') {
      // Excel 不走 blob：后端直接给「表名 + 二维数组」，前端画表格（转义交给 Vue）
      const res = await previewSpreadsheet(row.id)
      const body = res?.data || {}
      if (body.success === false) throw new Error(body.msg || '读不出表格')
      preview.value.sheets = body.data?.sheets || []
      return
    }
    const res = await downloadArchive(row.id)
    const blob = new Blob([res.data], { type: row.mimeType || (kind === 'pdf' ? 'application/pdf' : 'image/*') })
    preview.value.url = URL.createObjectURL(blob)
  } catch (e) {
    preview.value.error = e?.message || '打开失败'
  } finally {
    preview.value.loading = false
  }
}

/** 下载：走本服务转发拿 blob，文件名用 DB 里的原文件名 */
async function download(row) {
  if (!row.hasFile) {
    ElMessage.info('这条资料只有纸质，没有电子件')
    return
  }
  try {
    const res = await downloadArchive(row.id)
    const blob = new Blob([res.data], { type: row.mimeType || 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = row.origName || row.fileName || '资料'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (e) {
    ElMessage.error(e?.message || '下载失败')
  }
}

/** 新建大类（分类维护只有"建"和"删"：改名不常用，先不做，免得界面变复杂） */
async function addRootCategory() {
  let name
  try {
    const result = await ElMessageBox.prompt('新分类的名称', '新建大类', {
      confirmButtonText: '创建',
      cancelButtonText: '取消',
      inputPattern: /\S+/,
      inputErrorMessage: '名称不能为空',
    })
    name = result.value
  } catch {
    return
  }
  try {
    await saveCategory({ parentId: null, name })
    ElMessage.success('已创建')
  } catch (e) {
    ElMessage.error(e?.response?.data?.msg || e?.message || '创建失败')
  }
}

async function addChildCategory(root) {
  let name
  try {
    const result = await ElMessageBox.prompt(`在「${root.name}」下新建子类`, '新建子类', {
      confirmButtonText: '创建',
      cancelButtonText: '取消',
      inputPattern: /\S+/,
      inputErrorMessage: '名称不能为空',
    })
    name = result.value
  } catch {
    return
  }
  try {
    await saveCategory({ parentId: root.id, name })
    ElMessage.success('已创建')
  } catch (e) {
    ElMessage.error(e?.response?.data?.msg || e?.message || '创建失败')
  }
}

async function removeCategoryNode(node) {
  try {
    await ElMessageBox.confirm(`删除分类「${node.name}」？分类下还有资料时不能删。`, '删除分类', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    await removeCategory(node.id)
    if (categoryId.value === node.id) {
      await setCategory(null)
    }
    ElMessage.success('已删除')
  } catch (e) {
    ElMessage.error(e?.response?.data?.msg || e?.message || '删除失败')
  }
}

function isActive(id) {
  return categoryId.value === id
}

onMounted(async () => {
  await loadCategories()
  await load()
})
</script>

<template>
  <section class="flex min-h-0 flex-1 gap-4">
    <!-- 左：分类树 -->
    <aside
      class="flex w-[220px] shrink-0 flex-col rounded-card border border-line bg-raised shadow-card"
      aria-label="资料分类"
    >
      <div class="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <h2 class="text-sm font-medium text-slate-900">分类</h2>
        <button
          v-if="canEdit"
          type="button"
          class="rounded-full p-1 text-slate-500 transition-colors hover:bg-region hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
          aria-label="新建大类"
          title="新建大类"
          @click="addRootCategory"
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      <nav class="min-h-0 flex-1 overflow-auto px-1.5 py-2">
        <button
          type="button"
          class="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
          :class="isActive(null) ? 'bg-region text-slate-900' : 'text-slate-600 hover:bg-region hover:text-slate-900'"
          @click="setCategory(null)"
        >
          <span>全部资料</span>
          <span class="text-xs text-slate-500">{{ total }}</span>
        </button>

        <div v-for="root in categories" :key="root.id" class="mt-1">
          <div class="group flex items-center gap-1">
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
              :class="isActive(root.id) ? 'bg-region text-slate-900' : 'text-slate-700 hover:bg-region hover:text-slate-900'"
              @click="setCategory(root.id)"
            >
              <span class="truncate">{{ root.name }}</span>
              <span class="shrink-0 text-xs text-slate-500">{{ root.documentCount }}</span>
            </button>
            <button
              v-if="canEdit"
              type="button"
              class="shrink-0 rounded-full p-0.5 text-slate-500 opacity-0 transition-opacity hover:text-slate-900 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none group-hover:opacity-100"
              :aria-label="`在 ${root.name} 下新建子类`"
              title="新建子类"
              @click.stop="addChildCategory(root)"
            >
              <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <button
              v-if="canEdit"
              type="button"
              class="shrink-0 rounded-full p-0.5 text-slate-500 opacity-0 transition-opacity hover:text-rose-600 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none group-hover:opacity-100"
              :aria-label="`删除分类 ${root.name}`"
              title="删除分类"
              @click.stop="removeCategoryNode(root)"
            >
              <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <div
            v-for="child in root.children"
            :key="child.id"
            class="group ml-3 flex items-center gap-1 border-l border-line pl-2"
          >
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[13px] transition-colors focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
              :class="isActive(child.id) ? 'bg-region text-slate-900' : 'text-slate-600 hover:bg-region hover:text-slate-900'"
              @click="setCategory(child.id)"
            >
              <span class="truncate">{{ child.name }}</span>
              <span class="shrink-0 text-xs text-slate-500">{{ child.documentCount }}</span>
            </button>
            <button
              v-if="canEdit"
              type="button"
              class="shrink-0 rounded-full p-0.5 text-slate-500 opacity-0 transition-opacity hover:text-rose-600 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none group-hover:opacity-100"
              :aria-label="`删除分类 ${child.name}`"
              title="删除分类"
              @click.stop="removeCategoryNode(child)"
            >
              <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>

        <p v-if="!categories.length" class="px-2.5 py-3 text-xs text-slate-500">
          还没有分类。点右上角的「＋」建第一次，或在初始 7 大类基础上加子类。
        </p>
      </nav>
    </aside>

    <!-- 右：列表 -->
    <section class="flex min-h-0 flex-1 flex-col rounded-card border border-line bg-raised shadow-card">
      <header class="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <h2 class="mr-auto min-w-0 truncate text-sm font-medium text-slate-900">{{ currentCategoryName }}</h2>

        <el-input
          v-model="searchText"
          placeholder="名称 / 编号 / 责任人 / 原件位置"
          aria-label="搜索资料"
          clearable
          class="!w-[240px]"
          @keyup.enter="onSearch"
          @clear="clearSearch"
        />
        <el-button :disabled="loading" @click="onSearch">搜索</el-button>
        <!-- 排序（2026-11-05）：默认「最近录入」；另外给有效期与名称 -->
        <el-select :model-value="sort" aria-label="排序方式" class="!w-[136px]" @change="setSort">
          <el-option label="最近录入" value="recent" />
          <el-option label="有效期最近" value="expire" />
          <el-option label="名称 A→Z" value="name" />
        </el-select>

        <button
          type="button"
          class="rounded-full border px-3 py-1.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
          :class="expireWithinDays > 0
            ? 'border-transparent bg-brand-ink text-white'
            : 'border-line text-slate-600 hover:border-slate-400 hover:text-slate-900'"
          :aria-pressed="expireWithinDays > 0"
          @click="toggleExpiring"
        >
          只看 30 天内到期
        </button>

        <!--
          批量上传（2026-11-05）
          两个隐藏 input：multiple 多选、webkitdirectory 选文件夹（Chrome/Edge 支持）。
          选完不立刻传，先弹清单让人确认 —— 文件夹里混着临时文件是常态。
        -->
        <input
          ref="batchInput"
          type="file"
          multiple
          class="hidden"
          aria-hidden="true"
          tabindex="-1"
          @change="onBatchPicked"
        />
        <input
          ref="batchDirInput"
          type="file"
          webkitdirectory
          directory
          multiple
          class="hidden"
          aria-hidden="true"
          tabindex="-1"
          @change="onBatchPicked"
        />
        <template v-if="canEdit">
          <el-button @click="pickBatchFiles">批量上传</el-button>
          <el-button @click="pickBatchFolder">选文件夹</el-button>
          <el-button type="primary" @click="openCreate">新增资料</el-button>
        </template>
      </header>

      <p v-if="loadError" role="alert" class="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">
        {{ loadError }}
      </p>

      <div class="min-h-0 flex-1 overflow-auto">
        <table class="w-full table-fixed border-collapse text-sm">
          <thead class="sticky top-0 z-10 bg-raised">
            <tr class="border-b border-line text-left text-xs font-medium text-slate-500">
              <th v-for="col in ARCHIVE_COLUMNS" :key="col.key" scope="col"
                  class="whitespace-nowrap px-2 py-2" :class="[col.width, col.align === 'right' ? 'text-right' : '']">
                {{ col.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td :colspan="ARCHIVE_COLUMNS.length" class="px-4 py-10 text-center text-sm text-slate-500">加载中…</td>
            </tr>
            <tr v-else-if="!rows.length">
              <td :colspan="ARCHIVE_COLUMNS.length" class="px-4 py-10 text-center text-sm text-slate-500">
                没有资料。{{ canEdit ? '点右上角「新增资料」开始录入。' : '' }}
              </td>
            </tr>
            <template v-else>
              <tr
                v-for="(row, index) in rows"
                :key="row.id"
                tabindex="0"
                class="cursor-pointer border-b border-line transition-colors hover:bg-region focus-visible:bg-region focus-visible:outline-none"
                @click="openEdit(row)"
                @keydown.enter.prevent="openEdit(row)"
                @keydown.space.prevent="openEdit(row)"
              >
              <td class="px-2 py-2 text-xs text-slate-500">{{ (pageNum - 1) * pageSize + index + 1 }}</td>
              <td class="min-w-0 px-2 py-2">
                <button
                  type="button"
                  class="block max-w-full truncate text-left font-medium text-slate-900 underline decoration-dotted decoration-slate-300 underline-offset-2 transition-colors hover:text-brand-ink hover:decoration-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
                  :title="`点击复制文件名：${row.origName || row.name || ''}`"
                  @click.stop="copyFileName(row)"
                >
                  {{ row.name }}
                </button>
                <span v-if="row.remark" class="block truncate text-xs text-slate-500" :title="row.remark">{{ row.remark }}</span>
              </td>
              <td class="px-2 py-2">
                <span class="block truncate text-slate-600" :title="row.categoryName">{{ row.categoryName || '—' }}</span>
              </td>
              <td class="px-2 py-2 whitespace-nowrap text-slate-600">{{ row.expireDate || '—' }}</td>
              <td class="px-2 py-2 text-right whitespace-nowrap" :class="badgeOf(row).className">
                {{ badgeOf(row).text }}
              </td>
              <td class="px-2 py-2">
                <span class="block truncate text-slate-600" :title="row.originPlace">{{ row.originPlace || '—' }}</span>
              </td>
              <td class="px-2 py-2">
                <span class="block truncate text-slate-600" :title="row.owner">{{ row.owner || '—' }}</span>
              </td>
              <td class="px-2 py-2">
                <span v-if="row.hasFile" class="inline-flex items-center gap-1">
                  <button
                    v-if="previewKind(row) !== 'other'"
                    type="button"
                    class="rounded-full border border-line px-2 py-0.5 text-xs text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
                    @click.stop="openPreview(row)"
                  >
                    预览
                  </button>
                  <button
                  type="button"
                  class="rounded-full border border-line px-2 py-0.5 text-xs text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
                  @click.stop="download(row)"
                >
                  下载
                </button>
                </span>
                <span v-else class="text-xs text-slate-500">仅纸质</span>
              </td>
              <td class="px-2 py-2 text-right">
                <button
                  v-if="canEdit"
                  type="button"
                  class="rounded-full px-2 py-0.5 text-xs text-slate-600 transition-colors hover:bg-region hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
                  @click.stop="openEdit(row)"
                >
                  编辑
                </button>
                <span v-else class="text-xs text-slate-500">查看</span>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <footer class="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
        <span class="text-xs text-slate-500">共 {{ total }} 条</span>
        <el-pagination
          :current-page="pageNum"
          :page-size="pageSize"
          :total="total"
          :page-sizes="[20, 50, 100]"
          layout="sizes, prev, pager, next"
          :disabled="loading"
          @current-change="goPage"
          @size-change="changePageSize"
        />
      </footer>
    </section>
  </section>

  <!-- 批量上传面板（2026-11-05）：先看清单，再决定传不传 -->
  <el-dialog
    :model-value="batchOpen"
    title="批量上传资料"
    width="720px"
    top="6vh"
    append-to-body
    @update:model-value="(v) => { if (!v) closeBatch() }"
  >
    <div class="space-y-3">
      <p class="text-xs text-slate-600">
        共 <b>{{ batchFiles.length }}</b> 个文件，可上传 <b>{{ batchValidCount }}</b> 个
        <span v-if="batchSkippedCount" class="text-amber-700">，跳过 {{ batchSkippedCount }} 个</span>
      </p>

      <div class="max-h-[36vh] overflow-auto rounded-md border border-line">
        <table class="w-full border-collapse text-xs">
          <tbody>
            <tr v-for="(item, i) in batchFiles" :key="i" class="border-b border-line">
              <td class="px-2 py-1 text-slate-700">
                <span :class="item.ok ? '' : 'text-slate-500 line-through'">{{ item.name }}</span>
              </td>
              <td class="whitespace-nowrap px-2 py-1 text-right text-slate-500">
                {{ (item.size / 1024).toFixed(0) }} KB
              </td>
              <td class="whitespace-nowrap px-2 py-1 text-right">
                <span v-if="!item.ok" class="text-amber-700">{{ item.reason }}</span>
                <span v-else class="text-slate-500">待上传</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <span class="text-xs text-slate-600">统一分类</span>
        <el-select v-model="batchCategoryId" class="!w-[180px]" placeholder="选分类">
          <el-option
            v-for="option in categoryOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
            :disabled="option.disabled"
          />
        </el-select>
        <label class="flex items-center gap-1.5 text-xs text-slate-600">
          <input v-model="batchUseAi" type="checkbox" class="h-3.5 w-3.5" />
          逐条 AI 归类（较慢，只对管理员开放）
        </label>
      </div>
      <p class="text-[11px] leading-relaxed text-slate-500">
        默认不调模型：批量多半是同类资料，统一分类一次就够。
        勾上后会逐个调 DeepSeek，并采用它给的名称/编号/有效期/备注摘要。
      </p>

      <p v-if="batchRunning" class="text-xs text-brand-ink">
        正在上传 {{ batchDone }} / {{ batchValidCount }}…
      </p>
      <div v-if="batchResults.length" class="max-h-[20vh] overflow-auto text-[11px]">
        <p v-for="(r, i) in batchResults" :key="i" :class="r.ok ? 'text-slate-600' : 'text-rose-700'">
          {{ r.ok ? '✓' : '✗' }} {{ r.name }} — {{ r.message }}
        </p>
      </div>
    </div>

    <template #footer>
      <el-button :disabled="batchRunning" @click="closeBatch">关闭</el-button>
      <el-button type="primary" :loading="batchRunning" :disabled="!batchValidCount" @click="runBatch">
        开始上传（{{ batchValidCount }}）
      </el-button>
    </template>
  </el-dialog>

  <!--
    在线预览（2026-11-05）
    图片用 img、PDF 用 iframe（浏览器自带阅读器）；
    Word/Excel 浏览器渲染不了，不显示"预览"按钮，只给下载。
    关闭时 revoke objectURL —— 否则看十次就漏十份内存。
  -->
  <el-dialog
    :model-value="preview.open"
    :title="preview.name"
    width="80%"
    top="6vh"
    append-to-body
    @update:model-value="onPreviewVisible"
  >
    <div class="flex min-h-[60vh] items-center justify-center bg-region">
      <span v-if="preview.loading" class="text-sm text-slate-500">载入中…</span>
      <span v-else-if="preview.error" class="text-sm text-rose-700">{{ preview.error }}</span>
      <img
        v-else-if="preview.kind === 'image' && preview.url"
        :src="preview.url"
        alt="资料预览"
        class="max-h-[70vh] max-w-full object-contain"
      />
      <!-- Excel 预览（2026-11-05）：后端给「表名 + 二维数组」，这里画表格；转义交给 Vue -->
      <div v-else-if="preview.kind === 'sheet'" class="max-h-[70vh] w-full overflow-auto">
        <div v-for="sheet in preview.sheets" :key="sheet.name" class="mb-4">
          <p class="mb-1 text-xs font-medium text-slate-600">
            {{ sheet.name }}
            <span v-if="sheet.truncated" class="ml-1 text-amber-700">（只显示前 100 行）</span>
          </p>
          <table class="w-full border-collapse text-xs">
            <tbody>
              <tr v-for="(line, lineIndex) in sheet.rows" :key="lineIndex" class="border-b border-line">
                <td
                  v-for="(cell, cellIndex) in line"
                  :key="cellIndex"
                  class="whitespace-nowrap border-r border-line px-2 py-1 text-slate-700"
                >{{ cell }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="!preview.sheets.length" class="text-sm text-slate-500">这张表里没有内容</p>
      </div>
      <iframe
        v-else-if="preview.kind === 'pdf' && preview.url"
        :src="preview.url"
        title="资料预览"
        class="h-[70vh] w-full border-0"
      ></iframe>
    </div>
  </el-dialog>

  <ArchiveDetailDrawer
      :ai-suggestion="aiSuggestion"
    v-model="drawerOpen"
    :mode="drawerMode"
    :row="drawerRow"
    :can-edit="canEdit"
    :saving="saving"
    :error-message="drawerMessage"
    :category-options="categoryOptions"
    @save="onSave"
    @delete="onDelete"
    @upload="onUpload"
  />
</template>
