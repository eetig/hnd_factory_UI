<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { authState, isAdmin } from '../../api/auth'
import request from '../../api/request'
import { uploadFile } from '../../api/upload'
import { useTheme } from '../../composables/useTheme'

/*
 * 手机抄表（2026-11-03）。
 *
 * 使用方原话：「手机抄表想做成卡片式的，手动填写好了后（而且能保存图片），
 * 左滑或者右滑，保存提交，然后当前卡片消失，弹出下一个卡片记录」
 *
 * 七条口径（逐条对齐过）：
 *  ① 右滑 = 提交 · 左滑 = 跳过（跳过只在本机计数，不写库 —— 写"未抄"会污染数据）
 *  ② **按表内编号顺序** 1~37 —— 使用方：「现场的表是按这个编号排列的，我去抄表就是顺序读表」
 *  ③ 已填过的卡仍会出现，但顶部标「已填」，可以直接改
 *  ④ 照片可选（有些表在柜里拍不了，不强求）
 *  ⑤ 滑走**立刻保存**，成功才消失；失败留在卡上并提示
 *  ⑥ 顶部「已填 N/M」，点开能回到任意一张改
 *  ⑦ 读数比上次小 / 大很多 ⇒ 卡边变琥珀 + 一行提示，但仍允许提交（换表是真实情况）
 *  ⑧ 只有管理员用（使用方：「只有我抄表」）
 *
 * 视觉沿用 App 那套：暖纸 + 克制色块 + --ui-* token。
 */
const { themeClass, themeVars } = useTheme()

/**
 * 能否抄表（2026-11-04）：管理员，或被管理员授予「抄表员（meter_clerk）」的人。
 * 使用方：「只有我或者我同意的人才能录入电量」。
 * 前端只做入口显隐，真正的判定在后端 /api/electricity/readings/batch。
 */
const canReadMeter = computed(() => isAdmin() || authState.roleKey === 'meter_clerk')

const allowed = computed(() => isAdmin())

const loading = ref(false)
const saving = ref(false)
const errorMessage = ref('')

/** 当天日期（抄表日期就是今天；要补录旧日期去 PC） */
function today() {
  const d = new Date()
  const p = (n) => (n < 10 ? '0' + n : String(n))
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

const readDate = ref(today())
const rows = ref([]) // 抄表板原始数据（每块表一行）
const index = ref(0) // 当前卡片
const skipped = ref([]) // 跳过的 meterId
const draft = reactive({ reading: '', photo: '', note: '' })
const showList = ref(false)

/** 排序：表内编号升序；没有编号的（150车间）排最后 */
function numberRank(row) {
  const n = Number(row.excelNo)
  return Number.isFinite(n) && row.excelNo !== '' ? n : 999
}

const cards = computed(() =>
  [...rows.value].sort((a, b) => {
    const diff = numberRank(a) - numberRank(b)
    if (diff !== 0) return diff
    return (a.meterNo || 0) - (b.meterNo || 0)
  }),
)

const card = computed(() => cards.value[index.value] || null)
const filledCount = computed(() => cards.value.filter((c) => c.reading !== null && c.reading !== undefined).length)
const total = computed(() => cards.value.length)

/** 用量预览：(本次 − 上次) × 倍率 */
const previewUsage = computed(() => {
  if (!card.value || draft.reading === '') return null
  const current = Number(draft.reading)
  if (!Number.isFinite(current)) return null
  if (card.value.prevReading === null || card.value.prevReading === undefined) return null
  return (current - Number(card.value.prevReading)) * Number(card.value.multiplier || 1)
})

/** 异常：负数（换表）或比上次大 5 倍以上（疑似抄错） */
const anomaly = computed(() => {
  if (previewUsage.value === null) return ''
  if (previewUsage.value < 0) return '比上次读数小 —— 换表还是抄错了？'
  const prev = Number(card.value.prevReading)
  if (prev > 0 && previewUsage.value > prev * 5) return '用量是上次的 5 倍以上 —— 确认一下'
  return ''
})

function loadCard(row) {
  draft.reading = row.reading === null || row.reading === undefined ? '' : String(row.reading)
  draft.photo = row.imagePath || ''
  draft.note = ''
}

async function loadSheet() {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await request.get('/api/electricity/sheet', { params: { date: readDate.value } })
    rows.value = res.data?.data || []
    // 默认停在第一张还没填的卡上
    const firstUnfilled = cards.value.findIndex((c) => c.reading === null || c.reading === undefined)
    index.value = firstUnfilled === -1 ? 0 : firstUnfilled
    if (card.value) loadCard(card.value)
  } catch (e) {
    rows.value = []
    errorMessage.value = e?.data?.msg || e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

function goTo(next) {
  if (next < 0 || next >= cards.value.length) return
  index.value = next
  if (card.value) loadCard(card.value)
}

/* ===== 拍照（可选）===== */
async function takePhoto() {
  if (!card.value) return
  try {
    const chosen = await new Promise((resolve, reject) => {
      uni.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['camera', 'album'],
        success: resolve,
        fail: reject,
      })
    })
    const filePath = chosen?.tempFilePaths?.[0]
    if (!filePath) return
    uni.showLoading({ title: '上传中…' })
    const res = await uploadFile({ url: '/api/electricity/photo', filePath, name: 'file' })
    const body = res?.data || {}
    if (body.success === false) throw new Error(body.msg || '上传失败')
    draft.photo = body.data?.path || ''
    uni.hideLoading()
    uni.showToast({ title: '照片已保存', icon: 'none' })
  } catch (e) {
    uni.hideLoading()
    if (e?.errMsg && /cancel/.test(e.errMsg)) return // 用户取消，不提示
    uni.showToast({ title: e?.message || '拍照失败', icon: 'none' })
  }
}

