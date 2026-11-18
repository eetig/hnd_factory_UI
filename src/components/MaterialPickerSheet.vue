<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import AppPopup from './AppPopup.vue'
import { useKeyboardLift } from '../composables/useKeyboardLift'
import {
  fetchMaterialDetail,
  fetchMaterialFacets,
  materialLookupError,
  pageMaterials,
} from '../composables/useMaterialMaster'

/**
 * 手机端物料选择器（2026-10-23，变更-159）。
 *
 * <p>为什么不是一个"物料主数据页"：手机上浏览 3 万条是反体验的 —— 用户要的是
 * 「打两个字、点一下、回填」，所以这里只有 搜索 + 类型胶囊 + 结果卡片，
 * 详情（罐类的评估类型价格表）按需在行内展开。
 *
 * <p>数据全部来自服务端筛选（/api/material/page），一次 30 条、滚到底再取下一页；
 * 前端不缓存全表、也不做本地过滤 —— 与 PC 主数据页同一套接口，两端行为不会漂。
 */
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 打开时预填的关键词：图片解析里是识别出来的物料名称 */
  initialKeyword: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'select'])

const PAGE_SIZE = 30

const keyword = ref('')
const typeCode = ref('')
const rows = ref([])
const total = ref(0)
const pageNum = ref(1)
const loading = ref(false)
const error = ref('')
const facets = ref({ total: 0, types: [] })

/** 展开价格表的物料编码（罐类才有；同一时间只展开一个） */
const openCode = ref('')
const valuations = ref([])
const detailLoading = ref(false)

const { keyboardHeight: liftHeight, start: startKeyboardLift, stop: stopKeyboardLift } =
  useKeyboardLift()

const popupStyle = computed(() => {
  const base =
    'max-height: 86vh; display: flex; flex-direction: column; background-color: var(--ui-sheet-fill); overscroll-behavior: contain;'
  const kb = liftHeight.value
  if (!kb) return base
  // 键盘弹起时用「底边上移 + 高度写成确定值」而不是 padding：
  // 弹层是 content-box，padding 会把顶边顶出屏幕（同 TankLevelFormDialog）
  return `${base} bottom: ${kb}px; padding-bottom: 0; height: min(86vh, calc(100vh - ${kb}px - 12px));`
})

/* 请求序号：快速输入时先发的可能后返回，用它丢弃过期响应 */
let listSeq = 0
let detailSeq = 0

async function loadPage({ reset = false } = {}) {
  const target = reset ? 1 : pageNum.value + 1
  const seq = ++listSeq
  loading.value = true
  error.value = ''

  const result = await pageMaterials({
    keyword: keyword.value,
    type: typeCode.value,
    pageNum: target,
    pageSize: PAGE_SIZE,
  })
  if (seq !== listSeq) return

  if (result.failed) {
    error.value = materialLookupError.value || '物料加载失败。'
    if (reset) {
      rows.value = []
      total.value = 0
    }
  } else {
    rows.value = reset ? result.rows : [...rows.value, ...result.rows]
    total.value = result.total
    pageNum.value = target
  }
  loading.value = false
}

/* 防抖 300ms：与 PC 物料页、图片解析原有手感一致 */
let debounceTimer = null
function onKeywordInput() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => loadPage({ reset: true }), 300)
}

function onKeywordConfirm() {
  clearTimeout(debounceTimer)
  loadPage({ reset: true })
}

function toggleType(code) {
  typeCode.value = typeCode.value === code ? '' : code
  loadPage({ reset: true })
}

function loadMore() {
  if (loading.value || rows.value.length >= total.value) return
  loadPage()
}

function pick(row) {
  emit('select', row)
  close()
}

function close() {
  emit('update:modelValue', false)
}

/** 罐类物料展开价格表：再点一次收起（详情只拉一次，收起不清缓存） */
async function togglePrices(row) {
  if (!row.valuationCount) return
  if (openCode.value === row.code) {
    openCode.value = ''
    return
  }
  openCode.value = row.code
  valuations.value = []
  const seq = ++detailSeq
  detailLoading.value = true
  const detail = await fetchMaterialDetail(row.code)
  if (seq !== detailSeq) return
  valuations.value = detail?.valuations ?? []
  detailLoading.value = false
}

/** 打开时初始化：关键词预填、回第一页、类型清空、展开状态清空 */
function resetForOpen() {
  keyword.value = props.initialKeyword || ''
  typeCode.value = ''
  rows.value = []
  total.value = 0
  pageNum.value = 1
  openCode.value = ''
  valuations.value = []
  error.value = ''
  fetchMaterialFacets().then((data) => {
    facets.value = data
  })
  loadPage({ reset: true })
}

