<script setup>
import { computed, getCurrentInstance, nextTick, onMounted, reactive, ref, watch } from 'vue'
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

/*
 * 键盘高度（2026-11-06）
 * 使用方：「弹出键盘后的布局这样比较舒服，我就不用向上划一下才能点击到提交或跳过」。
 * 做法：监听键盘高度 → 页面底部留出键盘高度 + 间隙，按钮就贴在键盘正上方；
 *      同时把照片与"5 倍"提示隐藏，卡片才有空间收缩（否则会挤成一条）。
 */
const keyboardHeight = ref(0)
const keyboardOpen = computed(() => keyboardHeight.value > 0)

/** 页面样式：键盘弹起时把内容整体抬到键盘上方（2026-11-06） */
const pageStyle = computed(() => ({
  ...(themeVars.value || {}),
  paddingBottom: keyboardOpen.value ? `${keyboardHeight.value}px` : '0px',
}))

function bindKeyboardWatcher() {
  if (typeof uni.onKeyboardHeightChange !== 'function') return
  uni.onKeyboardHeightChange((res) => {
    keyboardHeight.value = Math.max(0, Number(res?.height) || 0)
  })
}

function unbindKeyboardWatcher() {
  if (typeof uni.offKeyboardHeightChange === 'function') uni.offKeyboardHeightChange()
  keyboardHeight.value = 0
}
const rows = ref([]) // 抄表板原始数据（每块表一行）
const index = ref(0) // 当前卡片
const skipped = ref([]) // 跳过的 meterId
/** 当前这块表的草稿（切表时从 entries 里取，输入时写回 entries） */
const draft = reactive({ reading: '', photo: '', note: '' })

/**
 * 每块表的填报内容（2026-11-06）。
 * 原来是"一张卡一个 draft、翻页就覆盖" —— 改成一次性提交后必须按表存，
 * 否则翻过去再翻回来，填好的数字就没了。
 * 结构：{ [meterId]: { reading: '1234.5', photo: '/files/x.jpg' } }
 */
const entries = reactive({})

/** 草稿的本地存储 key（按日期分，不同月份的草稿不会串） */
function draftKey() {
  return `meterDraft:${readDate.value}`
}

function saveDraft() {
  try {
    uni.setStorageSync(draftKey(), JSON.stringify(entries))
  } catch {
    /* 存储满/不可用时静默：草稿是增强，不是主流程 */
  }
}

function restoreDraft() {
  try {
    const raw = uni.getStorageSync(draftKey())
    if (!raw) return 0
    const parsed = JSON.parse(raw)
    let count = 0
    for (const [meterId, value] of Object.entries(parsed || {})) {
      if (value && (value.reading || value.photo)) {
        entries[meterId] = value
        count += 1
      }
    }
    return count
  } catch {
    return 0
  }
}

function clearDraft() {
  try {
    uni.removeStorageSync(draftKey())
  } catch {
    /* 同上 */
  }
}
const showList = ref(false)

/**
 * 排序用的名次。
 *
 * 没编号的那块（150车间+精品四甲）要给 27.5：现场动线是抄完 27 号乙炔车间就进 150 车间，
 * 再往下才是 28 号低压循环泵。（2026-11-11 使用方再次确认这个位置。）
 */
const UNNUMBERED_RANK = 27.5

function numberRank(row) {
  const raw = String(row?.excelNo ?? '').trim()
  if (raw === '') return UNNUMBERED_RANK
  const n = Number(raw)
  return Number.isFinite(n) ? n : 999
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
 * 开关只影响"翻卡列表"，不影响统计（filledNow / total 永远按全量算），
 * 否则抄到最后会显示"已填 8/8"这种假象。
 */
const onlyUnfilled = ref(false)

/** 翻卡用的列表：打开开关后只留没填的（当前这张永远留在里面，避免"卡片凭空消失"） */
const list = computed(() => {
  if (!onlyUnfilled.value) return cards.value
  return cards.value.filter(
    (c) => !hasReading(c) || c.meterId === card.value?.meterId,
  )
})

const card = computed(() => cards.value[index.value] || null)
/*
 * 顶部「已填」用这个（2026-11-11）。
 * 原来直接把只认服务端的计数摆上去，它只认服务端已入库的读数 ⇒
 * 现场填了三块还没提交，头上还是「已填 0」，跟底部「提交全部（3）」自相矛盾。
 * 现在把本地 entries 里刚填的也算进来。
 */
const filledNow = computed(
  () =>
    cards.value.filter(
      (c) => c.reading !== null && c.reading !== undefined,
    ).length +
    cards.value.filter(
      (c) =>
        (c.reading === null || c.reading === undefined) &&
        String(entries?.[c.meterId]?.reading ?? '').trim() !== '',
    ).length,
)
const total = computed(() => cards.value.length)

/*
 * 「全部 38 块表」列表里这张表该显示什么（2026-11-11）。
 * 原来只认服务端 reading ⇒ 现场刚填、还没「提交全部」的表在列表里全写「未填」，
 * 跟顶上的「已填 2」自相矛盾（用户就是这么发现的）。
 * 现在：服务端已存 → 用它；否则用本地草稿。
 */
function shownReading(row) {
  if (!row) return ''
  if (row.reading !== null && row.reading !== undefined) return row.reading
  return String(entries?.[row.meterId]?.reading ?? '').trim()
}
function hasReading(row) {
  const v = shownReading(row)
  return v !== '' && v !== null && v !== undefined
}

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
  // 已存的读数优先，其次是本地草稿（2026-11-06）
  const saved = entries[row.meterId]
  if (saved) {
    draft.reading = saved.reading ?? ''
    draft.photo = saved.photo ?? ''
  } else {
    draft.reading = row.reading === null || row.reading === undefined ? '' : String(row.reading)
    draft.photo = row.imagePath || ''
  }
  draft.note = ''
}

/** 把当前输入的读数/照片写回 entries 并落本地草稿 */
function commitDraft() {
  if (!card.value) return
  const meterId = card.value.meterId
  const reading = String(draft.reading ?? '').trim()
  if (!reading && !draft.photo) {
    delete entries[meterId]
  } else {
    entries[meterId] = { reading, photo: draft.photo }
  }
  saveDraft()
}

/*
 * 边打边记（2026-11-11）。
 * 以前只有 blur / 换卡 / 提交才写 entries，用户敲完直接点顶上的「已填」看列表，
 * 结果是：头上数字变了、列表里那张还是「未填」，看着像把数据弄丢了。
 * 现在输入停 250ms 就把当前卡写进 entries（连带落本地草稿）。
 */
let draftTimer = 0
watch(
  () => draft.reading,
  () => {
    clearTimeout(draftTimer)
    draftTimer = setTimeout(commitDraft, 250)
  },
)

/**
 * 改抄表日期（2026-11-06）。
 * 补录历史数据用：选到那一天，之后提交的读数就记到那期上。
 */function onReadDateChange(event) {
  const value = event?.detail?.value
  if (!value) return
  readDate.value = value
  skipped.value = []
  if (card.value) loadCard(card.value)
  loadSheet()
}

/** 无编号那块表的编号显示值（2026-11-06：使用方要求显示 150、排在 27 之后） */
const UNNUMBERED_LABEL = '150'

