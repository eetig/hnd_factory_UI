<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElButton, ElImage, ElMessage, ElMessageBox, ElPagination } from 'element-plus'
import { hasPerm } from '../api/auth'
import { STATUS_ROW_TONE, STATUS_TONE } from '../constants/statusTones'
import {
  isStoredImage,
  storedImageThumb,
  usePurchaseTracking,
} from '../composables/usePurchaseTracking'
import PurchaseColumnPicker from './purchase/PurchaseColumnPicker.vue'
import PurchaseDetailDrawer from './purchase/PurchaseDetailDrawer.vue'
import PurchaseFilterBar from './purchase/PurchaseFilterBar.vue'
import { columnsWidthPx, usePurchaseColumns } from './purchase/usePurchaseColumns.js'
import { buildCopyText, copyText, isCopyColumn } from '../utils/clipboard.js'

/**
 * 采购需求详情（变更-117，2026-10-18：交互模型重构）。
 *
 * ## 这次改了什么（以及为什么）
 *
 * 使用方的验收标准是一句话：「**录一条采购需求 ≤3 次点击、零横向滚动**」。
 * 上一版（变更-092/096）是 Excel 式行内录入 + 15 列 + 操作列、总宽 1870px：
 *
 *   · 横向：1280 视口必横滚 —— "看数量时看不到物料名称"，台账里最难受的一种；
 *   · 录入：15 个输入框横在表里，填到"备注"要横滚三次，眼睛还要在表头与输入框
 *     之间来回对位；
 *   · 点击：新增＝第一行直接填（可以），但编辑＝点「编辑」+ 那一行原地变控件，
 *     在长表里很容易找不到自己刚才点的是哪一行。
 *
 * 现在：
 *   · **默认 8 列**（序号/进度/物料名称/规格/类别/数量/要求到货/需求人），
 *     固定列宽合计 666px + 物料名称自适应，封顶 1100px ⇒ 1280 视口不横滚；
 *     其余 7 列默认关、可从右上「列」按钮勾开，选择存 localStorage；
 *   · **点行开右抽屉**，15 个字段按「基本信息 / 数量与到货 / 单据与备注」竖排分组；
 *   · **新增也走同一个抽屉**（新建模式空值起步、自动聚焦物料名称、回车即存），
 *     所以路径是「新增 → 打字 → 保存」。
 *
 * ## 守住的旧结论（别在这里改回去）
 *
 * · 状态色只从 `constants/statusTones.js` 取，不手写色阶（那张表按 WCAG 算过）；
 * · 分类/单位/必填口径与后端一致；写操作按 `purchase:edit` 显隐（后端还有一层）；
 * · 保存失败**不清理已填内容**（`usePurchaseTracking.savePurchase` 抛错即保留表单）。
 */
const {
  rows,
  total,
  loading,
  saving,
  loadError,
  pageNum,
  pageSize,
  loadPurchase,
  loadPurchasePage,
  setPurchasePageSize,
  savePurchase,
  deletePurchase,
} = usePurchaseTracking()

const canEdit = computed(() => hasPerm('purchase:edit'))

const { orderedColumns } = usePurchaseColumns()

/** 抽屉状态：新建 / 编辑共用一个组件 */
const drawerOpen = ref(false)
const drawerMode = ref('edit')
const drawerRow = ref(null)
const drawerMessage = ref('')


function statusClass(status) {
  switch (status) {
    case 'OVERDUE':
      return STATUS_TONE.error
    case 'DUE_SOON':
      return STATUS_TONE.warning
    case 'ARRIVED':
      return STATUS_TONE.success
    case 'PARTIAL':
      return STATUS_TONE.info
    case 'PENDING_OA':
    case 'WAITING':
    default:
      return STATUS_TONE.neutral
  }
}

/** 整行淡底（变更-097）：底色只负责分区，精确含义交给同行的胶囊 */
function rowTone(status) {
  switch (status) {
    case 'OVERDUE':
      return STATUS_ROW_TONE.error
    case 'DUE_SOON':
      return STATUS_ROW_TONE.warning
    case 'ARRIVED':
      return STATUS_ROW_TONE.success
    case 'PARTIAL':
      return STATUS_ROW_TONE.info
    case 'PENDING_OA':
      return STATUS_ROW_TONE.neutral
    case 'WAITING':
    default:
      return ''
  }
}

