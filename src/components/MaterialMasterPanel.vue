<script setup>
import { computed, onMounted, ref } from 'vue'
import AppPopup from './AppPopup.vue'
import { fetchMaterialDetail, fetchMaterialFacets, pageMaterials } from '../composables/useMaterialMaster'
import { copyRowField } from '../utils/clipboard'

/*
 * 物料主数据（手机端，2026-10-23，变更-164）
 *
 * 为什么手机上是"搜 + 分页 + 详情"，而不是 PC 那种三段式表格：
 *   主数据 30,434 行（编码 30,392 个，一个编码可能有 7 种评估类型），
 *   手机上既放不下表格也不能一次拉全 —— 所以：
 *     · **检索与筛选都在服务端**（/api/material/page 支持 keyword/type/status）；
 *     · 只在"停手 320ms"后才发请求（与物料选择器同一套节流），不做逐字过滤；
 *     · 列表卡片只放"看一眼够用"的字段，罐类的 N 种状态价点开详情才拉。
 *   PC 的"列顺序/列显隐"在手机上不适用 —— 使用方 2026-10-23 明确"手机上不需要"。
 */

const keyword = ref('')
const typeFilter = ref('')
const rows = ref([])
const total = ref(0)
const facetTotal = ref(0)
const types = ref([])
const loading = ref(false)
const loadingMore = ref(false)
const loadError = ref('')
const pageNum = ref(1)
const PAGE_SIZE = 20

let searchTimer = null
let seq = 0

const hasMore = computed(() => rows.value.length < total.value)

async function loadFacets() {
  const facets = await fetchMaterialFacets()
  facetTotal.value = Number(facets?.total) || 0
  types.value = Array.isArray(facets?.types) ? facets.types : []
}

async function loadPage({ append = false } = {}) {
  const mySeq = ++seq
  if (append) loadingMore.value = true
  else loading.value = true
  loadError.value = ''

  const res = await pageMaterials({
    keyword: keyword.value.trim(),
    type: typeFilter.value,
    pageNum: append ? pageNum.value : 1,
    pageSize: PAGE_SIZE,
  })

  // 打字连发时先发的可能后回：丢掉过期响应
  if (mySeq !== seq) return

  if (res.failed) {
    loadError.value = '加载失败，点一下重试'
    rows.value = append ? rows.value : []
    total.value = 0
  } else {
    rows.value = append ? [...rows.value, ...res.rows] : res.rows
    total.value = res.total
    if (!append) pageNum.value = 1
  }

  loading.value = false
  loadingMore.value = false
}

/** 停手 320ms 再查（与 MaterialPickerSheet 一致） */
function scheduleSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    loadFacets()
    loadPage()
  }, 320)
}

function pickType(type) {
  typeFilter.value = typeFilter.value === type ? '' : type
  loadPage()
}

function searchNow() {
  clearTimeout(searchTimer)
  loadPage()
}

async function loadMore() {
  if (!hasMore.value || loadingMore.value) return
  pageNum.value += 1
  await loadPage({ append: true })
}

onMounted(() => {
  loadFacets()
  loadPage()
})

// ===== 详情 =====
const detailOpen = ref(false)
const detailRow = ref(null)
const detail = ref(null)
const detailLoading = ref(false)

async function openDetail(row) {
  detailRow.value = row
  detail.value = null
  detailOpen.value = true
  detailLoading.value = true
  detail.value = await fetchMaterialDetail(row.code)
  detailLoading.value = false
}

function closeDetail() {
  detailOpen.value = false
}

/** 罐类的"评估类型价格"表；后端没给就是空（普通物料只有一条主档价） */
const valuations = computed(() => {
  const list = detail.value?.valuations
  return Array.isArray(list) ? list : []
})

function statusText(row) {
  const status = Number(row?.status ?? 1)
  if (status === 0) return '停用'
  if (status === 2) return '待停用'
  return '正常'
}

function statusTone(row) {
  const status = Number(row?.status ?? 1)
  if (status === 0) return 'is-off'
  if (status === 2) return 'is-warn'
  return ''
}

