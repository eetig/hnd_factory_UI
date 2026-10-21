<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElDialog } from 'element-plus'

/**
 * 图片浏览弹窗（纯展示）：看大图 / 左右翻页 / 缩放平移 / 加图 / 删图。
 *
 * <p>**不含任何数据逻辑** —— 图片从哪来、上传到哪去、删完怎么刷新，全由调用方的
 * composable 负责（工单是 `useOrderImages`，储罐液位是 `useTankLevelImages`）。
 *
 * <p>`currentIndex` 保持**受控**（父组件持有并改）：翻页状态原本就在调用方的
 * composable 里，且有单测覆盖，塞进组件内部会连带改掉那份 API。
 *
 * <p>2026-10-21 重做（使用方说"不好看"）。原版是白底大卡片：照片只占中间一小块、
 * 两侧大片灰、删除按钮粉色胶囊压在照片上、箭头钉在弹窗边缘、页码孤立在下方 ——
 * 五个毛病其实是同一个根：它长得像**表单**，不像**看图器**。
 *
 * <p>现在的形态（使用方逐项定的）：
 *   · **图片周围透明** —— 弹窗本体没有底色，看到的是被压暗的下层页面
 *   · **跟随系统深浅色** —— prefers-color-scheme：浅色用深墨字 + 浅遮罩，深色反过来
 *   · 元信息与关闭并到顶部一条细栏；页码与操作收进底部一条栏
 *   · 多张时给**缩略图条**（点哪张跳哪张）、左右箭头贴照片、键盘 ←/→ 翻页
 *   · **缩放**：滚轮缩放、放大后拖动平移、双击复位 —— 抄表照片的用途是看清刻度，
 *     只能看整张等于没用
 */
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** [{ imageId, url, thumbnailUrl }] */
  images: { type: Array, default: () => [] },
  currentIndex: { type: Number, default: 0 },
  /** 弹窗头部展示的字段：[{ label, value }] */
  titleItems: { type: Array, default: () => [] },
  canUpload: { type: Boolean, default: false },
  canDelete: { type: Boolean, default: false },
  uploading: { type: Boolean, default: false },
  deleting: { type: Boolean, default: false },
  /**
   * file input 的 accept。
   *
   * 默认沿用工单那边的 `image/*`（不动既有行为）；储罐液位图传 `image/png,image/jpeg`，
   * 与后端白名单一致 —— 那边的后端会显式拒掉非 PNG/JPG，让用户先选到再被拒是白跑一趟。
   */
  accept: { type: String, default: 'image/*' },
  emptyText: { type: String, default: '暂无图片' },
  imageAlt: { type: String, default: '原图' },
})

const emit = defineEmits(['update:modelValue', 'prev', 'next', 'upload', 'delete'])

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

// 索引越界时（比如刚删掉最后一张）不渲染 <img>，而不是渲染 undefined 的 src
const currentImage = computed(() => props.images[props.currentIndex] || null)
const hasMultiple = computed(() => props.images.length > 1)

const fileInput = ref(null)
const confirmDelete = ref(false)

function openFilePicker() {
  fileInput.value?.click()
}

function handleFileSelected(event) {
  const files = Array.from(event.target.files || [])
  // 清空 value：否则连续两次选同一批文件不会再触发 change
  event.target.value = ''
  if (files.length) {
    emit('upload', files)
  }
}


/* ===== 缩放与平移 =====
 * 变换只作用于图片本身（transform 不触发重排），弹窗布局不变。
 */
const scale = ref(1)
const tx = ref(0)
const ty = ref(0)
const dragging = ref(false)
let startX = 0
let startY = 0
let startTx = 0
let startTy = 0

const MIN_SCALE = 1
const MAX_SCALE = 6

const transformStyle = computed(() => ({
  transform: `translate(${tx.value}px, ${ty.value}px) scale(${scale.value})`,
  cursor: scale.value > 1 ? (dragging.value ? 'grabbing' : 'grab') : 'zoom-in',
  transition: dragging.value ? 'none' : 'transform 140ms ease-out',
}))

function clampPan() {
  if (scale.value <= 1) {
    tx.value = 0
    ty.value = 0
  }
}

function onWheel(event) {
  if (!currentImage.value) return
  const step = event.deltaY < 0 ? 0.25 : -0.25
  scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale.value + step))
  clampPan()
}