// 组件可能是「页面一进来就打开」的（visible 初始 true）——watch 只监听变化，
// 初始值不会触发，所以这里补一次；否则会看到空列表 + 关键词没预填。
onMounted(() => {
  if (props.modelValue) {
    startKeyboardLift()
    resetForOpen()
  }
})

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) {
      clearTimeout(debounceTimer)
      listSeq += 1
      detailSeq += 1
      stopKeyboardLift()
      return
    }

    startKeyboardLift()
    resetForOpen()
  },
)

/* 价格：0 显示「未计价」（与 PC 一致，避免被读成免费）；价格单位 1000 要一起说清 */
function formatPrice(row) {
  const value = Number(row?.price)
  if (!row?.price && row?.price !== 0) return '—'
  if (!value) return '未计价'
  const unit = Number(row.priceUnit) || 1
  const text = value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return unit === 1 ? `¥${text}` : `¥${text}/${unit}`
}

function statusText(status) {
  if (status === 2) return '待停用'
  if (status === 0) return '停用'
  return ''
}
</script>

<template>
  <AppPopup
    :model-value="modelValue"
    position="bottom"
    round
    safe-area-inset-bottom
    :custom-style="popupStyle"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <view class="mp">
      <view class="mp__grabber"></view>

      <view class="mp__head">
        <text class="mp__title">选择物料</text>
        <view class="mp__close" @click="close">
          <wd-icon name="close" size="18px" />
        </view>
      </view>

      <view class="mp__search">
        <wd-icon name="search" size="14px" />
        <input
          v-model="keyword"
          class="mp__search-input"
          type="text"
          placeholder="物料编码 / 名称"
          placeholder-class="mp__ph"
          confirm-type="search"
          @input="onKeywordInput"
          @confirm="onKeywordConfirm"
        />
      </view>

      <!-- 类型胶囊：横向滚动，点一下收窄、再点取消 -->
      <scroll-view class="mp__chips" scroll-x>
        <view
          v-for="item in facets.types"
          :key="item.code"
          class="mp__chip"
          :class="{ 'is-active': typeCode === item.code }"
          @click="toggleType(item.code)"
        >
          <view class="mp__chip-dot" :style="{ backgroundColor: item.color || '#94a3b8' }"></view>
          <text>{{ item.label }}</text>
          <text class="mp__chip-count">{{ item.count }}</text>
        </view>
      </scroll-view>

      <scroll-view class="mp__list" scroll-y @scrolltolower="loadMore">
        <view v-if="error" class="mp__state">
          <text>{{ error }}</text>
        </view>
        <view v-else-if="!rows.length && loading" class="mp__state">
          <text>检索中…</text>
        </view>
        <view v-else-if="!rows.length" class="mp__state">
          <text>{{ keyword.trim() ? '没有匹配的物料，换个关键词试试。' : '输入编码或名称开始搜索。' }}</text>
        </view>

        <template v-else>
          <view v-for="item in rows" :key="item.code" class="mp__item">
            <view class="mp__item-main" @click="pick(item)">
              <view class="mp__item-line">
                <text class="mp__code">{{ item.code }}</text>
                <text v-if="statusText(item.status)" class="mp__status">{{ statusText(item.status) }}</text>
                <text v-if="item.valuationCount" class="mp__val" @click.stop="togglePrices(item)">
                  {{ item.valuationCount }} 种状态价 {{ openCode === item.code ? '▴' : '▾' }}
                </text>
              </view>
              <text class="mp__name">{{ item.name }}</text>
              <view class="mp__meta">
                <text class="mp__type" :style="{ color: item.typeColor || '' }">{{ item.typeName }}</text>
                <text class="mp__unit">{{ item.unit || '—' }}</text>
                <text class="mp__price" :class="{ 'is-zero': !Number(item.price) }">{{ formatPrice(item) }}</text>
              </view>
            </view>

            <!-- 罐类：评估类型价格表（点「N 种状态价」展开） -->
            <view v-if="openCode === item.code" class="mp__prices">
              <text v-if="detailLoading" class="mp__prices-loading">读取价格…</text>
              <view v-for="price in valuations" :key="price.type" class="mp__price-row">
                <text class="mp__price-label">{{ price.label }}</text>
                <text class="mp__price-value">¥{{ Number(price.price || 0).toFixed(2) }}</text>
              </view>
            </view>
          </view>

          <view class="mp__more">
            <text v-if="loading">加载中…</text>
            <text v-else-if="rows.length < total">上滑加载更多</text>
            <text v-else>共 {{ total }} 个物料</text>
          </view>
        </template>
      </scroll-view>
    </view>
  </AppPopup>
