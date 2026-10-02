<script setup>
import { computed, ref, watch } from 'vue'
import { useMessage, useToast } from 'wot-design-uni'
import DateField from './DateField.vue'
import { hasPerm } from '../api/auth'
import { useEquipmentLedger } from '../composables/useEquipmentLedger'
import { useKeyboardLift } from '../composables/useKeyboardLift'
import {
  TANK_LEVEL_LOCATIONS,
  buildTankLevelDraft,
  useTankLevelData,
} from '../composables/useTankLevelData'
import { useTankLevelImages } from '../composables/useTankLevelImages'

/**
 * 月底储罐液位记录的新增 / 编辑表单（底部弹层）。
 *
 * <p>为什么不是电脑端那种行内编辑：手机上录一条要填 5 个字段（含日期），
 * 行内编辑得在横向滚动的表格里拖着填，误触概率高；弹层表单一次把字段铺开，
 * 与「图片解析」「物料选择」两处弹层的观感也统一。
 *
 * <p>一份弹层兼两用：有 `tank_level:edit` 权限时是可编辑表单，
 * 没有权限时同一层退化成只读详情（点行看详情不该被权限挡住）。
 *
 * <p>**所属 / 物料 / 容器编号三个字段不在界面上**（电脑端已按使用方要求撤掉这三栏），
 * 但草稿里原样带着并在提交时回传 —— 不带回去等于把库里这三列清成 NULL
 * （见 useTankLevelData 的 buildTankLevelDraft）。
 *
 * <p>变更-015（随电脑端 变更-012）在本文件上改了三处：
 *   ① 属地、容器名称改成「可填可选」——候选在同一弹层里**下钻**显示；
 *   ② 新增行可以先选照片，点一次「保存」即落库 + 传图；
 *   ③ 保存时若图没传上，只警告不报失败（数据已经存进去了）。
 */
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  // 要编辑的记录；null = 新增
  record: { type: Object, default: null },
})

const emit = defineEmits(['update:modelValue'])

const toast = useToast()
const message = useMessage()

const { saveTankLevelRecord, deleteTankLevelRecord, fetchTankLevelRecords } = useTankLevelData()
const { uploadImagesForRecord } = useTankLevelImages()
const {
  equipmentOptions,
  equipmentSearching,
  fetchEquipmentSuggestions,
  cancelEquipmentSearch,
} = useEquipmentLedger()

// 只挡按钮显隐与输入框可编辑，不是安全边界 —— 后端每个写接口各自鉴权
const canEdit = computed(() => hasPerm('tank_level:edit'))
const canDelete = computed(() => hasPerm('tank_level:delete'))
const readOnly = computed(() => !canEdit.value)

const isNew = computed(() => !props.record)

const draft = ref(buildTankLevelDraft(null))
const saving = ref(false)
const deleting = ref(false)

const title = computed(() => {
  if (isNew.value) return '新增液位记录'
  return readOnly.value ? '记录详情' : '编辑液位记录'
})

// 弹层里输入框会被软键盘盖住：弹层是 position: fixed 的，
// uni 的 adjust-position 只滚页面、对 fixed 元素无效（同物料选择弹层）
const {
  keyboardHeight: liftHeight,
  start: startKeyboardLift,
  stop: stopKeyboardLift,
} = useKeyboardLift()

const popupStyle = computed(() => {
  const base =
    'max-height: 86vh; display: flex; flex-direction: column; background-color: var(--ui-surface); overscroll-behavior: contain;'
  const kb = liftHeight.value
  if (!kb) return base

  // 键盘弹起时用「底边上移 + 高度写成确定值」而不是 padding —— 本项目没有全局
  // box-sizing 重置，.wd-popup 是 content-box，padding 会把弹层顶出屏幕上沿
  return `${base} bottom: ${kb}px; padding-bottom: 0; height: min(86vh, calc(100vh - ${kb}px - 12px));`
})

