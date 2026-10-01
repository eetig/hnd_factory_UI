<script setup>
import { computed, ref } from 'vue'
import {
  ElDatePicker,
  ElInput,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElPagination,
  ElSelect,
} from 'element-plus'
import { hasPerm } from '../api/auth'
import LoadingMask from './LoadingMask.vue'
import PanelState from './PanelState.vue'
import TankLevelImageDialog from './TankLevelImageDialog.vue'
import {
  TANK_LEVEL_CATEGORIES,
  buildTankLevelDraft,
  useTankLevelData,
} from '../composables/useTankLevelData'
import { useTankLevelImages } from '../composables/useTankLevelImages'

// 月底储罐液位记录（变更-004 只读落地 → 变更-008 加行内编辑 → 变更-011 图据改多张）
//
// 数据层是模块级单例（项目约定 4），所以本组件不需要 props：
// 「首次进 Tab 才加载」交给 WorkOrderList 的 watch(activeTab) —— 面板是 v-show 常驻的，
// 挂载时机和 Tab 切换不是一回事。
const {
  tankLevelTableData,
  tankLevelPageNum,
  tankLevelPageSize,
  tankLevelTotal,
  tankLevelLoading,
  tankLevelError,
  tankLevelStartDate,
  tankLevelEndDate,
  tankLevelLocation,
  tankLevelCategory,
  tankLevelKeyword,
  tankLevelLocationOptions,
  getTankLevelPageData,
  fetchTankLevelRecords,
  resetTankLevelFilters,
  saveTankLevelRecord,
  deleteTankLevelRecord,
} = useTankLevelData()

// 图据（可多张）的弹窗状态与请求都在这个 composable 里，本组件只负责触发与渲染
const { openImageDialog } = useTankLevelImages()

// 行内编辑的权限：后端每个写接口各自鉴权，这里只管按钮显隐（不是安全边界）
const canEdit = computed(() => hasPerm('tank_level:edit'))
const canDelete = computed(() => hasPerm('tank_level:delete'))
const canOperate = computed(() => canEdit.value || canDelete.value)

// 列与线下台账（月底车间各储罐液位记录表）逐列对应；「序号」由前端按分页渲染
// 数值列的表头直接带单位（容器液位 mm / 理论质量 kg）：线下台账没标单位，
// 页面上标清楚，免得与「压力容器体积计算」里的 m³ 混读
const baseColumns = [
  { key: 'index', label: '序号', width: 'w-14' },
  { key: 'recordDate', label: '记录日期', width: 'w-32' },
  { key: 'location', label: '属地', width: 'w-24' },
  { key: 'category', label: '所属(产品/原料)', width: 'w-32' },
  { key: 'materialName', label: '物料', width: 'w-[190px]' },
  { key: 'tankName', label: '容器名称', width: 'w-32' },
  // 容器编号（设备位号）：台账的唯一键之一（记录日期 + 容器编号），线下台账里单独一栏
  { key: 'tankCode', label: '容器编号', width: 'w-28' },
  { key: 'levelValue', label: '容器液位 (mm)', width: 'w-28', align: 'right' },
  { key: 'theoreticalWeight', label: '理论质量 (kg)', width: 'w-28', align: 'right' },
  { key: 'imageUrl', label: '图据', width: 'w-24' },
]

const columns = computed(() =>
  canOperate.value ? [...baseColumns, { key: 'action', label: '操作', width: 'w-32' }] : baseColumns,
)

// 行 key 必须用 id：编辑态下 recordDate / tankCode 会被用户改，
// 拿这两个做 key 的话每敲一个字 key 就变一次，Vue 重建 <tr>，输入框当场失焦
const ROW_KEY_NEW = 'tank-level-new'
const rowKeyOf = (record) => `tank-level-${record?.id ?? ROW_KEY_NEW}`

// 是否处于筛选状态：决定空表提示语是「没查到」还是「本来就没数据」
const hasFilter = computed(() =>
  Boolean(tankLevelLocation.value || tankLevelCategory.value || tankLevelKeyword.value),
)

// ===== 行内编辑状态 =====
// 同一时刻只允许一行在编辑：editingId 为 'new' 表示正在新增（草稿行），
// null 表示没有行处于编辑态。draft 存的是那一行的可编辑副本，
// 保存前的所有输入都只落在这里，不会碰到列表数据。
const ROW_KEY_CREATING = 'new'
const editingId = ref(null)
const draft = ref(null)
const saving = ref(false)