/**
 * 重排抄表顺序（2026-11-06）。
 *
 * 使用方：「把没有编号的那个（150车间+精品四甲）放在 27 和 28 之间」。
 * 后端按表号排序，无编号的会掉到最后 —— 但现场抄表的动线是 27 号后面就是 150 车间，
 * 所以在这里插一次。只动显示顺序，不动数据。
 */
function orderRows(list) {
  if (!Array.isArray(list) || list.length === 0) return list
  const unnumbered = list.filter((row) => !String(row.excelNo || '').trim())
  if (unnumbered.length === 0) return list
  const numbered = list.filter((row) => String(row.excelNo || '').trim())
  const result = []
  let inserted = false
  for (const row of numbered) {
    const no = Number(row.excelNo)
    // 遇到 28 号（或更大的编号）之前，先把无编号的插进去
    if (!inserted && Number.isFinite(no) && no >= 28) {
      result.push(...unnumbered)
      inserted = true
    }
    result.push(row)
  }
  if (!inserted) result.push(...unnumbered)
  return result
}

/** 编号列显示：无编号的显示 150（表本身没有号，这是车间号） */
function displayNo(row) {
  const no = String(row?.excelNo || '').trim()
  return no || UNNUMBERED_LABEL
}

async function loadSheet() {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await request.get('/api/electricity/sheet', { params: { date: readDate.value } })
    rows.value = orderRows(res.data?.data || [])
    // 恢复这个日期下的本地草稿（2026-11-06）
    const restored = restoreDraft()
    if (restored > 0) {
      uni.showToast({ title: `已恢复 ${restored} 块未提交的读数`, icon: 'none' })
      if (card.value) loadCard(card.value)
    }
    // 默认停在第一张还没填的卡上
    const firstUnfilled = cards.value.findIndex((c) => c.reading === null || c.reading === undefined)
    index.value = firstUnfilled === -1 ? 0 : firstUnfilled
    // 轨道要跟着落位：否则"表单挂在第 index 张、轨道却停在第 0 张"
    scrollX.value = index.value * Math.max(1, stageW.value)
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
  if (next === index.value) return
  /*
   * 2026-11-11：翻页现在由轨道位置驱动，所以不能只改 index，
   * 必须让轨道滚到那一页（jumpTo 内部会动 scrollX，index 由 activeIndex 跟着交接）。
   * 交接时会 commitDraft，滑走那张的读数不会丢。
   */
  jumpTo(next)
}

/** 在"翻卡列表"里前进/后退（筛选打开时跳过已填的） */
function step(delta) {
  if (!list.value.length) return
  const at = list.value.findIndex((c) => c.meterId === card.value?.meterId)
  const nextItem = list.value[Math.min(list.value.length - 1, Math.max(0, (at === -1 ? 0 : at) + delta))]
  if (!nextItem) return
  const realIndex = cards.value.findIndex((c) => c.meterId === nextItem.meterId)
  // 走吸附动画，不要硬切 —— 箭头和手势看到的是同一种过渡
  if (realIndex >= 0) jumpTo(realIndex)
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
/**
 * 一次性提交（2026-11-06）。
 *
 * 规则（使用方按推荐确认）：
 *   · 只提交填了读数的；没填 = 跳过，不报错
 *   · 读数 ≤ 上次读数（负用量）⇒ 阻止，直接跳到那块表
 *   · 用量超过上次 5 倍 ⇒ 只警告，允许提交
 *   · 提交成功清本地草稿；失败保留，可以再点一次
 */
async function submitAll() {
  if (saving.value) return
  commitDraft()

  const filled = cards.value
    .map((row) => ({ row, entry: entries[row.meterId] }))
    .filter((item) => item.entry && String(item.entry.reading || '').trim() !== '')

  if (!filled.length) {
    uni.showToast({ title: '还没有填任何读数', icon: 'none' })
    return
  }

  // 校验：负用量必须拦下来（一定是抄错了或上次读数还没补）
  for (const item of filled) {
    const current = Number(item.entry.reading)
    if (!Number.isFinite(current)) {
      uni.showToast({ title: `${item.row.meterName} 的读数不是数字`, icon: 'none' })
      goTo(cards.value.findIndex((c) => c.meterId === item.row.meterId))
      return
    }
    const prev = item.row.prevReading
    if (prev !== null && prev !== undefined && current <= Number(prev)) {
      uni.showModal({
        title: '读数比上次小',
        content: `${item.row.meterName}：本次 ${current}，上次 ${prev}。这会产生负用量，先确认是不是抄错。`,
        showCancel: false,
        confirmText: '去改',
        success: () => goTo(cards.value.findIndex((c) => c.meterId === item.row.meterId)),
      })
      return
    }
  }

  const anomalies = filled.filter((item) => {
    const prev = Number(item.row.prevReading)
    const current = Number(item.entry.reading)
    return Number.isFinite(prev) && prev > 0 && (current - prev) * (item.row.ratio || 1) > prev * 5
  })

  const skippedCount = cards.value.length - filled.length
  const confirmed = await new Promise((resolve) => {
    uni.showModal({
      title: '提交全部读数',
      content:
        `已填 ${filled.length} 块，未填 ${skippedCount} 块（按跳过处理）` +
        (anomalies.length ? `，其中 ${anomalies.length} 块用量异常（会照常提交）` : ''),
      confirmText: '提交',
      cancelText: '再看看',
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    })
  })
  if (!confirmed) return

  saving.value = true
  try {
    const items = filled.map((item) => ({
      meterId: item.row.meterId,
      reading: Number(item.entry.reading),
      imagePath: item.entry.photo || '',
      note: '',
    }))
    const res = await request.post('/api/electricity/readings/batch', {
      date: readDate.value,
      items,
    })
    const body = res?.data || {}
    if (body.success === false) throw new Error(body.msg || '提交失败')
    clearDraft()
    for (const key of Object.keys(entries)) delete entries[key]
    uni.vibrateShort?.({ type: 'medium' })
    uni.showToast({ title: `已提交 ${items.length} 块`, icon: 'success' })
    await loadSheet()
  } catch (e) {
    uni.showModal({
      title: '提交失败',
      content: (e?.data?.msg || e?.message || '网络问题') + '\n填好的内容还留着，可以再提交一次。',
      showCancel: false,
    })
  } finally {
    saving.value = false
  }
}

async function submit(direction) {
  if (!card.value || saving.value || pagerAnimating.value) return
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
  startScroll: 0,
  dx: 0,
  dy: 0,
  decided: false,
  flying: false,
})

/* ===== 卡片轨道 / 自由滚动 + 惯性吸附（2026-11-11 v2） =====
 *
 * 手感目标是原生 ViewPager / 横向轮播那一类：
 *   1) 手指按住时 1:1 跟手，没有阈值、没有"过 22% 才翻页"的判定；
 *   2) 松手取最近 100ms 的速度，用「位移 + 速度 × 325ms」预测落点；
 *   3) 预测落在哪一页就滚到哪一页（快滑可以一次跨好几页）；
 *   4) 减速用 easeOutCubic，时长按距离和初速度算，不是固定 300ms；
 *   5) 只有 transform: translate3d 在动，动画期间绝不改布局、不重建整张表单。
 *
 * 轨道里始终只有三张（上一张 / 当前 / 下一张）：位移越过一整页就把 index 挪一格、
 * offset 折回页内（内容在屏幕外换），所以 38 张表也不会同时挂载。
 */
