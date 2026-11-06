<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { authState, isAdmin } from '../../api/auth'
import request from '../../api/request'
import { uploadFile } from '../../api/upload'
import { resolveAssetUrl } from '../../api/config'
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

/*
 * 车间身份色（2026-11-05，使用方：「卡片设计的颜色太单调」）
 *
 * 与 PC 端「各区域用电占比」那张饼图同一套，含义一致：同一个车间在任何页面都是同一个颜色。
 * 只用在"身份标记"上（左缘色条、编号徽标、进度条），卡片主体仍是白面 ——
 * 读数是要被盯着看的数字，底色一花就读不准了。
 */
const SECTION_COLORS = {
  公用工程: '#4A5A7B',
  一车间: '#B45309',
  二车间: '#5B6E4F',
  乙炔车间: '#8A5A2B',
  中央控制室: '#7A4B5E',
  污水区: '#5B6470',
  办公楼: '#8A6A1F',
  不参与计算: '#8C8C8C',
  总表: '#3F6E6A',
  变压器: '#7A6A4F',
}

/** 当前卡片的车间色 */
const sectionColor = computed(() => SECTION_COLORS[card.value?.section] || '#8C8C8C')

/** 把 #RRGGBB 变成 rgba(...)，用于极淡底色（不引第三方库，两行就够） */
function tint(hex, alpha) {
  const h = String(hex || '').replace('#', '')
  if (h.length !== 6) return 'transparent'
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')'
}

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

/*
 * 只看没抄的（2026-11-05）
 * 开关只影响"翻卡列表"，不影响统计（filledCount / total 永远按全量算），
 * 否则抄到最后会显示"已填 8/8"这种假象。
 */
const onlyUnfilled = ref(false)

/** 翻卡用的列表：打开开关后只留没填的（当前这张永远留在里面，避免"卡片凭空消失"） */
const list = computed(() => {
  if (!onlyUnfilled.value) return cards.value
  return cards.value.filter(
    (c) => c.reading === null || c.reading === undefined || c.meterId === card.value?.meterId,
  )
})

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

/** 在"翻卡列表"里前进/后退（筛选打开时跳过已填的） */
function step(delta) {
  if (!list.value.length) return
  const at = list.value.findIndex((c) => c.meterId === card.value?.meterId)
  const nextItem = list.value[Math.min(list.value.length - 1, Math.max(0, (at === -1 ? 0 : at) + delta))]
  if (!nextItem) return
  const realIndex = cards.value.findIndex((c) => c.meterId === nextItem.meterId)
  if (realIndex >= 0) goTo(realIndex)
}

/** 切换"只看没抄的"：切完把当前卡挪到列表里最近的没填那张 */
function toggleOnlyUnfilled() {
  onlyUnfilled.value = !onlyUnfilled.value
  if (!onlyUnfilled.value) return
  const firstUnfilled = cards.value.findIndex((c) => c.reading === null || c.reading === undefined)
  if (firstUnfilled >= 0) goTo(firstUnfilled)
}

/* ===== 拍照（可选）===== */

/**
 * 自绘的拍照选项（2026-11-06）。
 *
 * 使用方：「这个弹出的拍照选项有点丑」。原来弹的是 uni.chooseImage 自己的系统
 * ActionSheet —— 样式由系统决定，改不了。所以自己做一个底部抽屉，
 * 跟 App 里其它弹层用同一套视觉（圆角、拖拽条、safe-area）。
 */
const photoSheetOpen = ref(false)

function openPhotoSheet() {
  if (!card.value) return
  photoSheetOpen.value = true
}

function closePhotoSheet() {
  photoSheetOpen.value = false
}

