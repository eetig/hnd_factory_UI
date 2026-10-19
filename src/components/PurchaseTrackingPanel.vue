<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import {
  ElAutocomplete,
  ElButton,
  ElDatePicker,
  ElImage,
  ElInput,
  ElMessage,
  ElMessageBox,
  ElPagination,
} from 'element-plus'
import { hasPerm } from '../api/auth'
import { useLiveQuery } from '../composables/useLiveQuery'
import { useMaterialLookup } from '../composables/useMaterialLookup'
import {
  isStoredImage,
  storedImageThumb,
  usePurchaseTracking,
} from '../composables/usePurchaseTracking'
import DeliveryNoteUpload from './DeliveryNoteUpload.vue'

/**
 * 采购进度跟踪（变更-091，2026-10-16；变更-092 改成表内录入）。
 *
 * 使用方原话：「PC端就不用这种卡片式，直接在行上面添加，物料名称可以搜索，实时搜索的形式，
 * 物料编码自动带出，也可以根据物料编码搜索，物料名称自动带出。」
 * ⇒ 去掉弹窗，改成**表格第一行直接填**（采购同事的心智就是 Excel：上面一行敲完就多一条），
 *   点某行的「编辑」时那一行**原地变成输入框**，不再跳弹窗。
 *
 * 物料两个框是 `el-autocomplete` 远程检索（`/api/stock/list`，见 useMaterialLookup）：
 * 打名称搜、打编码也搜，**选中**后互相带出（只是打字不互填 —— 否则半个名字会把编码冲掉）。
 *
 * ⚠️ 写操作按权限位 `purchase:edit` 显隐；查询对所有人开放（列表接口本来就免登录）。
 * 后端另有 @SaCheckPermission 兜底：界面藏了不等于接口安全，两层都要在。
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
  rangeStart,
  rangeEnd,
  loadPurchase,
  loadPurchasePage,
  applyPurchaseFilters,
  setPurchasePageSize,
  savePurchase,
  deletePurchase,
} = usePurchaseTracking()

const { fetchMaterialSuggestions, cancelMaterialSearch } = useMaterialLookup()

// 关键字边打边查（防抖 + 查询签名去重 + 卸载撤销，公共接线见 useLiveQuery）；
// 回车 / 清空 = 显式意图，立刻发。日期区间是离散动作，直接 @change 触发。
const { flush: flushPurchaseQuery } = useLiveQuery(keyword, applyPurchaseFilters)

const canEdit = computed(() => hasPerm('purchase:edit'))

/** 新增行（表格第一行）的草稿。空着的字段就按"没有"处理 */
const draft = reactive({})
/** 正在原地编辑的那一行的草稿；null = 没有行在编辑 */
const edit = ref(null)
const message = ref('')

function blankDraft() {
  return {
    requester: '',
    requestDate: '',
    materialName: '',
    materialCode: '',
    spec: '',
    requiredArrivalDate: '',
    purchaseOrderNo: '',
    deliveryNote: '',
    remark: '',
  }
}

/**
 * 可编辑单元格的字段表 —— 新增行与编辑行共用一份，避免两处各写 9 个 <td> 而慢慢写歪。
 *
 * kind 决定用哪个控件：text=input、date=el-date-picker、materialName/materialCode=el-autocomplete。
 * **顺序与表头一一对应**（含备注列；备注是库里的字段，不给它留列就永远填不进去）。
 */
const EDIT_FIELDS = [
  { key: 'requester', kind: 'text', placeholder: '需求人', aria: '需求人' },
  { key: 'requestDate', kind: 'date', aria: '提出需求日期' },
  { key: 'materialName', kind: 'materialName', placeholder: '打字搜物料名称', aria: '物料名称' },
  { key: 'materialCode', kind: 'materialCode', placeholder: '打字搜物料编码', aria: '物料编码' },
  { key: 'spec', kind: 'text', placeholder: '规格型号', aria: '规格型号' },
  { key: 'requiredArrivalDate', kind: 'date', aria: '要求到货日期' },
  { key: 'purchaseOrderNo', kind: 'text', placeholder: '订单号', aria: '采购订单号' },
  // 送货单是一张图片（变更-094，使用方：「送货单是一张图片」）—— 不再是文本框，
  // 换成上传控件（选图即传、显示缩略图、可重传/删除）。
  { key: 'deliveryNote', kind: 'image', aria: '送货单图片' },
  { key: 'remark', kind: 'text', placeholder: '备注', aria: '备注' },
]

