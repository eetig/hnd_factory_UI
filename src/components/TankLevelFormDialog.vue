<script setup>
import { computed, getCurrentInstance, ref, watch } from 'vue'
import { useMessage, useToast } from 'wot-design-uni'
import dayjs from 'dayjs'
import DateField from './DateField.vue'
import PhotoGrid from './PhotoGrid.vue'
import { hasPerm } from '../api/auth'
import { useEquipmentLedger } from '../composables/useEquipmentLedger'
import { useKeyboardLift } from '../composables/useKeyboardLift'
import {
  TANK_LEVEL_LOCATIONS,
  buildTankLevelDraft,
  useTankLevelData,
} from '../composables/useTankLevelData'
import { useTankLevelImages } from '../composables/useTankLevelImages'
import { chooseImages } from '../utils/chooseImages'
import { buildStampLines, CANVAS_EDGE, watermarkPhoto } from '../utils/photoWatermark'

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

const {
  saveTankLevelRecord,
  deleteTankLevelRecord,
  fetchTankLevelRecords,
  fetchTankLevelSuggestions,
  tankLevelSuggestions,
} = useTankLevelData()
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
    'max-height: 86vh; display: flex; flex-direction: column; background-color: var(--ui-sheet-fill); overscroll-behavior: contain;'
  const kb = liftHeight.value
  if (!kb) return base

  // 键盘弹起时用「底边上移 + 高度写成确定值」而不是 padding —— 本项目没有全局
  // box-sizing 重置，.wd-popup 是 content-box，padding 会把弹层顶出屏幕上沿
  return `${base} bottom: ${kb}px; padding-bottom: 0; height: min(86vh, calc(100vh - ${kb}px - 12px));`
})

// ===== 输入即查的候选（2026-10-20 改版：取消「选择」按钮）=====
//
// 旧做法是「输入框 + 选择按钮 → 下钻到一个候选层」，一次选择要点三次：
// 点选择、找条目、点条目。使用方要求改成**聚焦即列全部、打字即收窄、点中即回填**，
// 少一层、少两次点击（原话：「输入的时候自动查询，不需要后面的选择」）。
//
// 候选直接铺在字段下方（跟着内容往下推），不做浮层：
//   · 浮层要 position: fixed/absolute + 遮挡判断，而弹层里的祖先带 transform 时会被钉住
//     （本仓踩过多次，见 DateField / DropdownMenu 的注释）；
//   · 弹层里可滚，候选再多也只是往下长，不存在被裁切的问题。
const activeField = ref('') // '' | 'location' | 'equipment'

// 失焦到点击命中之间有约 220ms 的窗口：手指点在候选上时，blur 先于 click 触发，
// 立刻收起列表会让这一下点空（手机上尤其明显）。所以延迟收，点中候选时再取消。
let blurTimer = null
const SUGGEST_HIDE_DELAY = 220

/** 属地候选：**库里出现过的** + 固定罐组字典（2026-10-20 起会记住手打过的属地） */
const locationCandidatePool = computed(() => {
  const merged = [...tankLevelSuggestions.value.locations, ...TANK_LEVEL_LOCATIONS]
  return merged.filter((item, index) => item && merged.indexOf(item) === index)
})

/** 属地候选：固定字典，按已输入的片段做包含匹配 */
const locationSuggestions = computed(() => {
  const keyword = String(draft.value.location ?? '').trim()
  if (!keyword) return locationCandidatePool.value
  return locationCandidatePool.value.filter((item) => item.includes(keyword))
})

/**
 * 容器名称候选 = 设备台账（后端按关键字查，带规格）+ **库里录过的名称**（可手打的新罐）。
 *
 * <p>两条来源缺一不可（2026-10-20，变更-129）：
 *   · 只有台账 → 现场临时编号/新装罐（台账还没录）打完下次就没了；
 *   · 只有历史 → 第一次录某台设备时没有任何候选。
 *
 * <p>空关键字时的排序是**刻意的**：台账前 5 条 + 只出现在历史里的名称。
 * 全按台账排的话，一屏 8 条全是台账，刚手打过的「171产品」永远在 8 条之外 ——
 * 使用方要的正是"下次能搜到/看到我自己打的那个名字"。
 */
const EQUIPMENT_SUGGEST_LIMIT = 8
/** 空关键字时台账占前几条（其余名额给历史里独有的名称） */
const EQUIPMENT_LEDGER_HEAD = 5