/** 把刚拍的图存进系统相册（App/小程序；H5 无相册概念，跳过） */
async function saveToAlbum(filePath) {
  // #ifdef H5
  return
  // #endif
  try {
    await new Promise((resolve, reject) => {
      uni.saveImageToPhotosAlbum({ filePath, success: resolve, fail: reject })
    })
    uni.showToast({ title: '已存到相册', icon: 'none' })
  } catch (e) {
    const message = String(e?.errMsg || e?.message || '')
    // 用户拒绝相册权限：告诉他去开，不静默失败
    if (/auth|deny|denied|permission/i.test(message)) {
      uni.showModal({
        title: '需要相册权限',
        content: '要自动存到相册，请在系统设置里允许本应用访问照片。这次先只保存到资料里。',
        showCancel: false,
        confirmText: '知道了',
      })
      return
    }
    // 其它失败（如 H5/模拟器不支持）不打扰，图已经传到服务端了
  }
}

async function takePhoto(from) {
  if (!card.value) return
  photoSheetOpen.value = false
  try {
    const chosen = await new Promise((resolve, reject) => {
      uni.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: [from === 'album' ? 'album' : 'camera'],
        success: resolve,
        fail: reject,
      })
    })
    const filePath = chosen?.tempFilePaths?.[0]
    if (!filePath) return
    // 只把"刚拍的"存相册；从相册选的没必要再存一遍
    if (from !== 'album') saveToAlbum(filePath)
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

/**
 * 缩略图地址（2026-11-06）。
 *
 * 后端返回的是相对路径（/files/xxx.jpg），直接塞进 <image src> 在真机上没有 origin
 * ⇒ 一片空白（使用方：「拍好照后缩略图怎么是空白」）。
 * 复用项目里已有的 resolveAssetUrl（同单据图片那套），H5 与 App 都能拼对。
 */
const photoSrc = computed(() => resolveAssetUrl(draft.photo))

/** 看大图（2026-11-05）：现场对账时要看清表盘数字 */
function previewPhoto() {
  if (!draft.photo) return
  const current = resolveAssetUrl(draft.photo)
  const urls = [
    current,
    ...cards.value
      .map((c) => resolveAssetUrl(c.imagePath))
      .filter((p) => p && p !== current),
  ]
  uni.previewImage({ urls, current })
}

/* ===== 提交 ===== */
async function submit(direction) {
  if (!card.value || saving.value || gesture.flying) return
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
    fly(direction, () => step(1))
    return
  }

  /*
   * 乐观飞出（2026-11-06）：先让卡片飞出去，网络在飞的过程中跑。
   * 原来 fly() 写在 await 之后 ⇒ 松手后卡片停在原地等 300ms~3s，看着像"没反应"。
   */
  saving.value = true
  fly(direction, () => step(1))
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
    // 2026-11-05：轻震一下 —— 太阳底下、戴手套时，手感比屏幕可靠
    try {
      uni.vibrateShort({ type: 'light' })
    } catch {
      // 平板/浏览器不支持就算了，不影响保存
    }
    // 卡片已经在飞了，这里只补本地状态（顶部计数立刻对）
    if (card.value) {
      card.value.reading = reading
      card.value.imagePath = draft.photo
      skipped.value = skipped.value.filter((id) => id !== card.value.meterId)
    }
    if (warnings.length) uni.showToast({ title: warnings[0], icon: 'none', duration: 2500 })
  } catch (e) {
    /*
     * 失败了要把卡片飞回来（它已经在屏幕外），并且退回到原来的那张 ——
     * 不假装成功：数据没写进去，界面就不能显示"已填"。
     */
    restore()
    uni.showToast({ title: e?.data?.msg || e?.message || '保存失败', icon: 'none' })
  } finally {
    saving.value = false
  }
}

/* ===== 手势 ===== */
const gesture = reactive({
  dragging: false,
  startX: 0,
  startY: 0,
  dx: 0,
  dy: 0,
  decided: false,
  flying: false,
})

const SWIPE_MIN = 96 // 位移阈值（px）
const FLING_V = 0.35 // 速度阈值（px/ms）