const PAGER_MS_MIN = 200     // 吸附动画最短时长
const PAGER_MS_MAX = 1100    // 吸附动画最长时长（一下甩好几页时会到这一档）
const VELOCITY_WINDOW = 60   // 只取松手前 60ms 的速度：窗口越长，抬手前那点减速越会被平均进去，甩动被判得越慢
const PEEK_SCALE = 0.14      // 离中心一整页时缩到 86%
const PEEK_FADE = 0.45       // 离中心一整页时淡到 55%
const PEEK_PX = 8            // 邻居卡往中间收 8px，露出一点边当"能滑"的暗示

// 舞台宽度先用窗口宽兜底，measureNames 会量到精确值
const stageW = ref(Math.max(1, uni.getSystemInfoSync?.().windowWidth || 375))
const pagerAnimating = ref(false)
// 本次按下是否刹住了一段还在跑的动画：刹车后的松手用更短的吸附（150ms）
let touchBraked = false
// 轨道已经滚了多少 px：0 = 第一张居中，w = 第二张居中
const scrollX = ref(0)

const r2 = (n) => Math.round(n * 100) / 100
const r4 = (n) => Math.round(n * 10000) / 10000
const maxScroll = computed(() => Math.max(0, (cards.value.length - 1) * Math.max(1, stageW.value)))
const clampX = (v) => Math.max(0, Math.min(maxScroll.value, v))

/** 浮点页号：0 = 第一张居中，1.5 = 卡在第二、三张中间 */
const floatIndex = computed(() => scrollX.value / Math.max(1, stageW.value))

/** 表单挂在哪张：永远挂在"最接近正中"的那张，跨过 50% 就交接 */
const activeIndex = computed(() => {
  const at = Math.round(floatIndex.value)
  return Math.max(0, Math.min(cards.value.length - 1, at))
})

/** 只渲染视口附近的几张：38 张全挂 DOM 时每帧要 diff 38 个节点，低端机容易掉帧 */
const WINDOW_RADIUS = 2
const windowCards = computed(() => {
  const n = cards.value.length
  if (!n) return []
  const from = Math.max(0, activeIndex.value - WINDOW_RADIUS)
  const to = Math.min(n - 1, activeIndex.value + WINDOW_RADIUS)
  const out = []
  for (let i = from; i <= to; i += 1) {
    const row = cards.value[i]
    if (row) out.push({ ...row, i })
  }
  return out
})

/** 标签高亮跟着滚动手势连续走（50% 就是中间态），不是松手才切 */
const highlightIndex = computed(() => {
  const at = Math.floor(floatIndex.value + 0.5)
  return Math.max(0, Math.min(cards.value.length - 1, at))
})
const highlightMeterId = computed(() => cards.value[highlightIndex.value]?.meterId || '')

const trackStyle = computed(() => ({
  transform: `translate3d(${-r2(scrollX.value)}px, 0, 0)`,
}))

/*
 * 每张卡的位置、大小、透明度都在这里算，全部只写 transform / opacity：
 * 拖到一半（d = 0.5）时，上一张和下一张都是"半大不小"的状态；
 * 松手动画走的也是同一个函数，所以动画过程和手指拖动完全一致。
 */
const FAR_PAGE_STYLE = { display: 'none' }

function pageStyleAt(i) {
  const w = Math.max(1, stageW.value)
  const away = Math.abs(i * w - scrollX.value) / w
  // 离得远的页直接藏掉：留 38 个 transform 合成层一起缩放，手机会掉帧，摸起来发黏
  if (away > 1.6) return FAR_PAGE_STYLE
  const d = Math.min(1, away)
  const scale = 1 - PEEK_SCALE * d
  const opacity = 1 - PEEK_FADE * d
  /*
   * 往中间收几像素（2026-11-11）：原来邻居卡被舞台完全裁掉，
   * 首屏看不出"可以左右滑"；收进来 8px 就露出一点边，是那种能滑的暗示。
   * 越靠近正中收得越少（乘 d），落位时正好归零。
   */
  const shift = PEEK_PX * d * (i < floatIndex.value ? 1 : -1)
  return {
    width: `${Math.round(w)}px`,
    transform: `translate3d(${r2(i * w + shift)}px, 0, 0) scale(${r4(scale)})`,
    opacity: `${r2(opacity)}`,
    zIndex: away < 0.5 ? 2 : 1,
  }
}

/*
 * 表单跟着"正中那张"交接：交接前先把上一张的读数落进 entries，
 * 否则滑走的那张会丢（老问题，2026-11-11 又踩过一次）。
 */
watch(activeIndex, (now) => {
  if (now === index.value) return
  commitDraft()
  index.value = now
  if (card.value) loadCard(card.value)
})

/*
 * 舞台宽度是后量到的（页面左右有内边距，不等于窗口宽）：
 * 量完按新页宽重算一次位置，否则轨道会和"表单挂在哪张"差半屏。
 */
watch(stageW, (w) => {
  if (pagerAnimating.value || gesture.dragging) return
  scrollX.value = index.value * Math.max(1, w)
})

/* 标签带的测量结果：每个标签中心相对带子左边缘的 px */
const nameCenters = ref([])
const namesViewport = ref(0)

/*
 * 组件实例要在 setup 期间抓一次存下来。
 * getCurrentInstance() 只在 setup / 生命周期里有效，放到 setTimeout 里再调就是 null，
 * 之前就是这样导致标签一次都没量到（一直用 fallback 的 -i*84）。
 */
const pageInst = getCurrentInstance()

function measureNames(tries = 0) {
  if (!pageInst || !uni.createSelectorQuery) return
  const query = uni.createSelectorQuery().in(pageInst.proxy)
  query.select('.mr__names').boundingClientRect()
  query.selectAll('.mr__name').boundingClientRect()
  query.select('.mr__stage').boundingClientRect()
  query.select('.mr__names-inner').boundingClientRect()
  query.exec((res) => {
    const box = res?.[0]
    const items = res?.[1]
    const stage = res?.[2]
    const inner = res?.[3]
    // 舞台宽度才是"一屏"的真实宽度（页面有左右内边距，不等于 windowWidth）
    if (stage && stage.width) stageW.value = stage.width
    if (!box || !Array.isArray(items) || !items.length) {
      // 首帧可能还没渲染出标签（数据刚到）：等一会再量，最多三次
      if (tries < 3) setTimeout(() => measureNames(tries + 1), 120)
      return
    }
    namesViewport.value = box.width
    /*
     * 中心点必须相对"标签带内部"量，不能相对带子左边缘：
     * 带子本身带着 transform，量到的绝对坐标已经包含当前位移，
     * 拿它反算位移会形成"量一次→改一次→再量又变"的回授，最后总是 0。
     */
    const origin = inner && typeof inner.left === 'number' ? inner.left : box.left
    nameCenters.value = items.map((it) => it.left - origin + it.width / 2)
  })
}