const isCreating = computed(() => editingId.value === ROW_KEY_CREATING)
const isEditing = (record) => editingId.value !== null && editingId.value === String(record.id)

/** 静默单元格：平时看不出是输入框，悬停/聚焦才显形（同图片解析页 inputClass）*/
function inputClass(align) {
  return [
    'w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm text-slate-900 outline-none',
    'transition placeholder:text-slate-300 hover:border-slate-300 focus:border-sky-500 focus:bg-white',
    align === 'right' ? 'text-right' : '',
  ]
}

function startEdit(record) {
  editingId.value = String(record.id)
  draft.value = buildTankLevelDraft(record)
}

function cancelEdit() {
  editingId.value = null
  draft.value = null
}

function startCreate() {
  if (editingId.value !== null) {
    ElMessage.warning('请先保存或取消正在编辑的那一行。')
    return
  }
  // 草稿行不进 tankLevelTableData —— 它要参与本地分页的切片，混进去会把序号搅乱。
  // 单独用 editingId='new' 控制渲染，保存成功后由刷新带出真行
  editingId.value = ROW_KEY_CREATING
  draft.value = buildTankLevelDraft(null)
}

async function saveRow() {
  if (saving.value) return

  saving.value = true
  const creating = isCreating.value
  try {
    await saveTankLevelRecord(draft.value)
    ElMessage.success(creating ? '新增成功' : '保存成功')
    cancelEdit()
  } catch (error) {
    // 后端校验/唯一键冲突的消息原样展示：它比前端兜底文案具体得多
    ElMessage.error(error?.message || '保存失败，请稍后重试。')
  } finally {
    saving.value = false
  }
}

async function removeRow(record) {
  try {
    await ElMessageBox.confirm(
      `确定删除「${record.recordDate} ${record.tankCode || record.tankName}」这条记录吗？删除后不可恢复。`,
      '确认删除记录',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' },
    )
  } catch {
    return // 用户点了取消
  }

  try {
    await deleteTankLevelRecord(record.id)
    ElMessage.success('删除成功')
    if (isEditing(record)) {
      cancelEdit()
    }
  } catch (error) {
    ElMessage.error(error?.message || '删除失败，请稍后重试。')
  }
}

// ===== 图据 =====
// 可多张，看图/加图/删图全在弹窗里（<TankLevelImageDialog> + useTankLevelImages）。
// 行内编辑只管文字与数值 —— 图据入口在只读态也能点开，不必先进编辑态。

/**
 * 列表缩略图加载失败时回退到原图，再失败就露出底层的占位图标。
 *
 * <p>用 getAttribute('src') 而不是 img.src 比较：后者会被浏览器补成绝对 URL，
 * 与接口给的相对路径（/thumbs/xxx）永远不相等，回退分支等于没写。
 */
function handleThumbError(event, image) {
  const img = event?.target
  if (!img) return

  if (image?.url && img.getAttribute('src') !== image.url) {
    img.src = image.url
    return
  }
  img.style.display = 'none'
}
</script>