/*
 * 卡片的位移样式（2026-11-05，使用方：「手势左右滑，要跟手，动画要丝滑」）
 *
 * 三种状态，三套缓动：
 *   拖动中   transition: none          → 手指到哪卡片到哪（跟手）
 *   飞出去   cubic-bezier(.22,1,.36,1)  → 先快后缓，像被甩出去
 *   弹回来   cubic-bezier(.34,1.56,.64,1) → 轻微过冲再停下，手感"有弹性"
 * 旋转和透明度跟着位移走，幅度很小（最多 6°、最多淡到 65%），不喧宾夺主。
 */
const FLY_MS = 280

/**
 * 拖动时的方向提示（2026-11-06）。
 * 位移过 24px 就浮出标签，透明度随进度上升 —— 松手前就知道会触发"提交"还是"跳过"。
 */
const intent = computed(() => {
  if (gesture.flying || !gesture.decided) return { kind: '', opacity: 0 }
  const offset = gesture.dx
  if (Math.abs(offset) < 24) return { kind: '', opacity: 0 }
  const progress = Math.min(1, Math.abs(offset) / 160)
  return { kind: offset > 0 ? '提交' : '跳过', opacity: 0.25 + progress * 0.75 }
})

const cardStyle = computed(() => {
  const dragging = gesture.dragging && gesture.decided && !gesture.flying
  const transition = dragging
    ? 'none'
    : gesture.flying
      ? `transform ${FLY_MS}ms cubic-bezier(.22,1,.36,1), opacity ${FLY_MS}ms ease`
      : 'transform 320ms cubic-bezier(.34,1.56,.64,1), opacity 220ms ease'
  const dx = gesture.dx
  const progress = Math.min(1, Math.abs(dx) / 380)
  /*
   * 方向感（2026-11-05）：阴影跟着位移走 —— 往右滑，阴影就往左拖，
   * 看起来像卡片被"推离"桌面；退出方向那一侧再加一层同色淡光晕。
   */
  const shadowX = -dx * 0.06
  const shadowBlur = 30 + progress * 26
  const glowColor = tint(sectionColor.value, 0.16 * progress)
  const shadow = dx === 0
    ? '0 8rpx 30rpx rgba(90, 70, 40, 0.06)'
    : `${shadowX.toFixed(1)}px 14rpx ${shadowBlur.toFixed(0)}rpx rgba(70, 60, 45, 0.12), ` +
      `${(dx > 0 ? 1 : -1) * 10}px 0 0 ${glowColor}`
  return {
    transition,
    transform: `translate3d(${dx}px, 0, 0) rotate(${(dx * 0.015).toFixed(2)}deg)`,
    opacity: dragging ? String(1 - progress * 0.35) : '1',
    boxShadow: shadow,
    // 顶部一层 12% 同色洗染：色条之外再加一点"这块表属于哪个车间"的暗示
    backgroundImage: `linear-gradient(180deg, ${tint(sectionColor.value, 0.12)} 0, rgba(255,255,255,0) 96rpx)`,
  }
})

/** 还剩几块没填（提交按钮上要显示） */
const remaining = computed(() => {
  const unfilled = cards.value.filter((c) => c.reading === null || c.reading === undefined).length
  return Math.max(0, unfilled - 0)
})

/** 立刻把当前这张提交（底部按钮） */
function doSubmit() {
  submit('right')
}

/** 立刻跳过（底部按钮） */
function doSkip() {
  if (!card.value || saving.value) return
  skipped.value = [...skipped.value, card.value.meterId]
  fly('left', () => step(1))
}

/**
 * 把已经飞出去的卡片收回来（失败时用，2026-11-06）。
 *
 * 用同一套缓动倒着走：从屏外飞回原位，再把 index 退一格（fly 的 after 已经 step 过去了）。
 * 顺序很重要：先 step 回到上一张 → 让它从屏外飞回来。
 */