function nameShiftAt(i) {
  const centers = nameCenters.value
  if (!centers.length) return -i * 84
  const at = Math.max(0, Math.min(centers.length - 1, i))
  const viewport = namesViewport.value || stageW.value
  return viewport / 2 - centers[at]
}

/** 标签带位移：按浮点页号在两个标签中心之间插值，和卡片完全同一个进度 */
const namesShift = computed(() => {
  const raw = floatIndex.value
  const at = Math.max(0, Math.min(nameCenters.value.length - 1, Math.floor(raw)))
  const frac = Math.max(0, Math.min(1, raw - at))
  const from = nameShiftAt(at)
  return from + (nameShiftAt(at + 1) - from) * frac
})

const namesStyle = computed(() => ({
  transform: `translate3d(${namesShift.value.toFixed(2)}px, 0, 0)`,
}))

/**
 * 拖动时的方向提示：翻页语义下不再提示"提交/跳过"，
 * 保留这个 computed 只是为了模板不用改（恒为空）。
 */
const intent = computed(() => ({ kind: '', opacity: 0 }))

const cardStyle = computed(() => ({
  boxShadow: '0 8rpx 30rpx rgba(90, 70, 40, 0.06)',
  // 顶部一层 12% 同色洗染：色条之外再加一点"这块表属于哪个车间"的暗示
  backgroundImage: `linear-gradient(180deg, ${tint(sectionColor.value, 0.12)} 0, rgba(255,255,255,0) 96rpx)`,
}))

/** 已填条数（一次性提交时按钮上显示这个数） */
const filledEntries = computed(
  () => Object.values(entries).filter((entry) => String(entry?.reading || '').trim() !== '').length,
)

/** 点名字直接跳（带吸附动画，和翻页一致） */
function goToName(row) {
  // 刚拖过标签带：这次 click 是拖动带出来的，不再额外跳一次
  if (Date.now() - lastDragAt < 350) return
  const at = cards.value.findIndex((c) => c.meterId === row.meterId)
  if (at < 0 || at === index.value) return
  jumpTo(at)
}

/*
 * 标签带不再自己滚动：它就是轨道的"进度条"。
 * 手指在标签带上拖 → 直接复用卡片的拖拽逻辑（onTouchStart/Move/End），
 * 于是标签和卡片共用同一个 gesture.dx，天然同步。
 */
function onNamesTouchStart(event) {
  onTouchStart(event)
}
function onNamesTouchMove(event) {
  onTouchMove(event)
}
function onNamesTouchEnd() {
  onTouchEnd()
}

const remaining = computed(() => Math.max(0, total.value - filledNow.value))

/** 立刻把当前这张提交（底部按钮） */
function doSubmit() {
  submit('right')
}

/** 立刻跳过（底部按钮） */
function doSkip() {
  if (!card.value || saving.value) return
  skipped.value = [...skipped.value, card.value.meterId]
  step(1)
}

/**
 * 失败回退（兼容老调用）：直接复位到当前页，不做飞出动画。
 */
function restore() {
  pagerAnimating.value = false
  gesture.dragging = false
  gesture.decided = false
}

/** 老的 fly 接口：翻页由滚动引擎负责，这里只保留"滚动结束后做点什么" */
function fly(_direction, after) {
  if (after) after()
}

/** 最后一次"真的拖动过"的时间戳：用来吞掉拖动结束后的那次 click */
let lastDragAt = 0
/** 松手速度采样（最近 100ms 的坐标） */
let samples = []
/** 动画代次：新的滚动接管时，旧的 rAF 回调直接退出，避免两个循环抢 offset */
let flingToken = 0
/** 上一次动画帧的时间：用来发现"卡住不动"的循环（后台标签页会暂停 rAF） */
let lastTickAt = 0

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
}
function rafTick(fn) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn)
  else setTimeout(fn, 16)
}
function pushSample(x) {
  const t = nowMs()
  samples.push({ t, x })
  while (samples.length > 2 && t - samples[0].t > VELOCITY_WINDOW) samples.shift()
}
/** 松手速度 px/ms（往左为负） */
function releaseVelocity() {
  if (samples.length < 2) return 0
  /*
   * 只认"抬手前这一小段"的速度：手指停住不动时不会再有 touchmove，
   * 采样表里留着的还是拖动早段的数据。不按时间过滤的话，
   * "按住表盘停一下再松手"会被当成还在高速滑动，白白飞出去好几页。
   */
  const now = nowMs()
  const fresh = samples.filter((s) => now - s.t <= 120)
  if (fresh.length < 2) return 0
  const first = fresh[0]
  const last = fresh[fresh.length - 1]
  const dt = last.t - first.t
  if (dt <= 0) return 0
  return (last.x - first.x) / dt
}

/**
 * 刹车：立刻掐断正在跑的惯性/吸附动画，冻结在当前 offset。
 * 帧循环每次 tick 都会核对 flingToken，这里把代次 +1，
 * 已经在队列里的那一帧回来就直接退出 —— 不会再往前多滑一像素。
 */
function brake() {
  flingToken += 1
  pagerAnimating.value = false
  lastTickAt = 0
  // 把刹车前的速度样本清掉：否则"刹住后原地抬手"会被当成还在高速滑行，又甩一次
  samples = []
}

/* ---------- 手势：1:1 跟手，拖动时不做任何分页判定 ---------- */
function onTouchStart(e) {
  /*
   * 动画卡住的自愈：rAF 在后台标签页/系统省电时会停，
   * 超过 400ms 没有新帧就认为这次滚动已经死了，别让页面永远划不动。
   */
  if (pagerAnimating.value && nowMs() - lastTickAt > 400) {
    pagerAnimating.value = false
  }
  // 本次触摸是不是"按停了一段还在跑的动画"（决定松手后吸附用短时长）
  touchBraked = false
  /*
   * 滑行途中按下 = 刹车：动画当场停住，位置就冻在这里；
   * 这次按下继续往下面走，直接当作本次拖拽的起点，
   * 所以刹完不用再摸第二下才能拖。
   */
  if (pagerAnimating.value) {
    brake()
    touchBraked = true
  }
  if (!nameCenters.value.length) measureNames()
  const t = e.touches?.[0]
  if (!t) return
  gesture.startX = t.clientX
  gesture.startY = t.clientY
  gesture.startScroll = scrollX.value
  // 左缘 24px 不接管：那里是系统"返回"手势区
  gesture.dragging = t.clientX > 24
  gesture.decided = false
  gesture.dy = 0
  samples = []
  pushSample(t.clientX)
}

function onTouchMove(e) {
  if (!gesture.dragging || pagerAnimating.value) return
  const t = e.touches?.[0]
  if (!t) return
  const dx = t.clientX - gesture.startX
  const dy = t.clientY - gesture.startY
  if (!gesture.decided) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
    // 竖向多于横向 ⇒ 这是页面滚动，不要抢
    if (Math.abs(dy) > Math.abs(dx)) {
      gesture.dragging = false
      return
    }
    gesture.decided = true
  }
  pushSample(t.clientX)
  // 1:1：手指走多少，轨道走多少。只在两端夹住，不加阻尼
  scrollX.value = clampX(gesture.startScroll - dx)
}

