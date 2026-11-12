<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useToast } from 'wot-design-uni'
import request from '../api/request'
import { hasPerm } from '../api/auth'
import { copyRowField } from '../utils/clipboard'
import { uploadFile } from '../api/upload'
import { resolveAssetUrl } from '../api/config'
import { chooseImages } from '../utils/chooseImages'

/*
 * 采购需求（手机端，2026-10-23，变更-164）
 *
 * 与 PC 的差异（都是因为屏幕小，不是功能缺失）：
 *   · 表格 → **卡片**。PC 上 8 列能一眼扫完，手机上横向滚表格没法看；
 *   · 列顺序/列显隐 → **不做**（使用方 2026-10-23 明确"手机上不需要"；
 *     卡片布局只有一种顺序，做了只是给人添麻烦）；
 *   · 点单元格复制 → **长按**（手机上"点一下"是进详情，两者抢手势）。
 *
 * 与 PC 完全一致的两条关键行为：
 *   ① 新增保存后**不关表单**：清空物料名称/编码/规格 + 数量复位 1，
 *      保留需求人/提出日期/类别/用途/要求到货日期 —— 同一批需求连着录几条物料；
 *   ② 长按行号复制三样（Tab 分隔）、长按物料名称/编码/规格复制单项，且**不弹详情**。
 */

const toast = useToast()
const canEdit = computed(() => hasPerm('purchase:edit') || hasPerm('admin'))

// ===== 列表 =====
const rows = ref([])
const total = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const loadError = ref('')
const keyword = ref('')
const statusFilter = ref('')
const pageNum = ref(1)
const PAGE_SIZE = 20

/** 与后端 PurchaseTrackingVO 的状态枚举一致（超期/临期/待提单/等货/已到货/部分到货） */
const STATUS_FILTERS = [
  { value: '', label: '全部' },
  { value: 'OVERDUE', label: '超期' },
  { value: 'DUE_SOON', label: '临期' },
  { value: 'PENDING_OA', label: '待提单' },
  { value: 'WAITING', label: '等货' },
  { value: 'ARRIVED', label: '已到货' },
  { value: 'PARTIAL', label: '部分到货' },
]

const STATUS_TEXT = {
  OVERDUE: '超期',
  DUE_SOON: '临期',
  PENDING_OA: '待提单',
  WAITING: '等货',
  ARRIVED: '已到货',
  PARTIAL: '部分到货',
}

const hasMore = computed(() => rows.value.length < total.value)

let listSeq = 0

function buildParams(page) {
  const params = { pageNum: page, pageSize: PAGE_SIZE }
  const kw = keyword.value.trim()
  if (kw) params.keyword = kw
  if (statusFilter.value) params.statuses = statusFilter.value
  return params
}