const equipmentCandidateNames = computed(() => {
  const keyword = String(draft.value.tankName ?? '').trim()
  const ledgerNames = equipmentOptions.value.map((option) => option.name).filter(Boolean)
  const historyOnly = tankLevelSuggestions.value.tankNames
    .filter((name) => !ledgerNames.includes(name))

  if (keyword) {
    const pool = [...ledgerNames, ...historyOnly]
      .filter((name, index, all) => all.indexOf(name) === index)
    return pool.filter((name) => name.includes(keyword))
  }

  return [...ledgerNames.slice(0, EQUIPMENT_LEDGER_HEAD), ...historyOnly]
})

const equipmentSuggestions = computed(() => {
  const current = String(draft.value.tankName ?? '').trim()
  return equipmentCandidateNames.value
    .filter((name) => name !== current)
    .slice(0, EQUIPMENT_SUGGEST_LIMIT)
    .map((name) => ({
      name,
      spec: equipmentOptions.value.find((option) => option.name === name)?.spec || '',
    }))
})

const equipmentMoreHint = computed(() => {
  const current = String(draft.value.tankName ?? '').trim()
  const hidden = equipmentCandidateNames.value.filter((name) => name !== current).length
    - equipmentSuggestions.value.length
  return hidden > 0 ? `还有 ${hidden} 个，继续输入可缩小范围` : ''
})

/** 聚焦：属地列全量；容器名称按当前输入立刻查一次（空关键字 = 全部） */
function showSuggestions(field) {
  clearTimeout(blurTimer)
  activeField.value = field
  if (field === 'equipment') fetchEquipmentSuggestions(String(draft.value.tankName ?? ''))
}

function hideSuggestionsSoon() {
  clearTimeout(blurTimer)
  blurTimer = setTimeout(() => {
    activeField.value = ''
  }, SUGGEST_HIDE_DELAY)
}

function pickLocation(location) {
  draft.value.location = location
  activeField.value = ''
}

function pickEquipment(option) {
  draft.value.tankName = option.name
  activeField.value = ''
  cancelEquipmentSearch()
}

/** 容器名称边打边查（useEquipmentLedger 自带 300ms 防抖 + 过期响应丢弃） */
function onTankNameInput() {
  if (activeField.value !== 'equipment') activeField.value = 'equipment'
  fetchEquipmentSuggestions(String(draft.value.tankName ?? ''))
}

// ===== 新增行里先选好的照片 =====
// 记录还没保存就没有 id，而图据接口挂在 record id 上，所以照片只能先攥在手里，
// 等保存拿到新 id 后立刻传上去 —— 用户只点一次「保存」，不用「先存数据再补图」两步。
//
// 编辑已有行不走这条路：那种行本来就有 id，图据弹窗直接可用，不必等保存。
const pendingPhotos = ref([]) // uni.chooseImage 给的临时路径

// 水印画布（隐藏节点）：**尺寸固定**为 CANVAS_EDGE。
// 不能按图片尺寸动态改 —— uni-canvas 的像素尺寸在挂载时定死，改 style 只改盒子，
// 导出会得到"左上角一小块 + 大片白"（2026-10-20 实测）。详见 utils/photoWatermark。
const WATERMARK_CANVAS_ID = 'tlf-watermark'

/**
 * 拍照 / 从相册选。
 *
 * ⚠️ 一次只给一个 sourceType：两个都给的话，App / 小程序会先弹平台自带的
 *    「拍摄 / 从相册选择」ActionSheet（系统 UI，样式改不了，各机型还不一样），
 *    所以摆成两个入口，各自带单一来源（同图据弹层、图片解析页的做法）。
 *
 * <p>走 utils/chooseImages：「相册」这一支在 App 端去起手机自带的相册（见该文件），
 * 拍照与 H5 / 小程序原样走框架。
 *
 * <p>**只有「拍照」加水印**（2026-10-20 使用方要求）：现场取证要能自证"何时何地"。
 * 相册里的旧图不加 —— 那张照片不是此刻拍的，盖一个当前时间反而在伪造证据。
 */
async function pickPhotos(source) {
  chooseImages({
    count: 3,
    sizeType: ['original', 'compressed'],
    sourceType: [source],
    success: async (res) => {
      const paths = res.tempFilePaths || []
      if (!paths.length) return

      const finalPaths = source === 'camera'
        ? await Promise.all(paths.map((path) => stampOne(path)))
        : paths

      // 按路径去重：同一个临时路径进来两次，网格的 :key 会撞车（相册里连点两下就会）
      const merged = [...pendingPhotos.value, ...finalPaths]
      pendingPhotos.value = merged.filter((path, i) => merged.indexOf(path) === i)
    },
  })
}

