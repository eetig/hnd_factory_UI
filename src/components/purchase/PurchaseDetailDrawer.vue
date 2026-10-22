<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import {
  ElAutocomplete,
  ElButton,
  ElDatePicker,
  ElDrawer,
  ElInput,
  ElMessageBox,
  ElOption,
  ElSelect,
} from 'element-plus'
import { STATUS_TONE } from '../../constants/statusTones'
import { useMaterialLookup } from '../../composables/useMaterialLookup'
import DeliveryNoteUpload from '../DeliveryNoteUpload.vue'
import {
  CATEGORY_OPTIONS,
  DRAWER_GROUPS,
  FOCUS_FIELD_ON_CREATE,
  UNIT_OPTIONS,
  blankDraft,
  fieldByKey,
} from './fields.js'

/**
 * 采购需求抽屉（2026-10-18，变更-117）：**新建与编辑共用同一个抽屉**。
 *
 * ## 为什么从"行内编辑"改成抽屉
 *
 * 上一版是 Excel 式行内录入（点「编辑」那一行原地变输入框）。使用方的反馈是
 * 「录一条采购需求 ≤3 次点击、零横向滚动」—— 行内编辑天生做不到：
 * 15 个输入框横在 1870px 的表里，填到"备注"要横滚三次，眼睛还要在表头与
 * 输入框之间来回对位。
 *
 * 抽屉把 15 个字段竖着排、按语义分三组，一屏能看完，且不占表格宽度。
 *
 * ## 三次点击的路径
 *
 *   ① 右上「新增需求」 → ② 在抽屉里打字 → ③ 「保存」
 * 中间没有任何"再点一次才出现输入框"的步骤。新建模式自动聚焦物料名称，
 * 所以键盘用户甚至可以：点新增 → 打字 → 回车（回车提交，不用点保存）。
 *
 * ## Esc / 回车
 *
 * ⚠️ 关掉 el-drawer 自带的 Esc 关闭（`close-on-press-escape=false`），改由这里接管：
 * 有未保存修改时必须先问一句，否则改了半天按个 Esc 就全没了。
 */
const props = defineProps({
  /*
   * 遮罩要不要挂到 body（默认 true，2026-10-22 变更-141）。
   *
   * 必须是 true：抽屉如果渲染在页面容器里，页面头卡所在的兄弟层叠上下文会把它压住
   * （采购需求抽屉的标题就这样被吃掉过）。留成 prop 只为一件事 —— 组件测试可以传 false，
   * 让 DOM 留在原地供 wrapper.find 查询（teleport 打桩在 ElSelect 上会触发递归更新）。
   */
  appendToBody: { type: Boolean, default: true },
  modelValue: { type: Boolean, default: false },
  mode: { type: String, default: 'edit' }, // 'create' | 'edit'
  row: { type: Object, default: null },
  canEdit: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'save', 'delete'])

const { fetchMaterialSuggestions, cancelMaterialSearch } = useMaterialLookup()

const form = ref(blankDraft())
/** 打开时的快照，用来判断"有没有改过" */
let snapshot = ''

const isCreate = computed(() => props.mode === 'create')
const title = computed(() => (isCreate.value ? '新增采购需求' : '采购需求详情'))

const statusText = {
  OVERDUE: '超期',
  DUE_SOON: '临期',
  PENDING_OA: '待提单',
  WAITING: '等货',
  ARRIVED: '已到货',
  PARTIAL: '部分到货',
}

function statusClass(key) {
  switch (key) {
    case 'OVERDUE':
      return STATUS_TONE.error
    case 'DUE_SOON':
      return STATUS_TONE.warning
    case 'ARRIVED':
      return STATUS_TONE.success
    case 'PARTIAL':
      return STATUS_TONE.info
    default:
      return STATUS_TONE.neutral
  }
}

/** 「还差几天」——与列表同一口径：天数由后端给，前端不算日期 */
const dayHint = computed(() => {
  const r = props.row
  if (!r) return ''
  if (r.status === 'OVERDUE' && r.overdueDays) return `已超 ${r.overdueDays} 天`
  if (r.status === 'DUE_SOON') {
    const d = r.daysToDue
    if (d === null || d === undefined) return ''
    return d === 0 ? '今天到期' : `还剩 ${d} 天`
  }
  return ''
})