function onPointerDown(event) {
  if (scale.value <= 1) return
  dragging.value = true
  startX = event.clientX
  startY = event.clientY
  startTx = tx.value
  startTy = ty.value
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

function onPointerMove(event) {
  if (!dragging.value) return
  tx.value = startTx + (event.clientX - startX)
  ty.value = startTy + (event.clientY - startY)
}

function onPointerUp() {
  dragging.value = false
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
}

/** 双击：放大态复位；1x 态放大到 2 倍（多数人的习惯） */
function onDoubleClick() {
  if (scale.value > 1) {
    resetZoom()
  } else {
    scale.value = 2
  }
}

function resetZoom() {
  scale.value = 1
  tx.value = 0
  ty.value = 0
}

/**
 * 键盘：←/→ 翻页、Esc 关闭、+/- 缩放、0 复位。
 * 只在弹窗打开时挂监听 —— 常驻会让别的页面也响应方向键。
 */
function onKeydown(event) {
  if (event.key === 'ArrowLeft' && hasMultiple.value) {
    emit('prev')
  } else if (event.key === 'ArrowRight' && hasMultiple.value) {
    emit('next')
  } else if (event.key === 'Escape') {
    dialogVisible.value = false
  } else if (event.key === '+' || event.key === '=') {
    scale.value = Math.min(MAX_SCALE, scale.value + 0.5)
  } else if (event.key === '-') {
    scale.value = Math.max(MIN_SCALE, scale.value - 0.5)
    clampPan()
  } else if (event.key === '0') {
    resetZoom()
  }
}

function bindKeydown() {
  window.addEventListener('keydown', onKeydown)
}

function unbindKeydown() {
  window.removeEventListener('keydown', onKeydown)
  onPointerUp()
}

// 换图 / 关弹窗都复位：否则下一张会带着上一张的缩放和位移
watch(
  () => props.currentIndex,
  () => {
    resetZoom()
    confirmDelete.value = false
  },
)

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      resetZoom()
      confirmDelete.value = false
      bindKeydown()
    } else {
      unbindKeydown()
    }
  },
)

onMounted(() => {
  if (props.modelValue) bindKeydown()
})

onBeforeUnmount(unbindKeydown)