function onTouchEnd() {
  if (!gesture.dragging || pagerAnimating.value) return
  gesture.dragging = false
  gesture.decided = false
  const v = releaseVelocity()
  samples = []
  if (Math.abs(scrollX.value - gesture.startScroll) > 8) lastDragAt = Date.now()
  /*
   * 手感的关键：松手这一帧的速度要"接着走"，不能重新起一段缓动。
   * 上一版是先算落点再 easeOut，起手加速度是松手速度的 2.6 倍 —— 手指抬起来
   * 还会被"推一把"，反过来慢滑时又立刻停住，摸起来就是发黏。
   * 现在把速度直接交给惯性滑行（指数衰减），速度是连续的，然后才轻轻吸附。
   */
  startGlide(-v)
}

/*
 * 松手之后怎么"滑"：
 * 距离 = 初速度 × 时间常数，时长 = 3 × 时间常数 ⇒ easeOutCubic 的起手导数
 * 正好等于初速度（3D/T），速度是接得上的，不会像早先那样被"推一把"。
 * 三个旋钮：
 *   GLIDE_TAU  —— 时间常数（ms）；越大滑得越远，时长也跟着变长
 *   GLIDE_BOOST —— 把手指速度放大成甩动速度（拖动本身还是 1:1）
 *   GLIDE_VMAX —— 初速度上限，避免一甩飞到底
 */
const GLIDE_TAU = 760
const GLIDE_BOOST = 3.6
const GLIDE_VMAX = 15
const GLIDE_MIN_MS = 420
/*
 * 吸附时长分两种：
 *   SNAP_MS_BRAKE —— 按停动画后自己拖一小段再松手：手感要"立刻贴齐"，用 150ms；
 *   SNAP_MS_GLIDE —— 远距离惯性滑完之后贴齐：慢一点（220ms）才自然，
 *                    太快会像被人拽了一把、把刚建立的速度感截断。
 */
const SNAP_MS_BRAKE = 150
const SNAP_MS_GLIDE = 220

/**
 * 松手：按速度算一段"该滑多远"，再用 easeOutCubic 走过去。
 * 起点速度与手指速度连续（导数匹配），所以手感是"接着滑"而不是"重新起一段动画"。
 */
function startGlide(v0) {
  const w = Math.max(1, stageW.value)
  const n = cards.value.length
  // 调用方传进来的是"轨道方向"的速度（往左拖 = 正），这里只放大，不再取反
  const vTrack = Math.max(-GLIDE_VMAX, Math.min(GLIDE_VMAX, v0 * GLIDE_BOOST))
  const snapMs = touchBraked ? SNAP_MS_BRAKE : SNAP_MS_GLIDE
  if (!Number.isFinite(vTrack) || Math.abs(vTrack) < 0.05) {
    pagerAnimating.value = false
    snapNearest(snapMs)
    return
  }
  const minX = 0
  const maxX = Math.max(0, (n - 1) * w)
  const want = scrollX.value + vTrack * GLIDE_TAU
  const target = Math.max(minX, Math.min(maxX, want))
  const dist = Math.abs(target - scrollX.value)
  if (dist < 0.6) {
    snapNearest(snapMs)
    return
  }
  // 3D/T = 初速度 ⇒ 起手速度与松手速度一致；时长下限防止极短距离过冲
  const ms = Math.max(GLIDE_MIN_MS, (dist / Math.abs(vTrack)) * 3)
  /*
   * 关键：滑行的终点是"按速度算出来的任意位置"，不等于卡片对齐线。
   * 所以滑完必须再走一次吸附，否则就会停在两张卡中间（14:52 那个 bug）。
   */
  animateTo(target, vTrack, ms, () => snapNearest(SNAP_MS_GLIDE))
}

/** 停下后吸到最近的一整页；ms 默认按"滑行收尾"的 220ms，刹车路径传 150ms */
function snapNearest(ms = SNAP_MS_GLIDE) {
  const w = Math.max(1, stageW.value)
  animateTo(Math.round(scrollX.value / w) * w, 0, ms)
}

/**
 * 吸附动画：easeOutCubic。
 * forceMs 给了就用它（滑行结束后的贴齐），否则按「距离 / 初速度」推。
 * 起点就是当前 scrollX，所以不会跳。
 */
function animateTo(target, v = 0, forceMs = 0, onDone = null) {
  const from = scrollX.value
  const to = clampX(target)
  const dist = Math.abs(to - from)
  if (dist < 0.6) {
    scrollX.value = to
    if (onDone) onDone()
    return
  }
  const speed = Math.max(0.9, Math.abs(v))
  const ms = forceMs || (Math.abs(v) > 0.05
    ? Math.min(PAGER_MS_MAX, Math.max(PAGER_MS_MIN, (dist / speed) * 1.15))
    : Math.min(PAGER_MS_MAX, Math.max(PAGER_MS_MIN, 320 + (dist / Math.max(1, stageW.value) - 1) * 90)))
  const t0 = nowMs()
  const token = ++flingToken
  lastTickAt = t0
  pagerAnimating.value = true
  const tick = () => {
    if (token !== flingToken) return
    lastTickAt = nowMs()
    const t = Math.min(1, (nowMs() - t0) / ms)
    const eased = 1 - Math.pow(1 - t, 3)
    scrollX.value = from + (to - from) * eased
    if (t < 1) {
      rafTick(tick)
      return
    }
    scrollX.value = to
    pagerAnimating.value = false
    if (onDone) onDone()
  }
  rafTick(tick)
}

/** 直接跳到第 i 张（点标签、点预览卡、箭头）：走同一套吸附动画 */
function jumpTo(target) {
  if (pagerAnimating.value) return
  const at = Math.max(0, Math.min(cards.value.length - 1, target))
  animateTo(at * Math.max(1, stageW.value), 0)
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
  bindKeyboardWatcher()
  if (!allowed.value) {
    uni.showToast({ title: '需要抄表权限', icon: 'none' })
    setTimeout(() => uni.reLaunch({ url: '/pages/index/index' }), 900)
    return
  }
  loadSheet().then(() => {
    // 标签带是"轨道的进度条"，必须先量出每个标签的中心点才能对齐
    nextTick(() => setTimeout(measureNames, 80))
  })
})

/*
 * 标签带只在数据到手后才有内容：长度变化时重量一次，
 * 否则只能退回 -i*84 的估算，越往右偏得越多。
 */
watch(
  () => list.value.length,
  () => {
    if (!list.value.length) return
    nextTick(() => setTimeout(measureNames, 80))
  },
)
</script>