// ===== 候选层（下钻）=====
// '' = 填表；'location' = 选属地；'equipment' = 选容器名称。
//
// 刻意**不在弹层里再开一个弹层**：本项目多处靠「没有 transform 祖先」保证 fixed 浮层
// 铺满全屏（见 DropdownMenu 的说明），而 wd-popup 动画期间带 transform，
// 嵌套的 fixed 浮层会跟着它定位。同一个弹层里换内容最稳，各端表现也一致。
const pickerMode = ref('')
const equipmentKeyword = ref('')

const pickerTitle = computed(() =>
  pickerMode.value === 'location' ? '选择属地' : '从设备台账选择容器',
)

function openLocationPicker() {
  pickerMode.value = 'location'
}

function openEquipmentPicker() {
  pickerMode.value = 'equipment'
  equipmentKeyword.value = ''
  // 空关键字 = 台账前 100 条（后端按名称拼音序），点开就列出全部候选，不必先打字
  fetchEquipmentSuggestions('')
}

function closePicker() {
  pickerMode.value = ''
  cancelEquipmentSearch()
}

function selectLocation(location) {
  draft.value.location = location
  closePicker()
}

/** 选中台账设备：先只回填名称（用设备位号回填容器编号是电脑端 变更-012 的待办 #1，还没做） */
function selectEquipment(option) {
  draft.value.tankName = option.name
  closePicker()
}

watch(equipmentKeyword, (value) => {
  if (pickerMode.value !== 'equipment') return
  fetchEquipmentSuggestions(value)
})

// ===== 新增行里先选好的照片 =====
// 记录还没保存就没有 id，而图据接口挂在 record id 上，所以照片只能先攥在手里，
// 等保存拿到新 id 后立刻传上去 —— 用户只点一次「保存」，不用「先存数据再补图」两步。
//
// 编辑已有行不走这条路：那种行本来就有 id，图据弹窗直接可用，不必等保存。
const pendingPhotos = ref([]) // uni.chooseImage 给的临时路径

/**
 * 拍照 / 从相册选。
 *
 * ⚠️ 一次只给一个 sourceType：两个都给的话，App / 小程序会先弹平台自带的
 *    「拍摄 / 从相册选择」ActionSheet（系统 UI，样式改不了，各机型还不一样），
 *    所以摆成两个入口，各自带单一来源（同图据弹层、图片解析页的做法）。
 */
function pickPhotos(source) {
  uni.chooseImage({
    count: 3,
    sizeType: ['original', 'compressed'],
    sourceType: [source],
    success: (res) => {
      const paths = res.tempFilePaths || []
      if (paths.length) {
        pendingPhotos.value = [...pendingPhotos.value, ...paths]
      }
    },
  })
}

function removePendingPhoto(index) {
  pendingPhotos.value = pendingPhotos.value.filter((_, i) => i !== index)
}

function clearPendingPhotos() {
  pendingPhotos.value = []
}

/** 草稿按「要编辑的那条记录」重建：每次打开都重来一份，不复用上一次的输入 */
function syncDraft() {
  draft.value = buildTankLevelDraft(props.record)
  clearPendingPhotos()
  closePicker()
}

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) {
      syncDraft()
      startKeyboardLift()
    } else {
      stopKeyboardLift()
      cancelEquipmentSearch()
      pickerMode.value = ''
    }
  },
)

// 弹层开着的时候换了目标记录（比如没关表单就去点了另一行）：草稿要跟着换，
// 否则显示的还是上一条的值，一保存就把改过的内容写到另一条记录上
watch(
  () => props.record,
  () => {
    if (props.modelValue) syncDraft()
  },
)

function close() {
  emit('update:modelValue', false)
}