</template>

<style scoped lang="scss">
.mp {
  display: flex;
  height: 78vh;
  flex-direction: column;

  &__grabber {
    width: 72rpx;
    height: 8rpx;
    margin: 20rpx auto 0;
    border-radius: 999rpx;
    background-color: $ui-raise-3;
  }

  &__head {
    display: flex;
    align-items: center;
    padding: 16rpx 32rpx 8rpx;
  }

  &__title {
    flex: 1;
    color: $ui-text;
    font-size: 34rpx;
    font-weight: 600;
  }

  &__close {
    display: flex;
    width: 56rpx;
    height: 56rpx;
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
    display: flex;
    align-items: center;
    gap: 12rpx;
    margin: 8rpx 32rpx 0;
    padding: 14rpx 20rpx;
    border: 1px solid $ui-border;
    border-radius: $ui-radius-pill;
    background-color: $ui-surface-2;
    color: $ui-text-3;
  }

  &__search-input {
    flex: 1;
    color: $ui-text;
    font-size: 28rpx;
  }

  &__ph {
    color: $ui-text-3;
  }

  &__chips {
    flex-shrink: 0;
    width: auto;
    padding: 16rpx 24rpx 4rpx;
    white-space: nowrap;
  }

  &__chip {
    display: inline-flex;
    height: 56rpx;
    align-items: center;
    gap: 8rpx;
    margin-right: 12rpx;
    padding: 0 18rpx;
    border: 1px solid $ui-hairline;
    border-radius: $ui-radius-pill;
    background-color: $ui-raise;
    color: $ui-text-2;
    font-size: 24rpx;

    &.is-active {
      border-color: $ui-accent-strong;
      background-color: $ui-accent-soft;
      color: $ui-accent-text;
    }
  }

  &__chip-dot {
    width: 12rpx;
    height: 12rpx;
    border-radius: 50%;
  }

  &__chip-count {
    color: $ui-text-3;
    font-size: 22rpx;
  }

  &__list {
    min-height: 0;
    // uni.css 给 uni-scroll-view 写死 width:100%（不吃 padding）—— 不写 auto，卡片会比弹层宽出 24rpx
    width: auto;
    flex: 1;
    padding: 8rpx 24rpx calc(24rpx + env(safe-area-inset-bottom));
  }

  &__state {
    padding: 60rpx 20rpx;
    color: $ui-text-3;
    font-size: 26rpx;
    text-align: center;
  }

  &__item {
    margin-top: 12rpx;
    overflow: hidden;
    border: 1px solid $ui-hairline;
    border-radius: $ui-radius-md;
    background-color: $ui-surface;
  }

  &__item-main {
    padding: 20rpx 20rpx 16rpx;

    &:active {
      background-color: $ui-raise-2;
    }
  }

  &__item-line {
    display: flex;
    align-items: center;
    gap: 12rpx;
  }

  &__code {
    color: $ui-text-2;
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 24rpx;
  }

  &__status {
    padding: 2rpx 10rpx;
    border-radius: $ui-radius-pill;
    background-color: $ui-raise-2;
    color: $ui-text-3;
    font-size: 20rpx;
  }

  &__val {
    margin-left: auto;
    padding: 2rpx 12rpx;
    border-radius: $ui-radius-pill;
    background-color: $ui-accent-soft;
    color: $ui-accent-text;
    font-size: 20rpx;
  }

  &__name {
    display: block;
    margin-top: 6rpx;
    color: $ui-text;
    font-size: 28rpx;
    line-height: 1.4;
  }

  &__meta {
    display: flex;
    align-items: center;
    gap: 16rpx;
    margin-top: 8rpx;
  }

  &__type {
    font-size: 22rpx;
  }

  &__unit {
    color: $ui-text-3;
    font-size: 22rpx;
  }

  &__price {
    margin-left: auto;
    color: $ui-text-2;
    font-size: 24rpx;

    &.is-zero {
      color: $ui-text-3;
    }
  }

  &__prices {
    padding: 8rpx 20rpx 16rpx;
    border-top: 1px solid $ui-hairline;
    background-color: $ui-raise;
  }

  &__prices-loading {
    color: $ui-text-3;
    font-size: 22rpx;
  }

  &__price-row {
    display: flex;
    justify-content: space-between;
    padding: 6rpx 0;
  }

  &__price-label {
    color: $ui-text-2;
    font-size: 24rpx;
  }

  &__price-value {
    color: $ui-text;
    font-size: 24rpx;
  }

  &__more {
    padding: 24rpx 0 8rpx;
    color: $ui-text-3;
    font-size: 22rpx;
    text-align: center;
  }
}
</style>
