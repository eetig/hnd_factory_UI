<template>
  <view class="sn vt--pane">
    <view class="sn__intro">
      <text class="sn__intro-text">
        点一下就是复制，粘给新电脑的 DSH，它自己就装好了。
      </text>
    </view>

    <view class="sn__bar">
      <view class="sn__search">
        <text class="sn__search-icon">🔍</text>
        <input
          v-model="keyword"
          class="sn__search-input"
          placeholder="搜名字或说明，比如 rea、部署、cad"
          placeholder-class="sn__search-ph"
          confirm-type="search"
        />
        <text v-if="keyword" class="sn__search-clear" @click="keyword = ''">✕</text>
      </view>

      <!-- 分类胶囊：和密码页同一套果冻药丸，点一下切、左右划也能切 -->
      <view class="sn__chips-wrap">
        <view
          class="sn__pill"
          :class="{ 'is-ready': pillReady, 'is-flow': pillFlowing }"
          :style="pillStyle"
        />
        <scroll-view
          class="sn__chips"
          scroll-x
          scroll-with-animation
          :show-scrollbar="false"
          :scroll-into-view="chipAnchor"
          @scroll="onChipsScroll"
        >
          <view class="sn__chips-inner">
            <view
              v-for="(item, index) in KINDS"
              :id="`sk-${index}`"
              :key="item.key"
              class="sn__kind"
              :class="{ 'is-on': index === activeKind }"
              @click="goKind(index)"
            >
              <text>{{ item.label }}</text>
              <text v-if="countOf(item.key)" class="sn__kind-n">{{ countOf(item.key) }}</text>
            </view>
          </view>
        </scroll-view>
      </view>
    </view>

    <view class="sn__pager">
      <!-- 一类一屏，左右滑换类；屏内上下滑是自己的事，不挡手势 -->
      <GesturePager
        v-if="pagerH"
        ref="pagerRef"
        v-model="pageIndex"
        :items="pages"
        item-key="key"
        :height="pagerH"
        :peek-scale="0"
        :peek-fade="0"
        :peek-inset="0"
        :window-radius="1"
        @update:progress="onProgress"
        @edge-drag="$emit('edge-drag', $event)"
        @edge-release="$emit('edge-release', $event)"
      >
        <template #default="{ item }">
          <view class="sn__page">
            <scroll-view class="sn__page-scroll" scroll-y :show-scrollbar="false">
              <view
                v-for="row in item.rows"
                :key="row.id"
                class="sn__card"
                @click="useItem(row)"
                @longpress="openSheet(row)"
              >
                <view class="sn__card-head">
                  <text class="sn__name">{{ row.name }}</text>
                  <text class="sn__copy">复制</text>
                </view>
                <text v-if="row.desc" class="sn__desc">{{ row.desc }}</text>
                <text class="sn__snippet">{{ brief(row.text) }}</text>
              </view>

              <view v-if="!item.rows.length" class="sn__empty">
                <text class="sn__empty-title">{{ emptyTitle(item) }}</text>
                <text class="sn__empty-text">{{ emptyText(item) }}</text>
                <view
                  v-if="all.length && keyword.trim() && item.key !== 'all'"
                  class="sn__empty-btn"
                  @click="goKind(0)"
                >看全部 {{ all.length }} 条</view>
              </view>

              <view class="sn__sync">
                <text class="sn__sync-text">{{ syncText }}</text>
              </view>
            </scroll-view>
          </view>
        </template>
      </GesturePager>
    </view>

    <view class="sn__bottom">
      <view class="sn__add" @click="goEdit()">＋ 记一条</view>
    </view>
  </view>
</template>

<script setup>
import { computed, getCurrentInstance, nextTick, onMounted, ref, watch } from 'vue'
import GesturePager from '../GesturePager.vue'
import { copyToClipboard } from '../../utils/clipboard'
import { lastSyncedAt, pullAndMerge, readSnippets, removeSnippet } from '../../utils/vault'

const KINDS = [
  { key: 'all', label: '全部' },
  { key: 'pkg', label: '安装包' },
  { key: 'mcp', label: 'MCP' },
  { key: 'skill', label: 'Skill' },
]

/* 条目一多就翻不动了（25 条时使用方原话：「想找个 skill 得翻好久」）。
 * 分类不额外存字段，直接看名字前缀 —— 条目本来就按 `包 · ` / `mcp · ` / `skill · ` 命名，
 * 以后新增照这个前缀起名，分类自动对上，不用维护第二份数据。 */
const KIND_ORDER = { pkg: 0, mcp: 1, skill: 2 }

function kindOf(row) {
  const name = String(row.name || '')
  if (name.startsWith('包')) return 'pkg'
  if (name.startsWith('skill')) return 'skill'
  // 「密码箱」这种老条目本身就是装 MCP 的，归到 mcp
  return 'mcp'
}

