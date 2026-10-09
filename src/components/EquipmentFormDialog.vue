<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useToast } from 'wot-design-uni'
import { hasPerm } from '../api/auth'
import { resolveAssetUrl } from '../api/config'
import { CONTAINER_TYPES, buildPayload, useEquipmentLedgerData } from '../composables/useEquipmentLedgerData'

// ===== 设备数据维护的编辑弹层（2026-10-06）=====
//
// 为什么是底部弹层、不是行内编辑：与 TankLevelFormDialog 同一个理由 ——
// 手机上行内编辑要在横向滚动的表格里拖着填，16 个字段的误触概率极高；
// 弹层一次把字段按「台账 / 几何 / 底图」三组铺开，拿着手机对着图纸核对才顺手。
//
// 一份弹层兼两用：有 `equipment:edit` 时是可编辑表单，没有时退化成只读详情
// （点卡片看详情不该被权限挡住）—— 同样沿用 TankLevelFormDialog 的做法。
//
// 字段三组的分法不是随意的：「台账」是这张表的身份信息，「几何」是体积计算页真正吃的参数
// （填错直接算错数），「底图」两版由服务端生成。核对的顺序也是这个顺序。

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 传一行 = 编辑；传 null = 新增 */
  record: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue', 'saved'])

const toast = useToast()
const { saveLedger, uploadVesselDrawing } = useEquipmentLedgerData()

const canEdit = computed(() => hasPerm('equipment:edit'))
const isNew = computed(() => !props.record?.id)

const draft = reactive({})
const saving = ref(false)
const uploading = ref(false)

function resetDraft(source) {
  Object.assign(draft, {
    id: source?.id ?? null,
    equipmentCode: source?.equipmentCode ?? '',
    equipmentName: source?.equipmentName ?? '',
    nickname: source?.nickname ?? '',
    workshop: source?.workshop ?? '',
    spec: source?.spec ?? '',
    containerType: source?.containerType ?? 3,
    innerDiameter: source?.innerDiameter ?? '',
    shellLength: source?.shellLength ?? '',
    straightFlange: source?.straightFlange ?? '',
    topHeadDepth: source?.topHeadDepth ?? '',
    bottomHeadDepth: source?.bottomHeadDepth ?? '',
    volumePerMm: source?.volumePerMm ?? '',
    density: source?.density ?? '',
    medium: source?.medium ?? '',
    remark: source?.remark ?? '',
    imageFile: source?.imageFile ?? '',
  })
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) resetDraft(props.record)
  },
  { immediate: true },
)

/** 底图预览：与体积计算页同一个解析（内置底图走包内/服务器、上传的走 /files） */
const drawingPreview = computed(() => (draft.imageFile ? resolveAssetUrl(draft.imageFile) : ''))

const typeLabel = computed(
  () => CONTAINER_TYPES.find((t) => t.value === draft.containerType)?.label ?? '—',
)

const typeIndex = computed({
  get: () => Math.max(0, CONTAINER_TYPES.findIndex((t) => t.value === draft.containerType)),
  set: (i) => {
    draft.containerType = CONTAINER_TYPES[i]?.value ?? 3
  },
})

function close() {
  emit('update:modelValue', false)
}

