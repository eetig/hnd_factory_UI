<script setup>
import { computed, onMounted, ref } from 'vue'
import { useToast } from 'wot-design-uni'
import { hasPerm } from '../api/auth'
import { resolveAssetUrl } from '../api/config'
import { containerTypeLabel, useEquipmentLedgerData } from '../composables/useEquipmentLedgerData'
import EquipmentFormDialog from './EquipmentFormDialog.vue'

// ===== 设备数据维护（手机端，2026-10-06）=====
//
// 卡片式而不是表格：手机上 16 个字段的表格要横向滚，核对着图纸填极易改错行。
// 使用场景是「拿着手机到设备旁边/对着图纸逐个核对」，所以做成
// **搜索 → 卡片 → 点开弹层改**（弹层见 EquipmentFormDialog）。
//
// ⚠️ 2026-10-10 统一整改后，**搜索与分页都在服务端**（原来是一次拉全表 92 行 + 前端 filter
// + 前端分段渲染）。所以：
//   · 搜索改成**回车 / 键盘搜索键才发请求**，不做逐字实时过滤 ——
//     逐字过滤会把「敲一个字打一次接口」做实，正是当初把搜索放前端要躲开的事；
//   · 「显示更多」改成**取下一页并追加**，不再是本地 slice 出前 20 张卡片。
//
// 手机端仍然不用分页器（那是桌面表格的形态，小屏上点页码很难受）。

const toast = useToast()
const {
  rows,
  total,
  loading,
  loadError,
  keyword,
  onlyEnabled,
  hasMore,
  loadLedger,
  loadMoreLedger,
  applyLedgerFilters,
  setLedgerEnabled,
} = useEquipmentLedgerData()

const canEdit = computed(() => hasPerm('equipment:edit'))

function toggleOnlyEnabled() {
  onlyEnabled.value = !onlyEnabled.value
  applyLedgerFilters()
}

onMounted(() => {
  // loadLedger 自己吞错误并落到 loadError，这里不必再包 try
  loadLedger()
})

// ===== 弹层 =====

const dialogOpen = ref(false)
const current = ref(null)

function openCard(row) {
  current.value = row
  dialogOpen.value = true
}

function openCreate() {
  current.value = null
  dialogOpen.value = true
}

async function onSaved() {
  // 写完重新取第一页：列表数据在服务端，本地那份不会有新行
  await loadLedger()
}

/**
 * 「不能启用」的原因（服务端下发的整句，见 EquipmentLedgerVO.enableBlockReason）；
 * 可启用或已启用时为空。**规则只有服务端一份**，这里不重复实现。
 */
function blockReasonOf(row) {
  if (row.enabled === 1) return ''
  return row.enableBlockReason || ''
}

/** 有底图但没标定坐标：进不了体积计算页的下拉，卡片上给个标识 */
function uncalibrated(row) {
  return Boolean(row.imageFile) && !row.imageBounds
}

async function toggleEnabled(row) {
  // 启用门槛（变更-081/082）：不合规连请求都不发，直接把原因摆出来。
  // 手机上没有 hover，所以不靠 tooltip —— 点一下给弹窗（原因是一整句，toast 显示不下）。
  const blocked = blockReasonOf(row)
  if (row.enabled !== 1 && blocked) {
    uni.showModal({ title: '不能启用', content: blocked, showCancel: false, confirmText: '知道了' })
    return
  }
  try {
    await setLedgerEnabled(row.id, row.enabled !== 1)
    toast.success(row.enabled === 1 ? '已停用' : '已启用')
  } catch (e) {
    // 请求层的错误形状是 error.response.data.msg（见 api/request.js），不是 e.data.msg
    toast.error(e?.response?.data?.msg || e?.message || '操作失败')
  }
}

/** 缩略图：与体积计算页同一个解析（内置底图走包内/服务器，上传的走 /files） */
function thumbOf(row) {
  return row.imageFile ? resolveAssetUrl(row.imageFile) : ''
}
</script>