const dirty = computed(() => JSON.stringify(form.value) !== snapshot)

const materialNameRef = ref(null)

/** el-autocomplete 的 ref 回调：新建模式打开后要把光标放进物料名称 */
function setMaterialNameRef(el) {
  materialNameRef.value = el
}

/**
 * 保存成功后"接着录下一条"（2026-10-22，变更-142；使用方原话
 * 「新增后，清空物料名称，物料编码，规格型号」）。
 *
 * 只清这三样 + 数量复位 1：
 *   · 清物料三件套 —— 它们是由"选了哪个物料"派生出来的，留着必然导致下一条存成上一个物料；
 *   · 数量复位 1 —— 上一行常是 100 台/20 米，下一条多数不是同一个数，留着更容易存错；
 *   · **保留**需求人 / 提出需求日期 / 类别 / 用途 / 要求到货日期 / 单位 ——
 *     同一批需求连着录几条物料时，这些是共用的，重填一遍纯属浪费。
 *
 * 清完把快照对齐（否则关闭时会误判"有未保存改动"而弹确认），并把光标放回物料名称。
 */
function resetForNextEntry() {
  form.value.materialName = ''
  form.value.materialCode = ''
  form.value.spec = ''
  form.value.quantity = 1
  snapshot = JSON.stringify(form.value)
  cancelMaterialSearch()
  nextTick(() => materialNameRef.value?.focus?.())
}

defineExpose({ resetForNextEntry })

/** 打开：按模式装填表单、记快照、新建时聚焦物料名称 */
watch(
  () => props.modelValue,
  async (open) => {
    if (!open) {
      cancelMaterialSearch()
      return
    }
    form.value = props.mode === 'edit' && props.row ? { ...blankDraft(), ...props.row } : blankDraft()
    snapshot = JSON.stringify(form.value)
    await nextTick()
    if (isCreate.value) {
      /*
       * ⚠️ 不能只 `nextTick` 就聚焦：el-drawer 打开时会把焦点陷阱（focus trap）
       * 抢到容器上，紧接着的 focus() 会被它盖掉 —— 表现为"自动聚焦没生效"。
       * 等一帧再聚焦（抽屉过渡 260ms，但陷阱在首帧就装好；60ms 足够且感知不到）。
       */
      setTimeout(() => materialNameRef.value?.focus?.(), 60)
    }
  },
  { immediate: true },
)

function close() {
  emit('update:modelValue', false)
}

/** 关闭前问一句：有改动就别让它悄悄丢 */
async function requestClose() {
  if (!dirty.value) {
    close()
    return
  }
  try {
    await ElMessageBox.confirm('关闭后未保存的改动会丢失，确定关闭？', '未保存的改动', {
      confirmButtonText: '关闭',
      cancelButtonText: '继续编辑',
      type: 'warning',
    })
  } catch {
    return
  }
  close()
}

/** el-drawer 的遮罩点击 / 右上角 ×：都先走同一道确认 */
function beforeClose(done) {
  if (!dirty.value) {
    done()
    return
  }
  requestClose()
}

/**
 * 回车提交，但**只在输入框里**提交。
 *
 * 否则在下拉（el-select）里用回车选中「类别」、或在日期面板里回车确认，
 * 都会顺手把表单提交掉 —— 那种"选个类别就保存了"的行为比不能回车更糟。
 */
function onEnter(event) {
  const tag = event.target?.tagName
  if (tag !== 'INPUT' && tag !== 'TEXTAREA') return
  event.preventDefault()
  submit()
}

function submit() {
  if (!props.canEdit || props.saving) return
  emit('save', { ...form.value })
}

/**
 * 选中一条物料候选后互相带出（与上一版同一口径）：
 *   选名字 → 带出编码；选编码 → 带出名字（主数据没名字时保留原样，不拿编码冒充）；
 *   规格只在**原本空着**时填，不覆盖已经敲进去的内容。
 */
function pickMaterial(option, source) {
  if (!option) return
  if (source === 'name') {
    form.value.materialName = option.name || option.code
    form.value.materialCode = option.code
  } else {
    form.value.materialCode = option.code
    if (option.name) form.value.materialName = option.name
  }
  if (!form.value.spec) form.value.spec = option.spec || ''
}

