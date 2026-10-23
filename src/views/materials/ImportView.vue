<script setup>
import { computed, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import LoadingMask from '../../components/LoadingMask.vue'
import { STATUS_TONE } from '../../constants/statusTones'
import { useMaterialImport } from '../../composables/useMaterialImport'

/*
 * 物料主数据导入（2026-10-23，变更-159）。
 *
 * 一页三步：选文件 → 看差异 → 确认导入。**中间那步不能省** —— 这是覆盖 3 万行主数据的
 * 操作，"点一下直接写"会把「列选错了」「少了一列导致 3 万行全判消失」这类事故直接落到库里。
 * 所以后端做成 preview（给 token，不落库）+ commit（凭 token 落库）两段。
 */
const {
  fileName,
  preview,
  result,
  loading,
  committing,
  error,
  canCommit,
  pickFile,
  runPreview,
  runCommit,
  reset,
} = useMaterialImport()

const fileInput = ref(null)
const dragging = ref(false)
const activeTab = ref('new')

/** 三个样例列表：后端每类只回 20 行，够确认口径 */
const tabs = computed(() => {
  if (!preview.value) return []
  return [
    { key: 'new', label: '新增', count: preview.value.newCount, rows: preview.value.newSamples ?? [] },
    { key: 'changed', label: '变更', count: preview.value.changedCount, rows: preview.value.changedSamples ?? [] },
    { key: 'removed', label: '消失（转停用）', count: preview.value.removedCount, rows: preview.value.removedSamples ?? [] },
  ]
})

const activeRows = computed(() => tabs.value.find((tab) => tab.key === activeTab.value)?.rows ?? [])

function chooseFile() {
  fileInput.value?.click()
}

function onFileChange(event) {
  const selected = event.target.files?.[0]
  pickFile(selected)
  // 允许重复选同一个文件（清空 value，否则第二次不触发 change）
  event.target.value = ''
  if (selected) {
    runPreview()
  }
}

function onDrop(event) {
  dragging.value = false
  const selected = event.dataTransfer?.files?.[0]
  if (!selected) return
  pickFile(selected)
  if (!error.value) {
    runPreview()
  }
}

async function confirmCommit() {
  const p = preview.value
  if (!p) return
  const detail = `新增 ${p.newCount} 行、变更 ${p.changedCount} 行、消失 ${p.removedCount} 行（转停用）。`
  try {
    await ElMessageBox.confirm(
      `${detail}导入后这些变化会立即生效，确定继续？`,
      '确认导入物料主数据',
      { type: 'warning', confirmButtonText: '确认导入', cancelButtonText: '再看看' },
    )
  } catch {
    return
  }
  await runCommit()
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-4">
    <!-- 1. 选文件 -->
    <section class="shrink-0 rounded-card border border-line bg-raised shadow-card">
      <div class="border-b border-line px-6 py-3">
        <p class="text-sm font-semibold text-slate-900">上传 SAP 导出的物料清单</p>
        <p class="mt-1 text-xs text-slate-500">
          表头需包含 物料 / 物料描述 / 物料类型；一行 = 一个「物料编码 × 评估类型」。
          消失的物料会转停用，不会删除。
        </p>
      </div>

      <div class="px-6 py-4">
        <div
          class="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-6 py-8 text-center transition"
          :class="dragging ? 'border-brand bg-region' : 'border-line hover:bg-region'"
          tabindex="0"
          role="button"
          @click="chooseFile"
          @keydown.enter.prevent="chooseFile"
          @keydown.space.prevent="chooseFile"
          @dragover.prevent="dragging = true"
          @dragleave.prevent="dragging = false"
          @drop.prevent="onDrop"
        >
          <p class="text-sm text-slate-700">
            {{ fileName || '点击选择文件，或把 .xlsx 拖到这里' }}
          </p>
          <p class="mt-1 text-xs text-slate-500">支持 .xlsx / .xls，单次一个文件</p>
          <input
            ref="fileInput"
            type="file"
            accept=".xlsx,.xls"
            class="hidden"
            @change="onFileChange"
          />
        </div>

        <p v-if="error" class="mt-3 rounded-lg px-3 py-2 text-xs" :class="STATUS_TONE.error">
          {{ error }}
        </p>
      </div>
    </section>

    <!-- 2. 差异 -->
    <section
      v-if="preview"
      class="flex min-h-0 flex-1 flex-col rounded-card border border-line bg-raised shadow-card"
    >
      <div class="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-6 py-3">
        <p class="text-sm font-semibold text-slate-900">比对结果</p>
        <p class="text-xs text-slate-500">
          {{ preview.fileName }} · 解析 {{ preview.totalRows }} 行 · 未变 {{ preview.unchangedCount }} 行
        </p>
        <button
          type="button"
          class="ml-auto rounded-lg border border-line px-3 py-1.5 text-xs text-slate-600 hover:bg-region"
          @click="reset"
        >重新选择</button>
        <button
          type="button"
          class="rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white transition hover:bg-slate-700 disabled:opacity-50"
          :disabled="!canCommit"
          @click="confirmCommit"
        >{{ committing ? '导入中…' : '确认导入' }}</button>
      </div>

      <div class="grid shrink-0 grid-cols-4 gap-3 px-6 py-4">
        <div class="rounded-lg border border-line px-4 py-3">
          <p class="text-xs text-slate-500">新增</p>
          <p class="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{{ preview.newCount }}</p>
        </div>
        <div class="rounded-lg border border-line px-4 py-3">
          <p class="text-xs text-slate-500">变更</p>
          <p class="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{{ preview.changedCount }}</p>
        </div>
        <div class="rounded-lg border border-line px-4 py-3">
          <p class="text-xs text-slate-500">消失（转停用）</p>
          <p class="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{{ preview.removedCount }}</p>
        </div>
        <div class="rounded-lg border border-line px-4 py-3">
          <p class="text-xs text-slate-500">未变</p>
          <p class="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{{ preview.unchangedCount }}</p>
        </div>
      </div>

      <p
        v-if="preview.warnings && preview.warnings.length"
        class="mx-6 mb-3 rounded-lg px-3 py-2 text-xs"
        :class="STATUS_TONE.warning"
      >
        {{ preview.warnings.join('；') }}
      </p>

      <div class="flex shrink-0 items-center gap-2 border-t border-line px-6 py-2">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          class="rounded-lg px-3 py-1 text-xs transition"
          :class="activeTab === tab.key ? 'bg-region font-semibold text-slate-900' : 'text-slate-600 hover:bg-region'"
          @click="activeTab = tab.key"
        >{{ tab.label }} {{ tab.count }}</button>
        <span class="ml-auto text-xs text-slate-500">每类只展示前 20 行示例</span>
      </div>

      <div class="relative min-h-0 flex-1 overflow-auto">
        <table class="w-full table-fixed divide-y divide-line text-left">
          <colgroup>
            <col class="w-[104px]" />
            <col class="w-[84px]" />
            <col />
            <col class="w-[320px]" />
          </colgroup>
          <thead class="sticky top-0 z-10 bg-region">
            <tr>
              <th class="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">物料编码</th>
              <th class="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">评估类型</th>
              <th class="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">物料描述</th>
              <th class="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">差异</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line">
            <tr v-for="(row, index) in activeRows" :key="`${row.code}-${row.valuationType}-${index}`">
              <td class="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-600">{{ row.code }}</td>
              <td class="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{{ row.valuationType || '主档' }}</td>
              <td class="truncate px-3 py-2 text-xs text-slate-800" :title="row.name">{{ row.name }}</td>
              <td class="px-3 py-2 text-xs text-slate-600">{{ row.diff || '—' }}</td>
            </tr>
            <tr v-if="!activeRows.length">
              <td colspan="4" class="px-3 py-8 text-center text-xs text-slate-500">这一类没有内容</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 3. 结果 -->
    <section
      v-else-if="result"
      class="shrink-0 rounded-card border border-line bg-raised shadow-card"
    >
      <div class="border-b border-line px-6 py-3">
        <p class="text-sm font-semibold text-slate-900">导入完成</p>
        <p class="mt-1 text-xs text-slate-500">{{ result.fileName }}</p>
      </div>
      <div class="grid grid-cols-4 gap-3 px-6 py-4">
        <div class="rounded-lg border border-line px-4 py-3">
          <p class="text-xs text-slate-500">插入</p>
          <p class="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{{ result.inserted }}</p>
        </div>
        <div class="rounded-lg border border-line px-4 py-3">
          <p class="text-xs text-slate-500">更新</p>
          <p class="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{{ result.updated }}</p>
        </div>
        <div class="rounded-lg border border-line px-4 py-3">
          <p class="text-xs text-slate-500">转停用</p>
          <p class="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{{ result.disabled }}</p>
        </div>
        <div class="rounded-lg border border-line px-4 py-3">
          <p class="text-xs text-slate-500">待禁用（名称标记）</p>
          <p class="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{{ result.pendingDisabled }}</p>
        </div>
      </div>
      <div class="px-6 pb-4">
        <button
          type="button"
          class="rounded-lg border border-line px-3 py-1.5 text-xs text-slate-600 hover:bg-region"
          @click="reset"
        >再导入一次</button>
      </div>
    </section>

    <LoadingMask v-if="loading" />
  </div>
</template>
