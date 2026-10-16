<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import {
  ElButton,
  ElDatePicker,
  ElDialog,
  ElInput,
  ElMessage,
  ElMessageBox,
  ElPagination,
} from 'element-plus'
import { hasPerm } from '../api/auth'
import { useLiveQuery } from '../composables/useLiveQuery'
import { usePurchaseTracking } from '../composables/usePurchaseTracking'

/**
 * 采购进度跟踪（变更-091）。
 *
 * 需求登记 → 下单 → 到货的流水台账。数据层在 composables/usePurchaseTracking.js。
 *
 * ⚠️ 写按钮（新增/编辑/删除）按权限位 `purchase:edit` 显隐 —— **查询对所有人开放**
 * （与物料查询/体积计算一致：列表接口本来就免登录），只有写操作需要权限位。
 * 后端另有 @SaCheckPermission 兜底：界面藏了按钮不等于接口安全，两层都要在。
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

// 关键字边打边查（防抖 + 查询签名去重 + 卸载撤销，公共接线见 useLiveQuery）；
// 回车 / 清空 = 显式意图，立刻发。日期区间是离散动作，直接 @change 触发，不需要防抖。
const { flush: flushPurchaseQuery } = useLiveQuery(keyword, applyPurchaseFilters)

const canEdit = computed(() => hasPerm('purchase:edit'))

const dialogVisible = ref(false)
const isNew = ref(false)
const draft = reactive({})
const message = ref('')

function resetDraft(source) {
  Object.assign(draft, {
    id: source?.id ?? null,
    requester: source?.requester ?? '',
    requestDate: source?.requestDate ?? '',
    materialName: source?.materialName ?? '',
    materialCode: source?.materialCode ?? '',
    spec: source?.spec ?? '',
    requiredArrivalDate: source?.requiredArrivalDate ?? '',
    purchaseOrderNo: source?.purchaseOrderNo ?? '',
    deliveryNote: source?.deliveryNote ?? '',
    remark: source?.remark ?? '',
  })
}

function openCreate() {
  isNew.value = true
  resetDraft(null)
  message.value = ''
  dialogVisible.value = true
}

function openEdit(row) {
  isNew.value = false
  resetDraft(row)
  message.value = ''
  dialogVisible.value = true
}

async function handleSave() {
  message.value = ''
  // 与前端的必填口径一致（后端还会再校验一次，两边都要有：
  // 界面先拦住能少一次往返，后端拦住才是真的拦住）
  if (!draft.requester?.trim()) {
    message.value = '需求人不能为空'
    ElMessage.error(message.value)
    return
  }
  if (!draft.materialName?.trim()) {
    message.value = '物料名称不能为空'
    ElMessage.error(message.value)
    return
  }
  try {
    await savePurchase(draft)
    dialogVisible.value = false
    ElMessage.success('已保存')
  } catch (e) {
    // ⚠️ 失败**不关弹窗**：api/request.js 已把「HTTP 200 + success:false」拦成 Promise 拒绝
    // （变更-085），所以这里拿得到后端原话，而不是静默关掉当成功（那条坑吃过一次）。
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

onMounted(loadPurchase)
</script>

<template>
  <!-- 定高链（变更-088 的方子，与设备数据维护/储罐液位同一张）：
       卡片撑满页签给的高度、表格区自己滚、**分页行钉在卡底**。
       少一级 min-h-0，卡片就会被内容顶高、翻页时分页行上下跳。 -->
  <section class="flex min-h-0 flex-1 flex-col rounded-card border border-line bg-raised shadow-card">
    <div class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-3 border-b border-line px-6 py-3">
      <p class="text-sm font-medium text-slate-700">采购进度跟踪</p>
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
        <el-button v-if="canEdit" type="primary" @click="openCreate">新增采购需求</el-button>
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
      <table class="w-full text-sm">
        <thead
          class="sticky top-0 z-10 bg-region text-xs text-slate-500 shadow-[0_1px_0_0_var(--color-line,#e5e7eb)]"
        >
          <tr>
            <th scope="col" class="px-4 py-2.5 text-right font-medium">序号</th>
            <th scope="col" class="px-4 py-2.5 text-left font-medium">需求人</th>
            <th scope="col" class="px-4 py-2.5 text-left font-medium">提出需求日期</th>
            <th scope="col" class="px-4 py-2.5 text-left font-medium">物料名称</th>
            <th scope="col" class="px-4 py-2.5 text-left font-medium">物料编码</th>
            <th scope="col" class="px-4 py-2.5 text-left font-medium">规格型号</th>
            <th scope="col" class="px-4 py-2.5 text-left font-medium">要求到货日期</th>
            <th scope="col" class="px-4 py-2.5 text-left font-medium">采购订单号</th>
            <th scope="col" class="px-4 py-2.5 text-left font-medium">送货单</th>
            <th v-if="canEdit" scope="col" class="px-4 py-2.5 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in rows"
            :key="row.id"
            :tabindex="canEdit ? 0 : -1"
            class="border-t border-line"
            :class="
              canEdit
                ? 'cursor-pointer hover:bg-region focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand'
                : ''
            "
            @click="canEdit && openEdit(row)"
            @keydown.enter.self.prevent="canEdit && openEdit(row)"
          >
            <!-- 序号跨页连续（不是每页从 1 开始）：使用方是照着序号核对，一翻页重新数会串 -->
            <td class="px-4 py-2.5 text-right text-xs text-slate-500">
              {{ (pageNum - 1) * pageSize + index + 1 }}
            </td>
            <td class="px-4 py-2.5 text-slate-600">{{ row.requester || '—' }}</td>
            <td class="px-4 py-2.5 text-slate-600">{{ row.requestDate || '—' }}</td>
            <td class="px-4 py-2.5 font-medium">{{ row.materialName }}</td>
            <!-- 编码可能还没有（采购/仓库后定）：空值显示「—」，不要显示成 0 或空白 -->
            <td class="px-4 py-2.5 text-slate-600">
              {{ row.materialCode || '—' }}
              <span
                v-if="row.materialCode"
                class="ml-1 rounded-full border border-line px-1.5 text-[11px] text-slate-500"
                title="带编码保存时，后端会把它登记进物料总表的「采购登记（无库存）」档"
              >
                已登记
              </span>
            </td>
            <td class="px-4 py-2.5 text-slate-600">{{ row.spec || '—' }}</td>
            <td class="px-4 py-2.5 text-slate-600">{{ row.requiredArrivalDate || '—' }}</td>
            <td class="px-4 py-2.5 text-slate-600">{{ row.purchaseOrderNo || '—' }}</td>
            <!-- 空 = 还没到货：这是「进度」这一列的核心信息，所以用灰字说清楚而不是留白 -->
            <td class="px-4 py-2.5 text-slate-600">
              <template v-if="row.deliveryNote">{{ row.deliveryNote }}</template>
              <span v-else class="text-slate-500">未到货</span>
            </td>
            <td v-if="canEdit" class="px-4 py-2.5 text-right whitespace-nowrap">
              <el-button size="small" @click.stop="openEdit(row)">编辑</el-button>
              <el-button size="small" @click.stop="handleDelete(row)">删除</el-button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="canEdit ? 10 : 9" class="px-4 py-10 text-center text-sm text-slate-500">
              {{ loading ? '正在加载…' : '还没有采购需求记录' }}
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

    <el-dialog
      v-model="dialogVisible"
      :title="isNew ? '新增采购需求' : `编辑：${draft.materialName || ''}`"
      width="720px"
    >
      <div class="grid grid-cols-2 gap-x-4 gap-y-4">
        <label class="text-sm">
          需求人 <span class="text-rose-600">*</span>
          <el-input v-model="draft.requester" />
        </label>
        <label class="text-sm">
          提出需求日期
          <el-date-picker
            v-model="draft.requestDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择日期"
            aria-label="提出需求日期"
            class="w-full"
          />
        </label>
        <label class="text-sm">
          物料名称 <span class="text-rose-600">*</span>
          <el-input v-model="draft.materialName" />
        </label>
        <label class="text-sm">物料编码<el-input v-model="draft.materialCode" /></label>
        <label class="text-sm">规格型号<el-input v-model="draft.spec" /></label>
        <label class="text-sm">
          要求到货日期
          <el-date-picker
            v-model="draft.requiredArrivalDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择日期"
            aria-label="要求到货日期"
            class="w-full"
          />
        </label>
        <label class="text-sm">采购订单号<el-input v-model="draft.purchaseOrderNo" /></label>
        <label class="text-sm">送货单号<el-input v-model="draft.deliveryNote" /></label>
        <label class="col-span-2 text-sm">备注<el-input v-model="draft.remark" /></label>
      </div>

      <p class="mt-3 text-xs leading-relaxed text-slate-500">
        只填名称也能存 —— 编码、订单号、送货单号都可以后面补。带编码保存时，
        后端会把这个编码登记进物料总表（库位「采购登记（无库存）」、库存记 0），以后按编码就能查到它。
      </p>
      <p v-if="message" role="alert" class="mt-2 text-xs text-rose-600">{{ message }}</p>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
/*
 * 表格滚动条做细一点（与设备数据维护同一配方）。
 * 默认每页 10 行时这张表通常不会超出，所以这条多数时候看不见；
 * 小屏或自己切到 50 行时才出现，那时也不该是一条突兀的灰带。
 * 横向仍可滚：10 列在窄窗口下会溢出。
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