const all = ref([])
const keyword = ref('')

const matched = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  const rows = all.value.filter((row) => {
    if (!q) return true
    return [row.name, row.desc, row.text].some((field) => String(field || '').toLowerCase().includes(q))
  })
  return rows.sort((a, b) => (KIND_ORDER[kindOf(a)] ?? 9) - (KIND_ORDER[kindOf(b)] ?? 9))
})

/* 四类各占一屏，左右滑换类。搜索不清屏 —— 每屏各自过滤，
 * 这样「别的类里有、这一类没有」一眼就看出来，不用退回去重搜。 */
const pages = computed(() =>
  KINDS.map((item) => ({
    ...item,
    rows: item.key === 'all' ? matched.value : matched.value.filter((row) => kindOf(row) === item.key),
  })),
)

/* 跟随搜索：搜的时候数字是「命中几条」，不搜才是「一共几条」——
 * 不然搜索时胶囊上还挂着 26，看的人会以为没过滤 */
function countOf(key) {
  if (key === 'all') return matched.value.length
  return matched.value.filter((row) => kindOf(row) === key).length
}

function emptyTitle(item) {
  if (!all.value.length) return '还没记过'
  if (keyword.value.trim()) return item.key === 'all' ? `没搜到「${keyword.value.trim()}」` : '这一类里没搜到'
  return `${item.label} 这格还空着`
}

function emptyText(item) {
  if (!all.value.length) {
    return '以后我看到好用的，你让我记一下，我读完就写在这儿。你自己刷到了也可以点下面加。'
  }
  if (keyword.value.trim()) return '换个词试试，或者左右滑到别的类看看。'
  return '还没有归到这一类的。点下面「＋ 记一条」加一个，或者左右滑回「全部」。'
}

/* 到头之后多出来的位移交给宿主，让它带着整条轨道跟手 */
const emit = defineEmits(['edge-drag', 'edge-release'])

const inst = getCurrentInstance()
const pagerRef = ref(null)
const pagerH = ref(0)
const pageIndex = ref(0)
const floatIndex = ref(0)
/* 药丸和当前屏都跟这个走：滑动过程中是小数，取整才知道「现在是第几类」 */
const activeKind = computed(() => {
  const max = KINDS.length - 1
  return Math.min(max, Math.max(0, Math.round(floatIndex.value)))
})
const chipAnchor = computed(() => `sk-${activeKind.value}`)

function onProgress(value) {
  floatIndex.value = Number(value) || 0
}

function goKind(index) {
  pageIndex.value = Math.max(0, Math.min(KINDS.length - 1, index))
}

/* 轨道是绝对定位的，高度必须由外面量出来给它，否则整块塌成 0 */
function measurePager() {
  if (!inst || !inst.proxy) return
  uni
    .createSelectorQuery()
    .in(inst.proxy)
    .select('.sn__pager')
    .boundingClientRect((rect) => {
      if (rect && rect.height) pagerH.value = Math.round(rect.height)
      if (pagerRef.value) pagerRef.value.measure()
    })
    .exec()
}

/* 果冻药丸：和密码页同一套做法，量真实胶囊矩形，滚动时重新对账 */
const pillReady = ref(false)
const pillFlowing = ref(false)
const pillStyle = ref({ left: '0px', width: '0px' })
const chipsScrollLeft = ref(0)
let chipRects = []
let flowTimer = 0

function syncPill() {
  const rect = chipRects[activeKind.value]
  if (!rect) return
  pillStyle.value = {
    left: `${Math.round(rect.left - chipsScrollLeft.value)}px`,
    width: `${Math.round(rect.width)}px`,
  }
  pillReady.value = true
}

function measureChips() {
  if (!inst || !inst.proxy) return
  const query = uni.createSelectorQuery().in(inst.proxy)
  query.select('.sn__chips').boundingClientRect()
  query.selectAll('.sn__kind').boundingClientRect()
  query.exec((res) => {
    const box = res && res[0]
    const list = (res && res[1]) || []
    if (!box || !list.length) return
    chipRects = list.map((rect) => ({
      left: rect.left - box.left + chipsScrollLeft.value,
      width: rect.width,
    }))
    syncPill()
  })
}

function onChipsScroll(event) {
  chipsScrollLeft.value = (event && event.detail && event.detail.scrollLeft) || 0
  syncPill()
}

watch(activeKind, () => {
  syncPill()
  pillFlowing.value = false
  if (flowTimer) clearTimeout(flowTimer)
  flowTimer = setTimeout(() => {
    pillFlowing.value = true
  }, 16)
  setTimeout(() => {
    pillFlowing.value = false
  }, 520)
})

watch(pageIndex, (value) => {
  if (Math.abs(value - floatIndex.value) > 0.01) floatIndex.value = value
})

