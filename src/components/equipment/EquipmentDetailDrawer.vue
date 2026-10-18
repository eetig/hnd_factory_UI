<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import {
  ElButton,
  ElDrawer,
  ElInput,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElSelect,
} from 'element-plus'
import { STATUS_TEXT, STATUS_TONE } from '../../constants/statusTones'
import {
  containerTypeLabel,
  uploadVesselDrawing,
} from '../../composables/useEquipmentLedgerData'
import { vesselImageUrl } from '../../composables/useVesselList'
import VesselCalibrateDialog from '../VesselCalibrateDialog.vue'
import { CONTAINER_OPTIONS, DRAWER_GROUPS, FOCUS_FIELD_ON_CREATE, blankDraft, fieldByKey } from './fields.js'

/**
 * 设备详情抽屉（2026-10-18，变更-118）：**新增与编辑共用同一个抽屉**。
 *
 * ## 为什么从"常驻大表单"改成抽屉
 *
 * 上一版是表格上方一块常驻的编辑弹窗（`el-dialog`，720px，16 个字段铺成两列）。
 * 使用方要的是「逐个设备对着图纸核对参数」—— 常驻表单占掉半屏，表格只剩几行，
 * 核对时要在"表格找行 → 抬头看表单"之间来回扫。抽屉把表单挪到右侧、
 * 只占 560px，表格留在原处，点哪行改哪行。
 *
 * ## 为什么没有「删除」
 *
 * 不是漏了：`useEquipmentLedgerData` 里写着「台账是历史依据，删了就查不到某一行
 * 是怎么来的」，接口只提供 enable/disable。所以底部左侧是空的，而不是更危险的按钮。
 *
 * ## 底图与标定
 *
 * 上传只是把图放进图片服务器，**没点保存不会写进台账**；换了图旧坐标一律作废
 * （新图取景未必一致，留着旧坐标会让液面画错位置且不报错）。
 * 标定结果只写进表单，随「保存」一起提交 —— 后端 save 是整行覆写，
 * 单独提交 id+imageBounds 会把其余字段清成 NULL（变更-065/082 的契约）。
 */
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  mode: { type: String, default: 'edit' }, // 'create' | 'edit'
  row: { type: Object, default: null },
  canEdit: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'save'])

/*
 * 抽屉里那条上传/校验提示的两个色。
 * ⚠️ 不写死 tailwind 类：全站状态色走 constants/statusTones（守卫钉着）。
 */
const STATUS_TEXT_SUCCESS = STATUS_TEXT.success
const STATUS_TEXT_ERROR = STATUS_TEXT.error

const form = ref(blankDraft())
let snapshot = ''

const isCreate = computed(() => props.mode === 'create')
const title = computed(() => (isCreate.value ? '新增设备' : '设备详情'))

const enabled = computed(() => props.row?.enabled === 1)
/** 服务端拼好的整句原因（"不能启用：未配置容器底图；…"），前端不重复实现规则 */
const blockReason = computed(() => props.row?.enableBlockReason || '')

const dirty = computed(() => JSON.stringify(form.value) !== snapshot)
/* ===== 抽屉内的临时状态（必须声明在 watch 之前：那个 watch 是 immediate 的，
/* 在它里面读未初始化的 ref 会 TDZ 报错，表现成"自动聚焦不生效"。 */
const uploading = ref(false)
const uploadInput = ref(null)
const calibrateVisible = ref(false)
const message = ref('')
const messageOk = ref(false)

/* ===== 打开：装填表单、记快照、新建时聚焦名称 ===== */

const nameRef = ref(null)
function setNameRef(el) {
  nameRef.value = el
}

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return
    form.value = props.mode === 'edit' && props.row ? blankDraft(props.row) : blankDraft()
    snapshot = JSON.stringify(form.value)
    message.value = ''
    messageOk.value = false
    await nextTick()
    if (isCreate.value) {
      /*
       * ⚠️ 不能只 nextTick 就聚焦：el-drawer 打开时会把 focus trap 抢到容器上，
       * 紧接着的 focus() 会被盖掉（表现为"自动聚焦没生效"）。等一帧再聚焦。
       */
      setTimeout(() => nameRef.value?.focus?.(), 60)
    }
  },
  { immediate: true },
)

/* ===== 关闭前确认 ===== */

function close() {
  emit('update:modelValue', false)
}

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

function beforeClose(done) {
  if (!dirty.value) {
    done()
    return
  }
  requestClose()
}

/* ===== 提交 ===== */

function submit() {
  if (!props.canEdit || props.saving) return
  emit('save', { ...form.value })
}

