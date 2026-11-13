<template>
  <view class="pp" :style="pageStyle">
    <view class="pp__body">
      <view class="pp__head">
        <text class="pp__sub">拍一张，认成电脑能直接粘进 SAP 的单</text>
      </view>

      <view v-if="message" class="pp__note" @click="message = ''">
        <text class="pp__note-text">{{ message }}</text>
        <text class="pp__note-x">知道了</text>
      </view>

      <!-- 空态：直接给两个出口，不做多余引导 -->
      <view v-if="!photoSrc" class="pp__shot" @click="pick('camera')">
        <view class="pp__shot-icon"><wd-icon name="camera" size="26px" /></view>
        <text class="pp__shot-main">拍领料单</text>
        <text class="pp__shot-sub">平铺拍全，四个角都在画面里</text>
      </view>
      <view v-if="!photoSrc" class="pp__shot-alt" @click="pick('album')">
        <wd-icon name="picture" size="18px" />
        <text class="pp__shot-alt-text">从相册选择</text>
      </view>

      <!-- 有照片：缩略图 + 状态 + 重拍 -->
      <view v-else class="pp__photo">
        <image class="pp__thumb" :src="photoSrc" mode="aspectFill" @click="previewPhoto" />
        <view class="pp__photo-side">
          <text class="pp__photo-state">{{ statusText }}</text>
          <view class="pp__photo-acts">
            <view class="pp__mini" @click="pick('camera')">重拍</view>
            <view class="pp__mini" @click="pick('album')">换一张</view>
            <view v-if="rows.length" class="pp__mini pp__mini--go" @click="scrollToLines">看明细</view>
          </view>
        </view>
      </view>

      <!-- 单据信息：部门是「落哪个 sheet」的开关，所以放在最前 -->
      <view class="pp__card">
        <view class="pp__card-head">
          <text class="pp__card-title">哪张单</text>
          <text class="pp__hint">识别不到就自己选</text>
        </view>
        <view class="pp__depts">
          <view
            v-for="item in DEPTS"
            :key="item"
            :class="['pp__dept', dept === item ? 'is-on' : '']"
            @click="setDept(item)"
          >
            {{ item }}
          </view>
        </view>
        <view class="pp__row">
          <text class="pp__label">领料人</text>
          <input v-model="requester" class="pp__input" placeholder="谁领的" placeholder-class="pp__ph" />
        </view>
        <view class="pp__row">
          <text class="pp__label">单据号</text>
          <input v-model="docNo" class="pp__input" placeholder="单据右上角那串数字" placeholder-class="pp__ph" />
        </view>
        <view class="pp__row">
          <text class="pp__label">日期</text>
          <input v-model="docDate" class="pp__input" placeholder="2026-11-13" placeholder-class="pp__ph" />
        </view>
      </view>

      <!-- 明细：一行一条，名称与编码分开两行，手机上才不会挤成一团 -->
      <view id="pp-lines" class="pp__card">
        <view class="pp__card-head">
          <text class="pp__card-title">物料明细</text>
          <view class="pp__card-acts">
            <text class="pp__count">已填 {{ filledCount }}/{{ rows.length }}</text>
            <view class="pp__add" @click="addLine">+ 加一行</view>
          </view>
        </view>

        <view v-if="!rows.length" class="pp__empty">
          <text class="pp__empty-text">{{ photoSrc ? '这张还没认出物料，点上面的「+ 加一行」手填' : '先拍一张，或者直接手填' }}</text>
        </view>

        <view v-for="(row, index) in rows" :key="row.key" class="pp__line">
          <view class="pp__line-top">
            <text class="pp__no">{{ index + 1 }}</text>
            <input
              v-model="row.materialName"
              class="pp__name"
              placeholder="物料名称"
              placeholder-class="pp__ph"
            />
            <view class="pp__del" @click="removeLine(index)">×</view>
          </view>
          <view class="pp__line-bot">
            <input
              v-model="row.materialCode"
              class="pp__code"
              type="number"
              placeholder="物料编码"
              placeholder-class="pp__ph"
            />
            <input
              v-model="row.quantity"
              class="pp__qty"
              type="digit"
              placeholder="数量"
              placeholder-class="pp__ph"
            />
            <input v-model="row.unit" class="pp__unit" placeholder="单位" placeholder-class="pp__ph" />
          </view>
        </view>
      </view>

      <!-- 模板：只读展示，手机端不切模板（列位在电脑端决定，这里告诉他去哪张单上粘） -->
      <view class="pp__card">
        <view class="pp__card-head">
          <text class="pp__card-title">导入模板</text>
          <text class="pp__hint">{{ dept ? dept + ' 的模板' : '按部门自动选' }}</text>
        </view>
        <view class="pp__tpl">
          <text class="pp__tpl-name">{{ templateName || '暂无该部门模板' }}</text>
          <text class="pp__tpl-desc">{{ templateDesc }}</text>
        </view>
      </view>

      <view class="pp__pad"></view>
    </view>

    <!-- 固定底栏：不随内容滚动，键盘弹出时上移 -->
    <view class="pp__bar">
      <button class="pp__go" :disabled="!canSend" @click="send">
        {{ sending ? '正在发…' : `发到电脑（${filledCount} 行）` }}
      </button>
    </view>
  </view>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import request from '../../api/request'
