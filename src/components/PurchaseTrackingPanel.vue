<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElButton, ElDatePicker, ElImage, ElInput, ElMessage, ElMessageBox, ElOption, ElPagination, ElSelect } from 'element-plus'
import { hasPerm } from '../api/auth'
import { UNIT_OPTIONS } from './purchase/fields.js'
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
/** 「在一张已有的 OA 单下补一条」的预填值（抽屉从单据视图点「再加一条需求」时给） */
const drawerSeed = ref(null)
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


/* ─────────── 表格内录入（2026-11-10） ───────────
 * 使用方要「横向表格录入」。所以「新增需求」不再弹抽屉，而是往表格最上面插一行空行，
 * 行内逐格填，底部「保存全部」一次提交；抽屉保留给"编辑已有行"。
 * 失败的行**留在表里**并标红 —— 现场填十条，不能因为一条错就全丢。
 */
const draftRows = ref([])
const draftSaving = ref(false)
/** 每行的错误信息：key → 文案 */
const draftErrors = ref({})

let draftSeq = 0

function todayIso() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 草稿行的初始值：需求人/日期给常用的，其余空 */
function blankDraftRow() {
  draftSeq += 1
  return {
    __key: `draft-${draftSeq}`,
    requester: '',
    requestDate: '',
    materialName: '',
    materialCode: '',
    spec: '',
    purpose: '',
    category: '',
    quantity: '',
    unit: '',
    requiredArrivalDate: '',
    oaNo: '',
    oaUrl: '',
    orderType: '',
    acceptanceNo: '',
    acceptanceUrl: '',
    poNo: '',
    poUrl: '',
    remark: '',
  }
}

/**
 * 本批默认值（2026-11-10）。
 *
 * 一张 OA 单通常就是一批采购（5 条物料、同一个需求人、同一天提出、同一个用途）。
 * 让人把需求人/日期/用途/单号填 5 遍，是这张表最没必要的重复劳动。
 *
 * 口径：**行里留空就继承这里，填了就以行为准** —— 一批里偶尔混着两张单，
 * 那就把那一行的单号改掉，其余照旧继承。
 */
const batchDefaults = ref({
  requester: '',
  requestDate: todayIso(),
  purpose: '',
  oaNo: '',
  orderType: '',
})

/** 把本批默认值填进这一行（不改原对象：失败留在表里的行还得保持用户填的样子） */
function withBatchDefaults(d) {
  const inherit = (key) =>
    (d[key] ?? '').toString().trim() || (batchDefaults.value[key] ?? '').toString().trim()
  return {
    ...d,
    requester: inherit('requester'),
    requestDate: inherit('requestDate'),
    purpose: inherit('purpose'),
    oaNo: inherit('oaNo'),
    orderType: inherit('orderType'),
  }
}

function addDraftRow() {
  draftRows.value.unshift(blankDraftRow())
}

function removeDraftRow(key) {
  draftRows.value = draftRows.value.filter((d) => d.__key !== key)
  delete draftErrors.value[key]
}

function clearDrafts() {
  draftRows.value = []
  draftErrors.value = {}
}

/** 只校验必填（后端也校验，但这里先挡一道，免得整批 500） */
function draftProblem(d) {
  if (!d.requester.trim()) return '需求人必填'
  if (!d.requestDate) return '提出需求日期必填'
  if (!d.materialName.trim()) return '物料名称必填'
  if (!String(d.quantity).trim()) return '数量必填'
  if (!d.unit.trim()) return '单位必填'
  return ''
}


/* 草稿行里哪些列可以填、placeholder 是什么（2026-11-10）
 * 只列"真的要手填"的；进度/序号/送货单/实际到货在草稿行显示占位。 */
const DRAFT_TEXT = {
  materialName: '物料名称',
  spec: '规格',
  category: '类别',
  quantity: '数量',
  requiredArrivalDate: 'YYYY-MM-DD',
  requester: '需求人',
  requestDate: 'YYYY-MM-DD',
  materialCode: '物料编码',
  purpose: '用途',
  unit: '单位',
  oaNo: 'OA 单号',
  orderType: 'CGSQ/FWCGSQ/ZCSG',
  remark: '备注',
}