<template>
  <view class="mr" :class="themeClass" :style="pageStyle">
    <view v-if="!allowed" class="mr__deny">
      <text class="mr__deny-title">需要抄表权限（找管理员授权）</text>
    </view>

    <template v-else>
      <!-- 顶部：进度 + 已填 + 列表入口 -->
      <view class="mr__head">
        <!--
          「1 / 38 车间」既是进度也是列表入口（2026-11-11）
          原来列表入口挂在「已填 0」上，但那读起来是状态、没人会去点；
          这里把入口挪到左上角的计数上，并给一个小箭头明示可点。
        -->
        <view class="mr__progress" @click="showList = true">
          <text class="mr__progress-text">
            {{ index + 1 }} / {{ total }}
          </text>
          <text v-if="card" class="mr__section" :style="{ color: sectionColor }">
            {{ card.section || '未分组' }}
          </text>
          <wd-icon name="arrow-down" size="12px" custom-class="mr__progress-caret" />
        </view>
        <view class="mr__head-right">
          <!--
            抄表日期（2026-11-06）
            使用方要补录以前的抄表数据。后端 /readings/batch 本来就收 date，
            readDate 也一直是有的（默认今天），只是界面上没给入口 —— 这里补上。
            改日期会重新拉那一期的抄表表（loadSheet）。
          -->
          <picker mode="date" :value="readDate" @change="onReadDateChange">
            <view class="mr__date">
              <wd-icon name="calendar" size="14px" custom-class="mr__date-icon" />
              <text class="mr__date-text">{{ readDate.slice(5) }}</text>
            </view>
          </picker>
          <!-- 已填只是状态，不再当按钮用（列表入口挪到左上角计数上了） -->
          <text class="mr__filled">已填 {{ filledNow }}</text>
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
          :style="{ width: ((index + 1) / Math.max(1, total)) * 100 + '%' }"
        ></view>
      </view>

      <text v-if="errorMessage" class="mr__error">{{ errorMessage }}</text>

      <!-- 卡片 -->
      <!--
        电表名称带（2026-11-06）
        参考电费页的页签：左右滑切表，当前那块是主色胶囊。
        点名字也能直接跳 —— 38 块表时比滑 37 次快。
      -->
      <!--
        电表名称带（2026-11-11 改成轨道的"进度条"）
        标签不再自己滚：拖动时和下方卡片共用同一份 gesture.dx，
        在相邻两个标签之间按进度插值，所以标签与卡片是同一个手势、同一个进度。
      -->
      <view
        v-if="list.length"
        class="mr__names"
        @touchstart.stop="onNamesTouchStart"
        @touchmove.stop.prevent="onNamesTouchMove"
        @touchend.stop="onNamesTouchEnd"
        @touchcancel.stop="onNamesTouchEnd"
      >
        <view class="mr__names-inner" :style="namesStyle">
          <view
            v-for="row in list"
            :id="'mn' + row.meterId"
            :key="row.meterId"
            class="mr__name"
            :class="{ 'is-active': row.meterId === highlightMeterId }"
            @click="goToName(row)"
          >
            <text class="mr__name-no">{{ displayNo(row) }}</text>
            <text class="mr__name-text">{{ row.meterName }}</text>
          </view>
        </view>
      </view>

      <!--
        卡片轨道（2026-11-11 v3）：一条连续的横向容器，38 张表排在同一条线上。
        拖动时整条轨道 1:1 跟手（没有阻尼、没有"过半才翻"的判定）；
        每张卡的缩放与透明度由"它离屏幕中心多远"实时算出来，
        所以拖到一半时上一张和下一张都处在中间尺寸 —— 不是松手才变。
        只有正中间那张挂可编辑表单，其余是轻量预览：38 张表不会同时挂表单。
      -->
      <view
        v-if="cards.length"
        class="mr__stage"
        @touchstart.stop="onTouchStart"
        @touchmove.stop.prevent="onTouchMove"
        @touchend.stop="onTouchEnd"
        @touchcancel.stop="onTouchEnd"
      >
        <view class="mr__track" :style="trackStyle">
          <view
            v-for="item in windowCards"
            :key="item.meterId"
            class="mr__page"
            :style="pageStyleAt(item.i)"
          >
            <view v-if="item.i === activeIndex" class="mr__page-fill">
        <view
          class="mr__card"
          :class="{ 'is-anomaly': anomaly }"
          :style="[cardStyle, { borderLeftColor: sectionColor }]"
          @touchstart.stop="onTouchStart"
          @touchmove.stop.prevent="onTouchMove"
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
            >{{ displayNo(card) }}</text>
            <text class="mr__name">{{ card.meterName }}</text>
            <text v-if="hasReading(card)" class="mr__done">已填</text>
          </view>

          <!--
            信息条（2026-11-11）：原来这一行是「柜号 · 上次读数（日期）」一长串，
            字小、读起来要一个个数；改成三格，标签在上、数值在下，
            柜号/上次/倍率各归各位 —— 也把卡片上下那两百像素的空白收回来一点。
          -->
          <view class="mr__facts">
            <view class="mr__fact">
              <text class="mr__fact-k">柜号</text>
              <text class="mr__fact-v">{{ card.meterCode || '无柜号' }}</text>
            </view>
            <view class="mr__fact">
              <text class="mr__fact-k">上次读数</text>
              <text class="mr__fact-v">{{ card.prevReading === null || card.prevReading === undefined ? '暂无' : card.prevReading }}</text>
              <text v-if="card.prevDate" class="mr__fact-d">{{ String(card.prevDate).slice(5) }}</text>
            </view>
            <view class="mr__fact">
              <text class="mr__fact-k">倍率</text>
              <text class="mr__fact-v">{{ card.multiplier > 1 ? '×' + card.multiplier : '×1' }}</text>
            </view>
          </view>

          <view class="mr__entry">
          <view class="mr__input-row">
            <!--
              :key 绑当前表号（2026-11-11）：翻到下一张再翻回来时，
              uni 的 <input> 不会把更新后的 v-model 值刷回原生输入框，
              画面上还是空的 —— 用户就以为「刚填的数没了」（数据其实在 entries 里）。
              换 key 强制重建这个输入框，重建时按当前 draft.reading 初始化。
            -->
            <input
              :key="card ? `reading-${card.meterId}` : 'reading-none'"
              v-model="draft.reading"
            @blur="commitDraft"
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
              :class="previewUsage === null ? 'is-empty' : previewUsage < 0 ? 'is-bad' : 'is-ok'"
            >
              {{ previewUsage === null ? '待填' : (previewUsage > 0 ? '+' : '') + Math.round(previewUsage) }}
            </text>
          </view>

          <text v-if="anomaly && !keyboardOpen" class="mr__anomaly">{{ anomaly }}</text>
          </view>

          <!-- 照片（键盘弹出时隐藏，2026-11-06：给卡片腾空间） -->
        <!-- prettier-ignore -->
          <view v-if="!keyboardOpen" class="mr__photo-row">
            <view v-if="draft.photo" class="mr__photo">
              <image
                :src="photoSrc"
                mode="aspectFill"
                class="mr__photo-img"
                @click.stop="previewPhoto"
              />
              <text class="mr__photo-remove" @click.stop="draft.photo = ''">×</text>
            </view>
            <view v-else class="mr__photo-add" @click.stop="openPhotoSheet">
              <wd-icon name="camera" size="18px" custom-class="mr__photo-icon" />
              <text class="mr__photo-add-text">拍表存证</text>
            </view>
          </view>
        </view>
            </view>

            <view v-else class="mr__page-fill" @click="jumpTo(item.i)">
              <view class="mr__peek">
                <view class="mr__peek-head">
                  <text class="mr__peek-no">{{ displayNo(item) }}</text>
                  <text class="mr__peek-name">{{ item.meterName }}</text>
                </view>
                <text class="mr__peek-meta">
                  {{ item.meterCode || '无柜号' }} · 上次 {{ item.prevReading ?? '—' }}
                </text>
                <text class="mr__peek-value">
                  {{ hasReading(item) ? shownReading(item) : '还没填' }}
                </text>
              </view>
            </view>
          </view>
        </view>

        <!--
          底部动作条（2026-11-05）
          使用方：「左右滑的按钮太小了，而且间距太远，单手操作不方便」
          ⇒ 两个大按钮各占一半、贴底、拇指够得到；提示文案挪进按钮里
        -->
        <!--
          底部（2026-11-06）：一颗「提交全部」
          改成一路上滑填过去、最后一次性提交，所以不再有跳过/提交两颗按钮。
          左侧箭头只用来上一块（给不习惯手势的人留的后路）。
        -->
        <view class="mr__actions">
          <view class="mr__arrow" hover-class="mr__action--pressed" @click="step(-1)">
            <text class="mr__action-icon">‹</text>
          </view>
          <view
            class="mr__action mr__action--submit mr__action--wide"
            hover-class="mr__action--pressed"
            :class="{ 'is-disabled': saving }"
            @click="submitAll"
          >
            <text class="mr__action-text">{{ saving ? '提交中…' : `提交全部（${filledEntries}）` }}</text>
            <text v-if="remaining" class="mr__action-sub">还有 {{ remaining }} 块没填</text>
          </view>
          <view class="mr__arrow" hover-class="mr__action--pressed" @click="step(1)">
            <text class="mr__action-icon">›</text>
          </view>
        </view>
      </view>

      <!--
        抄完了（2026-11-05 重做）
        原来是三行小字 + 一个"刷新"，收工这一刻太轻。现在给一屏：
        进度环（已填比例）+ 两个数字 + 两个按钮（回到第一块没填的 / 重新拉数据）
      -->
      <view v-else class="mr__done-all">
        <view class="mr__done-ring" :style="{ background: `conic-gradient(${sectionColor} ${(filledNow / Math.max(1, total)) * 360}deg, rgba(20,22,28,0.08) 0deg)` }">
          <view class="mr__done-ring-inner">
            <text class="mr__done-pct">{{ Math.round((filledNow / Math.max(1, total)) * 100) }}%</text>
            <text class="mr__done-ring-label">已填</text>
          </view>
        </view>

        <text class="mr__done-title">今天的表都看完了</text>
        <view class="mr__done-stats">
          <view class="mr__done-stat">
            <text class="mr__done-stat-value">{{ filledNow }}</text>
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
              :class="{ 'is-filled': hasReading(item) }"
              @click="showList = false; jumpTo(i)"
            >
              <text class="mr__sheet-no">{{ displayNo(item) }}</text>
              <text class="mr__sheet-name">{{ item.meterName }}</text>
              <text class="mr__sheet-val">
                {{ hasReading(item) ? shownReading(item) : '未填' }}
              </text>
            </view>
          </scroll-view>
        </view>
      </view>
    </template>
  
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
  height: calc(100vh - var(--window-top, 0px));
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
  color: var(--ui-text-2);
}