/** 删除要二次确认：图据删掉不可恢复（只能重拍），误触代价比多点一下大得多 */
function askDelete() {
  if (!confirmDelete.value) {
    confirmDelete.value = true
    return
  }
  confirmDelete.value = false
  emit('delete', currentImage.value)
}
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    width="92vw"
    class="image-preview-dialog image-preview-dialog--glass"

    modal-class="image-preview-overlay"
    align-center
    append-to-body
    :show-close="false"
  >
    <template #header>
      <div class="flex items-center gap-4 px-4 py-2.5">
        <div class="ipv-meta flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-1 text-[13px]">
          <span v-for="item in titleItems" :key="item.label">
            {{ item.label }}：<span class="ipv-meta__value">{{ item.value }}</span>
          </span>
          <span v-if="!titleItems.length">{{ imageAlt }}</span>
        </div>
        <button
          type="button"
          class="ipv-icon-btn flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          aria-label="关闭"
          @click="dialogVisible = false"
        >
          <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </template>

    <!-- 舞台：**没有底色**。看到的是被压暗的下层页面，图片直接浮在上面 -->
    <div class="relative flex items-center justify-center overflow-hidden px-12">
      <template v-if="currentImage">
        <button
          v-if="hasMultiple"
          type="button"
          class="ipv-icon-btn absolute left-2 z-10 flex h-10 w-10 items-center justify-center rounded-full"
          aria-label="上一张"
          @click="emit('prev')"
        >
          <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>

        <img
          :src="currentImage.url"
          :alt="imageAlt"
          class="max-h-[calc(100vh-190px)] max-w-full select-none rounded-md object-contain shadow-[0_24px_60px_-24px_rgba(0,0,0,0.55)]"
          :style="transformStyle"
          draggable="false"
          @wheel.prevent="onWheel"
          @pointerdown="onPointerDown"
          @pointerup="onPointerUp"
          @dblclick="onDoubleClick"
        />

        <button
          v-if="hasMultiple"
          type="button"
          class="ipv-icon-btn absolute right-2 z-10 flex h-10 w-10 items-center justify-center rounded-full"
          aria-label="下一张"
          @click="emit('next')"
        >
          <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <!-- 放大后给一个"现在几倍、点这里复位"的出口；常态不显示，免得啰嗦 -->
        <div v-if="scale > 1" class="absolute bottom-1 left-1/2 z-10 -translate-x-1/2">
          <button type="button" class="ipv-chip" @click="resetZoom">
            {{ Math.round(scale * 100) }}%　点此复位
          </button>
        </div>
      </template>
      <p v-else class="ipv-empty py-16 text-sm">{{ emptyText }}</p>
    </div>

    <template #footer>
      <div class="px-4 py-2.5">
        <!-- 缩略图条：多张时给全貌 -->
        <div v-if="hasMultiple" class="mb-2 flex gap-2 overflow-x-auto pb-1">
          <button
            v-for="(item, index) in images"
            :key="item.imageId || index"
            type="button"
            class="ipv-thumb shrink-0 overflow-hidden rounded"
            :class="{ 'is-active': index === currentIndex }"
            :aria-label="`第 ${index + 1} 张`"
            @click="index === currentIndex ? undefined : index > currentIndex ? emit('next') : emit('prev')"
          >
            <img :src="item.thumbnailUrl || item.url" alt="" class="h-14 w-14 object-cover" />
          </button>
        </div>

        <div class="flex items-center justify-between gap-4">
          <span class="ipv-count text-[13px] tabular-nums">
            <template v-if="images.length">
              第 <span class="ipv-count__now">{{ currentIndex + 1 }}</span> 张 / 共 {{ images.length }} 张
            </template>
          </span>

          <div class="flex items-center gap-2">
            <input
              ref="fileInput"
              type="file"
              :accept="accept"
              multiple
              class="hidden"
              @change="handleFileSelected"
            />
            <template v-if="canDelete && currentImage">
              <button
                v-if="!confirmDelete"
                type="button"
                class="ipv-danger"
                :disabled="deleting"
                @click="askDelete"
              >
                删除当前图片
              </button>
              <template v-else>
                <span class="ipv-confirm-tip">确认删除这张？</span>
                <button type="button" class="ipv-danger" :disabled="deleting" @click="askDelete">
                  {{ deleting ? '删除中…' : '确认删除' }}
                </button>
                <button type="button" class="ipv-plain" @click="confirmDelete = false">取消</button>
              </template>
            </template>
            <button
              v-if="canUpload"
              type="button"
              class="ipv-primary"
              :disabled="uploading"
              @click="openFilePicker"
            >
              {{ uploading ? '上传中…' : '添加图片' }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
/*
 * 两套配色只差深浅，写成两组变量 + 一组规则：换主题只是换变量值。
 * 遮罩本身在 style.css 里（弹窗被 teleport，遮罩不在这棵子树里），那边用
 * prefers-color-scheme 分别给浅/深两种。
 */
/* 配色变量声明在 src/style.css（弹窗被 teleport 到 body，scoped 声明挂不上那节点）*/

/*
 * 30% 遮罩下文字会跟背景"混"在一起（深色档尤甚：白字压浅页 ≈ 2:1）。
 * 加一层很轻的投影：不改变透明度，但把字从背景里"拔"出来 —— 这是阴影最正当的用法。
 */
.ipv-meta,
.ipv-count,
.ipv-confirm-tip,
.ipv-chip,
.ipv-plain,
.ipv-danger,
.ipv-primary {
  text-shadow: 0 1px 2px rgb(0 0 0 / 0.45);
}

/* 浅色下深墨字配"亮投影"：下层页面花的时候也能把字托起来。
   注意用媒体查询而不是 .is-light 类 —— 主题已经完全交给 CSS，不再有那个类。 */
@media (prefers-color-scheme: light) {
  .ipv-meta,
  .ipv-count,
  .ipv-confirm-tip,
  .ipv-chip,
  .ipv-plain {
    text-shadow: 0 1px 1px rgb(255 255 255 / 0.85);
  }
}

.ipv-meta {
  color: var(--ipv-text);
}

.ipv-meta__value {
  color: var(--ipv-text-strong);
}

.ipv-icon-btn {
  background: var(--ipv-btn-bg);
  color: var(--ipv-text-strong);
  transition: background-color 140ms ease;
}

.ipv-icon-btn:hover {
  background: var(--ipv-btn-bg-hover);
}

.ipv-icon-btn:focus-visible,
.ipv-primary:focus-visible,
.ipv-danger:focus-visible,
.ipv-plain:focus-visible,
.ipv-thumb:focus-visible,
.ipv-chip:focus-visible {
  outline: 2px solid var(--ipv-text-strong);
  outline-offset: 2px;
}

.ipv-empty {
  color: var(--ipv-text);
}

.ipv-count {
  color: var(--ipv-text);
}

.ipv-count__now {
  color: var(--ipv-text-strong);
}

.ipv-chip {
  border-radius: 999px;
  padding: 4px 12px;
  background: var(--ipv-btn-bg);
  color: var(--ipv-text-strong);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.ipv-thumb {
  border: 1px solid var(--ipv-hairline);
  opacity: 0.66;
  transition: opacity 140ms ease, border-color 140ms ease;
}

.ipv-thumb:hover {
  opacity: 0.92;
}

.ipv-thumb.is-active {
  border-color: var(--ipv-text-strong);
  opacity: 1;
}

.ipv-primary {
  border-radius: 999px;
  padding: 6px 16px;
  background: var(--ipv-btn-bg);
  color: var(--ipv-text-strong);
  font-size: 13px;
  font-weight: 500;
  transition: background-color 140ms ease;
}

.ipv-primary:hover {
  background: var(--ipv-btn-bg-hover);
}

.ipv-danger {
  border-radius: 999px;
  padding: 6px 14px;
  color: #b91c1c;
  font-size: 13px;
  transition: background-color 140ms ease;
}

.ipv-danger:hover {
  background: rgb(185 28 28 / 0.1);
}

/* 深色下 danger 要提亮，否则红字在深遮罩上糊成一团 */
@media (prefers-color-scheme: dark) {
  .ipv-danger {
    color: #fecaca;
  }

  .ipv-danger:hover {
    background: rgb(248 113 113 / 0.16);
  }
}

.ipv-plain {
  border-radius: 999px;
  padding: 6px 12px;
  color: var(--ipv-text);
  font-size: 13px;
}

.ipv-plain:hover {
  background: var(--ipv-btn-bg);
}

.ipv-confirm-tip {
  color: var(--ipv-text-strong);
  font-size: 13px;
}
</style>