import { uploadFile } from '../../api/upload'
import { resolveAssetUrl } from '../../api/config'
import { chooseImages } from '../../utils/chooseImages'

// 部门是「落哪个 sheet」的开关，所以给的是高频几个，不是全部组织架构
const DEPTS = ['生产部', '行政部', '安环部', '设备部']

const photo = ref('')
/*
 * 本地临时路径不能过 resolveAssetUrl：那是给后端返回的 /files、/thumbs 相对路径补域名的，
 * 把 _doc/uniapp_temp/xxx.jpg 当成相对路径会拼成 https://host/_doc/... ⇒ 缩略图空白
 * （2026-11-13 使用方实测）。服务端地址才需要补。
 */
const photoSrc = computed(() => {
  const path = photo.value
  if (!path) return ''
  if (/^(file|content|blob|data):/i.test(path)) return path
  if (path.startsWith('_doc') || path.startsWith('_www') || path.startsWith('/storage')) return path
  return resolveAssetUrl(path)
})
const recognizing = ref(false)
const sending = ref(false)
const sent = ref(false)
const message = ref('')

const dept = ref('')
const requester = ref('')
const docNo = ref('')
const docDate = ref(today())

const rows = ref([])
const templates = ref([])
let uid = 0

const filledCount = computed(() => rows.value.filter(isFilled).length)
const canSend = computed(() => filledCount.value > 0 && !!dept.value && !sending.value)

const statusText = computed(() => {
  if (recognizing.value) return '正在认…'
  if (rows.value.length) return `认出 ${rows.value.length} 行`
  if (sent.value) return '已发给电脑'
  return '还没认出物料'
})

const templateName = computed(() => {
  const hit = pickTemplate()
  return hit ? hit.name : ''
})

const templateDesc = computed(() => {
  const hit = pickTemplate()
  if (!hit) return '去电脑端的「领料解析」上传一张 SAP 导出的空表，表头要有「物料」和「单据数量」'
  return [hit.docType, hit.columns].filter(Boolean).join(' · ')
})

// 键盘顶起时把底栏贴着键盘，避免被挡住（同抄表页的做法）
const keyboardHeight = ref(0)
const pageStyle = computed(() => ({ '--pp-kb': `${keyboardHeight.value}px` }))

onMounted(() => {
  uni.onKeyboardHeightChange?.((res) => {
    keyboardHeight.value = res.height || 0
  })
})

onShow(() => {
  loadTemplates()
})

function today() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function isFilled(row) {
  return String(row.materialCode || '').trim() && String(row.quantity || '').trim()
}

function blankLine() {
  return { key: ++uid, materialName: '', materialCode: '', quantity: '', unit: '' }
}

function addLine() {
  rows.value.push(blankLine())
  scrollToLines()
}

function removeLine(index) {
  rows.value.splice(index, 1)
}

function scrollToLines() {
  uni.pageScrollTo({ selector: '#pp-lines', duration: 240 })
}

function setDept(value) {
  dept.value = value
  loadTemplates()
}

function pick(source) {
  if (recognizing.value) return
  const options = {
    count: 1,
    sizeType: ['compressed'],
    sourceType: [source],
    success: (res) => {
      const path = (res.tempFilePaths || [])[0]
      if (path) startRecognize(path)
    },
    fail: () => {
      // 用户点取消不算错误，不弹提示
    },
  }
  // 相册必须走系统相册：uni.chooseImage 的相册分支是框架自绘的那套界面，
  // 操作路径和「图片解析」页面不一致，使用方明确要求统一。
  if (source === 'album') chooseImages(options)
  else uni.chooseImage(options)
}

