<template>
  <view class="vt" :class="themeClass" :style="[themeVars, frameStyle]" @touchstart="onEdgeStart" @touchend="onEdgeEnd">
    <PageTitle title="密码箱" />

    <view v-if="!allowed" class="vt__deny">
      <text class="vt__deny-title">只有管理员能看</text>
      <text class="vt__deny-text">这是你自己账号的密码。换个管理员账号登录才有。</text>
    </view>

    <template v-else>
      <!-- 一级只有两格：拿它去「查密码」，还是去「抄配方」 -->
      <view class="vt__tabs">
        <view class="vt__tab is-on">密码</view>
        <view class="vt__tab" @click="goSnippets">配方</view>
      </view>

      <!-- 搜索 + 状态 -->
      <view class="vt__bar">
        <view class="vt__search">
          <text class="vt__search-icon">🔍</text>
          <input
            v-model="keyword"
            class="vt__search-input"
            placeholder="搜名称 / 地址 / 用户"
            placeholder-class="vt__search-ph"
            confirm-type="search"
          />
          <text v-if="keyword" class="vt__search-clear" @click="keyword = ''">✕</text>
        </view>
      </view>

      <!-- 组胶囊：手指滑到哪组，它就跟着亮；点一下也能直接跳过去 -->
      <view v-if="items.length && groups.length" class="vt__chips-wrap">
        <!-- 果冻药丸：垫在文字下面，换组时横撑竖压地流过去（照「采购需求」那页） -->
        <view
          class="vt__pill"
          :class="{ 'is-ready': pillReady, 'is-flow': pillFlowing }"
          :style="pillStyle"
        />
        <scroll-view
          class="vt__chips"
          scroll-x
          scroll-with-animation
          :show-scrollbar="false"
          :scroll-into-view="chipAnchor"
          @scroll="onChipsScroll"
        >
          <view class="vt__chips-inner">
            <view
              v-for="(group, index) in groups"
              :id="`vc-${index}`"
              :key="group.name"
              class="vt__chip-tab"
              :class="{ 'is-on': index === activeChip }"
              @click="goGroup(index)"
            >
              <text>{{ group.name }}</text>
              <text v-if="group.items.length" class="vt__chip-num">{{ group.items.length }}</text>
            </view>
          </view>
        </scroll-view>
      </view>

      <view class="vt__meta">
        <text class="vt__meta-strong">{{ searching ? `搜到 ${hitCount} 条` : `${items.length} 条` }}</text>
        <text class="vt__meta-rest">{{ syncText }}</text>
      </view>

      <view class="vt__pager">
        <!-- 一组一屏，左右滑换组；每屏里上下滑是自己的事，不挡手势 -->
        <GesturePager
          v-if="items.length && groups.length && pagerH"
          ref="pagerRef"
          v-model="pageIndex"
          :items="groups"
          item-key="name"
          :height="pagerH"
          :peek-scale="0"
          :peek-fade="0"
          :peek-inset="0"
          :window-radius="1"
          @update:progress="onProgress"
        >
          <template #default="{ item }">
            <view class="vt__page">
              <scroll-view class="vt__page-scroll" scroll-y :show-scrollbar="false">
                <view
                  v-for="row in item.items"
                  :key="row.id"
                  class="vt__card"
                  @click="useItem(row)"
                  @longpress="openSheet(row)"
                >
                  <view class="vt__card-top">
                    <text class="vt__card-name">{{ row.name }}</text>
                    <text class="vt__chip">{{ typeLabel(row.type) }}</text>
                  </view>
                  <view class="vt__line">
                    <text class="vt__line-key">地址</text>
                    <text class="vt__line-val">{{ addressOf(row) || '没填' }}</text>
                  </view>
                  <view v-if="row.username" class="vt__line">
                    <text class="vt__line-key">用户</text>
                    <text class="vt__line-val">{{ row.username }}</text>
                  </view>
                  <view class="vt__line">
                    <text class="vt__line-key">密码</text>
                    <text class="vt__line-pass">{{ row.password || '（空）' }}</text>
                  </view>
                  <text v-if="row.note" class="vt__note">{{ row.note }}</text>
                </view>

                <view v-if="!item.items.length" class="vt__page-empty">
                  <text class="vt__page-empty-title">{{ item.name }} 这组还空着</text>
                  <text class="vt__page-empty-text">点下面「＋ 记一条」，会直接记到这一组。</text>
                </view>

                <!-- 备份藏在最底下：平时用不到，换手机才用 -->
                <view v-if="item.items.length" class="vt__foot">
                  <text class="vt__foot-link" @click="openBackup">换手机时用（备份 / 导入）</text>
                </view>
              </scroll-view>
            </view>
          </template>
        </GesturePager>

        <!-- 空：两种情况，话不一样 -->
        <view v-else-if="!items.length" class="vt__empty">
          <text class="vt__empty-title">还没拉下来</text>
          <text class="vt__empty-text">
            电脑上的密码会自动同步过来。要是网不好，先点下面这个按钮，把内置的几条装上顶一下。
          </text>
          <view class="vt__empty-btn" @click="doSeed">载入我电脑上的这几条</view>
          <text class="vt__empty-tip">以后在电脑上跟 DSH 说「帮我记一下 XX」，这里就有了。</text>
        </view>

        <view v-else-if="!groups.length" class="vt__empty">
          <text class="vt__empty-title">没搜到「{{ keyword }}」</text>
          <text class="vt__empty-text">换个词试试，或者点搜索框右边的叉清掉关键词。</text>
        </view>
      </view>

      <view class="vt__bottom">
        <view class="vt__add" @click="addHere">＋ 记一条</view>
      </view>
    </template>

    <!-- 备份弹层 -->
    <AppPopup v-model="backupVisible" position="bottom" round custom-style="background-color: var(--ui-surface);">
      <view class="bk">
        <text class="bk__title">备份 / 导入</text>
        <text class="bk__hint">换手机、换账号时用。平时不用管，电脑上的会自动同步。</text>

        <view class="bk__row">
          <view class="bk__btn" @click="doExport">复制全部</view>
          <!-- #ifdef H5 -->
          <view class="bk__btn" @click="doDownload">下载文件</view>
          <!-- #endif -->
        </view>

        <textarea
          v-model="importText"
          class="bk__area"
          placeholder="把导出的内容粘在这里，然后点下面「导入」"
          placeholder-class="bk__area-ph"
          :maxlength="-1"
        />
        <view class="bk__btn bk__btn--main" @click="doImport">导入（重复的会跳过）</view>
      </view>
    </AppPopup>
  </view>