/* 搜完/同步完条数变了，药丸宽度跟着变 */
watch(
  () => pages.value.map((page) => page.rows.length).join('|'),
  () => nextTick(measureChips),
)

const syncedAt = ref('')
const syncing = ref(false)
const syncError = ref('')

const syncText = computed(() => {
  if (syncing.value) return '正在同步…'
  if (syncError.value) return `同步失败：${syncError.value}`
  const at = syncedAt.value
  if (!at) return '还没同步过'
  // 服务器的时间串是 UTC，slice 出来会小 8 小时，换成手机本地时分
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return '刚同步'
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `刚同步 · ${hh}:${mm}`
})

function refresh() {
  all.value = readSnippets()
  syncedAt.value = lastSyncedAt()
}

async function sync() {
  if (syncing.value) return
  syncing.value = true
  syncError.value = ''
  try {
    await pullAndMerge()
    refresh()
  } catch (err) {
    syncError.value = (err && err.message) || '网络不通'
  } finally {
    syncing.value = false
  }
}

/* 常驻在宿主轨道里：页面 onShow 不触发，宿主每次回到本页时调 reload() */
async function reload() {
  refresh()
  nextTick(() => {
    measurePager()
    measureChips()
  })
  await sync()
}

defineExpose({
  reload,
  /** 从「密码」那栏往左滑过来时，落在第一类（全部）上 */
  focusFirst() {
    if (pagerRef.value) pagerRef.value.goTo(0)
  },
})

onMounted(() => {
  nextTick(() => {
    measurePager()
    measureChips()
  })
})

/** 卡片上只放前三行，剩下的留白，反正点一下就是复制整段 */
function brief(text) {
  const raw = String(text || '').trim()
  if (!raw) return ''
  const lines = raw.split('\n').filter((line) => line.trim())
  const head = lines.slice(0, 3).join('\n')
  return lines.length > 3 ? `${head}\n…` : head
}

async function useItem(row) {
  const ok = await copyToClipboard(row.text, `${row.name} 的安装说明`)
  if (ok) {
    uni.showToast({ title: '已复制，去电脑上粘给 DSH', icon: 'none' })
  }
}

function openSheet(row) {
  uni.showActionSheet({
    itemList: ['复制这段话', '改一下', '删掉'],
    success: ({ tapIndex }) => {
      if (tapIndex === 0) {
        useItem(row)
        return
      }
      if (tapIndex === 1) {
        goEdit(row.id)
        return
      }
      uni.showModal({
        title: '删掉这条？',
        content: '电脑那边同步下来也会跟着没。',
        confirmText: '删',
        confirmColor: '#D14343',
        success: ({ confirm }) => {
          if (!confirm) return
          removeSnippet(row.id)
          refresh()
          uni.showToast({ title: '删了', icon: 'none' })
        },
      })
    },
  })
}

function goEdit(id) {
  const query = id ? `?id=${encodeURIComponent(id)}` : ''
  uni.navigateTo({ url: `/pages/vault/snippet${query}` })
}
</script>

<style lang="scss" scoped>
.sn {
  display: flex;
  flex-direction: column;
  /* 常驻在宿主双栏轨道里，高度由栏位给 */
  height: 100%;
  background: var(--ui-bg);
  overflow: hidden;
}

.sn__intro {
  padding: 4rpx 32rpx 8rpx;
}

.sn__intro-text {
  font-size: 24rpx;
  line-height: 1.7;
  color: var(--ui-text-2);
}

.sn__tabs {
  position: relative;
  display: flex;
  gap: 10rpx;
  margin: 0 16rpx;
  padding: 6rpx;
  border-radius: 22rpx;
  background: var(--ui-raise, var(--ui-surface));
}

/* 白底块跟着哪一格走到哪，文字只换颜色 */
.sn__seg-pill {
  position: absolute;
  left: 6rpx;
  top: 6rpx;
  bottom: 6rpx;
  width: calc(50% - 11rpx);
  border-radius: 18rpx;
  background: var(--ui-surface);
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.06);
  transition: transform 260ms cubic-bezier(0.22, 0.68, 0.16, 1);
}

.sn__seg-pill.is-right {
  transform: translateX(calc(100% + 10rpx));
}

.sn__tab {
  position: relative;
  z-index: 1;
  flex: 1;
  height: 64rpx;
  line-height: 64rpx;
  text-align: center;
  font-size: 28rpx;
  color: var(--ui-text-2);
  border-radius: 18rpx;
  transition: color 180ms ease;
}

.sn__tab.is-on {
  color: var(--ui-text);
  font-weight: 600;
}

.sn__bar {
  padding: 8rpx 16rpx 0;
}