/**
 * 回车提交，但**只在输入框里**提交：在下拉里回车选「容器类型」、
 * 在日期面板里回车确认，都不该顺手把整台设备存掉。
 */
function onEnter(event) {
  const tag = event.target?.tagName
  if (tag !== 'INPUT' && tag !== 'TEXTAREA') return
  event.preventDefault()
  submit()
}

/* ===== 底图：上传 / 标定 / 清除 ===== */


function imagePreview(file) {
  return file ? vesselImageUrl(file) : ''
}

function pickDrawing() {
  uploadInput.value?.click()
}

async function handleDrawingPicked(event) {
  const file = event.target.files?.[0]
  event.target.value = '' // 允许连续选同一个文件
  if (!file) return
  message.value = ''
  messageOk.value = false
  uploading.value = true
  // 图纸有好几 MB，期间必须让人看到"在传"
  ElMessage.info(`正在上传底图（${Math.round(file.size / 1024)} KB）…`)
  try {
    form.value.imageFile = await uploadVesselDrawing(file)
    messageOk.value = true
    message.value = '底图已上传 ✓ 记得点【保存】才会写进台账；接着点【标定底图】框出罐体轮廓'
    ElMessage.success('底图已上传')
    // 换了图，旧坐标一律作废（理由见文件头）
    form.value.imageBounds = ''
  } catch (e) {
    message.value = `底图上传失败：${e?.response?.data?.msg || e?.message || '未知错误'}`
    ElMessage.error(message.value)
  } finally {
    uploading.value = false
  }
}

function openCalibrate() {
  if (!form.value.imageFile) {
    message.value = '先上传底图，再标定'
    return
  }
  message.value = ''
  calibrateVisible.value = true
}

function handleCalibrated(boundsJson) {
  form.value.imageBounds = boundsJson
  calibrateVisible.value = false
}

function clearDrawing() {
  form.value.imageFile = ''
  form.value.imageBounds = ''
}