async function startRecognize(filePath) {
  photo.value = filePath
  sent.value = false
  recognizing.value = true
  message.value = ''
  try {
    const res = await uploadFile({
      url: '/api/ocr-proxy/recognize',
      filePath,
      name: 'file',
      formData: { fileName: 'pick.jpg' },
    })
    const body = res.data || {}
    if (body.code !== 200) throw new Error(body.msg || body.message || '识别失败')
    applyResult(body.data || {})
  } catch (error) {
    message.value = `没认出来（${shortError(error)}），可以照纸单手填`
  } finally {
    recognizing.value = false
  }
}

/*
 * myocr 每个字段都带置信度：{ value, confidence }。
 * 直接把对象塞进 v-model 会显示成 [object Object]（2026-11-13 使用方实测），
 * 所以统一在这里拆一层；将来后端改成扁平字符串也照样能用。
 */
function field(value) {
  if (value && typeof value === 'object' && 'value' in value) return value.value
  return value
}

function applyResult(result) {
  const deptFromOcr = text(field(result.department))
  if (deptFromOcr) dept.value = deptFromOcr
  const whoFromOcr = text(field(result.requester))
  if (whoFromOcr) requester.value = whoFromOcr
  const noFromOcr = text(field(result.documentNo))
  if (noFromOcr) docNo.value = noFromOcr
  const dateFromOcr = text(field(result.docDate))
  if (dateFromOcr) docDate.value = normalizeDate(dateFromOcr)

  const items = Array.isArray(result.items) ? result.items : []
  rows.value = items.map((item) => ({
    key: ++uid,
    materialName: text(field(item.materialName)),
    materialCode: text(field(item.materialCode)),
    quantity: text(field(item.quantity)),
    unit: text(field(item.unit)),
  }))
  if (!rows.value.length) rows.value = [blankLine()]
  loadTemplates()
}