</template>

<script setup>
import { computed, getCurrentInstance, nextTick, onMounted, ref, watch } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import PageTitle from '../../components/PageTitle.vue'
import AppPopup from '../../components/AppPopup.vue'
import GesturePager from '../../components/GesturePager.vue'
import { useTheme } from '../../composables/useTheme'
import { usePageFrame } from '../../composables/usePageFrame'
import { useEdgeSwipe } from '../../composables/useEdgeSwipe'
import { isAdmin } from '../../api/auth'
import { copyToClipboard } from '../../utils/clipboard'
import {
  HOME_GROUPS,
  addressOf,
  buildBackupText,
  groupItems,
  importBackup,
  lastSyncedAt,
  migrateGrouping,
  pullAndMerge,
  readItems,
  removeItem,
  seedBuiltin,
  sortGroupItems,
  touchItem,
  typeLabel,
} from '../../utils/vault'

const { themeClass, themeVars } = useTheme()
const { frameStyle } = usePageFrame()
const { onTouchStart: onEdgeStart, onTouchEnd: onEdgeEnd } = useEdgeSwipe(() => uni.navigateBack())

const allowed = computed(() => isAdmin())
const items = ref([])
const keyword = ref('')
const backupVisible = ref(false)
const importText = ref('')
const syncedAt = ref('')
const syncing = ref(false)
const syncError = ref('')

const grouped = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return groupItems(items.value)

  const hit = items.value.filter((item) =>
    [item.name, item.host, item.username, item.note, item.group, typeLabel(item.type)]
      .join(' ')
      .toLowerCase()
      .includes(q)
  )
  const buckets = new Map()
  hit.forEach((item) => {
    const name = item.group || '未分组'
    if (!buckets.has(name)) buckets.set(name, [])
    buckets.get(name).push(item)
  })
  return Array.from(buckets.entries()).map(([name, rows]) => ({ name, items: sortGroupItems(rows) }))
})