.sn__search {
  display: flex;
  align-items: center;
  gap: 12rpx;
  height: 80rpx;
  padding: 0 24rpx;
  border-radius: 20rpx;
  background: var(--ui-surface);
}

.sn__search-icon {
  font-size: 26rpx;
  opacity: 0.5;
}

.sn__search-input {
  flex: 1;
  font-size: 28rpx;
  color: var(--ui-text);
}

.sn__search-ph {
  color: var(--ui-text-3);
}

.sn__search-clear {
  font-size: 26rpx;
  color: var(--ui-text-3);
  padding: 8rpx;
}

.sn__chips-wrap {
  position: relative;
  flex: none;
  padding-top: 14rpx;
}

/* 果冻药丸：和密码页同一套，切换先滑过去再压扁回弹 */
.sn__pill {
  position: absolute;
  top: 14rpx;
  left: 0;
  height: 58rpx;
  border-radius: 999rpx;
  background: var(--ui-text);
  opacity: 0;
  transition: left 380ms cubic-bezier(0.22, 1.2, 0.36, 1),
    width 380ms cubic-bezier(0.22, 1.2, 0.36, 1);

  &.is-ready {
    opacity: 1;
  }

  &.is-flow {
    animation: sn-pill-flow 460ms cubic-bezier(0.34, 1.2, 0.64, 1);
  }
}

@keyframes sn-pill-flow {
  0% {
    transform: scaleX(1) scaleY(1);
  }
  28% {
    transform: scaleX(1.14) scaleY(0.78);
  }
  52% {
    transform: scaleX(0.94) scaleY(1.08);
  }
  76% {
    transform: scaleX(1.04) scaleY(0.97);
  }
  100% {
    transform: scaleX(1) scaleY(1);
  }
}

.sn__chips {
  width: 100%;
  position: relative;
  z-index: 1;
  white-space: nowrap;
}

.sn__chips-inner {
  display: inline-flex;
  align-items: center;
  gap: 12rpx;
  padding: 0 2rpx;
}

.sn__kind {
  display: inline-flex;
  align-items: baseline;
  gap: 6rpx;
  height: 58rpx;
  line-height: 58rpx;
  padding: 0 22rpx;
  border-radius: 999rpx;
  font-size: 25rpx;
  color: var(--ui-text-2);
  background: var(--ui-surface);
  transition: background 0.18s ease, color 0.18s ease;
}

.sn__kind.is-on {
  color: var(--ui-bg);
  /* 底色交给药丸层，胶囊自己透明，滑动时底色才连续 */
  background: transparent;
  font-weight: 600;
}

.sn__kind-n {
  font-size: 20rpx;
  opacity: 0.55;
}

.sn__pager {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
  margin-top: 8rpx;
}

.sn__page {
  height: 100%;
  padding: 8rpx 16rpx 0;
  box-sizing: border-box;
}

.sn__page-scroll {
  height: 100%;
}

.sn__empty-btn {
  margin: 28rpx auto 0;
  width: 400rpx;
  height: 76rpx;
  line-height: 76rpx;
  border-radius: 999rpx;
  font-size: 26rpx;
  color: var(--ui-on-accent);
  background: var(--ui-accent);
}

.sn__card {
  padding: 24rpx 26rpx;
  margin-bottom: 16rpx;
  border-radius: 22rpx;
  background: var(--ui-surface);
}

.sn__card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}

.sn__name {
  flex: 1;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.sn__copy {
  flex-shrink: 0;
  padding: 6rpx 18rpx;
  border-radius: 999rpx;
  font-size: 23rpx;
  color: var(--ui-accent);
  background: var(--ui-accent-soft);
}

.sn__desc {
  display: block;
  margin-top: 10rpx;
  font-size: 25rpx;
  line-height: 1.6;
  color: var(--ui-text-2);
}

.sn__snippet {
  display: block;
  margin-top: 14rpx;
  padding: 16rpx 18rpx;
  border-radius: 14rpx;
  font-size: 22rpx;
  line-height: 1.6;
  color: var(--ui-text-3);
  background: var(--ui-raise);
  word-break: break-all;
}

.sn__empty {
  padding: 110rpx 32rpx;
  text-align: center;
}

.sn__empty-title {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.sn__empty-text {
  display: block;
  margin: 20rpx auto 0;
  max-width: 540rpx;
  font-size: 26rpx;
  line-height: 1.7;
  color: var(--ui-text-2);
}

.sn__sync {
  padding: 24rpx 0 40rpx;
  text-align: center;
}

.sn__sync-text {
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.sn__bottom {
  padding: 12rpx 16rpx calc(12rpx + env(safe-area-inset-bottom));
}

.sn__add {
  height: 96rpx;
  line-height: 96rpx;
  text-align: center;
  border-radius: 24rpx;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ui-on-accent);
  background: var(--ui-accent);
}
</style>
