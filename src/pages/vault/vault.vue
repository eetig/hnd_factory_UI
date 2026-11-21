<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { isAdmin } from '../../api/auth'
import { useTheme } from '../../composables/useTheme'
import { usePageFrame } from '../../composables/usePageFrame'
import { useEdgeSwipe } from '../../composables/useEdgeSwipe'
import PageTitle from '../../components/PageTitle.vue'
import AppPopup from '../../components/AppPopup.vue'
import { copyToClipboard } from '../../utils/clipboard'
import {
  addressOf,
  buildBackupText,
  importBackup,
  listGroups,
  readItems,
  sortGroupItems,
  touchItem,
  typeLabel,
} from '../../utils/vault'

/*
 * 密码箱（2026-11-21）
 *
 * 使用方原话：「账号密码太多太复杂，本地开发也要用，按 PC 分类记一下，能查方便就行；
 * 泄露无所谓，但只有管理员能看，这是我自己账号的密码」。
 *
 * ## 这一页只做三件事
 * 找得到（搜索 + 按分组平铺）、看了能抄（一键复制）、复制完不误点（点卡片才进编辑）。
 *
 * ## 为什么列表直接显示密码框而不是详情页
 * 查密码的人只有一个动作：拿到那串字符。多一层详情就多一次点击，
 * 所以卡片上就能「看一眼」、就能复制，点卡片才是去改。
 *
 * ## 数据只在本地
 * 整包存在 uni.setStorage 里，不走接口。换机/重装前用右上「备份」导出，
 * 这段提示也写在备份弹层里，不是只写在注释里。
 */
const { themeClass, themeVars } = useTheme()
const { frameStyle } = usePageFrame()
// 左上角不再有三横线按钮：从屏幕左缘右滑返回（全站同一套手势）
const { onTouchStart: onEdgeStart, onTouchEnd: onEdgeEnd } = useEdgeSwipe(() => uni.navigateBack())

const allowed = computed(() => isAdmin())

/** 只数真有东西的组：顺序表里留着空组给下次用，但报给用户看的数量不该把空的算上 */
const groupCount = computed(() => new Set(items.value.map((item) => item.group || '未分组')).size)

const items = ref([])
const keyword = ref('')
/** 已经被点开明文的那几条（离开本页就复位，不记在存储里） */
const revealed = ref([])

const backupOpen = ref(false)
const importText = ref('')
const importing = ref(false)

const grouped = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  const all = items.value
  const matched = k
    ? all.filter((item) => {
        const hay = [item.name, item.host, item.username, item.note, item.group]
          .join(' ')
          .toLowerCase()
        return hay.includes(k)
      })
    : all

  // 搜索结果里也要保持「分组 → 组内最近使用」的顺序，所以复用同一套归堆逻辑：
  // 用过滤后的条目喂进去，空组自然被丢掉
  const order = listGroups(all)
  const buckets = new Map()
  order.forEach((name) => buckets.set(name, []))
  matched.forEach((item) => {
    const name = item.group || '未分组'
    if (!buckets.has(name)) {
      buckets.set(name, [])
      order.push(name)
    }
    buckets.get(name).push(item)
  })

  return order
    .map((name) => ({
      name,
      items: sortGroupItems(buckets.get(name) || []),
    }))
    .filter((group) => group.items.length)
})

function refresh() {
  if (!allowed.value) return
  items.value = readItems()
}

// 从编辑页回来要看到新内容：新增、改名、删除都发生在那一边
onShow(refresh)

function openEdit(item) {
  const url = item ? `/pages/vault/edit?id=${item.id}` : '/pages/vault/edit'
  uni.navigateTo({ url })
}

function isRevealed(id) {
  return revealed.value.includes(id)
}

function toggleReveal(id) {
  revealed.value = isRevealed(id)
    ? revealed.value.filter((row) => row !== id)
    : [...revealed.value, id]
}