async function handleSave() {
  if (!String(draft.equipmentName ?? '').trim()) {
    toast.error('设备名称不能为空')
    return
  }
  saving.value = true
  try {
    await saveLedger(buildPayload(draft))
    toast.success('已保存')
    emit('saved')
    close()
  } catch (e) {
    toast.error(e?.data?.msg || e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function handlePickDrawing() {
  if (!canEdit.value) return
  uni.chooseImage({
    count: 1,
    sizeType: ['original'],
    sourceType: ['album', 'camera'],
    success: async (res) => {
      const filePath = res.tempFilePaths?.[0]
      if (!filePath) return
      uploading.value = true
      try {
        draft.imageFile = await uploadVesselDrawing(filePath)
        toast.success('底图已上传（服务端同时生成了深色版）')
      } catch (e) {
        toast.error(e?.data?.msg || e?.message || '底图上传失败')
      } finally {
        uploading.value = false
      }
    },
  })
}
</script>

<template>
  <wd-popup
    :model-value="modelValue"
    position="bottom"
    round
    :safe-area-inset-bottom="true"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <view class="eq-form">
      <view class="eq-form__head">
        <text class="eq-form__title">{{ isNew ? '新增设备' : draft.equipmentName || '设备详情' }}</text>
        <text class="eq-form__sub">{{ isNew ? '台账信息' : `容器类型：${typeLabel}` }}</text>
      </view>

      <scroll-view scroll-y class="eq-form__body">
        <view class="eq-form__group">台账信息</view>
        <wd-input v-model="draft.equipmentCode" label="设备位号" :disabled="!canEdit" />
        <wd-input v-model="draft.equipmentName" label="设备名称" :disabled="!canEdit" />
        <wd-input v-model="draft.nickname" label="设备昵称" :disabled="!canEdit" />
        <wd-input v-model="draft.workshop" label="车间装置" :disabled="!canEdit" />
        <wd-input v-model="draft.spec" label="设备规格" :disabled="!canEdit" />
        <view class="eq-form__row">
          <text class="eq-form__label">容器类型</text>
          <picker
            v-if="canEdit"
            mode="selector"
            :range="CONTAINER_TYPES.map((t) => t.label)"
            :value="typeIndex"
            @change="typeIndex = Number($event.detail.value)"
          >
            <view class="eq-form__picker">{{ typeLabel }}</view>
          </picker>
          <text v-else class="eq-form__value">{{ typeLabel }}</text>
        </view>
        <wd-input v-model="draft.medium" label="介质" :disabled="!canEdit" />
        <wd-input v-model="draft.density" label="介质密度 (g/cm³)" type="number" :disabled="!canEdit" />
        <wd-input
          v-model="draft.volumePerMm"
          label="每毫米体积 (m³/mm)"
          type="number"
          :disabled="!canEdit"
        />

        <view class="eq-form__group">
          几何参数
          <text class="eq-form__hint">筒体长度不含直边；下封头留空表示平底</text>
        </view>
        <wd-input v-model="draft.innerDiameter" label="内径 (mm)" type="number" :disabled="!canEdit" />
        <wd-input v-model="draft.shellLength" label="筒体长度 (mm)" type="number" :disabled="!canEdit" />
        <wd-input v-model="draft.straightFlange" label="直边 (mm)" type="number" :disabled="!canEdit" />
        <wd-input v-model="draft.topHeadDepth" label="上封头深度 (mm)" type="number" :disabled="!canEdit" />
        <wd-input v-model="draft.bottomHeadDepth" label="下封头深度 (mm)" type="number" :disabled="!canEdit" />

        <view class="eq-form__group">容器底图</view>
        <view class="eq-form__drawing">
          <image v-if="drawingPreview" :src="drawingPreview" mode="aspectFit" class="eq-form__thumb" />
          <view v-else class="eq-form__thumb eq-form__thumb--empty">
            <text>未配置</text>
          </view>
          <view class="eq-form__drawing-side">
            <text class="eq-form__value">{{ draft.imageFile || '—' }}</text>
            <wd-button v-if="canEdit" size="small" :loading="uploading" @click="handlePickDrawing">
              上传底图
            </wd-button>
            <text class="eq-form__hint">上传后服务端自动生成深色主题用的亮线版</text>
          </view>
        </view>

        <view class="eq-form__group">备注</view>
        <wd-input v-model="draft.remark" type="textarea" :disabled="!canEdit" />
      </scroll-view>

      <view class="eq-form__foot">
        <wd-button plain @click="close">取消</wd-button>
        <wd-button v-if="canEdit" type="primary" :loading="saving" @click="handleSave">保存</wd-button>
      </view>
    </view>
  </wd-popup>
</template>

<style lang="scss" scoped>
/* ⚠️ 颜色一律走 --ui-* 变量（理由见 EquipmentMaintenancePanel.vue 顶部那段注释）。
   这里原来是照浅色写死的 hex，深色主题下完全不跟随：副标题 #8a8f99、字段值、分组标题、
   标签色、选择器蓝字在白底弹层上是灰的、在深色弹层上就成了暗字压暗底。
   注：.eq-form__title 原先没有 color，是**故意**继承页面正文色的，本身没错
   （wot 弹层的表面色跟随主题，深色下表面 rgb(27,27,27)、继承来的正文色是近白）。
   现在显式写出来，是为了让整个文件不依赖"表面色和页面正文色同调"这个前提。 */
/* ⚠️ 必须是 height，不能写回 max-height。
   uni 的 scroll-view 里，真正滚动的是第二层 .uni-scroll-view（框架给它内联
   overflow: hidden auto），而它自己的 height: 100% 只有**父级高度确定**时才解析得出。
   父级高度由 flex 撑出来（computed 是 auto）时，100% 会退化成内容高度 ——
   滚动器就成了 917，比可见的 565 多出 352，整块戳出弹层之外；于是手指在表单里一滑，
   滚的不是表单而是**整个弹层**：真机实测弹层被滚 295px，表头飞出屏幕上沿、
   「取消 / 保存」掉到屏幕正中间（使用方截图就是这个）。
   实测把它改成 height 之后：滚动器回到 565，弹层 scrollTop 恒为 0，表单自己正常滚。
   （同一个道理见 ProductSelectDialog 的 popupStyle 注释：「高度必须是 height 而不是 max-height」。） */
.eq-form {
  display: flex;
  flex-direction: column;
  height: 82vh;
}

.eq-form__head {
  padding: 20rpx 30rpx 12rpx;
  border-bottom: 1rpx solid var(--ui-slate-200);
}

.eq-form__title {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--ui-slate-900);
}

.eq-form__sub {
  display: block;
  margin-top: 6rpx;
  font-size: 24rpx;
  color: var(--ui-slate-500);
}

.eq-form__body {
  flex: 1;
  min-height: 0;
}

.eq-form__group {
  padding: 20rpx 30rpx 8rpx;
  font-size: 24rpx;
  color: var(--ui-slate-500);
}

.eq-form__hint {
  margin-left: 8rpx;
  font-size: 22rpx;
  color: var(--ui-slate-400);
}

.eq-form__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 30rpx;
  font-size: 28rpx;
}

.eq-form__label {
  color: var(--ui-slate-600);
}

.eq-form__value {
  font-size: 24rpx;
  color: var(--ui-slate-500);
}

.eq-form__picker {
  padding: 8rpx 20rpx;
  font-size: 28rpx;
  color: var(--ui-gold-600);
}

.eq-form__drawing {
  display: flex;
  gap: 20rpx;
  padding: 12rpx 30rpx 20rpx;
}

.eq-form__thumb {
  width: 160rpx;
  height: 160rpx;
  border: 1rpx solid var(--ui-slate-200);
  border-radius: 12rpx;
}

.eq-form__thumb--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22rpx;
  color: var(--ui-slate-400);
}

.eq-form__drawing-side {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10rpx;
}

.eq-form__foot {
  display: flex;
  gap: 20rpx;
  padding: 16rpx 30rpx 24rpx;
  border-top: 1rpx solid var(--ui-slate-200);
}
</style>