/**
 * 从下拉里选中一条物料后互相带出。
 *
 * · 选名字 → 带出编码；
 * · 选编码 → 带出名字（**主数据里没有名字时保持原样**，不要拿编码冒充名字 ——
 *   `/api/stock/list` 的注释写明名称可能为 null，那时显示编码只是显示层的兜底）；
 * · 规格只在**原本空着**时填，不覆盖人已经敲进去的内容。
 */
function pickMaterial(target, option, source) {
  if (!option) {
    return
  }
  if (source === 'name') {
    target.materialName = option.name || option.code
    target.materialCode = option.code
  } else {
    target.materialCode = option.code
    if (option.name) {
      target.materialName = option.name
    }
  }
  if (!target.spec) {
    target.spec = option.spec || ''
  }
}

function resetDraft() {
  Object.assign(draft, blankDraft())
  message.value = ''
}

function startEdit(row) {
  edit.value = {
    id: row.id,
    requester: row.requester ?? '',
    requestDate: row.requestDate ?? '',
    materialName: row.materialName ?? '',
    materialCode: row.materialCode ?? '',
    spec: row.spec ?? '',
    requiredArrivalDate: row.requiredArrivalDate ?? '',
    purchaseOrderNo: row.purchaseOrderNo ?? '',
    deliveryNote: row.deliveryNote ?? '',
    remark: row.remark ?? '',
  }
  message.value = ''
}

function cancelEdit() {
  edit.value = null
  message.value = ''
}

/** 必填口径与后端一致（界面先拦一次少一趟往返，后端拦住才是真的拦住） */
function requiredProblem(source) {
  if (!source.requester?.trim()) {
    return '需求人不能为空'
  }
  if (!source.materialName?.trim()) {
    return '物料名称不能为空'
  }
  return ''
}

/** 新增行保存 */
async function handleCreate() {
  const problem = requiredProblem(draft)
  if (problem) {
    message.value = problem
    ElMessage.error(problem)
    return
  }
  try {
    await savePurchase(draft)
    resetDraft()
    ElMessage.success('已保存')
  } catch (e) {
    // ⚠️ 失败**不清理已填内容**：api/request.js 已把「HTTP 200 + success:false」拦成拒绝
    // （变更-085），这里拿得到后端原话；清空输入框等于让人重敲一遍（变更-091 的弹窗版本
    // 就是靠"不关弹窗"保住这一点的，改成行内录入后由"不清 draft"接替）。
    message.value = `保存失败：${e?.response?.data?.msg || e?.message || '未知错误'}`
    ElMessage.error(message.value)
  }
}

/** 原地编辑保存 */
async function handleUpdate() {
  const problem = requiredProblem(edit.value)
  if (problem) {
    message.value = problem
    ElMessage.error(problem)
    return
  }
  try {
    await savePurchase(edit.value)
    edit.value = null
    ElMessage.success('已保存')
  } catch (e) {
    message.value = `保存失败：${e?.response?.data?.msg || e?.message || '未知错误'}`
    ElMessage.error(message.value)
  }
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`删除「${row.materialName}」这条采购需求？`, '删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return // 取消
  }
  try {
    await deletePurchase(row.id)
    ElMessage.success('已删除')
  } catch (e) {
    ElMessage.error(`删除失败：${e?.response?.data?.msg || e?.message || '未知错误'}`)
  }
}

onMounted(() => {
  resetDraft()
  loadPurchase()
})
// 离开面板撤销待发的物料检索（免得已经不打字了还在打接口）
onUnmounted(cancelMaterialSearch)
</script>