/* ===== 提交 ===== */
async function submit(direction) {
  if (!card.value || saving.value) return
  const reading = draft.reading === '' ? null : Number(draft.reading)
  if (reading !== null && !Number.isFinite(reading)) {
    uni.showToast({ title: '读数不是数字', icon: 'none' })
    return
  }
  // 没填数又没有照片 ⇒ 当作"跳过"，不写库
  if (reading === null) {
    if (draft.photo) {
      uni.showToast({ title: '请填读数（照片不能代替读数）', icon: 'none' })
      return
    }
    skipped.value = [...skipped.value, card.value.meterId]
    fly(direction, () => goTo(index.value + 1))
    return
  }

  saving.value = true
  try {
    const res = await request.post('/api/electricity/readings/batch', {
      date: readDate.value,
      items: [
        {
          meterId: card.value.meterId,
          reading,
          imagePath: draft.photo,
          note: draft.note,
        },
      ],
    })
    const body = res?.data || {}
    if (body.success === false) throw new Error(body.msg || '保存失败')
    const warnings = body.data?.warnings || []
    fly(direction, () => {
      // 本地先把这张标为已填，顶部计数立刻对
      card.value.reading = reading
      card.value.imagePath = draft.photo
      skipped.value = skipped.value.filter((id) => id !== card.value.meterId)
      goTo(index.value + 1)
      if (warnings.length) uni.showToast({ title: warnings[0], icon: 'none', duration: 2500 })
    })
  } catch (e) {
    uni.showToast({ title: e?.data?.msg || e?.message || '保存失败', icon: 'none' })
  } finally {
    saving.value = false
  }
}

/* ===== 手势 ===== */
const gesture = reactive({ dragging: false, startX: 0, startY: 0, dx: 0, dy: 0, decided: false, flying: false })

const SWIPE_MIN = 96 // 位移阈值（px）
const FLING_V = 0.35 // 速度阈值（px/ms）

const cardStyle = computed(() => {
  if (gesture.flying) return { transition: 'transform 240ms ease, opacity 240ms ease' }
  if (!gesture.dragging) return { transition: 'transform 180ms ease' }
  return { transition: 'none' }
})

function fly(direction, after) {
  gesture.flying = true
  gesture.dx = direction === 'right' ? 420 : -420
  setTimeout(() => {
    gesture.flying = false
    gesture.dragging = false
    gesture.dx = 0
    if (after) after()
  }, 240)
}

function onTouchStart(e) {
  if (gesture.flying) return
  const t = e.touches[0]
  // 左缘 24px 不接管：那里是系统"返回"手势区
  gesture.startX = t.clientX
  gesture.startY = t.clientY
  gesture.dragging = t.clientX > 24
  gesture.decided = false
  gesture.dx = 0
  gesture.dy = 0
}

function onTouchMove(e) {
  if (!gesture.dragging || gesture.flying) return
  const t = e.touches[0]
  const dx = t.clientX - gesture.startX
  const dy = t.clientY - gesture.startY
  if (!gesture.decided) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
    // 竖向多于横向 ⇒ 判定为滚动，不再动卡片
    if (Math.abs(dy) > Math.abs(dx)) {
      gesture.dragging = false
      return
    }
    gesture.decided = true
  }
  gesture.dx = dx
  gesture.dy = dy
}

