<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElButton, ElInput, ElMessage, ElMessageBox, ElPagination } from 'element-plus'
import {
  containerTypeLabel,
  useEquipmentLedgerData,
} from '../composables/useEquipmentLedgerData'
import { useLiveQuery } from '../composables/useLiveQuery'
import { vesselImageUrl } from '../composables/useVesselList'
import { hasPerm } from '../api/auth'
import EquipmentColumnPicker from './equipment/EquipmentColumnPicker.vue'
import EquipmentDetailDrawer from './equipment/EquipmentDetailDrawer.vue'
import EquipmentFilterBar from './equipment/EquipmentFilterBar.vue'
import { firstNonNumericField } from './equipment/fields.js'
import { useEquipmentColumns } from './equipment/useEquipmentColumns.js'
import {
  hasClientFilter,
  matchesClientFilters,
  statusScope,
} from './equipment/useEquipmentFilters.js'

/**
 * 设备数据维护（2026-10-18 重构，变更-118）。
 *
 * ## 这一版改了什么
 *
 *   · 15 列 + 操作列 → **默认 8 列**（列配置可勾回全部 15 列），只能让「名称」自适应
 *   · 表格上方那块常驻的编辑弹窗 → **点行开右抽屉**（新增走同一个抽屉的空白模式）
 *   · 关键字 + 只看启用 + 按钮挤在标题行 → **一行不换行的筛选条**
 *
 * ## 没有变、也不许变的口径
 *
 *   · 搜索与分页**都在服务端**（变更-060 起关键字边打边查，防抖 250ms 走
 *     `useLiveQuery`；过期响应护栏在 `useEquipmentLedgerData` 的 `ledgerRequestSeq`）
 *   · 「停用的行也要显示」、`启用 / 停用` 的门槛与原因、`仅台账` 的提示（变更-087）
 *   · 定高链（变更-088）：卡片撑满、表格区自己滚、分页行钉卡底 —— 三串 class 原样保留，
 *     守卫按字面量钉着它们（少一级 `min-h-0` 卡片就会被内容顶高，分页行一页一个位置）
 *
 * ## 前端过滤的那两档
 *
 * 「停用·本页」与「容器类型」只在当前页内生效（后端没有这两个参数，硬约束是不改接口）。
 * 见 `equipment/useEquipmentFilters.js` 的注释 —— 数据量涨上去必须挪到后端。
 */
const {
  rows,
  total,
  loading,
  saving,
  loadError,
  pageNum,
  pageSize,
  keyword,
  onlyEnabled,
  loadLedger,
  loadLedgerPage,
  applyLedgerFilters,
  setLedgerPageSize,
  saveLedger,
  setLedgerEnabled,
} = useEquipmentLedgerData()

// 关键字边打边查（变更-060）：停 250ms 就发，不用回车；回车/清空 = 立刻发。
const { flush: flushLedgerQuery } = useLiveQuery(keyword, applyLedgerFilters)

const { orderedColumns } = useEquipmentColumns()

/**
 * 能不能改。用与导航同一个权限键（equipment:edit）—— 导航没这个键就不显示本页，
 * 所以真实用户的行为与改版前一致；这里补上门是为了「只读用户万一进来」时抽屉里
 * 不出现保存按钮，而不是让他填完才发现存不进去。
 */
const canEdit = computed(() => hasPerm('equipment:edit'))

/**
 * 已经有行、又正在查（实时查询的「细化」阶段）：只在计数处提示"查询中…"。
 * 遮罩只盖首屏（`loading && !rows.length`），打字期间必须另有"在查"的信号（变更-066）。
 */
const ledgerRefining = computed(() => loading.value && rows.value.length > 0)

/** 当前页经过**前端**筛选后真正显示的行 */
const displayRows = computed(() => rows.value.filter((row) => matchesClientFilters(row)))

/* ===== 打开抽屉 ===== */

const drawerOpen = ref(false)
const drawerMode = ref('edit')
const drawerRow = ref(null)
const drawerError = ref('')

function openCreate() {
  drawerMode.value = 'create'
  drawerRow.value = null
  drawerError.value = ''
  drawerOpen.value = true
}