<template>
  <view class="eq-page">
    <view class="eq-page__bar">
      <!-- 回车 / 键盘搜索键才查（服务端搜索），不做逐字实时过滤 -->
      <input
        v-model="keyword"
        class="eq-page__search"
        placeholder="位号 / 名称 / 昵称 / 规格 / 车间"
        placeholder-style="color: var(--ui-slate-400)"
        confirm-type="search"
        @confirm="applyLedgerFilters"
      />
      <view class="eq-page__toggle" :class="{ 'is-on': onlyEnabled }" @click="toggleOnlyEnabled">
        <text>只看启用的</text>
      </view>
    </view>

    <view class="eq-page__count">
      <!-- 「已加载 / 总共」：分页在服务端做，本地只有已取回来的那几页 -->
      <text>已加载 {{ rows.length }} / 共 {{ total }} 条</text>
      <text v-if="canEdit" class="eq-page__add" @click="openCreate">＋ 新增设备</text>
    </view>

    <view v-if="loadError" class="eq-page__error">{{ loadError }}</view>

    <view v-if="loading && !rows.length" class="eq-page__empty">正在加载…</view>
    <view v-else-if="!rows.length" class="eq-page__empty">没有符合条件的设备</view>

    <view
      v-for="row in rows"
      :key="row.id"
      class="eq-card"
      :class="{ 'is-off': row.enabled !== 1 }"
      @click="openCard(row)"
    >
      <image v-if="thumbOf(row)" :src="thumbOf(row)" mode="aspectFit" class="eq-card__thumb" />
      <view v-else class="eq-card__thumb eq-card__thumb--empty">
        <text>无图</text>
      </view>

      <view class="eq-card__main">
        <view class="eq-card__line">
          <text class="eq-card__name">{{ row.nickname || row.equipmentName }}</text>
          <text v-if="row.nickname" class="eq-card__alias">{{ row.equipmentName }}</text>
        </view>
        <text class="eq-card__meta">
          {{ row.equipmentCode || '无位号' }} · {{ row.spec || '无规格' }}
        </text>
        <text class="eq-card__meta">
          {{ containerTypeLabel(row.containerType) }} · 内径 {{ row.innerDiameter ?? '—' }}mm ·
          {{ row.medium || '介质未填' }}
        </text>
        <text v-if="row.enabled !== 1" class="eq-card__badge">已停用</text>
        <!-- 有图但没坐标 = 进不了体积计算页的下拉；标定在电脑端做（本端不做标定） -->
        <text v-if="uncalibrated(row)" class="eq-card__badge">底图未标定</text>
        <text v-if="blockReasonOf(row)" class="eq-card__badge">暂不可启用</text>
      </view>

      <view
        v-if="canEdit"
        class="eq-card__side"
        :class="{ 'is-blocked': !!blockReasonOf(row) }"
        @click.stop="toggleEnabled(row)"
      >
        <text>{{ row.enabled === 1 ? '停用' : '启用' }}</text>
      </view>
    </view>

    <view v-if="hasMore" class="eq-page__more" @click="loadMoreLedger">
      <text>{{ loading ? '加载中…' : `显示更多（还有 ${total - rows.length} 条）` }}</text>
    </view>

    <EquipmentFormDialog v-model="dialogOpen" :record="current" @saved="onSaved" />
  </view>
</template>

<style lang="scss" scoped>
/*
 * ⚠️ 这个文件里的颜色**一律走 --ui-* 变量，不要写颜色字面量**。
 *
 * 本仓的调色板定义在 src/uni.scss 的两套主题块里，tailwind.config.js 把
 * white / slate-* / gold-* / amber-* 这些工具类名也指到了同一批变量上
 * （「white」= 卡片表面，「slate-900」= 正文色，「slate-400/500」= 弱化文字，
 * 「slate-200」= 描边，「gold-600」= 强调金，「amber-100/800」= 告警底/字）。
 * 深色主题下这套变量的明暗是**反过来**的（slate-900 是最亮色），所以按语义选名字就行。
 *
 * 原先这个文件是照浅色写死的 hex，后果是深色模式下：
 *   1) 卡片底色写的是 var(--ui-card-bg, #fff) / 搜索框 var(--ui-input-bg, #f4f5f7) ——
 *      这两个变量在 uni.scss 里**根本不存在**，所以永远取兜底的白色，卡片在深色下还是白的；
 *   2) .eq-card__name 没有 color，直接继承了页面的正文色（深色下是近白），
 *      于是浅色文字压在白卡片上 —— 设备名几乎看不见；
 *   3) 其余 #8a8f99 / #2b6cb0 / #92400e+#fef3c7 之类的字面量换主题时纹丝不动。
 */