/** 验收状态：有验收单号即已验收（与后端同一口径，不存冗余列） */
function acceptanceState(row) {
  return row && row.acceptanceNo ? '已验收' : '未验收'
}
async function saveAllDrafts() {
  if (draftSaving.value) return
  if (!draftRows.value.length) return
  draftSaving.value = true
  draftErrors.value = {}
  const keep = []
  let okCount = 0
  for (const d of draftRows.value) {
    // 先合本批默认值，再校验：需求人/日期可能只在表头填了一次
    const row = withBatchDefaults(d)
    const problem = draftProblem(row)
    if (problem) {
      draftErrors.value[d.__key] = problem
      keep.push(d)
      continue
    }
    try {
      /*
       * 整行丢给 savePurchase，不再手写字段清单（2026-11-10）。
       *
       * 上一版在这里又抄了一遍字段名，结果漏了 oaNo/oaUrl —— 和 buildPurchasePayload
       * 漏字段是同一类事故：不报错、只是安静地不存。白名单应该只有
       * buildPurchasePayload 一处。
       */
      await savePurchase(row)
      okCount += 1
    } catch (e) {
      draftErrors.value[d.__key] = e?.response?.data?.msg || e?.message || '保存失败'
      keep.push(d)
    }
  }
  draftRows.value = keep
  draftSaving.value = false
  if (okCount) {
    ElMessage.success(`已保存 ${okCount} 条${keep.length ? '，' + keep.length + ' 条有问题留在表里' : ''}`)
    await loadPurchase()
  } else {
    ElMessage.error('一条都没存上，看每行后面的红字')
  }
}


function openDetail(row) {
  drawerMode.value = 'edit'
  drawerRow.value = row
  drawerSeed.value = null
  drawerMessage.value = ''
  drawerOpen.value = true
}

/**
 * 在单据视图里点「再加一条需求」（2026-11-10，变更-181）。
 *
 * 抽屉自己已经把表单开好了（它还留着一份 pendingSeed 兜底），这里只做两件事：
 * 把 mode 切成 create（保存时才会走"新建"分支），把预填值记下来给父组件回填。
 * 不关弹窗 —— 人是从这张单里点出来的，关掉再开等于让他重新找这张单。
 */