.mr__head-right {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.mr__date {
  /* 日期入口（2026-11-11）：带日历图标的小胶囊 —— 三个胶囊里只有它是"能改的东西" */
  display: flex;
  align-items: center;
  gap: 6rpx;
  padding: 10rpx 18rpx;
  border-radius: 999rpx;
  background-color: var(--ui-raise-2);
  font-size: 24rpx;
  color: var(--ui-text-2);
  font-variant-numeric: tabular-nums;
}

.mr__date-icon {
  color: var(--ui-text-2);
}

.mr__date-text {
  line-height: 1;
}

/* 已填 / 跳过：只是状态文字，不再是按钮，所以没有下划线、没有底色 */
.mr__filled,
.mr__skipped {
  font-size: 24rpx;
  color: var(--ui-text-2);
  font-variant-numeric: tabular-nums;
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
/* 电表名称带（2026-11-06） */
.mr__names {
  /* 2026-11-06：给死高度并居中 —— 之前没定高，scroll-view 被 flex 拉满，胶囊变成竖长条 */
  flex: 0 0 auto;
  /* 2026-11-11：56rpx 的胶囊只有 29px 高，手指点不准；抬到 84rpx（≈44px 触控下限） */
  height: 112rpx;
  width: 100%;
  /* 两侧留白放到 inner 上：这样 inner 的原点就是带子的左边缘，
     量出来的标签中心减去位移才对得齐（否则差一个 padding） */
  padding: 0;
  white-space: nowrap;
  /* 2026-11-11：不再用 scroll-view 自己滚，改成轨道式平移；两侧裁掉 */
  overflow: hidden;
  box-sizing: border-box;
}

.mr__names::-webkit-scrollbar {
  display: none;
}

.mr__names-inner {
  display: inline-flex;
  align-items: center;
  height: 112rpx;
  gap: 14rpx;
  padding: 0 24rpx;
  /* 轨道的位移由 JS 写 transform，和下方卡片共用同一个手势进度 */
  will-change: transform;
  backface-visibility: hidden;
}

.mr__name {
  /* 胶囊：定高 84rpx（≈44px）、横向排布、文字绝不换行 */
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
  height: 84rpx;
  padding: 0 24rpx;
  border-radius: 999rpx;
  white-space: nowrap;
  background-color: var(--ui-raise-2);
  font-size: 26rpx;
  color: var(--ui-text-2);
  transition: background-color 200ms cubic-bezier(0.22, 1, 0.36, 1), color 200ms ease;
}

.mr__name.is-active {
  background-color: var(--ui-accent);
  color: var(--ui-on-accent);
  font-weight: 600;
}

.mr__name-no {
  font-size: 22rpx;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.mr__name-text {
  font-weight: 600;
  white-space: nowrap;
}

.mr__stage {
  /* 2026-11-06：真机上 transform 动画要提升为合成层才不会掉帧 */
  will-change: transform;
  touch-action: pan-y;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  /* 2026-11-04：卡片按内容收紧后下方会空一块，垂直居中让空白看起来是有意的留白 */
  justify-content: center;
  /* 2026-11-11：轨道左右两侧的邻居卡要裁掉，不能溢出屏幕 */
  overflow: hidden;
  position: relative;
}

/* 一条连续横向轨道：38 张表排在同一条线上，只有 translate3d 在动 */
.mr__track {
  /*
   * 不能用 absolute：那样它不占高度，舞台就只剩底部按钮那么高，
   * 卡片会被压扁、按钮还会浮到卡片中间（2026-11-11 踩过）。
   * 这里让它作为一个会伸缩的普通块，撑满按钮之外的空间。
   */
  position: relative;
  flex: 1;
  min-height: 0;
  width: 100%;
  will-change: transform;
  backface-visibility: hidden;
}

/*
 * 每一页绝对定位在自己的横坐标上（pageStyle 写 translate3d(i*w)），
 * 缩放与透明度同样由 pageStyle 按"离屏幕中心多远"实时算，
 * 于是拖动过程中两侧卡片是连续放大/缩小的，不是松手才跳。
 */
.mr__page {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 12rpx;
  box-sizing: border-box;
  will-change: transform, opacity;
  transform-origin: center center;
}

.mr__page-fill {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  justify-content: center;
  /*
   * 顶部对齐（2026-11-11）：原来垂直居中，卡片上下各空 ~200px，像页面坏了一半。
   * 现在贴近标签栏，剩下的空间全留在按钮上方 —— 一块空地，而不是两块。
   * 顺带好处：键盘弹出后输入框还在上半屏，不会被顶出去。
   */
  align-items: flex-start;
  padding-top: 8rpx;
}

.mr__page-fill .mr__card,
.mr__page-fill .mr__peek {
  width: 100%;
  box-sizing: border-box;
}

/*
 * 录入区（读数 + 用量）：先包一层，方便以后把"柜号/倍率/上次"做成信息格子时
 * 还能保持内部间距一致；现在它只是把两行的 gap 收紧一点。
 */
.mr__entry {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
  margin-top: 2rpx;
}

/* 邻居卡：只给"这是哪块表、上次多少、填没填"，不提供输入，避免误触 */
.mr__peek {
  width: 100%;
  /* 和可编辑卡差不多高：这样左右两张在缩放时是"同一张卡变小"，不会突然变矮 */
  min-height: 460rpx;
  max-height: 62vh;
  padding: 28rpx;
  border-radius: 28rpx;
  border: 2rpx solid var(--ui-border);
  border-left: 8rpx solid var(--ui-border-strong);
  background-color: var(--ui-surface);
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.mr__peek-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
  min-width: 0;
}

.mr__peek-no {
  font-size: 24rpx;
  font-weight: 700;
  color: var(--ui-text-2);
  padding: 2rpx 12rpx;
  border-radius: 10rpx;
  background-color: var(--ui-raise-2);
}

.mr__peek-name {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ui-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mr__peek-meta {
  font-size: 24rpx;
  color: var(--ui-text-2);
}

.mr__peek-value {
  margin-top: 8rpx;
  font-size: 44rpx;
  font-weight: 700;
  letter-spacing: 1rpx;
  color: var(--ui-text);
}

.mr__peek-hint {
  margin-top: auto;
  font-size: 24rpx;
  color: var(--ui-text-3);
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
  /* 进度统一用主色（2026-11-11）：橙只留给"异常/超期"，车间身份交给卡片左色条 */
  background-color: var(--ui-accent);
  transition: width 320ms cubic-bezier(0.22, 1, 0.36, 1), background-color 240ms ease;
}

.mr__progress-caret {
  margin-left: 6rpx;
  color: var(--ui-text-2);
}

/* 底部动作条（2026-11-11 收小）：提交按钮不再是"半屏大砖头"，左右翻页各给一个 104rpx 的方块 */
.mr__actions {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-top: 24rpx;
}

/* 左右翻页：原来这个类没有样式，只有一个 ‹ 字符，手指根本按不到 */
.mr__arrow {
  flex: none;
  width: 104rpx;
  height: 96rpx;
  border-radius: 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--ui-raise-2);
  border: 2rpx solid var(--ui-border);
}

.mr__arrow .mr__action-icon {
  font-size: 40rpx;
  line-height: 1;
  color: var(--ui-text-2);
}

.mr__action {
  flex: 1;
  height: 96rpx;
  border-radius: 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  font-size: 28rpx;
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
  margin-left: 6rpx;
  /* 2026-11-11：10.4px + 0.82 透明度放在蓝底上太糊了，抬到 12.5px 并提亮 */
  font-size: 24rpx;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.92);
  white-space: nowrap;
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
  /* 2026-11-06：弹层已挪到页面根，这里按模态抽屉重写：满屏遮罩 + 贴底 + 上圆角 */
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 900;
  display: flex;
  align-items: flex-end;
  background-color: rgba(24, 20, 16, 0.5);
  animation: mr-fade-in 160ms ease both;
}

@keyframes mr-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.mr__ps-panel {
  width: 100%;
  max-height: 82vh;
  padding: 16rpx 28rpx calc(28rpx + env(safe-area-inset-bottom));
  border-radius: 32rpx 32rpx 0 0;
  background-color: var(--ui-surface);
  box-shadow: 0 -12rpx 40rpx rgba(60, 50, 40, 0.18);
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
  /* 次级操作：不与上面两项同权重（2026-11-06） */
  height: 84rpx;
  line-height: 84rpx;
  margin-top: 4rpx;
  text-align: center;
  border-radius: 22rpx;
  font-size: 28rpx;
  color: var(--ui-text-2);
  background-color: transparent;
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
  white-space: nowrap;
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
  /* 2026-11-11：--ui-text-3 在白底上只有 3.1:1，12.5px 正文达不到 AA；
     改用 --ui-text-2（约 5.6:1），层级仍靠字号区分 */
  color: var(--ui-text-2);
}

/*
  信息条（2026-11-11）：柜号 / 上次读数 / 倍率 三格。
  原来是一行小字长句，读起来要一个个数；现在标签在上、数值在下，一眼对上。
*/
.mr__facts {
  display: flex;
  gap: 12rpx;
  margin-top: 18rpx;
}

.mr__fact {
  flex: 1;
  min-width: 0;
  padding: 14rpx 16rpx;
  border-radius: 14rpx;
  background-color: var(--ui-surface-2);
}

.mr__fact-k {
  display: block;
  font-size: 20rpx;
  color: var(--ui-text-2);
  letter-spacing: 1rpx;
}

.mr__fact-v {
  display: block;
  margin-top: 4rpx;
  font-size: 26rpx;
  font-weight: 600;
  color: var(--ui-text);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mr__fact-line {
  display: flex;
  align-items: baseline;
  gap: 8rpx;
}

.mr__fact-d {
  font-size: 20rpx;
  color: var(--ui-text-2);
  font-variant-numeric: tabular-nums;
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
  color: var(--ui-text-2);
}

.mr__unit {
  font-size: 24rpx;
  color: var(--ui-text-2);
}

.mr__usage-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4rpx;
}

.mr__usage-label {
  font-size: 24rpx;
  color: var(--ui-text-2);
}

.mr__usage {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--ui-text-2);
  font-variant-numeric: tabular-nums;

  &.is-ok {
    color: #4c5f42;
  }

  &.is-bad {
    color: #9a4a1e;
  }

  /* 没填读数时这里只是占位：不要用粗体抢读数输入框的视觉重量 */
  &.is-empty {
    font-size: 26rpx;
    font-weight: 400;
    color: var(--ui-text-2);
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
  margin-top: 14rpx;
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
  /* 用 wd-icon 的相机，不再用 emoji（emoji 在不同安卓机上是彩色贴纸，和整套线性图标不搭） */
  display: inline-flex;
  align-items: center;
  gap: 10rpx;
  padding: 18rpx 24rpx;
  border-radius: 16rpx;
  border: 2rpx dashed var(--ui-border);
  font-size: 26rpx;
  color: var(--ui-text-2);
}

.mr__photo-icon {
  color: var(--ui-text-2);
}

.mr__photo-add-text {
  line-height: 1;
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

/* 2026-11-06：滑动已改成翻页，方向色带（提交/跳过）不再显示。
   这里用覆盖隐藏而不是删结构 —— 上一版用正则删它时误删了整张卡片主体（155 行），
   教训：改配对标签不要用非贪婪正则跨行匹配。 */
.mr__intent {
  display: none !important;
}
</style>