function fieldsOf(group) {
  return group.keys.map((k) => fieldByKey(k)).filter(Boolean)
}
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    direction="rtl"
    :size="'min(560px, 100vw)'"
    :close-on-press-escape="false"
    :before-close="beforeClose"
    :show-close="false"
    class="equipment-drawer"
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <template #header>
      <div class="flex w-full items-center justify-between gap-3">
        <div class="min-w-0">
          <h2 class="truncate text-lg font-serif font-bold tracking-tight text-slate-900">
            {{ title }}
          </h2>
          <p v-if="!isCreate && row" class="mt-1 flex items-center gap-2 text-xs text-slate-500">
            <span
              class="rounded-full px-2 py-0.5"
              :class="enabled ? STATUS_TONE.success : STATUS_TONE.neutral"
            >
              {{ enabled ? '启用' : '已停用' }}
            </span>
            <span v-if="row.equipmentCode">位号 {{ row.equipmentCode }}</span>
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
        <div>
          <h3 class="text-xs font-semibold tracking-wide text-slate-500">{{ group.title }}</h3>
          <p v-if="group.hint" class="mt-1 text-xs text-slate-500">{{ group.hint }}</p>
        </div>

        <div
          v-for="field in fieldsOf(group)"
          :key="field.key"
          class="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-3 gap-y-1"
        >
          <label :for="`ef-${field.key}`" class="text-sm text-slate-600">{{ field.label }}</label>

          <div class="min-w-0">
            <el-input
              v-if="field.kind === 'text'"
              :id="`ef-${field.key}`"
              :ref="field.key === FOCUS_FIELD_ON_CREATE ? setNameRef : undefined"
              v-model="form[field.key]"
              :placeholder="field.placeholder || ''"
              :aria-label="field.label"
              :disabled="!canEdit"
            />

            <div v-else-if="field.kind === 'number'" class="flex items-center gap-2">
              <el-input
                :id="`ef-${field.key}`"
                v-model="form[field.key]"
                inputmode="decimal"
                :placeholder="field.placeholder || ''"
                :aria-label="field.label"
                :disabled="!canEdit"
              />
              <span v-if="field.unit" class="shrink-0 text-xs text-slate-500">{{ field.unit }}</span>
            </div>

            <el-select
              v-else-if="field.kind === 'select'"
              :id="`ef-${field.key}`"
              v-model="form.containerType"
              :placeholder="`选择${field.label}`"
              :aria-label="field.label"
              :disabled="!canEdit"
              class="!w-full"
            >
              <el-option
                v-for="t in CONTAINER_OPTIONS"
                :key="t.value"
                :label="t.label"
                :value="t.value"
              />
            </el-select>

            <!-- 只读状态：库里的 enabled 只表示「在台账里启用」，
                 体积计算页还要求「底图 + 坐标 + 几何齐全」，两者不一致时要说清楚 -->
            <div v-else-if="field.kind === 'status'" class="flex flex-wrap items-center gap-2">
              <span
                class="rounded-full px-2 py-0.5 text-xs"
                :class="enabled ? STATUS_TONE.success : STATUS_TONE.neutral"
              >
                {{ enabled ? '启用' : '已停用' }}
              </span>
              <span v-if="enabled && blockReason" class="text-xs text-amber-700">
                · 仅台账（不能参与体积计算：{{ blockReason }}）
              </span>
              <span v-else-if="!enabled && blockReason" class="text-xs text-amber-700">
                {{ blockReason }}
              </span>
              <span class="text-xs text-slate-500">
                容器类型：{{ containerTypeLabel(form.containerType) }}
              </span>
            </div>

            <!-- 底图：缩略图 + 上传 + 标定 + 清除 -->
            <div v-else-if="field.kind === 'image'" class="space-y-2">
              <div class="flex items-start gap-3">
                <img
                  v-if="form.imageFile"
                  :src="imagePreview(form.imageFile)"
                  :alt="`${form.equipmentName || '该设备'} 的容器底图`"
                  class="h-20 w-20 rounded-card border border-line object-contain"
                />
                <div class="min-w-0 text-xs text-slate-500">
                  <p class="mb-1 break-all">
                    {{ form.imageFile || '未配置' }}
                    <span v-if="form.imageFile">· {{ form.imageBounds ? '已标定' : '未标定' }}</span>
                  </p>
                  <div class="flex flex-wrap items-center gap-2">
                    <el-button size="small" :loading="uploading" :disabled="!canEdit" @click="pickDrawing">
                      {{ uploading ? '上传中…' : '上传底图' }}
                    </el-button>
                    <el-button
                      v-if="form.imageFile"
                      size="small"
                      type="primary"
                      plain
                      :disabled="!canEdit"
                      @click="openCalibrate"
                    >
                      {{ form.imageBounds ? '重新标定' : '标定底图' }}
                    </el-button>
                    <el-button
                      v-if="form.imageFile"
                      size="small"
                      :disabled="!canEdit"
                      @click="clearDrawing"
                    >
                      清除
                    </el-button>
                  </div>
                </div>
              </div>
              <input
                ref="uploadInput"
                type="file"
                accept="image/png,image/jpeg"
                class="hidden"
                @change="handleDrawingPicked"
              />
            </div>
          </div>
        </div>
      </section>

      <p
        v-if="message"
        :role="messageOk ? 'status' : 'alert'"
        class="text-xs"
        :class="messageOk ? STATUS_TEXT_SUCCESS : STATUS_TEXT_ERROR"
      >
        {{ message }}
      </p>
    </div>

    <template #footer>
      <div class="flex w-full items-center justify-end gap-2">
        <el-button :disabled="saving" @click="requestClose">取消</el-button>
        <el-button v-if="canEdit" type="primary" :loading="saving" @click="submit">保存</el-button>
      </div>
    </template>
  </el-drawer>

  <!-- 标定只产出坐标 JSON，随抽屉的「保存」一起提交（后端 save 是整行覆写） -->
  <VesselCalibrateDialog
    v-model="calibrateVisible"
    :image-url="imagePreview(form.imageFile)"
    :image-file="form.imageFile"
    :container-type="Number(form.containerType) || null"
    :geometry="{
      topHeadDepth: form.topHeadDepth,
      shellLength: form.shellLength,
      bottomHeadDepth: form.bottomHeadDepth,
    }"
    :bounds="form.imageBounds"
    @save="handleCalibrated"
  />
</template>



<style scoped>
/*
 * 抽屉进出场（变更-118）：Ionic 的抽屉曲线 + 260ms，与采购页同一个口径
 * （emil-design-eng 给的 `--ease-drawer`，也是"抽屉/弹窗"这一档的中段）。
 * 只动 transform，不动 width/left —— 后两者会每帧重排。
 */
.equipment-drawer :deep(.el-drawer) {
  transition: transform 260ms cubic-bezier(0.32, 0.72, 0, 1);
}

/* 抽屉内滚动不带动页面（全局 style.css 已有一条，这里按组件再兜一次） */
.equipment-drawer :deep(.el-drawer__body) {
  overscroll-behavior: contain;
}

@media (prefers-reduced-motion: reduce) {
  .equipment-drawer :deep(.el-drawer) {
    transition: none;
  }
}
</style>