.eq-page {
  padding: 20rpx 0 40rpx;
}

.eq-page__bar {
  display: flex;
  gap: 16rpx;
  padding: 0 24rpx;
}

.eq-page__search {
  flex: 1;
  height: 72rpx;
  padding: 0 24rpx;
  font-size: 26rpx;
  color: var(--ui-slate-900);
  background: var(--ui-slate-50);
  border-radius: 36rpx;
}

.eq-page__toggle {
  display: flex;
  align-items: center;
  padding: 0 24rpx;
  font-size: 24rpx;
  color: var(--ui-slate-500);
  border: 1rpx solid var(--ui-slate-200);
  border-radius: 36rpx;
}

.eq-page__toggle.is-on {
  color: var(--ui-gold-600);
  border-color: var(--ui-gold-600);
}

.eq-page__count {
  display: flex;
  justify-content: space-between;
  padding: 16rpx 24rpx;
  font-size: 24rpx;
  color: var(--ui-slate-500);
}

.eq-page__add {
  color: var(--ui-gold-600);
}

.eq-page__error {
  margin: 0 24rpx 12rpx;
  padding: 16rpx 20rpx;
  font-size: 24rpx;
  color: var(--ui-amber-800);
  background: var(--ui-amber-100);
  border-radius: 12rpx;
}

.eq-page__empty {
  padding: 80rpx 0;
  font-size: 26rpx;
  color: var(--ui-slate-400);
  text-align: center;
}

.eq-page__more {
  margin: 20rpx 24rpx 0;
  padding: 22rpx 0;
  font-size: 26rpx;
  color: var(--ui-gold-600);
  text-align: center;
  border: 1rpx dashed var(--ui-slate-200);
  border-radius: 16rpx;
}

.eq-card {
  display: flex;
  gap: 20rpx;
  align-items: center;
  margin: 0 24rpx 16rpx;
  padding: 20rpx;
  background: var(--ui-white);
  border: 1rpx solid var(--ui-slate-200);
  border-radius: 16rpx;
}

.eq-card.is-off {
  opacity: 0.55;
}

.eq-card__thumb {
  width: 112rpx;
  height: 112rpx;
  border: 1rpx solid var(--ui-slate-200);
  border-radius: 12rpx;
}

.eq-card__thumb--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22rpx;
  color: var(--ui-slate-400);
}

.eq-card__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6rpx;
  min-width: 0;
}

.eq-card__line {
  display: flex;
  gap: 12rpx;
  align-items: baseline;
}

/* 必须显式给色：不给就继承页面正文色，深色主题下会变成浅字压在白卡片上 */
.eq-card__name {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ui-slate-900);
}

.eq-card__alias {
  font-size: 22rpx;
  color: var(--ui-slate-400);
}

.eq-card__meta {
  font-size: 24rpx;
  color: var(--ui-slate-500);
}

.eq-card__badge {
  align-self: flex-start;
  padding: 2rpx 12rpx;
  font-size: 22rpx;
  color: var(--ui-amber-800);
  background: var(--ui-amber-100);
  border-radius: 8rpx;
}

.eq-card__side {
  padding: 12rpx 16rpx;
  font-size: 24rpx;
  color: var(--ui-gold-600);
}

/* 不合规的行：按钮仍然可点（点了会弹出"缺什么"），只是看起来不该点 */
.eq-card__side.is-blocked {
  color: var(--ui-slate-400);
}
</style>
