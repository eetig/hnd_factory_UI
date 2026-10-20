<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElButton, ElInput, ElMessage, ElMessageBox, ElPagination } from 'element-plus'
import { hasPerm } from '../../api/auth'
import { downloadArchive } from '../../api/archive'
import { useArchive } from '../../composables/useArchive'
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
  } catch (e) {
    ElMessage.error(e?.response?.data?.msg || e?.message || '上传失败')
    resolve(null)
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

        <el-button v-if="canEdit" type="primary" @click="openCreate">新增资料</el-button>
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
                <span class="block truncate font-medium text-slate-900" :title="row.name">{{ row.name }}</span>
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
                <button
                  v-if="row.hasFile"
                  type="button"
                  class="rounded-full border border-line px-2 py-0.5 text-xs text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
                  @click.stop="download(row)"
                >
                  下载
                </button>
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

  <ArchiveDetailDrawer
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