/** 「25 个」；数量为空显示「—」（历史数据没有数量列） */
function quantityText(row) {
  const qty = row.quantity === null || row.quantity === undefined ? '' : String(row.quantity)
  if (!qty) return '—'
  return row.unit ? `${qty} ${row.unit}` : qty
}

/** 超期/临期后面的天数；天数由后端给，前端不自己算日期 */
function dayHint(row) {
  if (row.status === 'OVERDUE' && row.overdueDays) return `${row.overdueDays}天`
  if (row.status === 'DUE_SOON') {
    const days = row.daysToDue
    if (days === null || days === undefined) return ''
    return days === 0 ? '今天' : `${days}天`
  }
  return ''
}

/** 抽屉实例：新增保存后要让它清空物料三件套（见 handleSave） */
const drawerRef = ref(null)

function openCreate() {
  drawerMode.value = 'create'
  drawerRow.value = null
  drawerMessage.value = ''
  drawerOpen.value = true
}

function openDetail(row) {
  drawerMode.value = 'edit'
  drawerRow.value = row
  drawerMessage.value = ''
  drawerOpen.value = true
}

/** 必填口径与后端一致（界面先拦一次少一趟往返，后端拦住才是真的拦住） */
function requiredProblem(source) {
  if (!source.requester?.trim()) return '需求人不能为空'
  if (!source.materialName?.trim()) return '物料名称不能为空'
  return ''
}

/**
 * 单元格点击复制（2026-10-22，变更-144；使用方确认四条）：
 *   · 点**序号** → 复制「物料名称 ⇥ 物料编码 ⇥ 规格型号」一行三列（能直接粘进 Excel）
 *   · 点**物料名称 / 物料编码 / 规格型号** → 复制那一项
 *   · 这四个格子**只复制、不开抽屉**（其它列仍然点开抽屉）—— 复制是高频动作，
 *     每点一次都弹抽屉太吵
 *   · 成功：toast 说明复制了什么 + 单元格闪一下（从哪个格复制的）
 */
const flashedCell = ref('') // `${rowId}:${key}`，闪 700ms
let flashTimer = null

async function handleCellClick(row, key) {
  if (!isCopyColumn(key)) return

  const { text, label, empty } = buildCopyText(row, key)
  if (empty) {
    ElMessage.warning(`这一行的${label || '这一项'}是空的，没有可复制的内容`)
    return
  }

  const ok = await copyText(text)
  if (!ok) {
    ElMessage.error('复制失败：浏览器拒绝了剪贴板访问，请手动选中复制')
    return
  }

  flashedCell.value = `${row.id}:${key}`
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    flashedCell.value = ''
  }, 700)

  // 多行内容不往 toast 里塞（会撑得很长），只报"复制了三样"
  ElMessage.success(key === 'index' ? `已复制${label}` : `已复制${label}：${text.slice(0, 40)}`)
}

/** 可复制单元格的公共类：手型 + 悬停提示 + 刚复制过的底色 */
function cellClass(row, key) {
  if (!isCopyColumn(key)) return ''
  const flashing = flashedCell.value === `${row.id}:${key}`
  return `cursor-pointer transition-colors ${flashing ? 'bg-region' : 'hover:bg-region'}`
}

/** 抽屉里点保存（新建与编辑同一个入口，靠 id 有没有值区分） */
async function handleSave(payload) {
  const problem = requiredProblem(payload)
  if (problem) {
    drawerMessage.value = problem
    ElMessage.error(problem)
    return
  }
  try {
    // gotoFirstPage：排序是"提出需求日期倒序"，翻在第 2 页时新加的行看不见
    await savePurchase(payload, { gotoFirstPage: drawerMode.value === 'create' })

    /*
     * 新建：**不关抽屉**，清掉物料三件套继续录（2026-10-22，变更-142）。
     * 原先这里存完就关，但使用方要的是"同一批需求连着录几条物料"——
     * 关掉再点「新增需求」虽然也是空表，但需求人/日期/用途全要重填一遍。
     * 编辑仍然关：改一条就是一条。
     */
    if (drawerMode.value === 'create') {
      drawerRef.value?.resetForNextEntry?.()
      drawerMessage.value = ''
      ElMessage.success('已保存，接着录下一条（物料已清空）')
      return
    }

    drawerOpen.value = false
    drawerRow.value = null
    drawerMessage.value = ''
    ElMessage.success('已保存')
  } catch (e) {
    // 失败**不关抽屉、不清表单**：已填内容要留着（见文件头的口径）
    drawerMessage.value = `保存失败：${e?.response?.data?.msg || e?.message || '未知错误'}`
    ElMessage.error(drawerMessage.value)
  }
}