async function handleSave() {
  if (saving.value) return

  saving.value = true
  const creating = isNew.value
  // 图得等保存拿到 id 才能传。先拷一份：保存成功后会清空 pendingPhotos
  const photosToUpload = creating ? [...pendingPhotos.value] : []

  try {
    // 校验交给后端（TankLevelValidator 只返回首条错误，且文案就是给用户看的），
    // 前端不再抄一份规则 —— 抄了迟早和后端漂移
    const saved = await saveTankLevelRecord(draft.value)
    close()

    if (!photosToUpload.length) {
      toast.success(creating ? '新增成功' : '保存成功')
      return
    }

    // 照片这一段单独兜错：数据已经落库了，图没传上不能报成「保存失败」——
    // 记录是好的，图还能在该行的图据弹窗里补。含糊地报失败会让人以为整条没存进去，
    // 再存一次就多出一条重复记录
    try {
      await uploadImagesForRecord(saved?.id, photosToUpload)
      // 保存时刷的那一次还没有图，这里要再刷一次：列表要画首张缩略图与张数角标
      await fetchTankLevelRecords({ keepPage: true })
      toast.success(`新增成功，已上传 ${photosToUpload.length} 张照片`)
    } catch (error) {
      toast.warning(
        `数据已保存，但照片没传上：${error?.message || '请稍后重试。'}可在该行的图据里补传。`,
      )
    }
  } catch (error) {
    toast.error(error?.message || '保存失败，请稍后重试。')
  } finally {
    saving.value = false
  }
}