let touchStartedAt = 0
function onTouchEnd() {
  if (!gesture.dragging || gesture.flying) return
  const dx = gesture.dx
  const velocity = Math.abs(dx) / Math.max(1, Date.now() - touchStartedAt || 1)
  gesture.dragging = false

  if (dx > SWIPE_MIN || (dx > 40 && velocity > FLING_V)) {
    submit('right')
    return
  }
  if (dx < -SWIPE_MIN) {
    // 左滑 = 跳过：只在本机记，不写库
    skipped.value = [...skipped.value, card.value?.meterId].filter(Boolean)
    fly('left', () => goTo(index.value + 1))
    return
  }
  gesture.dx = 0
}

/* ===== 提交进度提示 ===== */
function finishHint() {
  if (skipped.value.length) {
    uni.showToast({ title: `还有 ${skipped.value.length} 块没抄`, icon: 'none' })
  } else {
    uni.showToast({ title: '今天的表都抄完了', icon: 'none' })
  }
}

onMounted(() => {
  if (!allowed.value) {
    uni.showToast({ title: '需要抄表权限', icon: 'none' })
    setTimeout(() => uni.reLaunch({ url: '/pages/index/index' }), 900)
    return
  }
  loadSheet()
})
</script>

<template>
  <view class="mr" :class="themeClass" :style="themeVars">
    <view v-if="!allowed" class="mr__deny">
      <text class="mr__deny-title">需要抄表权限（找管理员授权）</text>
    </view>

    <template v-else>
      <!-- 顶部：进度 + 已填 + 列表入口 -->
      <view class="mr__head">
        <view class="mr__progress">
          <text class="mr__progress-text">
            {{ index + 1 }} / {{ total }}
          </text>
          <text v-if="card" class="mr__section">{{ card.section || '未分组' }}</text>
        </view>
        <view class="mr__head-right">
          <text class="mr__filled" @click="showList = true">已填 {{ filledCount }}</text>
          <text v-if="skipped.length" class="mr__skipped">跳过 {{ skipped.length }}</text>
        </view>
      </view>

      <text v-if="errorMessage" class="mr__error">{{ errorMessage }}</text>

      <!-- 卡片 -->
      <view v-if="card" class="mr__stage">
        <view
          class="mr__card"
          :class="{ 'is-anomaly': anomaly }"
          :style="[cardStyle, { transform: `translate3d(${gesture.dx}px, 0, 0)` }]"
          @touchstart.stop="onTouchStart"
          @touchmove.stop="onTouchMove"
          @touchend.stop="onTouchEnd"
          @touchcancel.stop="onTouchEnd"
        >
          <view class="mr__card-head">
            <text class="mr__no">{{ card.excelNo || '—' }}</text>
            <text class="mr__name">{{ card.meterName }}</text>
            <text v-if="card.multiplier > 1" class="mr__mult">×{{ card.multiplier }}</text>
            <text v-if="card.reading !== null && card.reading !== undefined" class="mr__done">已填</text>
          </view>

          <text class="mr__meta">
            {{ card.meterCode || '无柜号' }} · 上次 {{ card.prevReading ?? '—' }}
            <text v-if="card.prevDate">（{{ String(card.prevDate).slice(5) }}）</text>
          </text>

          <view class="mr__input-row">
            <input
              v-model="draft.reading"
              class="mr__input"
              type="digit"
              placeholder="填本次读数"
              placeholder-class="mr__placeholder"
              :focus="false"
            />
            <text class="mr__unit">kWh</text>
          </view>

          <view class="mr__usage-row">
            <text class="mr__usage-label">用量</text>
            <text
              class="mr__usage"
              :class="previewUsage === null ? '' : previewUsage < 0 ? 'is-bad' : 'is-ok'"
            >
              {{ previewUsage === null ? '（填了读数才算）' : (previewUsage > 0 ? '+' : '') + previewUsage }}
            </text>
          </view>

          <text v-if="anomaly" class="mr__anomaly">{{ anomaly }}</text>

          <!-- 照片 -->
          <view class="mr__photo-row">
            <view v-if="draft.photo" class="mr__photo">
              <image :src="draft.photo" mode="aspectFill" class="mr__photo-img" />
              <text class="mr__photo-remove" @click.stop="draft.photo = ''">×</text>
            </view>
            <text v-else class="mr__photo-add" @click.stop="takePhoto">📷 拍表存证（可选）</text>
          </view>
        </view>

        <!-- 滑动手势提示 -->
        <view class="mr__hints">
          <text class="mr__hint mr__hint--left">← 左滑跳过</text>
          <text class="mr__hint mr__hint--right">右滑提交 →</text>
        </view>
      </view>

      <!-- 抄完了 -->
      <view v-else class="mr__done-all">
        <text class="mr__done-title">今天的表都看完了</text>
        <text class="mr__done-text" @click="finishHint">
          已填 {{ filledCount }} / {{ total }}
          <text v-if="skipped.length">· 跳过 {{ skipped.length }}</text>
        </text>
        <text class="mr__done-btn" @click="loadSheet">刷新</text>
      </view>

      <!-- 已填列表（点一张回到那张改） -->
      <view v-if="showList" class="mr__sheet" @click.self="showList = false">
        <view class="mr__sheet-body">
          <view class="mr__sheet-head">
            <text class="mr__sheet-title">全部 {{ total }} 块表</text>
            <text class="mr__sheet-close" @click="showList = false">关闭</text>
          </view>
          <scroll-view class="mr__sheet-list" scroll-y>
            <view
              v-for="(item, i) in cards"
              :key="item.meterId"
              class="mr__sheet-item"
              :class="{ 'is-filled': item.reading !== null && item.reading !== undefined }"
              @click="showList = false; goTo(i)"
            >
              <text class="mr__sheet-no">{{ item.excelNo || '—' }}</text>
              <text class="mr__sheet-name">{{ item.meterName }}</text>
              <text class="mr__sheet-val">
                {{ item.reading ?? '未填' }}
              </text>
            </view>
          </scroll-view>
        </view>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.mr {
  /* 弥散背景（2026-11-04）：与电费页同一套配方，让两个新页面看起来是一家的 */
  background-color: var(--ui-scene-bg);
  background-image:
    radial-gradient(circle at 88% -6%, var(--ui-scene-blob-1) 0%, transparent 58%),
    radial-gradient(circle at 6% 12%, var(--ui-scene-blob-2) 0%, transparent 52%),
    radial-gradient(circle at 92% 62%, var(--ui-scene-blob-3) 0%, transparent 56%);
  background-repeat: no-repeat;
  background-attachment: scroll;
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 16rpx 24rpx 0;
  box-sizing: border-box;
}