function openDetail(row) {
  drawerMode.value = 'edit'
  drawerRow.value = row
  drawerError.value = ''
  drawerOpen.value = true
}

/* ===== 筛选 ===== */

/**
 * 筛选条变了。只有「启用」这一档会改服务端参数（`onlyEnabled`），
 * 其余两档是当前页内的前端过滤，不必为了它们再发一次请求。
 */
function onFilterChange() {
  const wantEnabled = statusScope.value === 'on'
  if (onlyEnabled.value === wantEnabled) return
  onlyEnabled.value = wantEnabled
  applyLedgerFilters()
}

/* ===== 保存 ===== */

async function handleSave(payload) {
  drawerError.value = ''
  if (!payload.equipmentName?.trim()) {
    drawerError.value = '设备名称不能为空'
    return
  }
  const badField = firstNonNumericField(payload)
  if (badField) {
    drawerError.value = `${badField}必须填数字（留空表示未填写）`
    return
  }
  try {
    await saveLedger(payload)
    drawerOpen.value = false
    ElMessage.success('已保存')
  } catch (e) {
    // 失败**不关抽屉**（变更-085）：后端把业务失败也发成 200，配合 request.js 的拦截
    // 现在能拿到原因，不能静默关掉当成功
    drawerError.value = `保存失败：${e?.response?.data?.msg || e?.message || '未知错误'}`
    ElMessage.error(drawerError.value)
  }
}

/* ===== 启停（口径不变，只是位置从"操作列"挪到状态格） ===== */

async function handleToggle(row) {
  if (row.enabled !== 1 && blockReasonOf(row)) {
    await showAlert(blockReasonOf(row), `${row.equipmentName || '该设备'}：不能启用`)
    return
  }
  try {
    await setLedgerEnabled(row.id, row.enabled !== 1)
  } catch (e) {
    loadError.value = `切换启停失败：${e?.response?.data?.msg || e?.message || '未知错误'}`
  }
}

/** 「不能启用」的原因；可以启用（或已启用）时返回空串 */
function blockReasonOf(row) {
  if (row.enabled === 1) return ''
  return row.enableBlockReason || ''
}

/**
 * 「不能参与体积计算」的原因（服务端对每一行都算好了）。
 * 与 blockReasonOf 的区别：那个决定【启用】按钮能否点（已启用返回空），
 * 这个回答"我已经启用了，为什么计算页里没有它"（变更-087）。
 */
function usageProblemOf(row) {
  return row.enableBlockReason || ''
}

async function showAlert(text, title) {
  try {
    await ElMessageBox.alert(text, title, { confirmButtonText: '知道了' })
  } catch {
    // 关掉弹窗即可，不算错误
  }
}

async function showUsageProblem(row) {
  await showAlert(
    `${usageProblemOf(row)}\n\n` +
      '这台设备在【设备检索 / 储罐液位录入】里仍然正常可用 —— 状态里的"仅台账"就是这个意思；' +
      '这里说的是它还不能进【压力容器体积计算】的下拉。',
    `${row.equipmentName || '该设备'}：不能参与体积计算`,
  )
}

/* ===== 单元格取值 ===== */

/** 封头深度一列显示「上 / 下」；下封头为空只可能是平底，并排写两列反而占地方 */
function headDepthText(row) {
  const top = row.topHeadDepth ?? '—'
  const bottom = row.bottomHeadDepth > 0 ? row.bottomHeadDepth : '平底'
  return `${top} / ${bottom}`
}

function imagePreview(file) {
  return vesselImageUrl(file)
}

/** 普通文本列；空值统一显示破折号，不要留白（留白会被误读成"没有这一列"） */
function cellText(row, key, index) {
  switch (key) {
    case 'index':
      return (pageNum.value - 1) * pageSize.value + index + 1
    case 'equipmentCode':
      return row.equipmentCode || '—'
    case 'equipmentName':
      return row.equipmentName || '—'
    case 'nickname':
      return row.nickname || '—'
    case 'workshop':
      return row.workshop || '—'
    case 'containerType':
      return containerTypeLabel(row.containerType)
    case 'spec':
      return row.spec || '—'
    case 'medium':
      return row.medium || '—'
    case 'innerDiameter':
      return row.innerDiameter ?? '—'
    case 'shellLength':
      return row.shellLength ?? '—'
    case 'straightFlange':
      return row.straightFlange ?? '—'
    case 'headDepth':
      return headDepthText(row)
    case 'density':
      return row.density ?? '—'
    default:
      return ''
  }
}