async function handleDelete() {
  if (deleting.value || isNew.value) return

  try {
    await message.confirm({
      title: '确认删除记录',
      msg: `确定删除「${draft.value.recordDate} ${draft.value.tankName || draft.value.location}」这条记录吗？删除后不可恢复。`,
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
    })
  } catch {
    return // 用户点了取消
  }

  deleting.value = true

  try {
    await deleteTankLevelRecord(draft.value.id)
    toast.success('删除成功')
    close()
  } catch (error) {
    toast.error(error?.message || '删除失败，请稍后重试。')
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <wd-popup
    :model-value="modelValue"
    position="bottom"
    round
    safe-area-inset-bottom
    :custom-style="popupStyle"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <view class="tlf">
      <view class="tlf__grabber"></view>

      <view class="tlf__head">
        <!-- 候选层时头部换成「返回」：不新开弹层，只换内容 -->
        <view v-if="pickerMode" class="tlf__back" @click="closePicker">
          <wd-icon name="arrow-left" size="18px" />
        </view>
        <text class="tlf__title">{{ pickerMode ? pickerTitle : title }}</text>
        <view class="tlf__close" @click="close">
          <wd-icon name="close" size="18px" />
        </view>
      </view>

      <!-- ===== 候选层：属地 ===== -->
      <scroll-view v-if="pickerMode === 'location'" class="tlf__body" scroll-y>
        <view
          v-for="location in TANK_LEVEL_LOCATIONS"
          :key="location"
          class="tlf__option"
          :class="location === draft.location ? 'is-selected' : ''"
          @click="selectLocation(location)"
        >
          <text class="tlf__option-text">{{ location }}</text>
          <text v-if="location === draft.location" class="tlf__option-flag">当前</text>
        </view>
        <text class="tlf__tip">
          这里只是常用罐组，列表里没有的照样可以直接打在属地框里。
        </text>
      </scroll-view>

      <!-- ===== 候选层：容器名称（设备台账）===== -->
      <template v-else-if="pickerMode === 'equipment'">
        <view class="tlf__search">
          <wd-input
            v-model="equipmentKeyword"
            placeholder="输入关键字搜索设备台账"
            clearable
            no-border
          />
        </view>

        <scroll-view class="tlf__body tlf__body--list" scroll-y>
          <view
            v-for="item in equipmentOptions"
            :key="item.name"
            class="tlf__option"
            :class="item.name === draft.tankName ? 'is-selected' : ''"
            @click="selectEquipment(item)"
          >
            <view class="tlf__option-main">
              <text class="tlf__option-text">{{ item.name }}</text>
              <text v-if="item.spec" class="tlf__option-sub">{{ item.spec }}</text>
            </view>
            <text v-if="item.name === draft.tankName" class="tlf__option-flag">当前</text>
          </view>

          <view v-if="equipmentSearching && !equipmentOptions.length" class="tlf__empty">
            <text>正在读取设备台账…</text>
          </view>
          <view v-else-if="!equipmentOptions.length" class="tlf__empty">
            <text>{{ equipmentKeyword.trim() ? '没有匹配的设备' : '暂时取不到设备台账' }}</text>
            <text class="tlf__empty-hint">
              台账里没有的设备，把名称直接打在容器名称框里即可。
            </text>
          </view>
        </scroll-view>
      </template>

      <!-- ===== 表单 / 只读详情 ===== -->
      <scroll-view v-else class="tlf__body" scroll-y>
        <!-- 只读详情：无编辑权限时把值按行铺出来，不做成灰掉的输入框
             （灰输入框点不动又像是坏了，不如直接给文本） -->
        <template v-if="readOnly">
          <view class="tlf__line">
            <text class="tlf__line-label">记录日期</text>
            <text class="tlf__line-value">{{ draft.recordDate || '/' }}</text>
          </view>
          <view class="tlf__line">
            <text class="tlf__line-label">属地</text>
            <text class="tlf__line-value">{{ draft.location || '/' }}</text>
          </view>
          <view class="tlf__line">
            <text class="tlf__line-label">容器名称</text>
            <text class="tlf__line-value">{{ draft.tankName || '/' }}</text>
          </view>
          <view class="tlf__line">
            <text class="tlf__line-label">容器液位 (mm)</text>
            <text class="tlf__line-value">{{ draft.levelValue || '/' }}</text>
          </view>
          <view class="tlf__line">
            <text class="tlf__line-label">理论质量 (kg)</text>
            <text class="tlf__line-value">{{ draft.theoreticalWeight || '/' }}</text>
          </view>
        </template>

        <template v-else>
          <view class="tlf__field">
            <text class="tlf__label">记录日期</text>
            <DateField v-model="draft.recordDate" placeholder="请选择记录日期" />
          </view>

          <!-- 属地：可填可选 —— 候选就那几个罐组，这里只帮省事，不是必选项 -->
          <view class="tlf__field">
            <text class="tlf__label">属地</text>
            <input
              v-model="draft.location"
              class="tlf__input"
              type="text"
              placeholder="如：4#"
              placeholder-class="ui-placeholder"
            />
            <view class="tlf__pick" @click="openLocationPicker">
              <wd-icon name="filter" size="14px" />
              选择
            </view>
          </view>

          <!-- 容器名称：候选来自设备台账（点开列全部、按名称拼音序），也能直接手打 ——
               台账里没有的设备照样要录得进去，所以不做成「只能选」 -->
          <view class="tlf__field">
            <text class="tlf__label">容器名称</text>
            <input
              v-model="draft.tankName"
              class="tlf__input"
              type="text"
              placeholder="请填写容器名称"
              placeholder-class="ui-placeholder"
            />
            <view class="tlf__pick" @click="openEquipmentPicker">
              <wd-icon name="filter" size="14px" />
              选择
            </view>
          </view>

          <view class="tlf__field">
            <text class="tlf__label">容器液位 (mm)</text>
            <!-- type="digit" 而不是 number：抄表是带小数的，number 键盘在部分机型上没有小数点 -->
            <input
              v-model="draft.levelValue"
              class="tlf__input"
              type="digit"
              placeholder="—"
              placeholder-class="ui-placeholder"
            />
          </view>

          <view class="tlf__field">
            <text class="tlf__label">理论质量 (kg)</text>
            <input
              v-model="draft.theoreticalWeight"
              class="tlf__input"
              type="digit"
              placeholder="—"
              placeholder-class="ui-placeholder"
            />
          </view>

          <!-- 图据随数据一起存（仅新增）：编辑已有记录时图据在图据弹窗里维护，这里不重复 -->
          <view v-if="isNew" class="tlf__media">
            <view class="tlf__media-head">
              <text class="tlf__label">图据</text>
              <text class="tlf__media-hint">随记录一起保存</text>
            </view>

            <view v-if="pendingPhotos.length" class="tlf__thumbs">
              <view v-for="(path, index) in pendingPhotos" :key="`${path}-${index}`" class="tlf__thumb">
                <image class="tlf__thumb-img" :src="path" mode="aspectFill" />
                <view class="tlf__thumb-remove" @click="removePendingPhoto(index)">
                  <wd-icon name="close" size="10px" />
                </view>
              </view>
            </view>

            <view class="tlf__photo-actions">
              <view class="tlf__photo-btn" @click="pickPhotos('camera')">
                <wd-icon name="camera" size="14px" />
                <text class="tlf__photo-text">拍照</text>
              </view>
              <view class="tlf__photo-btn" @click="pickPhotos('album')">
                <wd-icon name="picture" size="14px" />
                <text class="tlf__photo-text">从相册</text>
              </view>
            </view>
          </view>

          <text class="tlf__tip">
            同一天可以录入多条记录：月底同一天各容器各记一条即可。
          </text>
        </template>
      </scroll-view>

      <view v-if="!pickerMode" class="tlf__footer">
        <wd-button
          v-if="!readOnly && !isNew && canDelete"
          type="error"
          plain
          :loading="deleting"
          @click="handleDelete"
        >
          删除
        </wd-button>
        <view class="tlf__footer-gap"></view>
        <wd-button v-if="!readOnly" plain @click="close">取消</wd-button>
        <wd-button v-if="!readOnly" type="primary" :loading="saving" @click="handleSave">
          保存
        </wd-button>
        <wd-button v-else type="primary" @click="close">关闭</wd-button>
      </view>
    </view>
  </wd-popup>
</template>

<style scoped lang="scss">
.tlf {
  display: flex;
  max-height: 86vh;
  flex-direction: column;

  &__grabber {
    width: 72rpx;
    height: 8rpx;
    margin: 20rpx auto 0;
    border-radius: $ui-radius-pill;
    background-color: $ui-raise-3;
  }

  &__head {
    display: flex;
    align-items: center;
    gap: 12rpx;
    padding: 24rpx 32rpx 16rpx;
  }

  &__title {
    min-width: 0;
    flex: 1;
    color: $ui-text;
    font-size: 32rpx;
    font-weight: 600;
  }

  &__back,
  &__close {
    display: flex;
    width: 56rpx;
    height: 56rpx;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background-color: $ui-raise-2;
    color: $ui-text-3;

    &:active {
      background-color: $ui-raise-3;
      color: $ui-text;
    }
  }

  &__search {
    padding: 0 32rpx 16rpx;
  }

  &__body {
    // scroll-view 必须有确定高度才会滚动；键盘弹起时靠 flex 把剩余空间吃掉
    min-height: 0;
    flex-grow: 1;
    overscroll-behavior: contain;
    // uni 的 uni-scroll-view 自带 width: 100%，而 100% 不扣边框，会平白溢出 2px
    width: auto;
    border-top: 1px solid $ui-hairline;
    padding: 8rpx 32rpx 16rpx;

    // 候选列表：给一个确定高度，键盘弹起时也留得住
    &--list {
      height: 60vh;
      flex-grow: 0;
    }
  }

  &__field {
    display: flex;
    min-height: 92rpx;
    align-items: center;
    gap: 16rpx;
    border-bottom: 1px solid $ui-hairline;
  }

  &__label {
    flex-shrink: 0;
    color: $ui-text-2;
    font-size: 28rpx;
  }

  &__input {
    min-width: 0;
    flex: 1;
    padding: 16rpx 0;
    background-color: transparent;
    color: $ui-text;
    font-size: 28rpx;
    text-align: right;
  }

  /** 「选择」入口：贴着输入框右侧的小胶囊 */
  &__pick {
    display: flex;
    height: 52rpx;
    flex-shrink: 0;
    align-items: center;
    gap: 4rpx;
    padding: 0 18rpx;
    border-radius: $ui-radius-pill;
    background-color: $ui-raise-2;
    color: $ui-text-2;
    font-size: 24rpx;

    &:active {
      background-color: $ui-raise-3;
      color: $ui-text;
    }
  }

  &__option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16rpx;
    padding: 26rpx 20rpx;
    border-radius: $ui-radius-md;
    color: $ui-text-2;

    &:active {
      background-color: $ui-raise-2;
    }

    &.is-selected {
      background-color: $ui-accent-soft;
      color: $ui-accent-text;
    }
  }

  &__option-main {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 6rpx;
  }

  &__option-text {
    font-size: 28rpx;
  }

  &__option-sub {
    color: $ui-text-3;
    font-size: 22rpx;
  }

  &__option-flag {
    flex-shrink: 0;
    color: $ui-accent-text;
    font-size: 22rpx;
  }

  &__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12rpx;
    padding: 60rpx 20rpx;
    color: $ui-text-3;
    font-size: 26rpx;
    text-align: center;
  }

  &__empty-hint {
    color: $ui-text-3;
    font-size: 24rpx;
    line-height: 1.6;
  }

  /* ===== 图据（新增时先选好，保存后一起传）===== */
  &__media {
    padding: 20rpx 0 8rpx;
    border-bottom: 1px solid $ui-hairline;
  }

  &__media-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }

  &__media-hint {
    color: $ui-text-3;
    font-size: 22rpx;
  }

  &__thumbs {
    display: flex;
    flex-wrap: wrap;
    gap: 16rpx;
    padding: 16rpx 0 4rpx;
  }

  &__thumb {
    position: relative;
    width: 140rpx;
    height: 140rpx;
  }

  &__thumb-img {
    width: 100%;
    height: 100%;
    border-radius: $ui-radius-md;
    background-color: $ui-raise-2;
  }

  &__thumb-remove {
    position: absolute;
    top: -10rpx;
    right: -10rpx;
    display: flex;
    width: 36rpx;
    height: 36rpx;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background-color: $ui-scrim;
    color: #fff;
  }

  &__photo-actions {
    display: flex;
    gap: 16rpx;
    padding: 16rpx 0 8rpx;
  }

  &__photo-btn {
    display: flex;
    height: 60rpx;
    align-items: center;
    gap: 6rpx;
    padding: 0 24rpx;
    border-radius: $ui-radius-pill;
    background-color: $ui-raise-2;
    color: $ui-text-2;
    font-size: 26rpx;

    &:active {
      background-color: $ui-raise-3;
      color: $ui-text;
    }
  }

  &__tip {
    display: block;
    padding: 20rpx 0 8rpx;
    color: $ui-text-3;
    font-size: 24rpx;
    line-height: 1.6;
  }

  &__line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20rpx;
    padding: 24rpx 0;
    border-bottom: 1px solid $ui-hairline;
  }

  &__line-label {
    color: $ui-text-2;
    font-size: 28rpx;
  }

  &__line-value {
    color: $ui-text;
    font-size: 28rpx;
    font-weight: 600;
  }

  &__footer {
    display: flex;
    align-items: center;
    gap: 16rpx;
    border-top: 1px solid $ui-hairline;
    padding: 20rpx 32rpx;
  }

  // 把「删除」推到左边、其余按钮靠右
  &__footer-gap {
    flex: 1;
  }
}

/* 占位符走 placeholder-class（uni 各端的写法，与图片解析页一致）；
   下面那条 ::placeholder 给 H5 原生 input 兜底，认不得的那条就是空规则 */
.ui-placeholder {
  color: $ui-text-3;
}

.tlf__input::placeholder {
  color: $ui-text-3;
}
</style>