/**
 * 复制某个字段。
 *
 * 复制成功才记一次「用过」——失败那次不该把它顶到组内最前面。
 * 这里不立刻重排列表：正看着的那张卡突然跳走比排序过时更烦，下次进页面自然就对了。
 */
async function copyField(item, field) {
  const map = {
    password: { text: item.password, label: '密码' },
    username: { text: item.username, label: '用户名' },
    address: { text: addressOf(item), label: '地址' },
  }
  const hit = map[field]
  if (!hit || !hit.text) {
    uni.showToast({ title: `这条没填${hit ? hit.label : '内容'}`, icon: 'none' })
    return
  }
  const ok = await copyToClipboard(hit.text, hit.label)
  if (ok) touchItem(item.id)
}

function openBackup() {
  backupOpen.value = true
}

function closeBackup() {
  backupOpen.value = false
  importText.value = ''
}

function doExport() {
  const text = buildBackupText(items.value)
  copyToClipboard(text, '整份备份').then((ok) => {
    if (ok) {
      uni.showToast({
        title: '已复制，粘到微信文件传输助手存着',
        icon: 'none',
        duration: 2600,
      })
    }
  })
}

/** H5 才能下载文件：App 端没有浏览器下载这一套，只能走剪贴板 */
function doDownload() {
  // #ifdef H5
  try {
    const blob = new Blob([buildBackupText(items.value)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 10)
    link.href = url
    link.download = `hnd-vault-${stamp}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    uni.showToast({ title: '已下载到浏览器下载目录', icon: 'none' })
  } catch (e) {
    uni.showToast({ title: '下载失败，改用复制到剪贴板', icon: 'none' })
  }
  // #endif
}

function doImport() {
  if (importing.value) return
  importing.value = true
  try {
    const result = importBackup(importText.value)
    if (result.error) {
      uni.showToast({ title: result.error, icon: 'none', duration: 2600 })
      return
    }
    if (!result.added && !result.skipped) {
      uni.showToast({ title: '这份内容里没有条目', icon: 'none' })
      return
    }
    refresh()
    closeBackup()
    const parts = [`新增 ${result.added} 条`]
    if (result.skipped) parts.push(`跳过重复 ${result.skipped} 条`)
    uni.showToast({ title: parts.join('，'), icon: 'none', duration: 2600 })
  } finally {
    importing.value = false
  }
}

function backupCount() {
  return items.value.length
}
</script>

<template>
  <view
    class="vt"
    :class="themeClass"
    :style="[themeVars, frameStyle]"
    @touchstart="onEdgeStart"
    @touchend="onEdgeEnd"
  >
    <PageTitle title="密码箱" />

    <!-- 不是管理员：连条数和搜索都不给，免得看起来像「有内容但打不开」 -->
    <view v-if="!allowed" class="vt__deny">
      <text class="vt__deny-title">只有管理员能看</text>
      <text class="vt__deny-text">这里是你自己账号的密码，只对管理员开放。</text>
    </view>

    <template v-else>
      <view class="vt__bar">
        <view class="vt__search">
          <input
            v-model="keyword"
            class="vt__input"
            type="text"
            confirm-type="search"
            placeholder="搜名称 / 主机 / 用户名 / 备注"
            placeholder-class="vt__placeholder"
          />
          <text v-if="keyword" class="vt__clear" @click="keyword = ''">清空</text>
        </view>
        <view class="vt__backup-btn" @click="openBackup">
          <text class="vt__backup-text">备份</text>
        </view>
      </view>

      <view class="vt__stat">
        <text class="vt__stat-main">{{ items.length }} 条</text>
        <text class="vt__stat-sub">{{ groupCount }} 个分组 · 只存在这台手机</text>
      </view>

      <scroll-view class="vt__list" scroll-y>
        <view v-for="group in grouped" :key="group.name" class="vt__group">
          <view class="vt__group-head">
            <text class="vt__group-name">{{ group.name }}</text>
            <text class="vt__group-count">{{ group.items.length }}</text>
          </view>

          <view
            v-for="item in group.items"
            :key="item.id"
            class="vt__card"
            @click="openEdit(item)"
          >
            <view class="vt__card-head">
              <text class="vt__name">{{ item.name }}</text>
              <text class="vt__type">{{ typeLabel(item.type) }}</text>
            </view>

            <view class="vt__line">
              <text v-if="addressOf(item)" class="vt__addr">{{ addressOf(item) }}</text>
              <text v-if="item.username" class="vt__user">{{ item.username }}</text>
              <text v-if="!addressOf(item) && !item.username" class="vt__muted">没填地址和用户名</text>
            </view>

            <view v-if="item.password" class="vt__secret">
              <text class="vt__secret-label">密码</text>
              <text class="vt__secret-text" :class="{ 'is-open': isRevealed(item.id) }">
                {{ isRevealed(item.id) ? item.password : '••••••••' }}
              </text>
              <text class="vt__eye" @click.stop="toggleReveal(item.id)">
                {{ isRevealed(item.id) ? '收起' : '看一眼' }}
              </text>
            </view>

            <text v-if="item.note" class="vt__note">{{ item.note }}</text>

            <!-- 复制是这一页最高频的动作，所以三颗按钮常驻，不等长按也不进详情 -->
            <view class="vt__chips">
              <view class="vt__chip vt__chip--main" @click.stop="copyField(item, 'password')">
                复制密码
              </view>
              <view class="vt__chip" @click.stop="copyField(item, 'username')">用户名</view>
              <view
                v-if="addressOf(item)"
                class="vt__chip"
                @click.stop="copyField(item, 'address')"
              >
                地址
              </view>
            </view>
          </view>
        </view>

        <view v-if="!items.length" class="vt__empty">
          <text class="vt__empty-title">还一条都没记</text>
          <text class="vt__empty-text">
            点下面「记一条」，把服务器、数据库、后台的账号密码存进来。分组直接输名字就行，
            比如「公司电脑」「腾讯云」「家里服务器」。
          </text>
        </view>

        <view v-else-if="!grouped.length" class="vt__empty">
          <text class="vt__empty-title">没找到「{{ keyword }}」</text>
          <text class="vt__empty-text">换个名字、IP 或用户名试试；备注里的字也能搜到。</text>
        </view>

        <view class="vt__bottom-space"></view>
      </scroll-view>

      <view class="vt__foot">
        <view class="vt__add" @click="openEdit(null)">
          <text class="vt__add-plus">＋</text>
          <text class="vt__add-text">记一条</text>
        </view>
      </view>
    </template>

    <!-- 备份与恢复：不做独立的设置页，一年用两次的东西不该占一个入口 -->
    <AppPopup
      v-model="backupOpen"
      position="bottom"
      round
      custom-style="background-color: var(--ui-surface);"
    >
      <view class="bk">
        <view class="bk__head">
          <text class="bk__title">备份</text>
          <text class="bk__close" @click="closeBackup">关闭</text>
        </view>

        <text class="bk__note">
          这 {{ backupCount() }} 条只存在这台手机里，不上传服务器。换手机、重装 App
          之前导出一份，粘到微信文件传输助手或电脑上存着。
        </text>

        <view class="bk__row" @click="doExport">
          <text class="bk__row-title">导出：复制整份到剪贴板</text>
          <text class="bk__row-sub">粘到任何能存文字的地方都行</text>
        </view>

        <!-- #ifdef H5 -->
        <view class="bk__row" @click="doDownload">
          <text class="bk__row-title">导出：下载 .json 文件</text>
          <text class="bk__row-sub">浏览器才有，App 里用上面那条</text>
        </view>
        <!-- #endif -->

        <text class="bk__label">恢复：把之前导出的内容整段粘进来</text>
        <textarea
          v-model="importText"
          class="bk__area"
          placeholder="以 { 或 [ 开头的那一整段"
          placeholder-class="vt__placeholder"
          :maxlength="-1"
        />

        <view class="bk__merge" :class="{ 'is-busy': importing }" @click="doImport">
          {{ importing ? '正在导入…' : '合并导入' }}
        </view>
        <text class="bk__hint">同分组同名的会跳过，不会覆盖你现在记的。</text>
      </view>
    </AppPopup>
  </view>
</template>

<style lang="scss" scoped>
.vt {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 0 20rpx;
  box-sizing: border-box;
  background-color: var(--ui-bg);
}

/* ---------- 非管理员 ---------- */
.vt__deny {
  margin-top: 120rpx;
  padding: 40rpx 32rpx;
  border-radius: 24rpx;
  background-color: var(--ui-surface);
  text-align: center;
}

.vt__deny-title {
  display: block;
  font-size: 34rpx;
  font-weight: 700;
  color: var(--ui-text);
}

.vt__deny-text {
  display: block;
  margin-top: 12rpx;
  font-size: 26rpx;
  line-height: 1.7;
  color: var(--ui-text-3);
}

/* ---------- 搜索 + 备份 ---------- */
.vt__bar {
  display: flex;
  flex-shrink: 0;
  gap: 12rpx;
  align-items: center;
}

.vt__search {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8rpx;
  height: 76rpx;
  padding: 0 8rpx 0 22rpx;
  border-radius: 18rpx;
  border: 2rpx solid var(--ui-border);
  background-color: var(--ui-surface);
  box-sizing: border-box;
}

.vt__input {
  flex: 1;
  height: 72rpx;
  font-size: 26rpx;
  color: var(--ui-text);
}

.vt__placeholder {
  color: var(--ui-text-3);
}

.vt__clear {
  padding: 0 14rpx;
  height: 56rpx;
  line-height: 56rpx;
  border-radius: 14rpx;
  background-color: var(--ui-raise);
  font-size: 24rpx;
  color: var(--ui-text-2);
}

.vt__backup-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 76rpx;
  padding: 0 24rpx;
  border-radius: 18rpx;
  background-color: var(--ui-raise);
}

.vt__backup-text {
  font-size: 26rpx;
  color: var(--ui-text-2);
}

/* ---------- 统计一行 ---------- */
.vt__stat {
  display: flex;
  flex-shrink: 0;
  align-items: baseline;
  gap: 12rpx;
  padding: 14rpx 8rpx 6rpx;
}

.vt__stat-main {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--ui-text);
  font-variant-numeric: tabular-nums;
}

.vt__stat-sub {
  font-size: 22rpx;
  color: var(--ui-text-3);
}

/* ---------- 列表 ---------- */
.vt__list {
  flex: 1;
  min-height: 0;
}

.vt__group {
  margin-top: 14rpx;
}

.vt__group-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 6rpx 8rpx 10rpx;
}

.vt__group-name {
  font-size: 24rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: var(--ui-text-2);
}

.vt__group-count {
  font-size: 20rpx;
  color: var(--ui-text-3);
  font-variant-numeric: tabular-nums;
}

.vt__card {
  margin-bottom: 14rpx;
  padding: 20rpx 22rpx 16rpx;
  border-radius: 22rpx;
  background-color: var(--ui-surface);
}

.vt__card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}

.vt__name {
  flex: 1;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.vt__type {
  flex-shrink: 0;
  padding: 4rpx 14rpx;
  border-radius: 999rpx;
  background-color: var(--ui-accent-soft);
  font-size: 20rpx;
  color: var(--ui-accent-text, var(--ui-text-2));
}

.vt__line {
  display: flex;
  align-items: center;
  gap: 14rpx;
  margin-top: 8rpx;
}

.vt__addr {
  font-size: 24rpx;
  color: var(--ui-text-2);
  font-variant-numeric: tabular-nums;
}

.vt__user {
  font-size: 24rpx;
  color: var(--ui-text-2);
}

.vt__muted {
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.vt__secret {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-top: 8rpx;
  padding: 8rpx 14rpx;
  border-radius: 12rpx;
  background-color: var(--ui-raise);
}

.vt__secret-label {
  font-size: 20rpx;
  color: var(--ui-text-3);
}

.vt__secret-text {
  flex: 1;
  font-size: 24rpx;
  letter-spacing: 2rpx;
  color: var(--ui-text-2);
  word-break: break-all;
}

/* 明文用等宽感 + 更实的字色：一眼能分出「这是真密码」和「这是打码」 */
.vt__secret-text.is-open {
  font-weight: 600;
  letter-spacing: 0;
  color: var(--ui-text);
}

.vt__eye {
  flex-shrink: 0;
  padding: 0 6rpx;
  font-size: 22rpx;
  color: var(--ui-accent-text, var(--ui-accent));
}

.vt__note {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  line-height: 1.6;
  color: var(--ui-text-3);
}

.vt__chips {
  display: flex;
  gap: 10rpx;
  margin-top: 14rpx;
}

.vt__chip {
  flex: 1;
  height: 64rpx;
  line-height: 64rpx;
  border-radius: 14rpx;
  background-color: var(--ui-raise);
  font-size: 24rpx;
  color: var(--ui-text-2);
  text-align: center;
}

/* 最高频的那颗给一点点强调，但不做成主按钮：一屏里三颗同样重的按钮才不打架 */
.vt__chip--main {
  background-color: var(--ui-accent-soft);
  color: var(--ui-accent-text, var(--ui-text));
  font-weight: 600;
}

.vt__empty {
  padding: 72rpx 28rpx;
  text-align: center;
}

.vt__empty-title {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.vt__empty-text {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  line-height: 1.8;
  color: var(--ui-text-3);
}

.vt__bottom-space {
  height: 24rpx;
}

/* ---------- 底部主操作 ---------- */
.vt__foot {
  flex-shrink: 0;
  padding: 14rpx 0 calc(14rpx + env(safe-area-inset-bottom));
}

.vt__add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
  height: 92rpx;
  border-radius: 24rpx;
  background-color: var(--ui-accent);
}

.vt__add-plus {
  font-size: 34rpx;
  font-weight: 600;
  color: var(--ui-on-accent);
}

.vt__add-text {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ui-on-accent);
}

/* ---------- 备份弹层 ---------- */
.bk {
  padding: 26rpx 28rpx 10rpx;
}

.bk__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.bk__title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--ui-text);
}

.bk__close {
  font-size: 26rpx;
  color: var(--ui-text-3);
}

.bk__note {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  line-height: 1.7;
  color: var(--ui-text-3);
}

.bk__row {
  margin-top: 16rpx;
  padding: 18rpx 22rpx;
  border-radius: 18rpx;
  background-color: var(--ui-raise);
}

.bk__row-title {
  display: block;
  font-size: 26rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.bk__row-sub {
  display: block;
  margin-top: 4rpx;
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.bk__label {
  display: block;
  margin-top: 24rpx;
  font-size: 24rpx;
  color: var(--ui-text-2);
}

.bk__area {
  width: 100%;
  height: 180rpx;
  margin-top: 10rpx;
  padding: 16rpx 18rpx;
  border-radius: 16rpx;
  border: 2rpx solid var(--ui-border);
  background-color: var(--ui-bg);
  box-sizing: border-box;
  font-size: 24rpx;
  line-height: 1.5;
  color: var(--ui-text);
}

.bk__merge {
  margin-top: 16rpx;
  height: 84rpx;
  line-height: 84rpx;
  border-radius: 20rpx;
  border: 2rpx solid var(--ui-accent);
  font-size: 28rpx;
  font-weight: 600;
  color: var(--ui-accent-text, var(--ui-accent));
  text-align: center;
}

.bk__merge.is-busy {
  opacity: 0.6;
}

.bk__hint {
  display: block;
  padding: 12rpx 0 6rpx;
  font-size: 22rpx;
  line-height: 1.6;
  color: var(--ui-text-3);
  text-align: center;
}
</style>