async function handleDelete(row) {
  if (!row) return
  try {
    await ElMessageBox.confirm(`删除「${row.materialName}」这条采购需求？`, '删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    await deletePurchase(row.id)
    drawerOpen.value = false
    drawerRow.value = null
    ElMessage.success('已删除')
  } catch (e) {
    ElMessage.error(`删除失败：${e?.response?.data?.msg || e?.message || '未知错误'}`)
  }
}


onMounted(loadPurchase)
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col rounded-card border border-line bg-raised shadow-card">
    <div class="shrink-0 border-b border-line px-6 py-3">
      <div class="flex items-center gap-3">
        <p class="text-sm font-medium text-slate-700">采购需求详情</p>
        <p class="text-xs text-slate-500">
          <template v-if="loading">查询中…</template>
          <template v-else>共 {{ total }} 条</template>
        </p>
        <div class="ml-auto flex items-center gap-2">
          <PurchaseColumnPicker />
          <el-button v-if="canEdit" type="primary" @click="openCreate">新增需求</el-button>
        </div>
      </div>

      <!-- 筛选条：一行不换行（内部只有 chips 那段可横滚） -->
      <div class="mt-2.5">
        <PurchaseFilterBar />
      </div>
    </div>

    <p
      v-if="loadError"
      role="alert"
      class="shrink-0 border-b border-amber-200 bg-amber-50 px-6 py-3 text-xs text-amber-800"
    >
      {{ loadError }}
    </p>

    <div class="purchase-scroll min-h-0 flex-1 overflow-auto">
      <!--
        宽度：**只让「物料名称」一列自适应**，其余列写死。
        ⚠️ 别给每列都写宽度 —— `table-fixed` + 全固定宽 + `w-full` 时浏览器会把
        剩余宽度按比例摊给所有列，数字列右对齐、左边一片空白（本会话踩过两次）。
        封顶 1100px：1280 视口下 8 列刚好，不出现横向滚动条。
      -->
      <!--
        宽度：**每一列都有固定宽度**，表格的 min-width 按当前可见列求和。
        列开得多（>1100px）时由外层 .purchase-scroll 横向滚动，**不压缩任何一列**。

        ⚠️ 2026-10-22（变更-143）：这里原来是 `w-full max-w-[1100px]` + 只有「物料名称」
        一列不写宽度（自适应）。使用方勾到 13 列后那一列直接消失 —— 固定宽合计超过 1100，
        自适应列算出来的剩余空间是负的，被压成 0 宽。
      -->
      <table
        class="ledger-table w-full table-fixed text-sm"
        :style="{ minWidth: columnsWidthPx(orderedColumns) + 'px' }"
      >
        <colgroup>
          <col v-for="col in orderedColumns" :key="col.key" :class="col.width" />
        </colgroup>
        <thead class="sticky top-0 z-10 bg-region">
          <tr>
            <th
              v-for="col in orderedColumns"
              :key="col.key"
              scope="col"
              class="whitespace-nowrap px-3 py-2 text-xs font-medium text-slate-500"
              :class="col.align === 'right' ? 'num text-right' : 'text-left'"
            >
              {{ col.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in rows"
            :key="row.id"
            tabindex="0"
            class="cursor-pointer transition-colors hover:bg-region focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-ink"
            :class="rowTone(row.status)"
            @click="openDetail(row)"
            @keydown.enter.self="openDetail(row)"
            @keydown.space.self.prevent="openDetail(row)"
          >
            <template v-for="col in orderedColumns" :key="col.key">
              <!-- 序号：跨页连续。点它复制「物料名称 ⇥ 物料编码 ⇥ 规格型号」（可粘进 Excel） -->
              <td
                v-if="col.key === 'index'"
                class="px-3 py-2 text-xs font-medium text-slate-500"
                :class="cellClass(row, 'index')"
                tabindex="0"
                role="button"
                :title="`点击复制：物料名称 / 物料编码 / 规格型号`"
                :aria-label="`复制第 ${(pageNum - 1) * pageSize + index + 1} 行的物料名称、编码、规格型号`"
                @click.stop="handleCellClick(row, 'index')"
                @keydown.enter.self.stop.prevent="handleCellClick(row, 'index')"
                @keydown.space.self.stop.prevent="handleCellClick(row, 'index')"
              >
                {{ (pageNum - 1) * pageSize + index + 1 }}
              </td>

              <!-- 进度：胶囊 + 天数 -->
              <td v-else-if="col.key === 'status'" class="px-3 py-2">
                <span class="inline-flex flex-col items-start gap-0.5">
                  <span class="rounded-full px-2 py-0.5 text-xs" :class="statusClass(row.status)">
                    {{ { OVERDUE: '超期', DUE_SOON: '临期', PENDING_OA: '待提单', WAITING: '等货', ARRIVED: '已到货', PARTIAL: '部分到货' }[row.status] || '等货' }}
                  </span>
                  <span v-if="dayHint(row)" class="text-xs text-slate-500">{{ dayHint(row) }}</span>
                </span>
              </td>

              <td
                v-else-if="col.key === 'materialName'"
                class="px-3 py-2 text-slate-700"
                :class="cellClass(row, 'materialName')"
                tabindex="0"
                role="button"
                title="点击复制物料名称"
                :aria-label="`复制物料名称 ${row.materialName || ''}`"
                @click.stop="handleCellClick(row, 'materialName')"
                @keydown.enter.self.stop.prevent="handleCellClick(row, 'materialName')"
                @keydown.space.self.stop.prevent="handleCellClick(row, 'materialName')"
              >
                <div class="line-clamp-2" :title="row.materialName || ''">
                  {{ row.materialName || '—' }}
                </div>
              </td>

              <td
                v-else-if="col.key === 'spec'"
                class="px-3 py-2 text-slate-600"
                :class="cellClass(row, 'spec')"
                tabindex="0"
                role="button"
                title="点击复制规格型号"
                :aria-label="`复制规格型号 ${row.spec || ''}`"
                @click.stop="handleCellClick(row, 'spec')"
                @keydown.enter.self.stop.prevent="handleCellClick(row, 'spec')"
                @keydown.space.self.stop.prevent="handleCellClick(row, 'spec')"
              >
                <div class="line-clamp-2" :title="row.spec || ''">{{ row.spec || '—' }}</div>
              </td>

              <td v-else-if="col.key === 'category'" class="px-3 py-2 text-slate-600">
                {{ row.category || '—' }}
              </td>

              <td
                v-else-if="col.key === 'quantity'"
                class="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-700"
              >
                {{ quantityText(row) }}
              </td>

              <td
                v-else-if="col.key === 'requiredArrivalDate'"
                class="whitespace-nowrap px-3 py-2 text-slate-600"
              >
                {{ row.requiredArrivalDate || '—' }}
              </td>

              <td v-else-if="col.key === 'requester'" class="px-3 py-2 text-slate-600">
                {{ row.requester || '—' }}
              </td>

              <td
                v-else-if="col.key === 'requestDate'"
                class="whitespace-nowrap px-3 py-2 text-slate-600"
              >
                {{ row.requestDate || '—' }}
              </td>

              <td
                v-else-if="col.key === 'materialCode'"
                class="px-3 py-2 text-slate-600"
                :class="cellClass(row, 'materialCode')"
                tabindex="0"
                role="button"
                title="点击复制物料编码"
                :aria-label="`复制物料编码 ${row.materialCode || ''}`"
                @click.stop="handleCellClick(row, 'materialCode')"
                @keydown.enter.self.stop.prevent="handleCellClick(row, 'materialCode')"
                @keydown.space.self.stop.prevent="handleCellClick(row, 'materialCode')"
              >
                <span class="tabular-nums">{{ row.materialCode || '—' }}</span>
              </td>

              <td v-else-if="col.key === 'purpose'" class="px-3 py-2 text-slate-600">
                <div class="line-clamp-2" :title="row.purpose || ''">{{ row.purpose || '—' }}</div>
              </td>

              <!-- OA 三态：已关联可点 / 有单号没链接 / 都没有 -->
              <td v-else-if="col.key === 'oaNo'" class="px-3 py-2 text-slate-600">
                <a
                  v-if="row.oaUrl"
                  :href="row.oaUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="block truncate text-brand-ink hover:underline"
                  :title="`在 OA 里打开：${row.oaUrl}`"
                  @click.stop
                >{{ row.oaNo || '打开 OA' }}</a>
                <span
                  v-else-if="row.oaNo"
                  class="block cursor-help truncate text-amber-700 underline decoration-amber-400/60 decoration-dashed underline-offset-2"
                  title="还没关联 OA 链接 —— 打开这条需求，把表单地址粘进去"
                >{{ row.oaNo }}</span>
                <span v-else class="text-slate-500">—</span>
              </td>

              <!-- 送货单三态：图片缩略图 / 文本老数据 / 空 -->
              <td v-else-if="col.key === 'deliveryNote'" class="px-3 py-2 text-slate-600">
                <el-image
                  v-if="isStoredImage(row.deliveryNote)"
                  :src="storedImageThumb(row.deliveryNote)"
                  :preview-src-list="[row.deliveryNote]"
                  :preview-teleported="true"
                  fit="cover"
                  alt="送货单图片"
                  title="点击查看原图"
                  class="h-8 w-8 cursor-zoom-in rounded border border-line"
                  @click.stop
                />
                <template v-else-if="row.deliveryNote">{{ row.deliveryNote }}</template>
                <span v-else class="text-slate-500">未到货</span>
              </td>

              <td
                v-else-if="col.key === 'actualArrival'"
                class="whitespace-nowrap px-3 py-2 text-slate-600"
              >
                <template v-if="row.actualArrivalDate || row.receivedQuantity">
                  <div>{{ row.actualArrivalDate || '—' }}</div>
                  <div
                    v-if="row.receivedQuantity"
                    class="text-xs"
                    :class="row.partial ? 'font-medium text-slate-700' : 'text-slate-500'"
                  >
                    到货 {{ row.receivedQuantity }}<template v-if="row.quantity"> / 需求 {{ row.quantity }}</template>
                  </div>
                </template>
                <template v-else>—</template>
              </td>

              <td v-else-if="col.key === 'remark'" class="px-3 py-2 text-slate-600">
                <div class="line-clamp-2" :title="row.remark || ''">{{ row.remark || '—' }}</div>
              </td>
            </template>
          </tr>

          <tr v-if="!rows.length">
            <td
              :colspan="orderedColumns.length"
              class="px-4 py-10 text-center text-sm text-slate-500"
            >
              {{ loading ? '正在加载…' : '还没有采购需求记录 —— 点右上「新增需求」就能记一条' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="rows.length" class="flex shrink-0 justify-end border-t border-line px-6 py-3">
      <el-pagination
        v-model:current-page="pageNum"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        background
        @current-change="loadPurchasePage"
        @size-change="setPurchasePageSize"
      />
    </div>

    <PurchaseDetailDrawer
    ref="drawerRef"
      v-model="drawerOpen"
      :mode="drawerMode"
      :row="drawerRow"
      :can-edit="canEdit"
      :saving="saving"
      :error-message="drawerMessage"
      @save="handleSave"
      @delete="handleDelete"
    />
  </section>
</template>

<style scoped>
/* 滚动条做细一点（与设备数据维护同一配方） */
.purchase-scroll {
  scrollbar-width: thin;
  scrollbar-color: theme(colors.line) transparent;
}
.purchase-scroll::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.purchase-scroll::-webkit-scrollbar-thumb {
  background: theme(colors.line);
  border-radius: 999px;
}
.purchase-scroll::-webkit-scrollbar-track {
  background: transparent;
}
</style>