function priceText(row) {
  const price = row?.price
  if (price === null || price === undefined || price === '') return '未计价'
  const unit = row?.priceUnit && Number(row.priceUnit) > 1 ? `/${row.priceUnit}` : ''
  return `¥${price}${unit}`
}

/*
 * ⚠️ `/api/material/page` 的字段是 code / name / typeName / typeCode / valuationCount，
 * **不是** materialCode / materialName（2026-10-23 实测抓到一次：卡片上名称全是"—"）。
 * 复制口径仍按 materialName / materialCode / spec 三个语义键，所以在这里做一层映射。
 */
function normRow(row) {
  return { materialName: row?.name, materialCode: row?.code, spec: row?.spec }
}

async function onLongPress(row, key) {
  await copyRowField(normRow(row), key)
}

const popupStyle =
  'max-height: 84vh; display: flex; flex-direction: column; background-color: var(--ui-sheet-fill); overscroll-behavior: contain;'
</script>

<template>
  <view class="mm">
    <view class="mm__bar">
      <input
        v-model="keyword"
        class="mm__search"
        placeholder="名称 / 编码 / 规格"
        placeholder-style="color: var(--ui-text-3)"
        confirm-type="search"
        @input="scheduleSearch"
        @confirm="searchNow"
      />
    </view>

    <view class="mm__summary">
      <text>共 {{ facetTotal || total }} 条主数据</text>
      <text v-if="typeFilter" class="mm__clear" @click="pickType(typeFilter)">× 取消筛选</text>
    </view>

    <scroll-view class="mm__chips" scroll-x enable-flex>
      <view
        v-for="item in types"
        :key="item.code"
        class="mm__chip"
        :class="{ 'is-on': typeFilter === item.code }"
        @click="pickType(item.code)"
      >
        <text>{{ item.label || item.code }}{{ item.count != null ? ` ${item.count}` : '' }}</text>
      </view>
    </scroll-view>

    <view v-if="loadError" class="mm__error" @click="searchNow">
      <text>{{ loadError }}</text>
    </view>

    <view class="mm__list">
      <view
        v-for="row in rows"
        :key="`${row.code}-${row.valuationType || ''}`"
        class="mm__card"
        @click="openDetail(row)"
      >
        <view class="mm__card-top">
          <text class="mm__code" @click.stop @longpress.stop="onLongPress(row, 'materialCode')">{{ row.code }}</text>
          <view class="mm__status" :class="statusTone(row)">
            <text>{{ statusText(row) }}</text>
          </view>
          <text class="mm__price">{{ priceText(row) }}</text>
        </view>

        <view class="mm__card-name" @click.stop @longpress.stop="onLongPress(row, 'materialName')">
          <text>{{ row.name || '—' }}</text>
        </view>

        <view class="mm__card-meta">
          <text v-if="row.typeName" class="mm__tag">{{ row.typeName }}</text>
          <text v-if="row.unit" class="mm__dim">{{ row.unit }}</text>
          <text v-if="row.spec" class="mm__dim mm__dim--grow" @click.stop @longpress.stop="onLongPress(row, 'spec')">
            {{ row.spec }}
          </text>
        </view>
      </view>

      <view v-if="!rows.length && !loading" class="mm__empty">
        <text>{{ loadError ? '加载失败' : '没有匹配的物料' }}</text>
      </view>
      <view v-else-if="hasMore" class="mm__more" @click="loadMore">
        <text>{{ loadingMore ? '正在加载…' : `加载更多（已显示 ${rows.length} / ${total}）` }}</text>
      </view>
      <view v-else-if="rows.length" class="mm__more">
        <text>共 {{ total }} 条，到底了</text>
      </view>
      <view class="mm__hint">
        <text>长按编码 / 名称 / 规格复制单项；点卡片看详情</text>
      </view>
    </view>

    <AppPopup
      v-model="detailOpen"
      position="bottom"
      round
      safe-area-inset-bottom
      :duration="280"
      :custom-style="popupStyle"
      @close="closeDetail"
    >
      <view class="md">
        <view class="md__grabber"></view>
        <view class="md__head">
          <text class="md__title">{{ detailRow?.name || '物料详情' }}</text>
          <text class="md__close" @click="closeDetail">关闭</text>
        </view>

        <scroll-view class="md__body" scroll-y>
          <view class="md__row">
            <text class="md__label">物料编码</text>
            <text class="md__value" @longpress="onLongPress(detailRow, 'materialCode')">{{ detailRow?.code || '—' }}</text>
          </view>
          <view class="md__row">
            <text class="md__label">规格型号</text>
            <text class="md__value" @longpress="onLongPress(detailRow, 'spec')">{{ detailRow?.spec || '—' }}</text>
          </view>
          <view class="md__row">
            <text class="md__label">物料类型</text>
            <text class="md__value">{{ detailRow?.typeName || '—' }}</text>
          </view>
          <view class="md__row">
            <text class="md__label">基本单位</text>
            <text class="md__value">{{ detailRow?.unit || '—' }}</text>
          </view>
          <view class="md__row">
            <text class="md__label">价格</text>
            <text class="md__value">{{ priceText(detailRow) }}</text>
          </view>
          <view class="md__row">
            <text class="md__label">状态</text>
            <text class="md__value">{{ statusText(detailRow) }}</text>
          </view>
          <view v-if="detailRow?.changedAt" class="md__row">
            <text class="md__label">上次更改</text>
            <text class="md__value">{{ detailRow.changedAt }}</text>
          </view>
          <view v-if="detailRow?.creator" class="md__row">
            <text class="md__label">创建人</text>
            <text class="md__value">{{ detailRow.creator }}</text>
          </view>

          <view v-if="detailLoading" class="md__tip">
            <text>正在加载评估类型价格…</text>
          </view>

          <view v-else-if="valuations.length" class="md__valuations">
            <text class="md__group-title">{{ valuations.length }} 种评估类型价</text>
            <view v-for="item in valuations" :key="item.valuationType" class="md__valuation">
              <text class="md__valuation-type">{{ item.valuationType || '主档' }}</text>
              <text class="md__valuation-price">{{ item.price != null ? `¥${item.price}` : '未计价' }}</text>
              <text v-if="item.unit" class="md__valuation-unit">{{ item.unit }}</text>
            </view>
          </view>
        </scroll-view>
      </view>
    </AppPopup>
  </view>