.mr__deny {
  margin-top: 160rpx;
  padding: 48rpx 32rpx;
  border-radius: 24rpx;
  background-color: var(--ui-surface);
  text-align: center;
}

.mr__deny-title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--ui-text);
}

/* 顶部 */
.mr__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8rpx 4rpx 16rpx;
}

.mr__progress {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
}

.mr__progress-text {
  font-size: 34rpx;
  font-weight: 700;
  color: var(--ui-text);
  font-variant-numeric: tabular-nums;
}

.mr__section {
  font-size: 24rpx;
  color: var(--ui-text-3);
}

.mr__head-right {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.mr__filled,
.mr__skipped {
  font-size: 24rpx;
  color: var(--ui-text-2);
  text-decoration: underline;
}

.mr__skipped {
  color: #9a4a1e;
}

.mr__error {
  margin-bottom: 12rpx;
  padding: 16rpx 20rpx;
  border-radius: 14rpx;
  background-color: rgba(180, 83, 9, 0.1);
  font-size: 24rpx;
  color: #9a4a1e;
}

/* 卡片 */
.mr__stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  /* 2026-11-04：卡片按内容收紧后下方会空一块，垂直居中让空白看起来是有意的留白 */
  justify-content: center;
}

.mr__card {
  /*
   * 2026-11-04：原来 flex:1 会把卡片拉到整屏高，内容只有两三行 ⇒ 一大片白，很单调。
   * 改成按内容高度、最多占 62% 高：卡片自己收紧，弥散背景露出来。
   */
  flex: 0 0 auto;
  max-height: 62vh;
  padding: 28rpx;
  border-radius: 28rpx;
  border: 2rpx solid var(--ui-border);
  background-color: var(--ui-surface);
  box-shadow: 0 8rpx 30rpx rgba(90, 70, 40, 0.06);
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}