<template>
  <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
    <div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-6 py-4">
      <h2 class="text-base font-semibold text-slate-900">月底车间各储罐液位记录</h2>
      <span class="text-xs text-slate-500">数据来源：hnd_factory /api/tank-level/list</span>
    </div>

    <!-- 查询条件：记录日期区间 + 属地 + 所属 + 物料/容器关键字，全部走接口查询 -->
    <div class="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-2.5">
      <el-date-picker
        v-model="tankLevelStartDate"
        type="date"
        value-format="YYYY-MM-DD"
        placeholder="起始日期"
        :first-day-of-week="1"
        @change="fetchTankLevelRecords"
      />
      <span class="text-sm text-slate-500">至</span>
      <el-date-picker
        v-model="tankLevelEndDate"
        type="date"
        value-format="YYYY-MM-DD"
        placeholder="结束日期"
        :first-day-of-week="1"
        @change="fetchTankLevelRecords"
      />
      <el-select
        v-model="tankLevelLocation"
        style="width: 9.5rem"
        placeholder="属地"
        clearable
        aria-label="属地"
        @change="fetchTankLevelRecords"
      >
        <el-option
          v-for="location in tankLevelLocationOptions"
          :key="location"
          :label="location"
          :value="location"
        />
      </el-select>
      <el-select
        v-model="tankLevelCategory"
        style="width: 9.5rem"
        placeholder="所属(产品/原料)"
        clearable
        aria-label="所属"
        @change="fetchTankLevelRecords"
      >
        <el-option
          v-for="category in TANK_LEVEL_CATEGORIES"
          :key="category"
          :label="category"
          :value="category"
        />
      </el-select>
      <el-input
        v-model="tankLevelKeyword"
        style="width: 13rem"
        placeholder="物料 / 容器名称 / 容器编号"
        clearable
        @keyup.enter="fetchTankLevelRecords"
        @clear="fetchTankLevelRecords"
      />
      <button
        type="button"
        class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
        @click="fetchTankLevelRecords"
      >
        查询
      </button>
      <button
        type="button"
        class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
        @click="resetTankLevelFilters"
      >
        重置
      </button>
      <span class="ml-auto text-sm text-slate-500">
        共 <span class="font-semibold text-slate-900">{{ tankLevelTotal }}</span> 条记录
      </span>
    </div>

    <div class="relative">
      <LoadingMask v-if="tankLevelLoading" />

      <PanelState
        v-else-if="tankLevelError"
        type="error"
        title="暂时无法获取储罐液位记录"
        :description="tankLevelError"
        action-text="重新加载"
        @action="fetchTankLevelRecords"
      />

      <PanelState
        v-else-if="tankLevelTableData.length === 0 && !isCreating"
        :title="hasFilter ? '没有符合筛选条件的记录' : '暂无储罐液位记录'"
        :description="
          hasFilter
            ? '换个日期区间或关键字试试，或点「重置」回到默认范围。'
            : canEdit
              ? '点下方「新增一行」开始录入。'
              : '数据由管理员在「新增一行」中维护。'
        "
      />

      <div v-else>
        <div class="overflow-x-auto">
          <table class="min-w-full table-fixed divide-y divide-slate-200 text-left">
            <colgroup>
              <col v-for="column in columns" :key="column.key" :class="column.width" />
            </colgroup>
            <thead class="bg-slate-50">
              <tr>
                <th
                  v-for="column in columns"
                  :key="column.key"
                  scope="col"
                  class="whitespace-nowrap py-4 text-xs font-semibold uppercase tracking-wide text-slate-500"
                  :class="column.align === 'right' ? 'pl-3 pr-4 text-right' : 'px-3'"
                >
                  {{ column.label }}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 bg-white">
              <!-- 新增草稿行：固定在表格最前，一眼能看到自己正在补的那条 -->
              <tr v-if="isCreating" class="bg-sky-50/60">
                <td class="whitespace-nowrap px-3 py-2 text-sm font-semibold text-sky-700">新增</td>
                <td class="px-2 py-1.5">
                  <input
                    v-model="draft.recordDate"
                    type="date"
                    :class="inputClass()"
                    aria-label="记录日期"
                  />
                </td>
                <td class="px-2 py-1.5">
                  <input
                    v-model="draft.location"
                    type="text"
                    placeholder="属地"
                    :class="inputClass()"
                    aria-label="属地"
                  />
                </td>
                <td class="px-2 py-1.5">
                  <select v-model="draft.category" :class="inputClass()" aria-label="所属">
                    <option value="">—</option>
                    <option v-for="category in TANK_LEVEL_CATEGORIES" :key="category" :value="category">
                      {{ category }}
                    </option>
                  </select>
                </td>
                <td class="px-2 py-1.5">
                  <input
                    v-model="draft.materialName"
                    type="text"
                    placeholder="物料名称"
                    :class="inputClass()"
                    aria-label="物料名称"
                  />
                  <input
                    v-model="draft.materialCode"
                    type="text"
                    placeholder="物料编码"
                    :class="inputClass()"
                    aria-label="物料编码"
                  />
                </td>
                <td class="px-2 py-1.5">
                  <input
                    v-model="draft.tankName"
                    type="text"
                    placeholder="容器名称"
                    :class="inputClass()"
                    aria-label="容器名称"
                  />
                </td>
                <td class="px-2 py-1.5">
                  <input
                    v-model="draft.tankCode"
                    type="text"
                    placeholder="容器编号"
                    :class="inputClass()"
                    aria-label="容器编号"
                  />
                </td>
                <td class="px-2 py-1.5">
                  <input
                    v-model="draft.levelValue"
                    type="text"
                    inputmode="decimal"
                    placeholder="—"
                    :class="inputClass('right')"
                    aria-label="容器液位"
                  />
                </td>
                <td class="px-2 py-1.5">
                  <input
                    v-model="draft.theoreticalWeight"
                    type="text"
                    inputmode="decimal"
                    placeholder="—"
                    :class="inputClass('right')"
                    aria-label="理论质量"
                  />
                </td>
                <td class="whitespace-nowrap px-3 py-2 text-xs text-slate-400">保存后可上传</td>
                <td class="whitespace-nowrap px-3 py-2">
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      class="rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                      :disabled="saving"
                      @click="saveRow"
                    >
                      {{ saving ? '保存中…' : '保存' }}
                    </button>
                    <button
                      type="button"
                      class="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50"
                      :disabled="saving"
                      @click="cancelEdit"
                    >
                      取消
                    </button>
                  </div>
                </td>
              </tr>

              <tr
                v-for="(record, index) in tankLevelTableData"
                :key="rowKeyOf(record)"
                class="transition"
                :class="isEditing(record) ? 'bg-sky-50/60' : 'hover:bg-slate-50'"
              >
                <td class="whitespace-nowrap px-3 py-2 text-sm font-semibold text-slate-900">
                  {{ (tankLevelPageNum - 1) * tankLevelPageSize + index + 1 }}
                </td>

                <!-- ===== 编辑态：整行换成输入框 ===== -->
                <template v-if="isEditing(record)">
                  <td class="px-2 py-1.5">
                    <input v-model="draft.recordDate" type="date" :class="inputClass()" aria-label="记录日期" />
                  </td>
                  <td class="px-2 py-1.5">
                    <input
                      v-model="draft.location"
                      type="text"
                      placeholder="属地"
                      :class="inputClass()"
                      aria-label="属地"
                    />
                  </td>
                  <td class="px-2 py-1.5">
                    <select v-model="draft.category" :class="inputClass()" aria-label="所属">
                      <option value="">—</option>
                      <option v-for="category in TANK_LEVEL_CATEGORIES" :key="category" :value="category">
                        {{ category }}
                      </option>
                    </select>
                  </td>
                  <td class="px-2 py-1.5">
                    <input
                      v-model="draft.materialName"
                      type="text"
                      placeholder="物料名称"
                      :class="inputClass()"
                      aria-label="物料名称"
                    />
                    <input
                      v-model="draft.materialCode"
                      type="text"
                      placeholder="物料编码"
                      :class="inputClass()"
                      aria-label="物料编码"
                    />
                  </td>
                  <td class="px-2 py-1.5">
                    <input
                      v-model="draft.tankName"
                      type="text"
                      placeholder="容器名称"
                      :class="inputClass()"
                      aria-label="容器名称"
                    />
                  </td>
                  <td class="px-2 py-1.5">
                    <input
                      v-model="draft.tankCode"
                      type="text"
                      placeholder="容器编号"
                      :class="inputClass()"
                      aria-label="容器编号"
                    />
                  </td>
                  <td class="px-2 py-1.5">
                    <input
                      v-model="draft.levelValue"
                      type="text"
                      inputmode="decimal"
                      placeholder="—"
                      :class="inputClass('right')"
                      aria-label="容器液位"
                    />
                  </td>
                  <td class="px-2 py-1.5">
                    <input
                      v-model="draft.theoreticalWeight"
                      type="text"
                      inputmode="decimal"
                      placeholder="—"
                      :class="inputClass('right')"
                      aria-label="理论质量"
                    />
                  </td>
                </template>

                <!-- ===== 只读态 ===== -->
                <template v-if="!isEditing(record)">
                  <td class="whitespace-nowrap px-3 py-2 text-sm text-slate-600">
                    {{ record.recordDate }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-2 text-sm text-slate-600">
                    {{ record.location }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-2 text-sm text-slate-600">
                    {{ record.category }}
                  </td>
                  <td class="max-w-[190px] whitespace-normal break-words px-3 py-2 text-sm text-slate-700">
                    {{ record.materialName }}
                    <span v-if="record.materialCode" class="mt-0.5 block text-xs text-slate-400">
                      {{ record.materialCode }}
                    </span>
                  </td>
                  <td class="whitespace-nowrap px-3 py-2 text-sm text-slate-600">
                    {{ record.tankName }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-2 text-sm text-slate-600">
                    {{ record.tankCode }}
                  </td>
                  <td class="whitespace-nowrap py-2 pl-3 pr-4 text-right text-sm text-slate-600">
                    {{ record.levelValue }}
                  </td>
                  <td class="whitespace-nowrap py-2 pl-3 pr-4 text-right text-sm font-semibold text-sky-700">
                    {{ record.theoreticalWeight }}
                  </td>
                </template>

                <!-- 图据（可多张）：点开弹窗看大图 / 加图 / 删图。
                     编辑态与只读态行为一致，所以不放进上面的两态分支，免得写两份 -->
                <td class="whitespace-nowrap px-3 py-2">
                  <span
                    class="relative flex h-5 w-5 cursor-pointer items-center justify-center rounded bg-slate-100 text-slate-400"
                    :aria-label="record.images.length ? `查看图据（共 ${record.images.length} 张）` : '暂无图据'"
                    @click="openImageDialog(record)"
                  >
                    <svg
                      class="h-3 w-3"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                      aria-hidden="true"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="m21 15-5-5L5 21" />
                    </svg>
                    <!-- 首张缩略图；缺失时回退原图，再失败露出底层占位图标 -->
                    <img
                      v-if="record.images.length"
                      :src="record.images[0].thumbnailUrl || record.images[0].url"
                      alt="图据缩略图"
                      loading="lazy"
                      decoding="async"
                      class="absolute inset-0 h-5 w-5 rounded border border-slate-200 bg-white object-cover transition hover:opacity-80"
                      @error="handleThumbError($event, record.images[0])"
                    />
                    <!-- 多张时在角上标出总数，免得点开才知道有几张 -->
                    <span
                      v-if="record.images.length > 1"
                      class="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-sky-600 px-1 text-[10px] font-medium leading-none text-white"
                    >
                      {{ record.images.length }}
                    </span>
                  </span>
                </td>

                <!-- 操作列：位置固定在最后，同样不必跟着编辑态复制两份 -->
                <td v-if="isEditing(record) || canOperate" class="whitespace-nowrap px-3 py-2">
                  <div v-if="isEditing(record)" class="flex items-center gap-2">
                    <button
                      type="button"
                      class="rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                      :disabled="saving"
                      @click="saveRow"
                    >
                      {{ saving ? '保存中…' : '保存' }}
                    </button>
                    <button
                      type="button"
                      class="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50"
                      :disabled="saving"
                      @click="cancelEdit"
                    >
                      取消
                    </button>
                  </div>
                  <div v-else class="flex items-center gap-2">
                    <button
                      v-if="canEdit"
                      type="button"
                      class="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 transition hover:border-sky-400 hover:text-sky-700"
                      @click="startEdit(record)"
                    >
                      编辑
                    </button>
                    <button
                      v-if="canDelete"
                      type="button"
                      class="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 transition hover:border-rose-400 hover:text-rose-600"
                      @click="removeRow(record)"
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 录入入口放在表下：与图片解析页的行数校准按钮同一个位置习惯 -->
        <div v-if="canEdit" class="flex items-center gap-3 border-t border-slate-100 px-6 py-2.5">
          <button
            type="button"
            class="flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 transition hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700"
            @click="startCreate"
          >
            <svg
              class="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            新增一行
          </button>
          <span class="text-xs text-slate-400">
            记录日期 + 容器编号是唯一键，同一天同一容器只能有一条记录
          </span>
        </div>

        <div class="flex justify-end border-t border-slate-100 px-6 py-2.5">
          <el-pagination
            v-model:current-page="tankLevelPageNum"
            :page-size="tankLevelPageSize"
            :total="tankLevelTotal"
            layout="total, prev, pager, next"
            background
            @current-change="getTankLevelPageData"
          />
        </div>
      </div>
    </div>

    <!-- 记录说明：与线下台账表尾的说明一字不差，避免两处口径不同 -->
    <div class="border-t border-slate-100 px-6 py-3 text-xs leading-relaxed text-slate-500">
      <p>记录说明：</p>
      <p>1. 实际重量与理论计算可能存在差异，以实际测量为准。</p>
      <p>2. 记录时间为每月月底下午3点</p>
    </div>

    <!-- 图据弹窗（可多张）：状态在 useTankLevelImages，渲染在 ImageGalleryDialog -->
    <TankLevelImageDialog />
  </section>
</template>