/** 「全到」：把到货数量填成需求数量、到货日期填成今天（与列表的快捷按钮同义） */
function fillAllDelivered() {
  form.value.receivedQuantity = form.value.quantity
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  form.value.actualArrivalDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function onDelete() {
  emit('delete', props.row)
}

function fieldsOf(group) {
  return group.keys.map((k) => fieldByKey(k)).filter(Boolean)
}
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    :append-to-body="appendToBody"
    direction="rtl"
    :size="'min(520px, 100vw)'"
    :close-on-press-escape="false"
    :before-close="beforeClose"
    :show-close="false"
    class="purchase-drawer"
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <template #header>
      <div class="flex w-full items-center justify-between gap-3">
        <div class="min-w-0">
          <h2 class="truncate text-lg font-serif font-bold tracking-tight text-slate-900">
            {{ title }}
          </h2>
          <p v-if="!isCreate && row" class="mt-1 flex items-center gap-2 text-xs text-slate-500">
            <span class="rounded-full px-2 py-0.5" :class="statusClass(row.status)">
              {{ statusText[row.status] || '等货' }}
            </span>
            <span v-if="dayHint">{{ dayHint }}</span>
            <span v-else>编号 #{{ row.id }}</span>
          </p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-full p-1.5 text-slate-500 transition-colors hover:bg-region hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
          aria-label="关闭抽屉"
          @click="requestClose"
        >
          <svg
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </template>

    <!-- 回车提交（在输入框里敲回车就能存），Esc 关闭。都挂在内容区，不污染全局 -->
    <div
      class="flex min-h-full flex-col gap-6 pb-2"
      @keydown.enter.exact="onEnter"
      @keydown.esc.stop.prevent="requestClose"
    >
      <p
        v-if="errorMessage"
        role="alert"
        class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
      >
        {{ errorMessage }}
      </p>

      <section v-for="group in DRAWER_GROUPS" :key="group.title" class="space-y-3">
        <h3 class="text-xs font-semibold tracking-wide text-slate-500">{{ group.title }}</h3>

        <div
          v-for="field in fieldsOf(group)"
          :key="field.key"
          class="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-3 gap-y-1"
        >
          <label :for="`pf-${field.key}`" class="text-sm text-slate-600">{{ field.aria }}</label>

          <div class="min-w-0">
            <!-- 文本 -->
            <el-input
              v-if="field.kind === 'text'"
              :id="`pf-${field.key}`"
              v-model="form[field.key]"
              :placeholder="field.placeholder"
              :aria-label="field.aria"
              :disabled="!canEdit"
              size="default"
            />

            <!-- 日期 -->
            <el-date-picker
              v-else-if="field.kind === 'date'"
              :id="`pf-${field.key}`"
              v-model="form[field.key]"
              type="date"
              value-format="YYYY-MM-DD"
              :placeholder="field.aria"
              :aria-label="field.aria"
              :disabled="!canEdit"
              class="!w-full"
            />

            <!-- 数字（实际到货数量） -->
            <el-input
              v-else-if="field.kind === 'number'"
              :id="`pf-${field.key}`"
              v-model="form[field.key]"
              inputmode="decimal"
              :placeholder="field.placeholder"
              :aria-label="field.aria"
              :disabled="!canEdit"
            />

            <!-- 下拉（类别） -->
            <el-select
              v-else-if="field.kind === 'select'"
              :id="`pf-${field.key}`"
              v-model="form[field.key]"
              clearable
              :placeholder="`选择${field.aria}`"
              :aria-label="field.aria"
              :disabled="!canEdit"
              class="!w-full"
            >
              <el-option v-for="c in CATEGORY_OPTIONS" :key="c" :label="c" :value="c" />
            </el-select>

            <!-- 物料名称 / 编码：远程检索，选中后互相带出 -->
            <el-autocomplete
              v-else-if="field.kind === 'materialName' || field.kind === 'materialCode'"
              :id="`pf-${field.key}`"
              :ref="field.key === FOCUS_FIELD_ON_CREATE ? setMaterialNameRef : undefined"
              v-model="form[field.key]"
              :fetch-suggestions="fetchMaterialSuggestions"
              :placeholder="field.placeholder"
              :aria-label="field.aria"
              :disabled="!canEdit"
              value-key="label"
              class="w-full"
              @select="(opt) => pickMaterial(opt, field.kind === 'materialName' ? 'name' : 'code')"
            />

            <!-- 数量 + 单位（一格两个控件：分开填没意义） -->
            <div v-else-if="field.kind === 'quantity'" class="flex items-center gap-2">
              <el-input
                v-model="form.quantity"
                inputmode="decimal"
                placeholder="数量"
                aria-label="需求数量"
                :disabled="!canEdit"
                class="!w-28"
              />
              <el-select
                v-model="form.unit"
                filterable
                allow-create
                default-first-option
                placeholder="单位"
                aria-label="单位"
                :disabled="!canEdit"
                class="!w-24"
              >
                <el-option v-for="u in UNIT_OPTIONS" :key="u" :label="u" :value="u" />
              </el-select>
              <button
                v-if="canEdit && !isCreate"
                type="button"
                class="shrink-0 rounded-full border border-line px-2 py-1 text-xs text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
                title="把到货数量填成需求数量、到货日期填成今天"
                @click.prevent="fillAllDelivered"
              >
                全部到货
              </button>
            </div>

            <!-- OA 单号 + 表单链接 -->
            <div v-else-if="field.kind === 'oaNoWithLink'" class="space-y-2">
              <el-input
                v-model="form.oaNo"
                :placeholder="field.placeholder"
                aria-label="OA 单号"
                :disabled="!canEdit"
              />
              <el-input
                v-model="form.oaUrl"
                placeholder="OA 表单链接（粘一次，之后可直接点开）"
                aria-label="OA 表单链接"
                :disabled="!canEdit"
              />
            </div>

            <!-- 送货单图片：上传 / 缩略图 / 点开看原图（沿用现有组件） -->
            <DeliveryNoteUpload
              v-else-if="field.kind === 'image'"
              :value="form.deliveryNote"
              @update:value="(v) => (form.deliveryNote = v)"
            />
          </div>
        </div>

        <!-- 数量与到货组的末尾：只读的进度 -->
        <div
          v-if="group.title === '数量与到货' && !isCreate && row"
          class="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-3"
        >
          <span class="text-sm text-slate-600">进度</span>
          <div class="flex items-center gap-2 text-sm">
            <span class="rounded-full px-2 py-0.5" :class="statusClass(row.status)">
              {{ statusText[row.status] || '等货' }}
            </span>
            <span class="text-xs text-slate-500">{{ dayHint || '由后端按到货日期判定' }}</span>
          </div>
        </div>
      </section>
    </div>

    <template #footer>
      <div class="flex w-full items-center justify-between gap-3">
        <el-button
          v-if="canEdit && !isCreate && row"
          type="danger"
          plain
          :disabled="saving"
          @click="onDelete"
        >
          删除
        </el-button>
        <span v-else />
        <div class="flex items-center gap-2">
          <el-button :disabled="saving" @click="requestClose">取消</el-button>
          <el-button v-if="canEdit" type="primary" :loading="saving" @click="submit">
            保存
          </el-button>
        </div>
      </div>
    </template>
  </el-drawer>
</template>

<style scoped>
/*
 * 抽屉的进出场（变更-117）。
 *
 * 曲线用 Ionic 的抽屉曲线 `cubic-bezier(0.32, 0.72, 0, 1)`、260ms —— 这是
 * emil-design-eng 给的 `--ease-drawer`，也是"弹窗/抽屉"这一档（200–500ms）的中段。
 * 只动 transform，不动 width/left：后两者会让浏览器每帧重排。
 */
.purchase-drawer :deep(.el-drawer) {
  transition: transform 260ms cubic-bezier(0.32, 0.72, 0, 1);
}

/* 抽屉内滚动不带动页面（全局 style.css 已有一条，这里按组件再兜一次） */
.purchase-drawer :deep(.el-drawer__body) {
  overscroll-behavior: contain;
}

@media (prefers-reduced-motion: reduce) {
  .purchase-drawer :deep(.el-drawer) {
    transition: none;
  }
}
</style>