<template>
  <!-- 定高链（变更-088 的方子）：卡片撑满页签给的高度、表格区自己滚、**分页行钉在卡底** -->
  <section class="flex min-h-0 flex-1 flex-col rounded-card border border-line bg-raised shadow-card">
    <div class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-3 border-b border-line px-6 py-3">
      <!-- 变更-096 试点（使用方指定的参考站 supply.madebyoversight.com）：「小标签 + 大标题」两层。
           标签**照抄仓库已有的眉标写法**（侧栏 FACTORY、登录页 Factory Operations 都是
           text-xs uppercase tracking-[0.18em]），不另造第三套字号 —— 参考站是 11px/0.08em，
           这里故意跟仓库一致，否则同一屏会出现两种"小标签"。标题 18px/500 + 收紧字距
           （照参考站 52px/500/−0.015em 那个"大而不粗"的比例，缩到卡片头放得下的档）。 -->
      <div class="min-w-0">
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Purchase tracking
        </p>
        <h2 class="mt-0.5 text-lg font-medium tracking-tight text-slate-900">采购进度跟踪</h2>
      </div>
      <p class="text-xs text-slate-500">
        <template v-if="loading">查询中…</template>
        <template v-else>共 {{ total }} 条</template>
      </p>
      <div class="ml-auto flex flex-wrap items-center gap-x-2 gap-y-2">
        <el-input
          v-model="keyword"
          placeholder="需求人 / 物料名称 / 物料编码 / 订单号 / 送货单"
          aria-label="搜索采购需求"
          clearable
          class="w-64"
          @keyup.enter="flushPurchaseQuery"
          @clear="flushPurchaseQuery"
        />
        <el-date-picker
          v-model="rangeStart"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="提出需求·起"
          aria-label="提出需求日期起"
          class="w-40"
          @change="applyPurchaseFilters"
        />
        <span class="text-xs text-slate-500">至</span>
        <el-date-picker
          v-model="rangeEnd"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="提出需求·止"
          aria-label="提出需求日期止"
          class="w-40"
          @change="applyPurchaseFilters"
        />
        <el-button @click="applyPurchaseFilters">查询</el-button>
      </div>
    </div>

    <p
      v-if="loadError"
      role="alert"
      class="shrink-0 border-b border-amber-200 bg-amber-50 px-6 py-3 text-xs text-amber-800"
    >
      {{ loadError }}
    </p>

    <p
      v-if="message"
      role="alert"
      class="shrink-0 border-b border-rose-200 bg-rose-50 px-6 py-2 text-xs text-rose-700"
    >
      {{ message }}
    </p>

    <div class="purchase-scroll min-h-0 flex-1 overflow-auto">
      <table class="w-full text-sm">
        <thead
          class="sticky top-0 z-10 bg-region text-xs text-slate-500 shadow-[0_1px_0_0_var(--color-line,#e5e7eb)]"
        >
          <tr>
            <th scope="col" class="px-3 py-2.5 text-right font-medium">序号</th>
            <th scope="col" class="px-3 py-2.5 text-left font-medium">需求人</th>
            <th scope="col" class="px-3 py-2.5 text-left font-medium">提出需求日期</th>
            <th scope="col" class="px-3 py-2.5 text-left font-medium">物料名称</th>
            <th scope="col" class="px-3 py-2.5 text-left font-medium">物料编码</th>
            <th scope="col" class="px-3 py-2.5 text-left font-medium">规格型号</th>
            <th scope="col" class="px-3 py-2.5 text-left font-medium">要求到货日期</th>
            <th scope="col" class="px-3 py-2.5 text-left font-medium">采购订单号</th>
            <th scope="col" class="px-3 py-2.5 text-left font-medium">送货单</th>
            <th scope="col" class="px-3 py-2.5 text-left font-medium">备注</th>
            <th v-if="canEdit" scope="col" class="px-3 py-2.5 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          <!-- ★ 新增行：就摆在数据行**上面**，敲完点保存（或在本行文本框里回车）就多一条。
               不做弹窗 —— 采购同事的心智是 Excel，跳窗会打断连续录入。 -->
          <tr v-if="canEdit" class="border-t border-line bg-region/40">
            <td class="px-3 py-1.5 text-right align-middle text-base leading-none text-brand">＋</td>
            <td v-for="f in EDIT_FIELDS" :key="f.key" class="px-2 py-1.5">
              <el-date-picker
                v-if="f.kind === 'date'"
                v-model="draft[f.key]"
                type="date"
                size="small"
                value-format="YYYY-MM-DD"
                placeholder="选择日期"
                :aria-label="f.aria"
                class="w-full"
              />
              <el-autocomplete
                v-else-if="f.kind === 'materialName'"
                v-model="draft.materialName"
                class="w-full"
                size="small"
                value-key="label"
                :fetch-suggestions="fetchMaterialSuggestions"
                :trigger-on-focus="true"
                :debounce="0"
                :placeholder="f.placeholder"
                :aria-label="f.aria"
                @select="pickMaterial(draft, $event, 'name')"
              >
                <template #default="{ item }">
                  <span class="text-sm text-slate-800">{{ item.label }}</span>
                  <span v-if="item.code" class="ml-2 text-xs text-slate-500">{{ item.code }}</span>
                  <span v-if="item.spec" class="ml-2 text-xs text-slate-500">{{ item.spec }}</span>
                </template>
              </el-autocomplete>
              <el-autocomplete
                v-else-if="f.kind === 'materialCode'"
                v-model="draft.materialCode"
                class="w-full"
                size="small"
                value-key="code"
                :fetch-suggestions="fetchMaterialSuggestions"
                :trigger-on-focus="true"
                :debounce="0"
                :placeholder="f.placeholder"
                :aria-label="f.aria"
                @select="pickMaterial(draft, $event, 'code')"
              >
                <template #default="{ item }">
                  <span class="text-sm text-slate-800">{{ item.code }}</span>
                  <span v-if="item.label" class="ml-2 text-xs text-slate-500">{{ item.label }}</span>
                  <span v-if="item.spec" class="ml-2 text-xs text-slate-500">{{ item.spec }}</span>
                </template>
              </el-autocomplete>
              <DeliveryNoteUpload
                v-else-if="f.kind === 'image'"
                :value="draft[f.key]"
                @update:value="draft[f.key] = $event"
              />
              <el-input
                v-else
                v-model="draft[f.key]"
                size="small"
                :placeholder="f.placeholder"
                :aria-label="f.aria"
                @keyup.enter="handleCreate"
              />
            </td>
            <td class="px-3 py-1.5 text-right whitespace-nowrap">
              <!-- saving 是数据层的一个共享标志：编辑某行时它也会是 true。
                   所以这里用 `saving && !edit` —— 否则编辑行保存时，新增行的按钮也跟着转。 -->
              <el-button size="small" type="primary" :loading="saving && !edit" @click="handleCreate">
                保存
              </el-button>
              <el-button size="small" @click="resetDraft">清空</el-button>
            </td>
          </tr>

          <!-- 数据行：正在编辑的那一行原地变成输入框（同一份字段表，两种形态不会写歪） -->
          <tr
            v-for="(row, index) in rows"
            :key="row.id"
            class="border-t border-line"
            :class="
              edit && edit.id === row.id
                ? 'bg-region/40'
                : canEdit
                  ? 'cursor-pointer hover:bg-region focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand'
                  : ''
            "
            :tabindex="canEdit && !(edit && edit.id === row.id) ? 0 : -1"
            @click="canEdit && !(edit && edit.id === row.id) && startEdit(row)"
            @keydown.enter.self.prevent="canEdit && !(edit && edit.id === row.id) && startEdit(row)"
          >
            <!-- 序号跨页连续（不是每页从 1 开始）：使用方是照着序号核对，一翻页重新数会串 -->
            <td class="px-3 py-2 text-right text-xs text-slate-500">
              {{ (pageNum - 1) * pageSize + index + 1 }}
            </td>

            <template v-if="edit && edit.id === row.id">
              <td v-for="f in EDIT_FIELDS" :key="f.key" class="px-2 py-1.5">
                <el-date-picker
                  v-if="f.kind === 'date'"
                  v-model="edit[f.key]"
                  type="date"
                  size="small"
                  value-format="YYYY-MM-DD"
                  placeholder="选择日期"
                  :aria-label="f.aria"
                  class="w-full"
                />
                <el-autocomplete
                  v-else-if="f.kind === 'materialName'"
                  v-model="edit.materialName"
                  class="w-full"
                  size="small"
                  value-key="label"
                  :fetch-suggestions="fetchMaterialSuggestions"
                  :trigger-on-focus="true"
                  :debounce="0"
                  :placeholder="f.placeholder"
                  :aria-label="f.aria"
                  @select="pickMaterial(edit, $event, 'name')"
                >
                  <template #default="{ item }">
                    <span class="text-sm text-slate-800">{{ item.label }}</span>
                    <span v-if="item.code" class="ml-2 text-xs text-slate-500">{{ item.code }}</span>
                    <span v-if="item.spec" class="ml-2 text-xs text-slate-500">{{ item.spec }}</span>
                  </template>
                </el-autocomplete>
                <el-autocomplete
                  v-else-if="f.kind === 'materialCode'"
                  v-model="edit.materialCode"
                  class="w-full"
                  size="small"
                  value-key="code"
                  :fetch-suggestions="fetchMaterialSuggestions"
                  :trigger-on-focus="true"
                  :debounce="0"
                  :placeholder="f.placeholder"
                  :aria-label="f.aria"
                  @select="pickMaterial(edit, $event, 'code')"
                >
                  <template #default="{ item }">
                    <span class="text-sm text-slate-800">{{ item.code }}</span>
                    <span v-if="item.label" class="ml-2 text-xs text-slate-500">{{ item.label }}</span>
                    <span v-if="item.spec" class="ml-2 text-xs text-slate-500">{{ item.spec }}</span>
                  </template>
                </el-autocomplete>
                <DeliveryNoteUpload
                  v-else-if="f.kind === 'image'"
                  :value="edit[f.key]"
                  @update:value="edit[f.key] = $event"
                />
                <el-input
                  v-else
                  v-model="edit[f.key]"
                  size="small"
                  :placeholder="f.placeholder"
                  :aria-label="f.aria"
                  @keyup.enter="handleUpdate"
                />
              </td>
              <td class="px-3 py-1.5 text-right whitespace-nowrap">
                <el-button size="small" type="primary" :loading="saving" @click.stop="handleUpdate">
                  保存
                </el-button>
                <el-button size="small" @click.stop="cancelEdit">取消</el-button>
              </td>
            </template>

            <template v-else>
              <td class="px-3 py-2 text-slate-600">{{ row.requester || '—' }}</td>
              <td class="px-3 py-2 text-slate-600">{{ row.requestDate || '—' }}</td>
              <td class="px-3 py-2 font-medium">{{ row.materialName }}</td>
              <!-- 编码可能还没有（采购/仓库后定）：空值显示「—」，不要显示成 0 或空白 -->
              <td class="px-3 py-2 text-slate-600">
                {{ row.materialCode || '—' }}
                <!-- ⚠️ 措辞要两种情况下都成立：有编码时后端**要么**把它登记进 0000 档、
                     **要么**发现它本来就在库存表里而跳过。说「总表可查」才是两句都真的话。 -->
                <span
                  v-if="row.materialCode"
                  class="ml-1 rounded-full border border-line px-1.5 text-[11px] text-slate-500"
                  title="有编码的行都能在物料总表里按编码查到：新编码由保存时登记进「采购登记（无库存）」档，原本就在库存表里的则保持原样"
                >
                  总表可查
                </span>
              </td>
              <td class="px-3 py-2 text-slate-600">{{ row.spec || '—' }}</td>
              <td class="px-3 py-2 text-slate-600">{{ row.requiredArrivalDate || '—' }}</td>
              <td class="px-3 py-2 text-slate-600">{{ row.purchaseOrderNo || '—' }}</td>
              <!-- 送货单三态（变更-094）：图片 → 缩略图（点开看原图）；文本 → 原样显示
                   （这一列原本是「送货单号」文本，老数据不许当坏数据）；空 → 未到货。
                   这是「进度」这一列的核心信息，所以空着要用灰字说清楚而不是留白。 -->
              <td class="px-3 py-2 text-slate-600">
                <el-image
                  v-if="isStoredImage(row.deliveryNote)"
                  :src="storedImageThumb(row.deliveryNote)"
                  :preview-src-list="[row.deliveryNote]"
                  :preview-teleported="true"
                  fit="cover"
                  alt="送货单图片"
                  class="h-8 w-8 rounded border border-line"
                />
                <template v-else-if="row.deliveryNote">{{ row.deliveryNote }}</template>
                <span v-else class="text-slate-500">未到货</span>
              </td>
              <td class="px-3 py-2 text-slate-600">{{ row.remark || '—' }}</td>
              <td v-if="canEdit" class="px-3 py-2 text-right whitespace-nowrap">
                <el-button size="small" @click.stop="startEdit(row)">编辑</el-button>
                <el-button size="small" @click.stop="handleDelete(row)">删除</el-button>
              </td>
            </template>
          </tr>

          <tr v-if="!rows.length">
            <td
              :colspan="canEdit ? 11 : 10"
              class="px-4 py-10 text-center text-sm text-slate-500"
            >
              {{ loading ? '正在加载…' : '还没有采购需求记录 —— 在第一行直接填就能加一条' }}
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
  </section>
</template>

<style scoped>
/*
 * 表格滚动条做细一点（与设备数据维护同一配方）。
 * 默认每页 10 行时这张表通常不会超出，所以这条多数时候看不见；
 * 小屏或自己切到 50 行时才出现，那时也不该是一条突兀的灰带。
 * 横向仍可滚：11 列在窄窗口下会溢出（新增行/编辑行的输入框也在这里，别改成 overflow-hidden）。
 */
.purchase-scroll {
  scrollbar-width: thin;
  scrollbar-color: #d4d4d8 transparent;
}
.purchase-scroll::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.purchase-scroll::-webkit-scrollbar-thumb {
  background: #d4d4d8;
  border-radius: 999px;
}
.purchase-scroll::-webkit-scrollbar-track {
  background: transparent;
}
</style>