const syncText = computed(() => {
  if (syncing.value) return '正在同步…'
  if (syncError.value) return `同步失败：${syncError.value}`
  const at = syncedAt.value
  if (!at) return '还没同步过'
  // 服务器返回的是 UTC 时间串，直接 slice 出来会比手机时间少 8 小时，
  // 看着像「刚同步 · 07:29」而手机上是 15:29 —— 换成当地时分
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return '刚同步'
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `刚同步 · ${hh}:${mm}`
})

/* ===== 一组一屏的横滑 ===== */

const inst = getCurrentInstance()
const pagerRef = ref(null)
const pagerH = ref(0)
const pageIndex = ref(0)
const floatIndex = ref(0)

const groups = computed(() => {
  const list = grouped.value
  // 搜索时只看命中的组，别让五张空页在那儿翻
  if (searching.value) return list
  if (!items.value.length) return []
  const byName = new Map(list.map((group) => [group.name, group]))
  // 五个归属组常驻：滑到「家里」就是空的，但记号时能直接记进去
  const homes = HOME_GROUPS.map((name) => byName.get(name) || { name, items: [] })
  const rest = list.filter((group) => !HOME_GROUPS.includes(group.name))
  return [...homes, ...rest]
})
const searching = computed(() => !!keyword.value.trim())
const hitCount = computed(() => groups.value.reduce((sum, group) => sum + group.items.length, 0))

/** 拖到一半时页号是小数，胶囊四舍五入亮最近的那组 */
const activeChip = computed(() => {
  const max = Math.max(0, groups.value.length - 1)
  return Math.min(max, Math.max(0, Math.round(floatIndex.value)))
})

const chipAnchor = computed(() => (groups.value.length ? `vc-${activeChip.value}` : ''))

/* 果冻药丸（2026-11-23，用户：「动画效果需要完善，参考着页面的」）
 * 照 采购需求 那页的做法：一个和胶囊同高同圆角的色块垫在文字下面，
 * 换组时先滑过去（left/width 过渡），再用 scaleX 撑开、scaleY 压扁回弹 —— 像一坨液体被挤着流过去。
 * 位置和宽度必须量真实胶囊矩形（名字长短不一，猜不得）；胶囊条自己还能横滚，所以滚动时重新对一次账。 */
const pillReady = ref(false)
const pillFlowing = ref(false)
const pillStyle = ref({ left: '0px', width: '0px' })
const chipsScrollLeft = ref(0)
let chipRects = []
let flowTimer = 0