</template>

<style lang="scss" scoped>
/* 自然流 + 整页滚动（同 PurchaseDemandPanel 的说明） */
.mm {
  padding: 16rpx 20rpx 40rpx;
  box-sizing: border-box;
}

.mm__bar {
  flex-shrink: 0;
}

.mm__search {
  height: 72rpx;
  padding: 0 22rpx;
  border-radius: 36rpx;
  font-size: 26rpx;
  color: var(--ui-text);
  background-color: var(--ui-raise-2);
  border: 2rpx solid var(--ui-border);
}

.mm__summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12rpx 4rpx 0;
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.mm__clear {
  color: var(--ui-brand, #b4551f);
}

.mm__chips {
  flex-shrink: 0;
  white-space: nowrap;
  height: 56rpx;
  margin: 12rpx 0 8rpx;
}

.mm__chip {
  display: inline-flex;
  align-items: center;
  height: 56rpx;
  padding: 0 20rpx;
  margin-right: 12rpx;
  border-radius: 28rpx;
  font-size: 24rpx;
  color: var(--ui-text-2);
  background-color: var(--ui-raise);
  border: 2rpx solid var(--ui-border);

  &.is-on {
    color: #fff;
    background-color: var(--ui-brand, #b4551f);
    border-color: transparent;
  }
}

.mm__error {
  flex-shrink: 0;
  margin: 8rpx 0;
  padding: 14rpx 20rpx;
  border-radius: 16rpx;
  font-size: 24rpx;
  color: #f56c6c;
  background-color: rgba(245, 108, 108, 0.12);
}

.mm__list {
  padding-bottom: 8rpx;
}

.mm__card {
  margin-bottom: 14rpx;
  padding: 18rpx 20rpx;
  border-radius: 18rpx;
  background-color: var(--ui-surface);
  border: 2rpx solid var(--ui-border);
}

.mm__card-top {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.mm__code {
  font-size: 24rpx;
  font-variant-numeric: tabular-nums;
  letter-spacing: 1rpx;
  color: var(--ui-text-2);
}

.mm__status {
  height: 36rpx;
  padding: 0 14rpx;
  border-radius: 18rpx;
  display: flex;
  align-items: center;
  font-size: 20rpx;
  color: var(--ui-text-2);
  background-color: var(--ui-raise-2);

  &.is-off {
    color: #f56c6c;
    background-color: rgba(245, 108, 108, 0.16);
  }

  &.is-warn {
    color: #e6a23c;
    background-color: rgba(230, 162, 60, 0.16);
  }
}

.mm__price {
  margin-left: auto;
  font-size: 24rpx;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text);
}

.mm__card-name {
  margin-top: 10rpx;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ui-text);
  word-break: break-all;
}

.mm__card-meta {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-top: 8rpx;
  min-width: 0;
}

.mm__tag {
  flex-shrink: 0;
  height: 36rpx;
  padding: 0 14rpx;
  border-radius: 18rpx;
  display: flex;
  align-items: center;
  font-size: 20rpx;
  color: var(--ui-text-2);
  background-color: var(--ui-raise-2);
}

.mm__dim {
  flex-shrink: 0;
  font-size: 22rpx;
  color: var(--ui-text-3);

  &--grow {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.mm__empty,
.mm__more {
  padding: 36rpx 0;
  text-align: center;
  font-size: 24rpx;
  color: var(--ui-text-3);
}

.mm__hint {
  padding: 20rpx 8rpx 40rpx;
  text-align: center;
  font-size: 22rpx;
  color: var(--ui-text-3);
}

/* ===== 详情 ===== */
.md {
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: 84vh;
}

.md__grabber {
  width: 72rpx;
  height: 8rpx;
  margin: 12rpx auto 0;
  border-radius: 4rpx;
  background-color: var(--ui-border-strong);
}

.md__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 20rpx 28rpx 8rpx;
}

.md__title {
  flex: 1;
  min-width: 0;
  font-size: 30rpx;
  font-weight: 700;
  line-height: 1.4;
  color: var(--ui-text);
  word-break: break-all;
}

.md__close {
  flex-shrink: 0;
  font-size: 26rpx;
  color: var(--ui-text-2);
}

.md__body {
  flex: 1;
  min-height: 0;
  padding: 8rpx 28rpx calc(28rpx + env(safe-area-inset-bottom));
}

.md__row {
  display: flex;
  align-items: baseline;
  gap: 16rpx;
  padding: 14rpx 0;
  border-bottom: 2rpx solid var(--ui-hairline);
}

.md__label {
  flex-shrink: 0;
  width: 152rpx;
  font-size: 24rpx;
  color: var(--ui-text-3);
}

.md__value {
  flex: 1;
  min-width: 0;
  font-size: 26rpx;
  color: var(--ui-text);
  word-break: break-all;
}

.md__tip {
  padding: 24rpx 0;
  font-size: 24rpx;
  color: var(--ui-text-3);
}

.md__group-title {
  display: block;
  margin: 24rpx 0 10rpx;
  font-size: 24rpx;
  font-weight: 600;
  color: var(--ui-text-3);
}

.md__valuation {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 12rpx 0;
  border-bottom: 2rpx solid var(--ui-hairline);
}

.md__valuation-type {
  width: 120rpx;
  font-size: 24rpx;
  color: var(--ui-text-2);
}

.md__valuation-price {
  flex: 1;
  font-size: 26rpx;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text);
}

.md__valuation-unit {
  font-size: 22rpx;
  color: var(--ui-text-3);
}
</style>