async function loadList({ append = false } = {}) {
  const seq = ++listSeq
  if (append) loadingMore.value = true
  else loading.value = true
  loadError.value = ''

  try {
    const res = await request.get('/api/purchase/list', { params: buildParams(append ? pageNum.value : 1) })
    // 打字停顿就连发几次，先发的后回会把新结果盖掉（与 PC 同一套序号护栏）
    if (seq !== listSeq) return

    const body = res.data || {}
    if (body.success === false) throw new Error(body.msg || '采购需求接口返回异常。')

    const list = Array.isArray(body.dataList) ? body.dataList : []
    rows.value = append ? [...rows.value, ...list] : list
    total.value = Number(body.total) || 0
    if (!append) pageNum.value = 1
  } catch (e) {
    if (seq !== listSeq) return
    loadError.value = e?.response?.data?.msg || e?.message || '加载失败'
  } finally {
    if (seq === listSeq) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

function applyFilters() {
  pageNum.value = 1
  loadList()
}

function pickStatus(value) {
  statusFilter.value = value
  applyFilters()
}

async function loadMore() {
  if (!hasMore.value || loadingMore.value) return
  pageNum.value += 1
  await loadList({ append: true })
}

onMounted(() => {
  loadList()
})

// ===== 长按复制（不弹详情）=====
/**
 * 长按复制与"点一下看详情"共存的办法。
 *
 * 原来名称 / 编码 / 规格都写了 `@click.stop`，只为了长按复制时别把弹窗点开 ——
 * 结果是卡片上最大的一块地方（物料名称那一行）点上去毫无反应，使用方报
 * 「点击卡片不能展开信息」就是这个。现在改成：
 *   · 这些格子只拦长按（@longpress.stop），点击照常冒泡到卡片；
 *   · 长按复制成功时记一个时间戳，紧接着冒上来的那次 click 直接忽略，
 *     免得「刚复制完，弹窗自己开了」。
 */
let lastCopyAt = 0
async function onLongPress(row, key) {
  lastCopyAt = Date.now()
  await copyRowField(row, key)
}

// ===== 表单 =====
const formOpen = ref(false)
const saving = ref(false)
const formError = ref('')
const isCreate = ref(true)
const savedCount = ref(0)
const lastSavedText = ref('')

/*
 * 送货单图片（变更-207，使用方 2026-11-12：「我记得有保存送货单的功能的，这里我没找到」）
 *
 * 与 PC 同一条口径（变更-094）：`delivery_note` 存的是 `/files/<fileName>` 这种相对路径，
 * 不是裸文件名、也不是图片 URL。列本来就是 varchar(64)，装得下，不用改表。
 *
 * ⚠️ 保存时必须把这个值原样带上：后端 save 走的是
 * `row.setDeliveryNote(blankIfNull(dto.getDeliveryNote()))`，
 * 也就是「没传 = 空串 = 把已有图片抹掉」。第一次接这块时最容易漏的就是这里。
 */
const deliverySheetOpen = ref(false)
const deliveryUploading = ref(false)
const deliveryImage = computed(() => (form.deliveryNote ? resolveAssetUrl(form.deliveryNote) : ''))

function blankDraft() {
  return {
    id: null,
    requester: '',
    requestDate: '',
    materialName: '',
    materialCode: '',
    spec: '',
    purpose: '',
    category: '',
    quantity: 1,
    unit: '',
    requiredArrivalDate: '',
    actualArrivalQuantity: '',
    actualArrivalDate: '',
    oaNo: '',
    deliveryNote: '',
    remark: '',
  }
}

const form = reactive(blankDraft())

function resetForm(draft = null) {
  const next = { ...blankDraft(), ...(draft || {}) }
  Object.keys(form).forEach((key) => {
    form[key] = next[key] ?? ''
  })
  form.quantity = next.quantity ?? 1
  form.id = next.id ?? null
}

function openCreate() {
  isCreate.value = true
  formError.value = ''
  savedCount.value = 0
  lastSavedText.value = ''
  resetForm()
  formOpen.value = true
}

function openEdit(row) {
  // 刚长按复制过就别开弹窗（长按之后浏览器还会补一次 click）
  if (Date.now() - lastCopyAt < 600) return
  isCreate.value = false
  formError.value = ''
  savedCount.value = 0
  lastSavedText.value = ''
  resetForm(row)
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
}

// ===== 送货单图片 =====

function openDeliverySheet() {
  if (deliveryUploading.value) return
  deliverySheetOpen.value = true
}

/**
 * 选一张图并上传。
 *
 * 相册一定要走 chooseImages（手机自带相册），不能用 uni.chooseImage 的 album 分支 ——
 * 那个分支是框架自绘的绿色选图页，与 App 完全不搭（2026-11-12 使用方明确要求换掉）。
 * 拍照仍交给 uni.chooseImage，它调的就是系统相机。
 */
async function pickDeliverySource(source) {
  deliverySheetOpen.value = false
  const options = {
    count: 1,
    sizeType: ['compressed'],
    sourceType: [source],
    success: (res) => {
      const path = (res.tempFilePaths || [])[0]
      if (path) uploadDeliveryPhoto(path)
    },
    fail: () => {},
  }
  if (source === 'album') chooseImages(options)
  else uni.chooseImage(options)
}

async function uploadDeliveryPhoto(filePath) {
  if (deliveryUploading.value) return
  deliveryUploading.value = true
  try {
    const res = await uploadFile({
      url: '/api/purchase/upload-delivery-note',
      filePath,
      name: 'file',
    })
    const body = res.data || {}
    if (body.success === false) throw new Error(body.msg || '上传失败')
    const fileName = body.data
    if (!fileName) throw new Error('上传未返回文件名')

    // ADR-0004：前端固定拼 `/files/<fileName>`，缩略图由显示端换 /thumbs/
    form.deliveryNote = `/files/${fileName}`
    toast.success('送货单已上传')
  } catch (error) {
    toast.error(error?.message || '送货单上传失败')
  } finally {
    deliveryUploading.value = false
  }
}

function clearDeliveryNote() {
  form.deliveryNote = ''
}

function previewDeliveryNote() {
  if (!deliveryImage.value) return
  uni.previewImage({ urls: [deliveryImage.value], current: deliveryImage.value })
}

/** 与 PC 的 buildPurchasePayload 同口径：空串发 null，非数字不发 NaN */
function buildPayload() {
  const text = (v) => {
    const s = String(v ?? '').trim()
    return s === '' ? null : s
  }
  const decimal = (v) => {
    const s = String(v ?? '').trim()
    if (s === '') return null
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }

  return {
    id: form.id ?? null,
    requester: String(form.requester ?? '').trim(),
    requestDate: text(form.requestDate),
    materialName: String(form.materialName ?? '').trim(),
    materialCode: text(form.materialCode),
    spec: text(form.spec),
    purpose: text(form.purpose),
    category: text(form.category),
    quantity: decimal(form.quantity),
    unit: text(form.unit),
    requiredArrivalDate: text(form.requiredArrivalDate),
    actualArrivalQuantity: decimal(form.actualArrivalQuantity),
    actualArrivalDate: text(form.actualArrivalDate),
    oaNo: text(form.oaNo),
    deliveryNote: text(form.deliveryNote),
    remark: text(form.remark),
  }
}

async function save() {
  if (saving.value) return
  const payload = buildPayload()

  // 必填口径与后端一致：界面先拦一次，少一趟往返
  if (!payload.requester) {
    formError.value = '需求人不能为空'
    return
  }
  if (!payload.materialName) {
    formError.value = '物料名称不能为空'
    return
  }

  saving.value = true
  formError.value = ''
  try {
    const res = await request.post('/api/purchase/save', payload)
    const body = res.data || {}
    if (body.success === false) throw new Error(body.msg || '保存失败')

    if (isCreate.value) {
      /*
       * 连续录入（与 PC 一致）：不关表单，只清"由物料派生"的三样 + 数量复位 1。
       * 需求人/日期/类别/用途留着 —— 同一批需求连着录时这些是共用的。
       */
      savedCount.value += 1
      lastSavedText.value = `第 ${savedCount.value} 条已保存（${payload.materialName}）`
      form.materialName = ''
      form.materialCode = ''
      form.spec = ''
      form.quantity = 1
      toast.success('已保存，接着录下一条')
      loadList()
    } else {
      toast.success('已保存')
      formOpen.value = false
      loadList()
    }
  } catch (e) {
    // 失败不关表单、不清内容：已填的要留着
    formError.value = e?.response?.data?.msg || e?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

async function removeRow() {
  if (!form.id) return
  const ok = await new Promise((resolve) => {
    uni.showModal({
      title: '删除确认',
      content: `删除「${form.materialName}」这条采购需求？`,
      confirmText: '删除',
      confirmColor: '#c0392b',
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    })
  })
  if (!ok) return

  try {
    const res = await request.delete('/api/purchase/delete', { params: { id: form.id } })
    const body = res.data || {}
    if (body.success === false) throw new Error(body.msg || '删除失败')
    toast.success('已删除')
    formOpen.value = false
    loadList()
  } catch (e) {
    formError.value = e?.response?.data?.msg || e?.message || '删除失败'
  }
}

// ===== 展示辅助 =====
function statusTone(row) {
  if (row.status === 'OVERDUE') return 'is-danger'
  if (row.status === 'DUE_SOON') return 'is-warn'
  if (row.status === 'ARRIVED') return 'is-ok'
  return ''
}

function dayHint(row) {
  if (row.status === 'OVERDUE' && row.overdueDays) return `已超 ${row.overdueDays} 天`
  if (row.status === 'DUE_SOON') {
    const d = row.daysToDue
    if (d === null || d === undefined) return ''
    return d === 0 ? '今天到期' : `还剩 ${d} 天`
  }
  return ''
}

function quantityText(row) {
  const qty = row.quantity ?? ''
  const unit = row.unit ? ` ${row.unit}` : ''
  return qty === '' || qty === null ? '—' : `${qty}${unit}`
}

/*
 * 面板给"确定高度"，不是只有 max-height。
 *
 * 只有 max-height 时，里层 `flex:1` 的滚动区拿不到可用高度，会按内容撑开 ——
 * 于是整块面板比屏幕还高：表单滑不下去、底部按钮停在半空、还会压在最下面几行字上
 * （使用方 2026-11-12 截图报的就是这个）。定成 86vh 之后：
 *   头部 + 胶条 + 提示条（固定）→ 中间 scroll-view（吃掉剩余高度、内部滚动）→ 底部按钮栏（固定）
 */
const popupStyle =
  'height: 86vh; max-height: 86vh; width: 100%; display: flex; flex-direction: column; background-color: var(--ui-sheet-fill); overscroll-behavior: contain; overflow: hidden;'
</script>

<template>
  <view class="pd">
    <view class="pd__bar">
      <input
        v-model="keyword"
        class="pd__search"
        placeholder="物料名称 / 编码 / 需求人"
        placeholder-style="color: var(--ui-text-3)"
        confirm-type="search"
        @confirm="applyFilters"
      />
      <view v-if="canEdit" class="pd__add" @click="openCreate">
        <text>＋ 新增</text>
      </view>
    </view>

    <scroll-view class="pd__chips" scroll-x enable-flex>
      <view
        v-for="item in STATUS_FILTERS"
        :key="item.value"
        class="pd__chip"
        :class="{ 'is-on': statusFilter === item.value }"
        @click="pickStatus(item.value)"
      >
        <text>{{ item.label }}</text>
      </view>
    </scroll-view>

    <view v-if="loadError" class="pd__error" @click="loadList()">
      <text>{{ loadError }}（点一下重试）</text>
    </view>

    <view class="pd__list">
      <view
        v-for="(row, index) in rows"
        :key="row.id"
        class="pd__card"
        @click="openEdit(row)"
      >
        <view class="pd__card-head">
          <!-- 行号：长按复制三样（Tab 分隔，可直接粘进 Excel）；点一下照样开详情 -->
          <view class="pd__no" @longpress.stop="onLongPress(row, 'index')">
            <text>{{ (pageNum - 1) * PAGE_SIZE + index + 1 }}</text>
          </view>
          <view class="pd__status" :class="statusTone(row)">
            <text>{{ STATUS_TEXT[row.status] || '等货' }}</text>
          </view>
          <text v-if="dayHint(row)" class="pd__days">{{ dayHint(row) }}</text>
          <text class="pd__requester">{{ row.requester || '—' }}</text>
        </view>

        <view class="pd__name" @longpress.stop="onLongPress(row, 'materialName')">
          <text>{{ row.materialName || '—' }}</text>
        </view>

        <view class="pd__meta">
          <view class="pd__meta-item" @longpress.stop="onLongPress(row, 'materialCode')">
            <text class="pd__label">编码</text>
            <text class="pd__code">{{ row.materialCode || '—' }}</text>
          </view>
          <view class="pd__meta-item pd__meta-item--grow" @longpress.stop="onLongPress(row, 'spec')">
            <text class="pd__label">规格</text>
            <text class="pd__spec">{{ row.spec || '—' }}</text>
          </view>
        </view>

        <view class="pd__foot">
          <text class="pd__qty">{{ quantityText(row) }}</text>
          <text class="pd__date">要求到货 {{ row.requiredArrivalDate || '—' }}</text>
        </view>
      </view>

      <view v-if="!rows.length && !loading" class="pd__empty">
        <text>{{ loadError ? '加载失败' : '还没有采购需求 —— 点右上「新增」就能记一条' }}</text>
      </view>
      <view v-else-if="hasMore" class="pd__more" @click="loadMore">
        <text>{{ loadingMore ? '正在加载…' : `加载更多（已显示 ${rows.length} / ${total}）` }}</text>
      </view>
      <view v-else-if="rows.length" class="pd__more">
        <text>共 {{ total }} 条，到底了</text>
      </view>
      <view class="pd__hint">
        <text>长按行号复制「名称 / 编码 / 规格」三样；长按名称、编码、规格各复制单项</text>
      </view>
    </view>

    <wd-popup
      v-model="formOpen"
      position="bottom"
      round
      safe-area-inset-bottom
      :duration="280"
      :custom-style="popupStyle"
      @close="closeForm"
    >
      <view class="pf">
        <view class="pf__grabber"></view>
        <view class="pf__head">
          <text class="pf__title">{{ isCreate ? '新增采购需求' : '采购需求详情' }}</text>
          <text class="pf__close" @click="closeForm">关闭</text>
        </view>

        <view v-if="lastSavedText" class="pf__saved">
          <text>{{ lastSavedText }}</text>
        </view>
        <view v-if="formError" class="pf__error">
          <text>{{ formError }}</text>
        </view>

        <scroll-view class="pf__body" scroll-y>
          <view class="pf__group">
            <text class="pf__group-title">基本信息</text>
            <view class="pf__row">
              <text class="pf__label">需求人 *</text>
              <input v-model="form.requester" class="pf__input" placeholder="谁提的" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">提出日期</text>
              <input v-model="form.requestDate" class="pf__input" placeholder="2026-10-23" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">物料名称 *</text>
              <input v-model="form.materialName" class="pf__input" placeholder="打字搜物料名称" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">物料编码</text>
              <input v-model="form.materialCode" class="pf__input" placeholder="选填" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">规格型号</text>
              <input v-model="form.spec" class="pf__input" placeholder="选填" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">类别</text>
              <input v-model="form.category" class="pf__input" placeholder="五金 / 电气…" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">用途</text>
              <input v-model="form.purpose" class="pf__input" placeholder="哪条线 / 哪个车间用" placeholder-style="color: var(--ui-text-3)" />
            </view>
          </view>

          <view class="pf__group">
            <text class="pf__group-title">数量与到货</text>
            <view class="pf__row">
              <text class="pf__label">数量</text>
              <view class="pf__qty">
                <input v-model="form.quantity" class="pf__input pf__input--num" type="digit" placeholder="1" placeholder-style="color: var(--ui-text-3)" />
                <input v-model="form.unit" class="pf__input pf__input--unit" placeholder="单位" placeholder-style="color: var(--ui-text-3)" />
              </view>
            </view>
            <view class="pf__row">
              <text class="pf__label">要求到货</text>
              <input v-model="form.requiredArrivalDate" class="pf__input" placeholder="2026-10-30" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">实到数量</text>
              <input v-model="form.actualArrivalQuantity" class="pf__input" type="digit" placeholder="选填" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">实到日期</text>
              <input v-model="form.actualArrivalDate" class="pf__input" placeholder="选填" placeholder-style="color: var(--ui-text-3)" />
            </view>
          </view>

          <view class="pf__group">
            <text class="pf__group-title">单据与备注</text>
            <view class="pf__row">
              <text class="pf__label">OA 单号</text>
              <input v-model="form.oaNo" class="pf__input" placeholder="选填" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">备注</text>
              <input v-model="form.remark" class="pf__input" placeholder="选填" placeholder-style="color: var(--ui-text-3)" />
            </view>

            <!-- 送货单：一张图。有图显示缩略图 + 更换/删除，没图显示一颗上传按钮 -->
            <view class="pf__row pf__row--file">
              <text class="pf__label">送货单</text>
              <view class="pf__file">
                <template v-if="deliveryImage">
                  <image class="pf__file-thumb" :src="deliveryImage" mode="aspectFill" @click="previewDeliveryNote" />
                  <view class="pf__file-acts">
                    <text class="pf__file-act" @click="openDeliverySheet">更换</text>
                    <text class="pf__file-act pf__file-act--danger" @click="clearDeliveryNote">删除</text>
                  </view>
                </template>
                <view v-else class="pf__file-add" :class="{ 'is-busy': deliveryUploading }" @click="openDeliverySheet">
                  <text>{{ deliveryUploading ? '上传中…' : '＋ 上传送货单' }}</text>
                </view>
              </view>
            </view>
          </view>
        </scroll-view>

        <view class="pf__foot">
          <view v-if="!isCreate && canEdit" class="pf__del" @click="removeRow">
            <text>删除</text>
          </view>
          <view class="pf__btn pf__btn--ghost" @click="closeForm">
            <text>{{ isCreate ? '先不填' : '取消' }}</text>
          </view>
          <view class="pf__btn pf__btn--primary" :class="{ 'is-busy': saving }" @click="save">
            <text>{{ saving ? '保存中…' : isCreate ? '保存并继续' : '保存' }}</text>
          </view>
        </view>
      </view>
    </wd-popup>

    <!-- 送货单来源：与「图片解析」「拍表存证」同一套底部弹层，选完再进系统相机/相册 -->
    <wd-popup
      v-model="deliverySheetOpen"
      position="bottom"
      round
      safe-area-inset-bottom
      custom-style="background-color: var(--ui-sheet-fill);"
    >
      <view class="pf-sheet">
        <text class="pf-sheet__title">上传送货单</text>
        <view class="pf-sheet__item" @click="pickDeliverySource('camera')">
          <view class="pf-sheet__icon">
            <wd-icon name="camera" size="20px" />
          </view>
          <text class="pf-sheet__text">拍摄</text>
        </view>
        <view class="pf-sheet__item" @click="pickDeliverySource('album')">
          <view class="pf-sheet__icon">
            <wd-icon name="picture" size="20px" />
          </view>
          <text class="pf-sheet__text">从相册选择</text>
        </view>
        <view class="pf-sheet__cancel" @click="deliverySheetOpen = false">
          <text>取消</text>
        </view>
      </view>
    </wd-popup>
  </view>
</template>

<style lang="scss" scoped>
/* 面板是「确定高度的三段式」：头部固定 / 中间 scroll-view 自己滚 / 底部按钮栏固定。
   2026-11-12 使用方报「滑到底按钮和页面分离」，根因是原来只写 max-height，
   flex 子项按内容撑开，滚动区拿不到高度。现在高度写死 86vh，滚动区 height:0 + flex:1。 */
.pd {
  padding: 16rpx 20rpx 40rpx;
  box-sizing: border-box;
}

.pd__bar {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex-shrink: 0;
}

.pd__search {
  flex: 1;
  height: 72rpx;
  padding: 0 22rpx;
  border-radius: 36rpx;
  font-size: 26rpx;
  color: var(--ui-text);
  background-color: var(--ui-raise-2);
  border: 2rpx solid var(--ui-border);
}

.pd__add {
  flex-shrink: 0;
  height: 72rpx;
  padding: 0 26rpx;
  border-radius: 36rpx;
  display: flex;
  align-items: center;
  font-size: 26rpx;
  font-weight: 600;
  color: #fff;
  background-color: var(--ui-brand, #b4551f);
}

.pd__chips {
  white-space: nowrap;
  margin: 16rpx 0 8rpx;
  height: 56rpx;
}

.pd__chip {
  display: inline-flex;
  align-items: center;
  height: 56rpx;
  padding: 0 22rpx;
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

.pd__error {
  flex-shrink: 0;
  margin: 8rpx 0;
  padding: 14rpx 20rpx;
  border-radius: 16rpx;
  font-size: 24rpx;
  color: #f56c6c;
  background-color: rgba(245, 108, 108, 0.12);
}

.pd__list {
  padding-bottom: 24rpx;
}

.pd__card {
  margin-bottom: 16rpx;
  padding: 20rpx 22rpx;
  border-radius: 20rpx;
  background-color: var(--ui-surface);
  border: 2rpx solid var(--ui-border);
}

.pd__card-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.pd__no {
  min-width: 52rpx;
  height: 40rpx;
  padding: 0 10rpx;
  border-radius: 10rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22rpx;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text-2);
  background-color: var(--ui-raise-2);
}

.pd__status {
  height: 40rpx;
  padding: 0 16rpx;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  font-size: 22rpx;
  color: var(--ui-text-2);
  background-color: var(--ui-raise-2);

  &.is-danger {
    color: #f56c6c;
    background-color: rgba(245, 108, 108, 0.16);
  }

  &.is-warn {
    color: #e6a23c;
    background-color: rgba(230, 162, 60, 0.16);
  }

  &.is-ok {
    color: #3f9d6b;
    background-color: rgba(63, 157, 107, 0.16);
  }
}

.pd__days {
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.pd__requester {
  margin-left: auto;
  font-size: 22rpx;
  color: var(--ui-text-2);
}

.pd__name {
  margin-top: 12rpx;
  font-size: 30rpx;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ui-text);
  word-break: break-all;
}

.pd__meta {
  display: flex;
  gap: 20rpx;
  margin-top: 10rpx;
}

.pd__meta-item {
  display: flex;
  align-items: baseline;
  gap: 8rpx;
  min-width: 0;

  &--grow {
    flex: 1;
    min-width: 0;
  }
}

.pd__label {
  flex-shrink: 0;
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.pd__code {
  font-size: 24rpx;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text-2);
}

.pd__spec {
  flex: 1;
  min-width: 0;
  font-size: 24rpx;
  color: var(--ui-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pd__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12rpx;
  padding-top: 12rpx;
  border-top: 2rpx solid var(--ui-hairline);
}

.pd__qty {
  font-size: 26rpx;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text);
}

.pd__date {
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.pd__empty,
.pd__more {
  padding: 40rpx 0;
  text-align: center;
  font-size: 24rpx;
  color: var(--ui-text-3);
}

.pd__hint {
  padding: 24rpx 8rpx 40rpx;
  text-align: center;
  font-size: 22rpx;
  line-height: 1.6;
  color: var(--ui-text-3);
}

/* ===== 表单 ===== */
.pf {
  display: flex;
  flex-direction: column;
  /* 高度由 popupStyle 的 86vh 给定；这里只负责"填满并裁掉溢出" */
  height: 100%;
  max-height: 100%;
  min-height: 0;
  overflow: hidden;
  box-sizing: border-box;
}

.pf__grabber {
  width: 72rpx;
  height: 8rpx;
  margin: 12rpx auto 0;
  border-radius: 4rpx;
  background-color: var(--ui-border-strong);
}

.pf__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 28rpx 12rpx;
}

.pf__title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--ui-text);
}

.pf__close {
  font-size: 26rpx;
  color: var(--ui-text-2);
}

.pf__saved {
  margin: 0 28rpx 8rpx;
  padding: 12rpx 18rpx;
  border-radius: 14rpx;
  font-size: 24rpx;
  color: #3f9d6b;
  background-color: rgba(63, 157, 107, 0.12);
}

.pf__error {
  margin: 0 28rpx 8rpx;
  padding: 12rpx 18rpx;
  border-radius: 14rpx;
  font-size: 24rpx;
  color: #f56c6c;
  background-color: rgba(245, 108, 108, 0.12);
}

/*
 * 滚动区：`height:0` + `flex:1` 是让 scroll-view 真正拿到高度的那一手。
 *
 * uni 的 scroll-view 必须有确定高度才会内部滚动（这是老坑，抄表页也踩过）；
 * 只写 `flex:1` 时它在 H5 上常常按内容高度算，滚不动。
 */
.pf__body {
  flex: 1 1 auto;
  height: 0;
  min-height: 0;
  box-sizing: border-box;
  padding: 0 28rpx;
}

.pf__group {
  margin-bottom: 20rpx;
}

.pf__group-title {
  display: block;
  margin: 8rpx 0 12rpx;
  font-size: 24rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: var(--ui-text-3);
}

.pf__row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 10rpx 0;
  /* 行内子项一律不许撑破行宽 */
  min-width: 0;
}

.pf__label {
  flex-shrink: 0;
  width: 148rpx;
  font-size: 26rpx;
  color: var(--ui-text-2);
}

/*
 * 输入框必须 `box-sizing: border-box` + `width: auto`。
 * uni 的 `input` 自带 `width:100%`，再用 content-box 加上左右 20rpx 内边距，
 * 每个格子就比容器宽 40rpx —— 一行行叠起来直接从屏幕右侧探出去（使用方截图）。
 */
.pf__input {
  flex: 1 1 auto;
  width: auto;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  height: 76rpx;
  padding: 0 20rpx;
  border-radius: 16rpx;
  font-size: 26rpx;
  color: var(--ui-text);
  background-color: var(--ui-raise);
  border: 2rpx solid var(--ui-border);

  &--num {
    flex: 0 0 168rpx;
    width: 168rpx;
  }

  &--unit {
    flex: 1 1 auto;
    width: auto;
  }
}

.pf__qty {
  flex: 1 1 auto;
  display: flex;
  gap: 12rpx;
  min-width: 0;
}

/* 送货单那行：标签顶对齐，右侧是缩略图或上传按钮 */
.pf__row--file {
  align-items: flex-start;
}

.pf__row--file .pf__label {
  padding-top: 18rpx;
}

.pf__file {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  gap: 18rpx;
  min-width: 0;
}

.pf__file-thumb {
  flex-shrink: 0;
  width: 120rpx;
  height: 120rpx;
  border-radius: 14rpx;
  border: 2rpx solid var(--ui-border);
  background-color: var(--ui-surface-2);
}

.pf__file-acts {
  display: flex;
  align-items: center;
  gap: 24rpx;
}

.pf__file-act {
  font-size: 26rpx;
  color: var(--ui-accent);
}

.pf__file-act--danger {
  color: var(--ui-danger, #b4463c);
}

.pf__file-add {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 76rpx;
  border-radius: 16rpx;
  font-size: 26rpx;
  color: var(--ui-text-2);
  background-color: var(--ui-surface-2);
  border: 2rpx dashed var(--ui-border-strong);

  &.is-busy {
    opacity: 0.6;
  }
}

/* 送货单来源弹层：视觉与「图片解析」「拍表存证」一致 */
.pf-sheet {
  padding: 20rpx 28rpx 24rpx;
}

.pf-sheet__title {
  display: block;
  padding: 4rpx 4rpx 16rpx;
  font-size: 26rpx;
  color: var(--ui-text-3);
}

.pf-sheet__item {
  display: flex;
  align-items: center;
  gap: 22rpx;
  height: 108rpx;
  margin-bottom: 16rpx;
  padding: 0 26rpx;
  border-radius: 24rpx;
  background-color: var(--ui-surface-2);
}

.pf-sheet__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72rpx;
  height: 72rpx;
  border-radius: 18rpx;
  color: var(--ui-accent);
  background-color: var(--ui-accent-soft);
}

.pf-sheet__text {
  font-size: 30rpx;
  color: var(--ui-text);
}

.pf-sheet__cancel {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 96rpx;
  margin-top: 8rpx;
  border-radius: 48rpx;
  font-size: 30rpx;
  color: var(--ui-text);
  background-color: var(--ui-raise-2);
}

/* 底部按钮栏：不参与滚动，实心底色（不能透出下面的表单） */
.pf__foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 18rpx 28rpx calc(18rpx + env(safe-area-inset-bottom));
  border-top: 2rpx solid var(--ui-hairline);
  background-color: var(--ui-surface);
  box-shadow: 0 -8rpx 24rpx rgba(20, 22, 28, 0.06);
}

.pf__del {
  flex-shrink: 0;
  height: 80rpx;
  padding: 0 26rpx;
  border-radius: 40rpx;
  display: flex;
  align-items: center;
  font-size: 26rpx;
  color: #f56c6c;
  background-color: rgba(245, 108, 108, 0.12);
}

.pf__btn {
  height: 80rpx;
  border-radius: 40rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  font-weight: 600;

  /* 「先不填」是次要操作，但不是"透明的"：给实心底 + 描边，跟主按钮一眼分得开 */
  &--ghost {
    flex: 0 0 180rpx;
    color: var(--ui-text);
    background-color: var(--ui-surface-2);
    border: 2rpx solid var(--ui-border);
  }

  &--primary {
    flex: 1 1 auto;
    min-width: 0;
    color: #fff;
    background-color: var(--ui-brand, #b4551f);

    &.is-busy {
      opacity: 0.6;
    }
  }
}
</style>