/* 卡片入场（2026-11-04）：轻微上浮淡入，换表时不会啪地跳 */
@keyframes mr-rise {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.99);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.mr__card {
  animation: mr-rise 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@media (prefers-reduced-motion: reduce) {
  .mr__card {
    animation: none;
  }
}

.mr__card.is-anomaly {
  border-color: rgba(180, 83, 9, 0.55);
}

.mr__card-head {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
}

.mr__no {
  min-width: 56rpx;
  padding: 2rpx 12rpx;
  border-radius: 8rpx;
  background-color: var(--ui-surface-2);
  font-size: 24rpx;
  font-weight: 700;
  color: var(--ui-text-2);
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.mr__name {
  flex: 1;
  font-size: 34rpx;
  font-weight: 700;
  line-height: 1.35;
  color: var(--ui-text);
}

.mr__mult {
  font-size: 24rpx;
  font-weight: 700;
  color: #9a4a1e;
}

.mr__done {
  font-size: 20rpx;
  padding: 2rpx 10rpx;
  border-radius: 999rpx;
  background-color: rgba(91, 110, 79, 0.16);
  color: #4c5f42;
}

.mr__meta {
  font-size: 24rpx;
  color: var(--ui-text-3);
}

.mr__input-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-top: 8rpx;
  padding: 0 24rpx;
  height: 112rpx;
  border-radius: 20rpx;
  background-color: var(--ui-surface-2);
}

.mr__input {
  flex: 1;
  font-size: 44rpx;
  font-weight: 700;
  color: var(--ui-text);
  font-variant-numeric: tabular-nums;
}

.mr__placeholder {
  font-size: 30rpx;
  font-weight: 400;
  color: var(--ui-text-3);
}

.mr__unit {
  font-size: 24rpx;
  color: var(--ui-text-3);
}

.mr__usage-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.mr__usage-label {
  font-size: 24rpx;
  color: var(--ui-text-3);
}

.mr__usage {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--ui-text-3);
  font-variant-numeric: tabular-nums;

  &.is-ok {
    color: #4c5f42;
  }

  &.is-bad {
    color: #9a4a1e;
  }
}

.mr__anomaly {
  padding: 10rpx 16rpx;
  border-radius: 12rpx;
  background-color: rgba(180, 83, 9, 0.12);
  font-size: 22rpx;
  color: #9a4a1e;
}

.mr__photo-row {
  margin-top: auto;
}

.mr__photo {
  position: relative;
  width: 180rpx;
  height: 180rpx;
}

.mr__photo-img {
  width: 180rpx;
  height: 180rpx;
  border-radius: 16rpx;
  border: 2rpx solid var(--ui-border);
}

.mr__photo-remove {
  position: absolute;
  top: -10rpx;
  right: -10rpx;
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  background-color: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 26rpx;
  line-height: 40rpx;
  text-align: center;
}

.mr__photo-add {
  display: inline-block;
  padding: 18rpx 24rpx;
  border-radius: 16rpx;
  border: 2rpx dashed var(--ui-border);
  font-size: 26rpx;
  color: var(--ui-text-2);
}

.mr__hints {
  display: flex;
  justify-content: space-between;
  padding: 18rpx 8rpx;
}

.mr__hint {
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.mr__done-all {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
}

.mr__done-title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--ui-text);
}

.mr__done-text {
  font-size: 26rpx;
  color: var(--ui-text-2);
}

.mr__done-btn {
  margin-top: 16rpx;
  padding: 14rpx 32rpx;
  border-radius: 999rpx;
  border: 2rpx solid var(--ui-border);
  font-size: 26rpx;
  color: var(--ui-text);
}

/* 列表弹层 */
.mr__sheet {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: flex-end;
  background-color: rgba(0, 0, 0, 0.28);
}

.mr__sheet-body {
  width: 100%;
  max-height: 72vh;
  display: flex;
  flex-direction: column;
  border-radius: 28rpx 28rpx 0 0;
  background-color: var(--ui-surface);
}

.mr__sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 28rpx 12rpx;
}

.mr__sheet-title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--ui-text);
}

.mr__sheet-close {
  font-size: 24rpx;
  color: var(--ui-text-3);
}

.mr__sheet-list {
  flex: 1;
  min-height: 0;
  padding: 0 20rpx 40rpx;
}

.mr__sheet-item {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 20rpx 16rpx;
  border-radius: 14rpx;
  border-bottom: 2rpx solid var(--ui-hairline);
}

.mr__sheet-no {
  min-width: 48rpx;
  font-size: 22rpx;
  color: var(--ui-text-3);
  font-variant-numeric: tabular-nums;
}

.mr__sheet-name {
  flex: 1;
  font-size: 26rpx;
  color: var(--ui-text);
}

.mr__sheet-val {
  font-size: 24rpx;
  color: var(--ui-text-3);
  font-variant-numeric: tabular-nums;
}

.mr__sheet-item.is-filled .mr__sheet-val {
  color: #4c5f42;
  font-weight: 600;
}
</style>