function restore() {
  const back = Math.max(0, index.value - 1)
  index.value = back
  if (card.value) loadCard(card.value)
  gesture.flying = true
  gesture.dx = gesture.dx > 0 ? 520 : -520
  // 下一帧再归零，才有"飞回来"的过渡
  setTimeout(() => {
    gesture.dx = 0
    setTimeout(() => {
      gesture.flying = false
      gesture.decided = false
      gesture.dragging = false
    }, FLY_MS)
  }, 16)
}

function fly(direction, after) {
  gesture.flying = true
  gesture.dragging = false
  gesture.decided = true
  // 位移要够远，卡片才真正飞出屏幕；时长与 CSS 里的 FLY_MS 对齐
  const target = direction === 'right' ? 520 : -520
  gesture.dx = target
  setTimeout(() => {
    gesture.flying = false
    gesture.decided = false
    gesture.dragging = false
    gesture.dx = 0
    if (after) after()
  }, FLY_MS)
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
  touchStartedAt = Date.now()
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

/** 回到第一块"跳过"的（完成态里那个按钮） */
function backToSkipped() {
  if (!skipped.value.length) return
  const first = skipped.value[0]
  const at = cards.value.findIndex((c) => c.meterId === first)
  if (at >= 0) {
    goTo(at)
  } else {
    loadSheet()
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
          <text v-if="card" class="mr__section" :style="{ color: sectionColor }">
            {{ card.section || '未分组' }}
          </text>
        </view>
        <view class="mr__head-right">
          <text class="mr__filled" @click="showList = true">已填 {{ filledCount }}</text>
          <text v-if="skipped.length" class="mr__skipped">跳过 {{ skipped.length }}</text>
          <text
            class="mr__filter"
            :class="{ 'is-on': onlyUnfilled }"
            @click="toggleOnlyUnfilled"
          >{{ onlyUnfilled ? '只看没抄' : '全部' }}</text>
        </view>
      </view>

      <!--
        进度条单独一行（2026-11-05）
        第一次我把它塞进 .mr__progress 里，那是个 flex 行 ⇒ 把 "1 / 38" 和车间名挤成竖排 ✗
        现在它占自己一行，填充长度按 index/total，颜色跟当前车间
      -->
      <view class="mr__progress-bar">
        <view
          class="mr__progress-fill"
          :style="{ width: ((index + 1) / Math.max(1, total)) * 100 + '%', backgroundColor: sectionColor }"
        ></view>
      </view>

      <text v-if="errorMessage" class="mr__error">{{ errorMessage }}</text>

      <!-- 卡片 -->
      <view v-if="card" class="mr__stage">
        <view
          class="mr__card"
          :class="{ 'is-anomaly': anomaly }"
          :style="[cardStyle, { borderLeftColor: sectionColor }]"
          @touchstart.stop="onTouchStart"
          @touchmove.stop="onTouchMove"
          @touchend.stop="onTouchEnd"
          @touchcancel.stop="onTouchEnd"
        >
          <!-- 方向提示（2026-11-06）：拖动时浮出，松手前就知道会触发哪个 -->
          <view
            v-if="intent.kind === '提交'"
            class="mr__intent mr__intent--right"
            :style="{ opacity: intent.opacity }"
          >提交</view>
          <view
            v-if="intent.kind === '跳过'"
            class="mr__intent mr__intent--left"
            :style="{ opacity: intent.opacity }"
          >跳过</view>

          <view class="mr__card-head">
            <text
              class="mr__no"
              :style="{ backgroundColor: tint(sectionColor, 0.14), color: sectionColor }"
            >{{ card.excelNo || '—' }}</text>
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
              <image
                :src="photoSrc"
                mode="aspectFill"
                class="mr__photo-img"
                @click.stop="previewPhoto"
              />
              <text class="mr__photo-remove" @click.stop="draft.photo = ''">×</text>
            </view>
            <text v-else class="mr__photo-add" @click.stop="openPhotoSheet">📷 拍表存证（可选）</text>
          </view>
        </view>

        <!--
          底部动作条（2026-11-05）
          使用方：「左右滑的按钮太小了，而且间距太远，单手操作不方便」
          ⇒ 两个大按钮各占一半、贴底、拇指够得到；提示文案挪进按钮里
        -->
        <view class="mr__actions">
          <view class="mr__action mr__action--skip" hover-class="mr__action--pressed" @click="doSkip">
            <text class="mr__action-icon">←</text>
            <text class="mr__action-text">跳过</text>
          </view>
          <view class="mr__action mr__action--submit" hover-class="mr__action--pressed" @click="doSubmit">
            <text class="mr__action-text">提交</text>
            <text v-if="remaining" class="mr__action-sub">还剩 {{ remaining }}</text>
            <text class="mr__action-icon">→</text>
          </view>
        </view>
      </view>

      <!--
        抄完了（2026-11-05 重做）
        原来是三行小字 + 一个"刷新"，收工这一刻太轻。现在给一屏：
        进度环（已填比例）+ 两个数字 + 两个按钮（回到第一块没填的 / 重新拉数据）
      -->
      <view v-else class="mr__done-all">
        <view class="mr__done-ring" :style="{ background: `conic-gradient(${sectionColor} ${(filledCount / Math.max(1, total)) * 360}deg, rgba(20,22,28,0.08) 0deg)` }">
          <view class="mr__done-ring-inner">
            <text class="mr__done-pct">{{ Math.round((filledCount / Math.max(1, total)) * 100) }}%</text>
            <text class="mr__done-ring-label">已填</text>
          </view>
        </view>

        <text class="mr__done-title">今天的表都看完了</text>
        <view class="mr__done-stats">
          <view class="mr__done-stat">
            <text class="mr__done-stat-value">{{ filledCount }}</text>
            <text class="mr__done-stat-label">已填</text>
          </view>
          <view class="mr__done-stat">
            <text class="mr__done-stat-value">{{ total }}</text>
            <text class="mr__done-stat-label">总数</text>
          </view>
          <view class="mr__done-stat">
            <text class="mr__done-stat-value" :class="{ 'is-warn': skipped.length }">{{ skipped.length }}</text>
            <text class="mr__done-stat-label">跳过</text>
          </view>
        </view>

        <view v-if="skipped.length" class="mr__done-actions">
          <view class="mr__action mr__action--skip" hover-class="mr__action--pressed" @click="backToSkipped">
            <text class="mr__action-text">补抄 {{ skipped.length }} 块</text>
          </view>
          <view class="mr__action mr__action--submit" hover-class="mr__action--pressed" @click="loadSheet">
            <text class="mr__action-text">刷新</text>
          </view>
        </view>
        <view v-else class="mr__done-actions">
          <view class="mr__action mr__action--submit" hover-class="mr__action--pressed" @click="loadSheet">
            <text class="mr__action-text">刷新</text>
          </view>
        </view>
      </view>

      <!-- 已填列表（点一张回到那张改） -->
      <!--
        自绘拍照选项（2026-11-06）
        使用方嫌 uni.chooseImage 自带的系统 ActionSheet 丑 —— 那个样式改不了，
        所以自己画一个：底部抽屉 + 圆角 + 拖拽条 + 两个大按钮 + safe-area。
      -->
      <view v-if="photoSheetOpen" class="mr__ps" @click="closePhotoSheet">
        <view class="mr__ps-panel" @click.stop>
          <view class="mr__ps-grabber"></view>
          <text class="mr__ps-title">拍表存证</text>
          <text class="mr__ps-hint">拍照会自动存一份到手机相册，方便日后对账</text>

          <view class="mr__ps-action" hover-class="mr__ps-action--pressed" @click="takePhoto('camera')">
            <text class="mr__ps-icon">📷</text>
            <view class="mr__ps-body">
              <text class="mr__ps-label">拍摄</text>
              <text class="mr__ps-sub">调起相机，拍完自动存相册</text>
            </view>
            <text class="mr__ps-arrow">›</text>
          </view>

          <view class="mr__ps-action" hover-class="mr__ps-action--pressed" @click="takePhoto('album')">
            <text class="mr__ps-icon">🖼</text>
            <view class="mr__ps-body">
              <text class="mr__ps-label">从相册选择</text>
              <text class="mr__ps-sub">已经拍过的表，直接从相册挑</text>
            </view>
            <text class="mr__ps-arrow">›</text>
          </view>

          <view class="mr__ps-cancel" hover-class="mr__ps-action--pressed" @click="closePhotoSheet">取消</view>
        </view>
      </view>

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
  /* 左缘 8rpx 车间身份色（2026-11-05）：颜色靠这一条表达，卡片主体保持白面好读数 */
  border-left: 8rpx solid #8c8c8c;
  border-top: 2rpx solid var(--ui-border);
  border-right: 2rpx solid var(--ui-border);
  border-bottom: 2rpx solid var(--ui-border);
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

/* ===== 2026-11-05 新增：进度条 / 大按钮 / 身份色 ===== */

/* 顶部"全部 / 只看没抄"开关（2026-11-05） */
.mr__filter {
  margin-left: 16rpx;
  padding: 6rpx 16rpx;
  border-radius: 999rpx;
  font-size: 22rpx;
  color: var(--ui-text-2);
  background-color: var(--ui-raise-2);
  border: 2rpx solid var(--ui-border);
  white-space: nowrap;
}

.mr__filter.is-on {
  color: var(--ui-on-accent);
  background-color: var(--ui-accent);
  border-color: var(--ui-accent);
}

.mr__progress-text,
.mr__section,
.mr__filled,
.mr__skipped {
  white-space: nowrap;
}

.mr__progress-bar {
  margin: 12rpx 32rpx 0;
  width: 100%;
  height: 6rpx;
  border-radius: 999rpx;
  background-color: var(--ui-raise-2);
  overflow: hidden;
}

.mr__progress-fill {
  height: 100%;
  border-radius: 999rpx;
  transition: width 320ms cubic-bezier(0.22, 1, 0.36, 1), background-color 240ms ease;
}

/* 左下角原文案位置改成动作条：两个大按钮各占一半，拇指够得到 */
.mr__actions {
  display: flex;
  gap: 24rpx;
  margin-top: 28rpx;
}

.mr__action {
  flex: 1;
  height: 112rpx;
  border-radius: 28rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
  font-size: 32rpx;
  font-weight: 600;
}

.mr__action--pressed {
  opacity: 0.72;
  transform: scale(0.985);
}

.mr__action--skip {
  color: var(--ui-text-2);
  background-color: var(--ui-raise-2);
  border: 2rpx solid var(--ui-border);
}

.mr__action--submit {
  color: var(--ui-on-accent);
  background-color: var(--ui-accent);
  box-shadow: 0 10rpx 24rpx rgba(70, 90, 130, 0.18);
}

.mr__action-sub {
  margin-left: 8rpx;
  font-size: 22rpx;
  font-weight: 500;
  opacity: 0.8;
}

/* 完成态（2026-11-05） */
.mr__done-all {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24rpx;
  padding: 0 40rpx;
}

.mr__done-ring {
  width: 220rpx;
  height: 220rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mr__done-ring-inner {
  width: 168rpx;
  height: 168rpx;
  border-radius: 50%;
  background-color: var(--ui-surface);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.mr__done-pct {
  font-size: 44rpx;
  font-weight: 700;
  color: var(--ui-text);
  font-variant-numeric: tabular-nums;
}

.mr__done-ring-label {
  font-size: 20rpx;
  color: var(--ui-text-2);
}

.mr__done-stats {
  display: flex;
  gap: 56rpx;
  margin-top: 8rpx;
}

.mr__done-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4rpx;
}

.mr__done-stat-value {
  font-size: 40rpx;
  font-weight: 700;
  color: var(--ui-text);
  font-variant-numeric: tabular-nums;
}

.mr__done-stat-value.is-warn {
  color: #b45309;
}

.mr__done-stat-label {
  font-size: 20rpx;
  color: var(--ui-text-2);
}

.mr__done-actions {
  display: flex;
  gap: 24rpx;
  width: 100%;
  margin-top: 16rpx;
}

/* ===== 拍照选项抽屉（2026-11-06）===== */
.mr__ps {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 60;
  background-color: rgba(20, 18, 16, 0.42);
  display: flex;
  align-items: flex-end;
}

.mr__ps-panel {
  width: 100%;
  padding: 16rpx 28rpx calc(28rpx + env(safe-area-inset-bottom));
  border-radius: 32rpx 32rpx 0 0;
  background-color: var(--ui-surface);
  box-shadow: 0 -12rpx 40rpx rgba(60, 50, 40, 0.14);
  animation: mr-sheet-up 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes mr-sheet-up {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}

.mr__ps-grabber {
  width: 72rpx;
  height: 8rpx;
  margin: 4rpx auto 18rpx;
  border-radius: 8rpx;
  background-color: var(--ui-border-strong);
}

.mr__ps-title {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.mr__ps-hint {
  display: block;
  margin-top: 6rpx;
  margin-bottom: 20rpx;
  font-size: 22rpx;
  color: var(--ui-text-2);
}

.mr__ps-action {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 24rpx 22rpx;
  margin-bottom: 16rpx;
  border-radius: 22rpx;
  border: 2rpx solid var(--ui-border);
  background-color: var(--ui-raise-2);
}

.mr__ps-action--pressed {
  opacity: 0.75;
  transform: scale(0.99);
}

.mr__ps-icon {
  font-size: 38rpx;
}

.mr__ps-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.mr__ps-label {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.mr__ps-sub {
  font-size: 22rpx;
  color: var(--ui-text-2);
}

.mr__ps-arrow {
  font-size: 34rpx;
  color: var(--ui-text-3);
}

.mr__ps-cancel {
  height: 92rpx;
  line-height: 92rpx;
  text-align: center;
  border-radius: 22rpx;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ui-text-2);
  background-color: var(--ui-raise-2);
}

.mr__action-icon {
  font-size: 30rpx;
  opacity: 0.9;
}

.mr__action-text {
  letter-spacing: 2rpx;
}

/* 方向提示标签（2026-11-06）：满幅半透明色带 + 大字，隔着阳光也看得清 */
.mr__intent {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 46%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 44rpx;
  font-weight: 700;
  letter-spacing: 8rpx;
  color: #ffffff;
  pointer-events: none;
  border-radius: 22rpx;
}

.mr__intent--right {
  right: 0;
  background: linear-gradient(90deg, rgba(47, 106, 176, 0) 0%, rgba(47, 106, 176, 0.92) 72%);
  border-radius: 0 22rpx 22rpx 0;
}

.mr__intent--left {
  left: 0;
  background: linear-gradient(270deg, rgba(120, 120, 120, 0) 0%, rgba(110, 110, 110, 0.9) 72%);
  border-radius: 22rpx 0 0 22rpx;
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
  /*
   * 2026-11-06：只写 flex:1 + min-height:0 时，真机 App webview 里的 scroll-view 不会滚
   * （H5 上能滚，真机上不能 —— 使用方反馈"不能上下滑动、看不全"）。
   * scroll-view 必须有确定高度才建立滚动容器，所以这里给死 54vh。
   */
  height: 54vh;
  max-height: 54vh;
  padding: 0 20rpx calc(28rpx + env(safe-area-inset-bottom));
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
  /* 2026-11-06：读数被右侧裁掉（"1226.4895" 只看到 1226.4895 一半）⇒ 限宽 + 右对齐 + 省略 */
  flex: 0 0 auto;
  max-width: 44%;
  padding-right: 6rpx;
  font-size: 24rpx;
  color: var(--ui-text-3);
  font-variant-numeric: tabular-nums;
  text-align: right;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mr__sheet-item.is-filled .mr__sheet-val {
  color: #4c5f42;
  font-weight: 600;
}
</style>