/** 给一张刚拍的照片盖章；失败自动退回原图（见 utils/photoWatermark 的取舍） */
function stampOne(path) {
  return watermarkPhoto({
    path,
    lines: buildStampLines({
      time: dayjs().format('YYYY-MM-DD HH:mm'),
      location: draft.value.location,
      tankName: draft.value.tankName,
    }),
    canvasId: WATERMARK_CANVAS_ID,
    instance: getCurrentInstance()?.proxy,
  })
}

/** 网格里勾了一批点「移除」：事件带回的是选中的临时路径 */
function removePhotos(paths) {
  const removing = new Set(paths)
  pendingPhotos.value = pendingPhotos.value.filter((path) => !removing.has(path))
}

function clearPendingPhotos() {
  pendingPhotos.value = []
}

/** 草稿按「要编辑的那条记录」重建：每次打开都重来一份，不复用上一次的输入 */
function syncDraft() {
  draft.value = buildTankLevelDraft(props.record)
  clearPendingPhotos()
  clearTimeout(blurTimer)
  activeField.value = ''
  cancelEquipmentSearch()
  // 每次打开都重取候选：刚录过的属地/容器名称要能立刻出现在下一次的候选里
  fetchTankLevelSuggestions()
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
      activeField.value = ''
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

/**
 * 保存一次；碰到「同一天同一容器已存在」先问一句，用户点了「仍要保存」再重提。
 *
 * <p>为什么把确认放在这里而不是各调用点：确认的是**这次保存**，与表单状态无关，
 * 放调用点会让"取消后要不要关弹层"散成两处判断。返回 null 表示用户主动取消。
 *
 * <p>为什么不是前端先查当天列表自己拦：同一天同一容器的判定要"去空白后比对名称"，
 * 那是一份规则；而规则一旦两端各写一份就会漂移（本项目在物料匹配上已经吃过一次）。
 * 所以判定只在后端（TankLevelRecordServiceImpl.requireNoSameDayTank），
 * 前端只负责"看到 409 就问一句"（2026-10-20，变更-127）。
 */
async function saveWithDuplicateConfirm() {
  try {
    return await saveTankLevelRecord(draft.value)
  } catch (error) {
    if (!error?.needsConfirm) throw error

    try {
      await message.confirm({
        title: '同一天已记过这台容器',
        msg: error.message,
        confirmButtonText: '仍要保存',
        cancelButtonText: '取消',
      })
    } catch {
      return null // 用户取消：本次不保存，也不算失败
    }

    return await saveTankLevelRecord(draft.value, { confirmDuplicate: true })
  }
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
    const saved = await saveWithDuplicateConfirm()
    // null = 用户在「同一天已记过这台容器」那里点了取消
    if (!saved) return
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

      <!-- 水印画布：不参与布局（挪到屏幕外），只给 canvasToTempFilePath 读像素。
           尺寸固定成 CANVAS_EDGE，导出时只取绘制区域（见 utils/photoWatermark）。 -->
      <canvas
        :canvas-id="WATERMARK_CANVAS_ID"
        :id="WATERMARK_CANVAS_ID"
        class="tlf__watermark"
        :style="`width:${CANVAS_EDGE}px;height:${CANVAS_EDGE}px;`"
      ></canvas>

      <view class="tlf__head">
        <text class="tlf__title">{{ title }}</text>
        <view class="tlf__close" @click="close">
          <wd-icon name="close" size="18px" />
        </view>
      </view>

      <!-- ===== 表单 / 只读详情 ===== -->
      <scroll-view class="tlf__body" scroll-y>
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
            <!-- variant="inline"：表单里不要胶囊，和下面几行的值一样右对齐 -->
            <DateField v-model="draft.recordDate" variant="inline" placeholder="请选择记录日期" />
          </view>

          <!-- 属地：可填可选。聚焦即列全部、打字即收窄（2026-10-20 取消「选择」按钮） -->
          <view class="tlf__field-wrap">
            <view class="tlf__field">
              <text class="tlf__label">属地</text>
              <input
                v-model="draft.location"
                class="tlf__input"
                type="text"
                placeholder="如：4#"
                placeholder-class="ui-placeholder"
                @focus="showSuggestions('location')"
                @blur="hideSuggestionsSoon"
              />
            </view>

            <view v-if="activeField === 'location' && locationSuggestions.length" class="tlf__suggest">
              <view
                v-for="item in locationSuggestions"
                :key="item"
                class="tlf__suggest-item"
                @click="pickLocation(item)"
              >
                <text>{{ item }}</text>
                <text v-if="item === draft.location" class="tlf__suggest-flag">当前</text>
              </view>
              <text class="tlf__suggest-hint">列表里没有的属地，直接打在框里即可。</text>
            </view>
          </view>

          <!-- 容器名称：候选来自设备台账（聚焦列全部、打字收窄），也能直接手打 ——
               台账里没有的设备照样要录得进去，所以不做成「只能选」 -->
          <view class="tlf__field-wrap">
            <view class="tlf__field">
              <text class="tlf__label">容器名称</text>
              <input
                v-model="draft.tankName"
                class="tlf__input"
                type="text"
                placeholder="请填写容器名称"
                placeholder-class="ui-placeholder"
                @focus="showSuggestions('equipment')"
                @blur="hideSuggestionsSoon"
                @input="onTankNameInput"
              />
            </view>

            <view
              v-if="activeField === 'equipment' && (equipmentSuggestions.length || equipmentSearching || equipmentMoreHint)"
              class="tlf__suggest"
            >
              <text v-if="equipmentSearching && !equipmentSuggestions.length" class="tlf__suggest-empty">
                正在读取设备台账…
              </text>
              <view
                v-for="item in equipmentSuggestions"
                :key="item.name"
                class="tlf__suggest-item"
                @click="pickEquipment(item)"
              >
                <view class="tlf__suggest-main">
                  <text class="tlf__suggest-text">{{ item.name }}</text>
                  <text v-if="item.spec" class="tlf__suggest-sub">{{ item.spec }}</text>
                </view>
              </view>
              <text v-if="equipmentMoreHint" class="tlf__suggest-hint">{{ equipmentMoreHint }}</text>
              <text v-else-if="!equipmentSearching && !equipmentSuggestions.length" class="tlf__suggest-empty">
                没有匹配的设备，可直接手打名称。
              </text>
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
              <PhotoGrid
                :items="pendingPhotos"
                delete-text="移除"
                @delete-selected="removePhotos"
              />
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

      <view class="tlf__footer">
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

  /* 水印画布：挪出可视区但不 display:none —— 隐藏的 canvas 在部分平台导不出像素 */
  &__watermark {
    position: fixed;
    top: -10000px;
    left: -10000px;
  }

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
    font-size: 34rpx;
    font-weight: 600;
    letter-spacing: 0.01em;
  }

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

  &__body {
    // scroll-view 必须有确定高度才会滚动；键盘弹起时靠 flex 把剩余空间吃掉
    min-height: 0;
    flex-grow: 1;
    overscroll-behavior: contain;
    // uni 的 uni-scroll-view 自带 width: 100%，而 100% 不扣边框，会平白溢出 2px
    width: auto;
    border-top: 1px solid $ui-hairline;
    padding: 8rpx 32rpx 16rpx;
  }

  // 带候选的字段：整块（字段行 + 候选）共用一条底分隔线，
  // 免得候选铺开后在中间多出一条横线
  &__field-wrap {
    border-bottom: 1px solid $ui-hairline;

    .tlf__field {
      border-bottom: 0;
    }
  }

  &__suggest {
    margin: 0 0 14rpx;
    overflow: hidden;
    border: 1px solid $ui-border;
    border-radius: $ui-radius-md;
    background-color: $ui-surface-2;
  }

  &__suggest-item {
    display: flex;
    min-height: 76rpx;
    align-items: center;
    justify-content: space-between;
    gap: 16rpx;
    padding: 14rpx 20rpx;
    color: $ui-text;
    font-size: 27rpx;

    & + & {
      border-top: 1px solid $ui-hairline;
    }

    &:active {
      background-color: $ui-surface-3;
    }
  }

  &__suggest-main {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 4rpx;
  }

  &__suggest-text {
    font-size: 27rpx;
  }

  &__suggest-sub {
    color: $ui-text-3;
    font-size: 22rpx;
  }

  &__suggest-flag {
    flex-shrink: 0;
    color: $ui-accent-text;
    font-size: 22rpx;
  }

  &__suggest-hint,
  &__suggest-empty {
    display: block;
    padding: 14rpx 20rpx;
    color: $ui-text-3;
    font-size: 22rpx;
    line-height: 1.5;
  }

  &__field {
    display: flex;
    min-height: 96rpx;
    align-items: center;
    gap: 16rpx;
    border-bottom: 1px solid $ui-hairline;
  }

  &__label {
    flex-shrink: 0;
    color: $ui-text-2;
    font-size: 28rpx;
    // 500 而不是 400：底膜抬亮之后正文与标签的灰度差变小了，
    // 靠字重把"这是字段名"重新立起来（深色下 400 会糊成一片）
    font-weight: 500;
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

  // 网格样式全在 PhotoGrid 里，这里只留外边距
  &__thumbs {
    padding: 16rpx 0 4rpx;
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