onMounted(() => {
  // loadLedger 自己吞错误并落到 loadError（失败时保留上一次取到的行）
  loadLedger()
})
</script>

<template>
  <!-- 定高链（变更-088）：卡片撑满页签给的高度、表格区自己滚、**分页行钉在卡底**。
       三串 class 原样保留，守卫按字面量钉着（与工单汇总 / 储罐液位同一张方子）。 -->
  <section class="flex min-h-0 flex-1 flex-col rounded-card border border-line bg-raised shadow-card">
    <div class="flex shrink-0 flex-nowrap items-center gap-x-3 border-b border-line px-6 py-4">
      <p class="shrink-0 text-sm font-medium text-slate-700">设备数据维护</p>
      <p class="shrink-0 text-xs text-slate-500">
        <template v-if="ledgerRefining">查询中…</template>
        <template v-else>
          本页 {{ displayRows.length }} / 共 {{ total }} 条
          <span v-if="hasClientFilter()" class="text-amber-700">（本页内过滤）</span>
        </template>
      </p>

      <!-- 筛选条：状态 chips + 容器类型（一行不换行） -->
      <EquipmentFilterBar class="min-w-0" @change="onFilterChange" />

      <div class="ml-auto flex shrink-0 items-center gap-2">
        <!-- 关键字边打边查（变更-060）：停 250ms 就发，不用回车；
             走 watch（输入法组字期间不触发）而不是 @input，选词时的拼音串不会变成一次查询 -->
        <el-input
          v-model="keyword"
          placeholder="位号 / 名称 / 昵称 / 规格 / 车间"
          aria-label="搜索设备"
          clearable
          class="!w-[220px]"
          @keyup.enter="flushLedgerQuery"
          @clear="flushLedgerQuery"
        />
        <EquipmentColumnPicker />
        <el-button @click="loadLedger">刷新</el-button>
        <el-button type="primary" @click="openCreate">新增设备</el-button>
      </div>
    </div>

    <p
      v-if="loadError"
      role="alert"
      class="shrink-0 border-b border-amber-200 bg-amber-50 px-6 py-3 text-xs text-amber-800"
    >
      {{ loadError }}
    </p>

    <!-- 表格区：`min-h-0 flex-1` 拿的是"卡片分给它之后剩下的空间"（定高，不随内容变），
         所以分页行永远在同一个位置；表头 `sticky top-0` 也终于有了参照物（变更-088）。 -->
    <div class="ledger-scroll min-h-0 flex-1 overflow-auto">
      <table class="w-full max-w-[1100px] table-fixed text-sm">
        <colgroup>
          <col v-for="column in orderedColumns" :key="column.key" :class="column.width" />
        </colgroup>
        <thead
          class="sticky top-0 z-10 bg-region text-xs text-slate-500 shadow-[0_1px_0_0_var(--color-line)]"
        >
          <tr>
            <th
              v-for="column in orderedColumns"
              :key="column.key"
              scope="col"
              class="whitespace-nowrap px-4 py-2.5 font-medium"
              :class="column.align === 'right' ? 'text-right' : 'text-left'"
            >
              {{ column.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in displayRows"
            :key="row.id"
            tabindex="0"
            class="cursor-pointer border-t border-line hover:bg-region focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
            :class="{ 'text-slate-500': row.enabled !== 1 }"
            @click="openDetail(row)"
            @keydown.enter.self.prevent="openDetail(row)"
            @keydown.space.self.prevent="openDetail(row)"
          >
            <td
              v-for="column in orderedColumns"
              :key="column.key"
              class="px-4 py-2.5"
              :class="[
                column.align === 'right' ? 'text-right' : 'text-left',
                column.key === 'equipmentName' ? 'font-medium' : '',
                column.key === 'index' ? 'text-xs text-slate-500' : '',
              ]"
            >
              <!-- 状态列：库里的 enabled 只表示"在台账里启用"，体积计算页还要求
                   底图 + 坐标 + 几何齐全。两者不一致时显示「启用 · 仅台账」并给原因入口，
                   否则使用方会以为"我明明启用了，为什么计算页下拉里没有它"（变更-087） -->
              <template v-if="column.key === 'status'">
                <div class="flex flex-wrap items-center gap-1 text-xs">
                  <template v-if="row.enabled !== 1">已停用</template>
                  <template v-else-if="usageProblemOf(row)">
                    <span>启用</span>
                    <span class="text-amber-700">· 仅台账</span>
                    <button
                      type="button"
                      class="text-amber-700 underline decoration-dotted focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
                      @click.stop="showUsageProblem(row)"
                    >
                      为何不能算
                    </button>
                  </template>
                  <template v-else>启用</template>

                  <el-button
                    size="small"
                    text
                    :disabled="row.enabled !== 1 && !!blockReasonOf(row)"
                    :title="blockReasonOf(row)"
                    @click.stop="handleToggle(row)"
                  >
                    {{ row.enabled === 1 ? '停用' : '启用' }}
                  </el-button>
                  <button
                    v-if="blockReasonOf(row)"
                    type="button"
                    class="text-amber-700 underline decoration-dotted focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
                    @click.stop="showAlert(blockReasonOf(row), `${row.equipmentName || '该设备'}：不能启用`)"
                  >
                    为何不能启用
                  </button>
                </div>
              </template>

              <!-- 底图列：缩略图 + 「未标定」徽标（有图没坐标 = 进不了体积计算页的下拉） -->
              <template v-else-if="column.key === 'imageFile'">
                <div class="flex items-center gap-2">
                  <img
                    v-if="row.imageFile"
                    :src="imagePreview(row.imageFile)"
                    :alt="`${row.equipmentName} 的容器底图`"
                    class="h-8 w-8 rounded-md border border-line object-contain"
                  />
                  <span v-else class="text-xs text-slate-500">未配</span>
                  <span
                    v-if="row.imageFile && !row.imageBounds"
                    class="rounded-full border border-amber-300 bg-amber-50 px-1.5 text-[11px] text-amber-700"
                  >
                    未标定
                  </span>
                </div>
              </template>

              <template v-else>{{ cellText(row, column.key, index) }}</template>
            </td>
          </tr>
          <tr v-if="!displayRows.length">
            <td :colspan="orderedColumns.length" class="px-4 py-10 text-center text-sm text-slate-500">
              {{ loading ? '正在加载…' : '没有符合条件的设备' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 分页行钉底（变更-088）：`shrink-0` 让它不参与上面的空间分配、始终贴卡底 -->
    <div v-if="rows.length" class="flex shrink-0 justify-end border-t border-line px-6 py-3">
      <el-pagination
        v-model:current-page="pageNum"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        background
        @current-change="loadLedgerPage"
        @size-change="setLedgerPageSize"
      />
    </div>

    <EquipmentDetailDrawer
      v-model="drawerOpen"
      :mode="drawerMode"
      :row="drawerRow"
      :can-edit="canEdit"
      :saving="saving"
      :error-message="drawerError"
      @save="handleSave"
    />
  </section>
</template>

<style scoped>
/*
 * 表格滚动条做细一点（变更-086）。
 *
 * 使用方原话：「尽量避免右边红色框选的滑块，很影响美观」。两件事：
 *   ① 默认每页 10 行 —— 1080p 与 768px 高的窗口下整表都不超高，默认视图里不出现滚动条；
 *   ② 万一还是超出（小屏 / 自己切到 50 行），滚动条从系统默认的十几像素降到 8px、
 *      去掉轨道底色。横向仍可滚（勾开全部 15 列时必须有）。
 *
 * ⚠️ 颜色用 `theme(colors.line)` 而不是 hex：本仓禁裸 hex（守卫会红）。
 */
.ledger-scroll {
  scrollbar-width: thin;
  scrollbar-color: theme(colors.line) transparent;
}
.ledger-scroll::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.ledger-scroll::-webkit-scrollbar-thumb {
  background: theme(colors.line);
  border-radius: 999px;
}
.ledger-scroll::-webkit-scrollbar-track {
  background: transparent;
}
</style>