function text(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function normalizeDate(value) {
  const raw = String(value || '').replace(/[年月./]/g, '-').replace(/日/g, '')
  const match = raw.match(/(\d{4})-?(\d{1,2})-?(\d{1,2})/)
  if (!match) return String(value || '')
  const pad = (n) => String(n).padStart(2, '0')
  return `${match[1]}-${pad(match[2])}-${pad(match[3])}`
}

function shortError(error) {
  const body = error?.response?.data
  if (body && typeof body === 'object') {
    const text = body.msg || body.message
    if (text) return String(text).slice(0, 40)
  }
  if (error?.response?.status) return `HTTP ${error.response.status}`
  if (error?.isNetworkError) return '网络不通'
  return String(error?.message || '未知原因').slice(0, 40)
}

async function loadTemplates() {
  try {
    const res = await request.get('/api/pick-template/list', { params: { dept: dept.value || undefined } })
    const body = res.data || {}
    templates.value = body.code === 200 && Array.isArray(body.data) ? body.data : []
  } catch (error) {
    templates.value = []
  }
}

/**
 * 与电脑端同一套优先级：本部门专属 > 通用。
 * 「通用」是 dept 为空的模板，列位可能不同，所以只在没有专属模板时才用。
 */
function pickTemplate() {
  const ours = templates.value.find((item) => item.dept && item.dept === dept.value)
  if (ours) return ours
  return templates.value.find((item) => !item.dept) || null
}

function previewPhoto() {
  if (!photo.value) return
  uni.previewImage({ urls: [photoSrc.value], current: photoSrc.value })
}

async function send() {
  if (!canSend.value) {
    if (!dept.value) message.value = '先选一下这单是哪个部门的'
    else message.value = '至少填一行：物料编码和数量'
    return
  }
  sending.value = true
  message.value = ''
  try {
    const payload = {
      orders: [
        {
          dept: dept.value,
          requester: requester.value.trim(),
          docNo: docNo.value.trim(),
          docDate: docDate.value.trim(),
          items: rows.value.filter(isFilled).map((row) => ({
            materialCode: row.materialCode.trim(),
            materialName: row.materialName.trim(),
            quantity: Number(row.quantity),
            unit: row.unit.trim(),
          })),
        },
      ],
    }
    const res = await request.post('/api/pick-order/submit', payload)
    const body = res.data || {}
    if (body.code !== 200) throw new Error(body.msg || '发送失败')
    sent.value = true
    uni.showToast({ title: '已发到电脑', icon: 'none' })
    // 单据号与领料人可以留着（同一批常常连号），明细清掉避免把上一单带进下一单
    rows.value = [blankLine()]
    photo.value = ''
  } catch (error) {
    message.value = `发送失败：${shortError(error)}`
  } finally {
    sending.value = false
  }
}
</script>

<style lang="scss" scoped>
.pp {
  min-height: 100vh;
  background: var(--ui-scene-bg, #f7f5f1);
  padding-bottom: calc(200rpx + env(safe-area-inset-bottom, 0px) + var(--pp-kb, 0px));
  box-sizing: border-box;
}

.pp__body {
  padding: 24rpx 28rpx 0;
}

.pp__head {
  padding: 4rpx 4rpx 20rpx;
}

.pp__sub {
  display: block;
  font-size: 26rpx;
  line-height: 1.5;
  color: var(--ui-text-2, #5b6069);
}

.pp__note {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  margin-bottom: 20rpx;
  padding: 20rpx 24rpx;
  border-radius: 20rpx;
  background: var(--ui-amber-50, #fdf6e7);
  border: 2rpx solid var(--ui-amber-200, #f0dcb0);
}

.pp__note-text {
  flex: 1;
  font-size: 25rpx;
  line-height: 1.5;
  color: var(--ui-amber-800, #7a5312);
}

.pp__note-x {
  font-size: 25rpx;
  font-weight: 600;
  color: var(--ui-amber-800, #7a5312);
}

/* 空态：一块大的可点区域，比两个等宽按钮更好按 */
.pp__shot {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 72rpx 24rpx;
  border-radius: 28rpx;
  border: 2rpx dashed var(--ui-border-strong, #d6d1c6);
  background: var(--ui-surface, #fff);
}

.pp__shot-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 104rpx;
  height: 104rpx;
  border-radius: 52rpx;
  background: var(--ui-accent-soft, #eaf1fb);
  color: var(--ui-accent, #2f6fdb);
  margin-bottom: 20rpx;
}

.pp__shot-main {
  font-size: 34rpx;
  font-weight: 600;
  color: var(--ui-text, #1c1c1e);
}

.pp__shot-sub {
  margin-top: 10rpx;
  font-size: 25rpx;
  color: var(--ui-text-2, #5b6069);
}

.pp__shot-alt {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
  height: 92rpx;
  margin-top: 18rpx;
  border-radius: 22rpx;
  background: var(--ui-raise, #fff);
  color: var(--ui-text-2, #5b6069);
}

.pp__shot-alt-text {
  font-size: 28rpx;
}

.pp__photo {
  display: flex;
  gap: 20rpx;
  padding: 20rpx;
  border-radius: 26rpx;
  background: var(--ui-surface, #fff);
  border: 2rpx solid var(--ui-hairline, #ece7dd);
}

.pp__thumb {
  width: 168rpx;
  height: 168rpx;
  border-radius: 18rpx;
  background: var(--ui-raise-2, #f3f1ec);
}

.pp__photo-side {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.pp__photo-state {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--ui-text, #1c1c1e);
}

.pp__photo-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
}

.pp__mini {
  padding: 12rpx 22rpx;
  border-radius: 999rpx;
  font-size: 25rpx;
  color: var(--ui-text-2, #5b6069);
  background: var(--ui-raise-2, #f3f1ec);
}

.pp__mini--go {
  color: var(--ui-accent, #2f6fdb);
  background: var(--ui-accent-soft, #eaf1fb);
}

.pp__card {
  margin-top: 20rpx;
  padding: 24rpx;
  border-radius: 26rpx;
  background: var(--ui-surface, #fff);
  border: 2rpx solid var(--ui-hairline, #ece7dd);
}

.pp__card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18rpx;
}

.pp__card-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ui-text, #1c1c1e);
}

.pp__hint {
  font-size: 24rpx;
  color: var(--ui-text-2, #5b6069);
}

.pp__card-acts {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.pp__count {
  font-size: 24rpx;
  color: var(--ui-text-2, #5b6069);
}

.pp__add {
  padding: 10rpx 20rpx;
  border-radius: 999rpx;
  font-size: 25rpx;
  color: var(--ui-accent, #2f6fdb);
  background: var(--ui-accent-soft, #eaf1fb);
}

.pp__depts {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
  margin-bottom: 8rpx;
}

.pp__dept {
  padding: 14rpx 26rpx;
  border-radius: 999rpx;
  font-size: 27rpx;
  color: var(--ui-text-2, #5b6069);
  background: var(--ui-raise-2, #f3f1ec);
}

.pp__dept.is-on {
  color: var(--ui-on-accent, #fff);
  background: var(--ui-accent, #2f6fdb);
  font-weight: 600;
}

.pp__row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 14rpx 0;
  border-bottom: 2rpx solid var(--ui-hairline, #ece7dd);
}

.pp__row:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.pp__label {
  width: 120rpx;
  font-size: 26rpx;
  color: var(--ui-text-2, #5b6069);
}

.pp__input {
  flex: 1;
  min-width: 0;
  height: 64rpx;
  font-size: 28rpx;
  color: var(--ui-text, #1c1c1e);
}

.pp__ph {
  color: var(--ui-text-3, #9aa1ad);
  font-size: 27rpx;
}

.pp__empty {
  padding: 24rpx 8rpx;
}

.pp__empty-text {
  font-size: 25rpx;
  line-height: 1.6;
  color: var(--ui-text-2, #5b6069);
}

.pp__line {
  padding: 18rpx 0;
  border-top: 2rpx solid var(--ui-hairline, #ece7dd);
}

.pp__line:first-of-type {
  border-top: 0;
}

.pp__line-top {
  display: flex;
  align-items: center;
  gap: 14rpx;
}

.pp__no {
  width: 40rpx;
  font-size: 24rpx;
  color: var(--ui-text-3, #9aa1ad);
  text-align: center;
}

.pp__name {
  flex: 1;
  min-width: 0;
  height: 64rpx;
  font-size: 29rpx;
  font-weight: 500;
  color: var(--ui-text, #1c1c1e);
}

.pp__del {
  width: 56rpx;
  height: 56rpx;
  line-height: 52rpx;
  text-align: center;
  font-size: 34rpx;
  color: var(--ui-text-3, #9aa1ad);
}

.pp__line-bot {
  display: flex;
  gap: 12rpx;
  margin-top: 6rpx;
  padding-left: 54rpx;
}

.pp__code {
  flex: 1.4;
  min-width: 0;
  height: 60rpx;
  padding: 0 16rpx;
  border-radius: 14rpx;
  background: var(--ui-raise-2, #f3f1ec);
  font-size: 26rpx;
  color: var(--ui-text, #1c1c1e);
}

.pp__qty {
  flex: 1;
  min-width: 0;
  height: 60rpx;
  padding: 0 16rpx;
  border-radius: 14rpx;
  background: var(--ui-raise-2, #f3f1ec);
  font-size: 26rpx;
  color: var(--ui-text, #1c1c1e);
  text-align: right;
}

.pp__unit {
  width: 110rpx;
  height: 60rpx;
  padding: 0 16rpx;
  border-radius: 14rpx;
  background: var(--ui-raise-2, #f3f1ec);
  font-size: 26rpx;
  color: var(--ui-text, #1c1c1e);
  text-align: center;
}

.pp__tpl {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.pp__tpl-name {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--ui-text, #1c1c1e);
}

.pp__tpl-desc {
  font-size: 24rpx;
  line-height: 1.5;
  color: var(--ui-text-2, #5b6069);
}

.pp__pad {
  height: 40rpx;
}

/*
 * 底栏贴视口底：
 *   bottom 只算键盘高度，安全区由 padding-bottom 承担 —— 两个都加会多出一条空白。
 *   导航栏已经有页面名，这里不再重复大标题。
 */
.pp__bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: var(--pp-kb, 0px);
  padding: 16rpx 28rpx calc(20rpx + env(safe-area-inset-bottom, 0px));
  background: var(--ui-surface, #ffffff);
  border-top: 2rpx solid var(--ui-hairline, #ece7dd);
  z-index: 20;
}

.pp__go {
  width: 100%;
  height: 96rpx;
  line-height: 96rpx;
  border-radius: 24rpx;
  font-size: 31rpx;
  font-weight: 600;
  color: var(--ui-on-accent, #fff);
  background: var(--ui-accent, #2f6fdb);
  border: 0;
}

.pp__go[disabled] {
  opacity: 0.45;
}
</style>