function syncPill() {
  const rect = chipRects[activeChip.value]
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
  query.select('.vt__chips').boundingClientRect()
  query.selectAll('.vt__chip-tab').boundingClientRect()
  query.exec((res) => {
    const box = res && res[0]
    const list = (res && res[1]) || []
    if (!box || !list.length) return
    // 记「内容坐标」：加上当前滚动量，之后滚到哪都能换算回视口坐标
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

watch(activeChip, () => {
  syncPill()
  pillFlowing.value = false
  if (flowTimer) clearTimeout(flowTimer)
  // 下一帧再加 is-flow，否则同一个类连加两次不重启动画
  flowTimer = setTimeout(() => {
    pillFlowing.value = true
  }, 16)
  setTimeout(() => {
    pillFlowing.value = false
  }, 520)
})

// 组变了（搜索过滤 / 同步回来）要重新量，否则药丸还停在老位置
watch(
  () => groups.value.map((group) => group.name).join('|'),
  () => nextTick(measureChips),
)

function onProgress(value) {
  floatIndex.value = Number.isFinite(value) ? value : 0
}

function goGroup(index) {
  floatIndex.value = index
  if (pagerRef.value) pagerRef.value.goTo(index)
}

/** 轨道是绝对定位的，必须显式给高度 —— 量一次外层容器 */
function measurePager() {
  if (!inst || !inst.proxy) return
  uni
    .createSelectorQuery()
    .in(inst.proxy)
    .select('.vt__pager')
    .boundingClientRect((rect) => {
      if (rect && rect.height > 0) pagerH.value = Math.round(rect.height)
    })
    .exec()
}

watch(
  () => groups.value.length,
  (len) => {
    if (len && pageIndex.value > len - 1) pageIndex.value = len - 1
  }
)

function refresh() {
  migrateGrouping()
  items.value = readItems()
  syncedAt.value = lastSyncedAt()
}

/** 进页面静默拉一次：失败不弹窗，只在状态行里说一句，列表照旧能翻 */
async function sync() {
  if (syncing.value) return
  syncing.value = true
  syncError.value = ''
  try {
    await pullAndMerge()
    migrateGrouping()
    refresh()
  } catch (err) {
    syncError.value = (err && err.message) || '网络不通'
  } finally {
    syncing.value = false
  }
}

onShow(() => {
  refresh()
  nextTick(() => {
    measurePager()
    measureChips()
  })
  if (allowed.value) sync()
})

onMounted(() => {
  nextTick(() => {
    measurePager()
    measureChips()
  })
})

/** 点一下整张卡 = 复制密码（最常用的动作，不让人找按钮） */
async function useItem(item) {
  if (!item.password) {
    uni.showToast({ title: '这条没有密码，长按选别的', icon: 'none' })
    return
  }
  const ok = await copyToClipboard(item.password, '密码')
  if (ok) touchItem(item.id)
}

function openSheet(item) {
  const actions = ['复制密码', '复制用户名', '复制地址', '编辑这条', '删除这条']
  uni.showActionSheet({
    itemList: actions,
    success: async ({ tapIndex }) => {
      if (tapIndex === 0) {
        await copyToClipboard(item.password || '', '密码')
        return
      }
      if (tapIndex === 1) {
        await copyToClipboard(item.username || '', '用户名')
        return
      }
      if (tapIndex === 2) {
        await copyToClipboard(addressOf(item), '地址')
        return
      }
      if (tapIndex === 3) {
        goEdit(item.id)
        return
      }
      confirmRemove(item)
    },
  })
}

function confirmRemove(item) {
  uni.showModal({
    title: '删掉这条？',
    content: `${item.name} 删了就没了，电脑上同步下来也会跟着没。`,
    confirmText: '删',
    confirmColor: '#D14343',
    success: ({ confirm }) => {
      if (!confirm) return
      removeItem(item.id)
      refresh()
      uni.showToast({ title: '删了', icon: 'none' })
    },
  })
}

function goEdit(id, group) {
  const params = []
  if (id) params.push(`id=${encodeURIComponent(id)}`)
  else if (group) params.push(`group=${encodeURIComponent(group)}`)
  const query = params.length ? `?${params.join('&')}` : ''
  uni.navigateTo({ url: `/pages/vault/edit${query}` })
}

/** 「＋ 记一条」默认落到当前这一组，省一次挑选 */
function addHere() {
  const here = groups.value[activeChip.value]
  goEdit('', here ? here.name : '')
}

/** 切到「配方」页签：用 redirect 换页，返回键直接回首页，不在两页之间来回弹 */
function goSnippets() {
  uni.redirectTo({ url: '/pages/vault/snippets' })
}

function doSeed() {
  const added = seedBuiltin()
  refresh()
  uni.showToast({ title: added ? `装了 ${added} 条` : '已经是最全的了', icon: 'none' })
}

/* ===== 备份 ===== */

function openBackup() {
  importText.value = ''
  backupVisible.value = true
}

async function doExport() {
  if (!items.value.length) {
    uni.showToast({ title: '一条都没有，没什么可备份的', icon: 'none' })
    return
  }
  await copyToClipboard(buildBackupText(items.value), '备份内容')
}

/* #ifdef H5 */
function doDownload() {
  const payload = JSON.stringify(
    { app: 'hnd-vault', version: 1, exportedAt: new Date().toISOString(), items: items.value },
    null,
    2
  )
  const blob = new Blob([`# 密码备份，别乱发\n${payload}`], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `hnd-vault-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  uni.showToast({ title: '已下载', icon: 'none' })
}
/* #endif */

function doImport() {
  const result = importBackup(importText.value)
  if (result.error) {
    uni.showToast({ title: result.error, icon: 'none' })
    return
  }
  refresh()
  backupVisible.value = false
  const tail = result.skipped ? `，跳过重复 ${result.skipped} 条` : ''
  uni.showToast({ title: `新增 ${result.added} 条${tail}`, icon: 'none' })
}
</script>

<style lang="scss" scoped>
.vt {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--ui-bg);
  overflow: hidden;
}

.vt__deny {
  margin: 120rpx 40rpx;
  padding: 48rpx 32rpx;
  border-radius: 24rpx;
  background: var(--ui-surface);
  text-align: center;
}

.vt__deny-title {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.vt__deny-text {
  display: block;
  margin-top: 16rpx;
  font-size: 26rpx;
  line-height: 1.6;
  color: var(--ui-text-2);
}

.vt__tabs {
  display: flex;
  gap: 10rpx;
  margin: 0 28rpx;
  padding: 6rpx;
  border-radius: 22rpx;
  background: var(--ui-raise, var(--ui-surface));
}

.vt__tab {
  flex: 1;
  height: 64rpx;
  line-height: 64rpx;
  text-align: center;
  font-size: 28rpx;
  color: var(--ui-text-2);
  border-radius: 18rpx;
}

.vt__tab.is-on {
  color: var(--ui-text);
  font-weight: 600;
  background: var(--ui-surface);
}

.vt__bar {
  padding: 8rpx 28rpx 0;
}

.vt__search {
  display: flex;
  align-items: center;
  gap: 12rpx;
  height: 80rpx;
  padding: 0 24rpx;
  border-radius: 20rpx;
  background: var(--ui-surface);
}

.vt__search-icon {
  font-size: 26rpx;
  opacity: 0.5;
}

.vt__search-input {
  flex: 1;
  font-size: 28rpx;
  color: var(--ui-text);
}

.vt__search-ph {
  color: var(--ui-text-3);
}

.vt__search-clear {
  font-size: 26rpx;
  color: var(--ui-text-3);
  padding: 8rpx;
}

.vt__meta {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
  padding: 20rpx 32rpx 8rpx;
}

.vt__meta-strong {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.vt__meta-rest {
  font-size: 24rpx;
  color: var(--ui-text-3);
}

/* 组胶囊：横滑时跟着亮 */
.vt__chips-wrap {
  position: relative;
  flex: none;
  padding-top: 14rpx;
}

/* 果冻药丸：和胶囊同高同圆角，垫在文字下面；切换时先滑再回弹 */
.vt__pill {
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
    animation: vt-pill-flow 460ms cubic-bezier(0.34, 1.2, 0.64, 1);
  }
}

@keyframes vt-pill-flow {
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

.vt__chips {
  flex: none;
  width: 100%;
  position: relative;
  z-index: 1;
}

.vt__chips-inner {
  display: inline-flex;
  align-items: center;
  gap: 12rpx;
  padding: 0 28rpx;
}

.vt__chip-tab {
  display: inline-flex;
  align-items: baseline;
  gap: 6rpx;
  height: 58rpx;
  line-height: 58rpx;
  padding: 0 22rpx;
  border-radius: 999rpx;
  font-size: 26rpx;
  color: var(--ui-text-2);
  background: var(--ui-surface);
  transition: background 0.18s ease, color 0.18s ease;
}

.vt__chip-tab.is-on {
  color: var(--ui-bg);
  /* 底色交给药丸层画，胶囊自己透明 —— 滑动时底色才是连续的一整块 */
  background: transparent;
  font-weight: 600;
}

.vt__chip-num {
  font-size: 20rpx;
  opacity: 0.55;
}

/* 一组一屏的轨道 */
.vt__pager {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}

.vt__page {
  height: 100%;
}

.vt__page-scroll {
  height: 100%;
  padding: 8rpx 28rpx 24rpx;
  box-sizing: border-box;
}

.vt__page-empty {
  padding: 120rpx 32rpx;
  text-align: center;
}

.vt__page-empty-title {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ui-text-2);
}

.vt__page-empty-text {
  display: block;
  margin-top: 16rpx;
  font-size: 25rpx;
  line-height: 1.6;
  color: var(--ui-text-3);
}

.vt__scroll {
  flex: 1;
  height: 0;
  padding: 0 28rpx;
  box-sizing: border-box;
}

.vt__group {
  padding-top: 20rpx;
}

.vt__group-name {
  display: block;
  padding: 8rpx 8rpx 12rpx;
  font-size: 24rpx;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--ui-text-3);
}

.vt__card {
  padding: 24rpx 26rpx;
  margin-bottom: 16rpx;
  border-radius: 22rpx;
  background: var(--ui-surface);
}

.vt__card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}

.vt__card-name {
  flex: 1;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.vt__chip {
  flex-shrink: 0;
  padding: 4rpx 14rpx;
  border-radius: 999rpx;
  font-size: 22rpx;
  color: var(--ui-accent);
  background: var(--ui-accent-soft);
}

.vt__line {
  display: flex;
  align-items: baseline;
  gap: 14rpx;
  margin-top: 10rpx;
}

.vt__line-key {
  width: 60rpx;
  flex-shrink: 0;
  font-size: 24rpx;
  color: var(--ui-text-3);
}

.vt__line-val {
  flex: 1;
  font-size: 26rpx;
  color: var(--ui-text-2);
  word-break: break-all;
}

.vt__line-pass {
  flex: 1;
  font-size: 28rpx;
  font-weight: 600;
  color: var(--ui-text);
  word-break: break-all;
}

.vt__note {
  display: block;
  margin-top: 12rpx;
  font-size: 23rpx;
  line-height: 1.5;
  color: var(--ui-text-3);
}

.vt__empty {
  padding: 100rpx 32rpx 60rpx;
  text-align: center;
}

.vt__empty-title {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.vt__empty-text {
  display: block;
  margin: 20rpx auto 0;
  max-width: 560rpx;
  font-size: 26rpx;
  line-height: 1.7;
  color: var(--ui-text-2);
}

.vt__empty-btn {
  display: inline-block;
  margin-top: 40rpx;
  padding: 22rpx 48rpx;
  border-radius: 999rpx;
  font-size: 28rpx;
  font-weight: 600;
  color: var(--ui-on-accent);
  background: var(--ui-accent);
}

.vt__empty-tip {
  display: block;
  margin-top: 28rpx;
  font-size: 23rpx;
  color: var(--ui-text-3);
}

.vt__foot {
  padding: 40rpx 0 32rpx;
  text-align: center;
}

.vt__foot-link {
  font-size: 24rpx;
  color: var(--ui-text-3);
  text-decoration: underline;
}

.vt__bottom {
  padding: 16rpx 28rpx calc(16rpx + env(safe-area-inset-bottom));
}

.vt__add {
  height: 96rpx;
  line-height: 96rpx;
  text-align: center;
  border-radius: 24rpx;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ui-on-accent);
  background: var(--ui-accent);
}

/* 备份弹层 */
.bk {
  padding: 36rpx 32rpx calc(32rpx + env(safe-area-inset-bottom));
}

.bk__title {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.bk__hint {
  display: block;
  margin-top: 10rpx;
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--ui-text-3);
}

.bk__row {
  display: flex;
  gap: 20rpx;
  margin-top: 28rpx;
}

.bk__btn {
  flex: 1;
  height: 84rpx;
  line-height: 84rpx;
  text-align: center;
  border-radius: 20rpx;
  font-size: 27rpx;
  color: var(--ui-text);
  background: var(--ui-raise);
}

.bk__btn--main {
  margin-top: 24rpx;
  color: var(--ui-on-accent);
  background: var(--ui-accent);
}

.bk__area {
  width: 100%;
  height: 200rpx;
  margin-top: 24rpx;
  padding: 20rpx;
  box-sizing: border-box;
  border-radius: 20rpx;
  font-size: 24rpx;
  color: var(--ui-text);
  background: var(--ui-raise);
}

.bk__area-ph {
  color: var(--ui-text-3);
}
</style>