function handleAddLine(seed) {
  drawerSeed.value = seed || null
  drawerMode.value = 'create'
  drawerMessage.value = ''
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
      /*
       * 两种情况分开（2026-11-10，变更-181）：
       *   · 从「新增」进来 → 老口径：不关抽屉、清物料、接着录下一条
       *   · 从某张单据的「再加一条需求」进来 → 回那张单，让他看见新加的那一行
       */
      if (drawerSeed.value) {
        drawerMessage.value = ''
        ElMessage.success('已保存，加进这张单了')
        drawerMode.value = 'edit'
        await drawerRef.value?.afterLineAdded?.()
        return
      }
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
    await ElMessageBox.confirm(
      `删除「${row.oaNo ? row.oaNo + ' · ' : ''}${row.materialName}」？删除后不可恢复，送货单图片也会一起删掉。`,
      '删除确认',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
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
          <el-button v-if="canEdit" type="primary" @click="addDraftRow">新增一行</el-button>
        </div>
      </div>

      <!-- 筛选条：一行不换行（内部只有 chips 那段可横滚） -->
      <div class="mt-2.5">
        <PurchaseFilterBar />
      </div>

      <!--
        本批默认值（2026-11-10）：一张 OA 单通常就是一批，需求人/日期/用途/单号填一遍就够。
        行里留空 = 用这里的值；填了以行为准（一批里混两张单时改那一行即可）。
      -->
      <div
        v-if="canEdit && draftRows.length"
        class="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-line bg-region/50 px-3 py-2"
      >
        <span class="shrink-0 text-xs font-medium text-slate-600">本批默认</span>
        <el-input
          v-model="batchDefaults.requester"
          size="small"
          placeholder="需求人"
          aria-label="本批需求人"
          class="!w-[110px]"
        />
        <el-date-picker
          v-model="batchDefaults.requestDate"
          type="date"
          value-format="YYYY-MM-DD"
          size="small"
          placeholder="提出日期"
          aria-label="本批提出需求日期"
          class="!w-[140px]"
        />
        <el-input
          v-model="batchDefaults.purpose"
          size="small"
          placeholder="用途"
          aria-label="本批用途"
          class="!w-[120px]"
        />
        <el-input
          v-model="batchDefaults.oaNo"
          size="small"
          placeholder="OA 单号"
          aria-label="本批 OA 单号"
          class="!w-[150px]"
        />
        <el-input
          v-model="batchDefaults.orderType"
          size="small"
          placeholder="单据类型"
          aria-label="本批单据类型"
          class="!w-[120px]"
        />
        <span class="text-[11px] text-slate-500">行里留空 ＝ 用这里的值</span>
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
          <!-- 草稿行（2026-11-10 v2）：按 orderedColumns 逐列渲染，不再硬编码格数。
               上一版硬编码 18 格，与"可勾选/可排序/固定宽度"的真实列对不上，
               多出的格子把表格撑宽，尾部（备注、删除）被裁掉。 -->
          <tr
            v-for="d in draftRows"
            :key="d.__key"
            class="align-top"
          >
            <template v-for="col in orderedColumns" :key="'d-' + col.key">
              <td v-if="col.key === 'index'" class="px-3 py-2 text-xs font-medium text-brand-ink"><div class="flex items-center gap-1">新<button type="button" class="text-rose-700 hover:underline" title="删除这一行" @click="removeDraftRow(d.__key)">✕</button></div><p v-if="draftErrors[d.__key]" class="mt-1 text-[11px] leading-tight text-rose-700" :title="draftErrors[d.__key]">!</p></td>
              <td v-else-if="col.key === 'status'" class="px-3 py-2 text-xs text-slate-500">未保存</td>
              <td v-else-if="col.key === 'deliveryNote' || col.key === 'actualArrival'" class="px-3 py-2 text-xs text-slate-500">—</td>
              <td v-else-if="col.key === 'poNo'" class="px-3 py-2">
                <el-input v-model="d.poNo" size="small" placeholder="采购单号" aria-label="采购单号" />
                <el-input v-model="d.poUrl" size="small" placeholder="采购单链接" aria-label="采购单链接" class="mt-1" />
              </td>
              <td v-else-if="col.key === 'acceptanceNo'" class="px-3 py-2">
                <el-input v-model="d.acceptanceNo" size="small" placeholder="验收单号" aria-label="验收单号" />
                <el-input v-model="d.acceptanceUrl" size="small" placeholder="验收单链接" aria-label="验收单链接" class="mt-1" />
              </td>
              <td v-else-if="col.key === 'quantity'" class="px-3 py-2">
                <!--
                  数量与单位必须同格（2026-11-10）：单位是必填，但历史上**没有**「单位」这一列，
                  于是批量录入时会卡在「单位必填」而无处可填 —— 只能整批放弃改走抽屉。
                -->
                <div class="flex items-center gap-1">
                  <el-input
                    v-model="d.quantity"
                    size="small"
                    placeholder="数量"
                    aria-label="数量"
                    class="!w-[60px]"
                  />
                  <el-select
                    v-model="d.unit"
                    size="small"
                    placeholder="单位"
                    aria-label="单位"
                    class="!w-[64px]"
                  >
                    <el-option v-for="u in UNIT_OPTIONS" :key="u" :label="u" :value="u" />
                  </el-select>
                </div>
              </td>
              <td v-else class="px-3 py-2">
                <el-input
                  v-if="DRAFT_TEXT[col.key]"
                  v-model="d[col.key]"
                  size="small"
                  :placeholder="DRAFT_TEXT[col.key]"
                  :aria-label="col.label"
                />
                <span v-else class="text-xs text-slate-500">—</span>
              </td>
            </template>
          </tr>
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
              <!-- 单据类型与验收单（2026-11-10）：CGSQ 一般无验收单 -->
              <td v-else-if="col.key === 'orderType'" class="whitespace-nowrap px-3 py-2 text-slate-600">
                {{ row.orderType || '—' }}
              </td>

              <td v-else-if="col.key === 'poNo'" class="px-3 py-2">
                <a v-if="row.poUrl" :href="row.poUrl" target="_blank" rel="noopener noreferrer"
                  class="block truncate text-[11px] text-brand-ink underline decoration-dotted underline-offset-2"
                  :title="row.poUrl">{{ row.poNo || '打开采购单' }}</a>
                <span v-else-if="row.poNo" class="block truncate text-[11px] text-slate-600" :title="row.poNo">{{ row.poNo }}</span>
                <span v-else class="text-xs text-slate-500">—</span>
              </td>
              <td v-else-if="col.key === 'acceptanceNo'" class="px-3 py-2">
                <span class="rounded-full px-2 py-0.5 text-[11px]" :class="row.acceptanceNo ? 'bg-brand-soft text-brand-ink' : 'bg-region text-slate-500'">
                  {{ acceptanceState(row) }}
                </span>
                <a v-if="row.acceptanceUrl" :href="row.acceptanceUrl" target="_blank" rel="noopener noreferrer"
                  class="ml-1 text-[11px] text-brand-ink underline decoration-dotted underline-offset-2"
                  :title="row.acceptanceUrl">{{ row.acceptanceNo || '打开' }}</a>
                <span v-else-if="row.acceptanceNo" class="ml-1 text-[11px] text-slate-600">{{ row.acceptanceNo }}</span>
              </td>

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

          <!-- 有新草稿行时不再说「还没有记录」：那行就在上面，再喊空是自相矛盾 -->
          <tr v-if="!rows.length && !draftRows.length">
            <td
              :colspan="orderedColumns.length"
              class="px-4 py-10 text-center text-sm text-slate-500"
            >
              {{ loading ? '正在加载…' : '还没有采购需求记录 —— 点上方「新增一行」就能记一条' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="draftRows.length" class="flex shrink-0 items-center gap-3 border-t border-line bg-region px-6 py-2">
          <span class="text-xs text-slate-600">
            正在录入 {{ draftRows.length }} 条（保存成功才会消失）
          </span>
          <el-button size="small" :loading="draftSaving" type="primary" @click="saveAllDrafts">
            保存全部 {{ draftRows.length }} 条
          </el-button>
          <el-button size="small" @click="clearDrafts">清空</el-button>
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
      :seed="drawerSeed"
      :can-edit="canEdit"
      :saving="saving"
      :error-message="drawerMessage"
      @save="handleSave"
      @delete="handleDelete"
      @add-line="handleAddLine"
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
