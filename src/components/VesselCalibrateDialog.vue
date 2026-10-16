<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElButton, ElDialog } from 'element-plus'
import {
  boundsPayload,
  clamp,
  clampBox,
  defaultBox,
  deriveTangents,
  parseBounds,
  showsTangents,
} from '../utils/vesselCalibration'

/*
 * 底图标定（变更-082）。
 *
 * 为什么必须有这个界面：体积计算页的液面是按「罐体轮廓框 + 筒体上下切线」画到图上的，
 * 而这几个数字原先只能手工按图量、再手写进 image_bounds —— 手填必然错位，且错位不报错。
 * 更要紧的是：待上传的轮廓图**四周有留白、右下角带水印**，所以「整张图当罐体」这种
 * 默认值根本不成立（实测左侧留白 15%~27%），必须让人框一次。
 *
 * 交互设计的三条原则：
 *   ① **实时预览**：把罐体路径 + 一条试验液位直接画在图上，对不对一眼能看出来；
 *   ② **切线给初值**：按几何反推（见 vesselCalibration.deriveTangents，真数据误差 <1% 框高），
 *      拖着微调即可，不必从零量；
 *   ③ **只产出数字**：本组件不改任何业务状态，保存时只往外抛一段 JSON，
 *      由维护页连同其它字段一起提交（后端 save 是整行覆写，必须一起交）。
 */

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 底图地址（与维护页/体积计算页同一个解析） */
  imageUrl: { type: String, default: '' },
  imageFile: { type: String, default: '' },
  containerType: { type: Number, default: null },
  geometry: { type: Object, default: () => ({}) },
  /** 现有坐标（JSON 字符串或对象），空 = 还没标过 */
  bounds: { type: [String, Object], default: '' },
})
const emit = defineEmits(['update:modelValue', 'save'])

const svgRef = ref(null)
const imgW = ref(0)
const imgH = ref(0)
const box = reactive({ left: 0, right: 0, top: 0, bottom: 0 })
const tangents = reactive({ tangent: null, tangentBottom: null })
const error = ref('')
/** 试验液位：筒体段的 0~1（只影响预览，不落库） */
const previewLevel = ref(0.5)
/** 当前拖拽：{ kind, edge, startX, startY, origin } —— 坐标都是**图像像素** */
let drag = null

const vertical = computed(() => showsTangents(props.containerType))
const ready = computed(() => imgW.value > 0 && imgH.value > 0)
const viewBox = computed(() => `0 0 ${imgW.value || 1} ${imgH.value || 1}`)

/** 下切线（平底/无下封头时就是框底） */
const tangentBottomY = computed(() =>
  vertical.value && tangents.tangentBottom !== null ? tangents.tangentBottom : box.bottom,
)
/** 上切线（立式必有；卧式退化成框顶，路径就成了一条直线围合的方框） */
const tangentY = computed(() =>
  vertical.value && tangents.tangent !== null ? tangents.tangent : box.top,
)

/**
 * 罐体路径：与体积计算页同一套构造 ——
 * 左右两条竖线是筒体，上/下各接一个椭圆封头，封头的短半轴就是封头曲面深度在图上的长度。
 */
const vesselPath = computed(() => {
  if (!ready.value) return ''
  const { left, right, top, bottom } = box
  const rx = (right - left) / 2
  const ry = Math.max(0, tangentY.value - top)
  const ryBottom = Math.max(0, bottom - tangentBottomY.value)
  const above = ry > 0.5
    ? `M ${left} ${tangentY.value} A ${rx} ${ry} 0 0 1 ${right} ${tangentY.value}`
    : `M ${left} ${tangentY.value} L ${right} ${tangentY.value}`
  const below = ryBottom > 0.5
    ? `L ${right} ${tangentBottomY.value} A ${rx} ${ryBottom} 0 0 1 ${left} ${tangentBottomY.value}`
    : `L ${right} ${tangentBottomY.value} L ${left} ${tangentBottomY.value}`
  return `${above} ${below} Z`
})

/** 试验液位对应的 y（筒体段内插值；拖到筒体外就夹在两端） */
const levelY = computed(() => {
  const t = clamp(previewLevel.value, 0, 1)
  return tangentBottomY.value - t * (tangentBottomY.value - tangentY.value)
})

function initFromProps() {
  error.value = ''
  const existing = parseBounds(props.bounds)
  if (existing && imgW.value > 0 && imgH.value > 0) {
    // 已经标过：按现成坐标显示，允许在它基础上微调
    Object.assign(box, {
      left: existing.left,
      right: existing.right,
      top: existing.top,
      bottom: existing.bottom,
    })
    tangents.tangent = existing.tangent ?? null
    tangents.tangentBottom = existing.tangentBottom ?? null
  } else if (imgW.value > 0 && imgH.value > 0) {
    Object.assign(box, defaultBox(imgW.value, imgH.value))
    Object.assign(tangents, { tangent: null, tangentBottom: null })
    autoTangents()
  }
}

/** 按几何重算切线（初值） */
function autoTangents() {
  const derived = deriveTangents(box, props.geometry)
  tangents.tangent = derived.tangent ?? null
  tangents.tangentBottom = derived.tangentBottom ?? null
}

// 弹窗每次打开都重新读尺寸/重置状态（图片可能已换）。
// 用 new Image() 而不是绑 <image> 的 load：SVGImageElement 不给 naturalWidth/naturalHeight，
// 而坐标必须以**原图像素**为单位（与后端 VesselBounds 的口径一致）。
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    const img = new Image()
    img.onload = () => {
      imgW.value = img.naturalWidth
      imgH.value = img.naturalHeight
      if (!imgW.value || !imgH.value) {
        error.value = '取不到底图尺寸，无法标定'
        return
      }
      initFromProps()
    }
    img.onerror = () => {
      error.value = '底图加载失败（检查图片是否存在）'
    }
    img.src = props.imageUrl
  },
)

// 切换容器类型会影响「要不要切线」
watch(
  () => props.containerType,
  () => {
    if (ready.value) autoTangents()
  },
)

// ===== 拖拽 =====

/** 屏幕坐标 → 图像像素坐标（走 SVG 的 CTM，容器怎么缩放都不影响） */
function toImagePoint(event) {
  const svg = svgRef.value
  if (!svg) return null
  const pt = svg.createSVGPoint()
  pt.x = event.clientX
  pt.y = event.clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return null
  const loc = pt.matrixTransform(ctm.inverse())
  return { x: loc.x, y: loc.y }
}

function startDrag(kind, edge, event) {
  const p = toImagePoint(event)
  if (!p) return
  drag = { kind, edge, startX: p.x, startY: p.y, origin: { ...box }, originTangents: { ...tangents } }
  event.preventDefault()
}

function onPointerMove(event) {
  if (!drag) return
  const p = toImagePoint(event)
  if (!p) return
  const dx = p.x - drag.startX
  const dy = p.y - drag.startY
  if (drag.kind === 'box') {
    // 整框拖动时不许跑出图外：先把位移夹住
    const clampedX = clamp(dx, -drag.origin.left, imgW.value - drag.origin.right)
    const clampedY = clamp(dy, -drag.origin.top, imgH.value - drag.origin.bottom)
    Object.assign(box, {
      left: drag.origin.left + clampedX,
      right: drag.origin.right + clampedX,
      top: drag.origin.top + clampedY,
      bottom: drag.origin.bottom + clampedY,
    })
    // 框动了，切线跟着平移（否则一拖框切线就留在原地，看着像坏了）
    if (drag.originTangents.tangent !== null) {
      tangents.tangent = drag.originTangents.tangent + clampedY
    }
    if (drag.originTangents.tangentBottom !== null) {
      tangents.tangentBottom = drag.originTangents.tangentBottom + clampedY
    }
  } else if (drag.kind === 'edge') {
    const next = { ...box }
    if (drag.edge === 'left') next.left = clamp(p.x, 0, box.right - 8)
    if (drag.edge === 'right') next.right = clamp(p.x, box.left + 8, imgW.value)
    if (drag.edge === 'top') next.top = clamp(p.y, 0, box.bottom - 8)
    if (drag.edge === 'bottom') next.bottom = clamp(p.y, box.top + 8, imgH.value)
    Object.assign(box, next)
  } else if (drag.kind === 'tangent') {
    const value = clamp(p.y, box.top + 1, box.bottom - 1)
    if (drag.edge === 'tangent') {
      tangents.tangent = tangents.tangentBottom !== null
        ? Math.min(value, tangents.tangentBottom - 1)
        : value
    } else {
      tangents.tangentBottom = tangents.tangent !== null
        ? Math.max(value, tangents.tangent + 1)
        : value
    }
  }
  Object.assign(box, clampBox(box, imgW.value, imgH.value))
}

function stopDrag() {
  drag = null
}

onMounted(() => {
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', stopDrag)
  window.addEventListener('pointercancel', stopDrag)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', stopDrag)
  window.removeEventListener('pointercancel', stopDrag)
})

// ===== 保存 =====

function handleSave() {
  error.value = ''
  if (!ready.value) {
    error.value = '底图还没加载好，无法保存'
    return
  }
  if (box.right - box.left < 8 || box.bottom - box.top < 8) {
    error.value = '罐体轮廓框太小了，请重新框选'
    return
  }
  if (vertical.value && tangents.tangent === null) {
    error.value = '立式容器需要标出筒体上切线（可点「按几何重算切线」）'
    return
  }
  emit(
    'save',
    boundsPayload({
      imgW: imgW.value,
      imgH: imgH.value,
      box,
      containerType: props.containerType,
      tangents,
    }),
  )
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="标定底图"
    width="900px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="space-y-3">
      <p class="text-xs text-slate-500">
        把矩形拖到**罐体外轮廓**（含上下封头，不含支腿与管口），再校准两条切线：
        切线之间的部分按筒体计算液位。框外的留白与水印不影响结果。
      </p>

      <div class="flex flex-wrap items-center gap-2">
        <el-button size="small" @click="autoTangents">按几何重算切线</el-button>
        <el-button size="small" @click="Object.assign(box, defaultBox(imgW, imgH))">重置轮廓框</el-button>
        <span class="text-xs text-slate-500">试验液位</span>
        <input
          v-model.number="previewLevel"
          type="range"
          min="0"
          max="1"
          step="0.01"
          class="w-40"
          aria-label="试验液位（仅预览）"
        />
        <span class="text-xs text-slate-500">{{ Math.round(previewLevel * 100) }}%</span>
        <span class="ml-auto text-xs text-slate-500">
          图片 {{ imgW }}×{{ imgH }} px ｜ 框 {{ Math.round(box.left) }},{{ Math.round(box.top) }} –
          {{ Math.round(box.right) }},{{ Math.round(box.bottom) }}
        </span>
      </div>

      <div class="rounded-card border border-line bg-region p-2">
        <svg
          ref="svgRef"
          :viewBox="viewBox"
          class="block max-h-[52vh] w-full touch-none select-none"
          role="img"
          :aria-label="`${imageFile} 的底图标定`"
        >
          <image :href="imageUrl" x="0" y="0" :width="imgW" :height="imgH" />

          <!-- 罐体 + 液面：与体积计算页同一套构造，所见即所得 -->
          <defs>
            <!-- ⚠️ id 必须是固定串：imageFile 里带 `/`（/files/xxx.png），拿它拼 id 会变成非法值、
                 url(#…) 也引用不上 -->
            <clipPath id="vessel-clip-preview">
              <path :d="vesselPath" />
            </clipPath>
          </defs>
          <rect
            v-if="ready"
            :x="box.left"
            :y="levelY"
            :width="box.right - box.left"
            :height="box.bottom - levelY"
            fill="rgba(96, 165, 250, 0.35)"
            clip-path="url(#vessel-clip-preview)"
          />
          <path v-if="ready" :d="vesselPath" fill="none" stroke="#111111" stroke-width="1.5" />
          <line
            v-if="ready"
            :x1="box.left"
            :x2="box.right"
            :y1="levelY"
            :y2="levelY"
            stroke="#60a5fa"
            stroke-width="1.5"
            stroke-dasharray="6 4"
          />

          <!-- 轮廓框 + 四条边的把手 -->
          <rect
            v-if="ready"
            :x="box.left"
            :y="box.top"
            :width="box.right - box.left"
            :height="box.bottom - box.top"
            fill="transparent"
            stroke="#f59e0b"
            stroke-width="1.5"
            stroke-dasharray="8 4"
            class="cursor-move"
            @pointerdown="startDrag('box', 'box', $event)"
          />
          <template v-if="ready">
            <circle
              :cx="box.left"
              :cy="(box.top + box.bottom) / 2"
              r="7"
              fill="#f59e0b"
              class="cursor-ew-resize"
              @pointerdown="startDrag('edge', 'left', $event)"
            />
            <circle
              :cx="box.right"
              :cy="(box.top + box.bottom) / 2"
              r="7"
              fill="#f59e0b"
              class="cursor-ew-resize"
              @pointerdown="startDrag('edge', 'right', $event)"
            />
            <circle
              :cx="(box.left + box.right) / 2"
              :cy="box.top"
              r="7"
              fill="#f59e0b"
              class="cursor-ns-resize"
              @pointerdown="startDrag('edge', 'top', $event)"
            />
            <circle
              :cx="(box.left + box.right) / 2"
              :cy="box.bottom"
              r="7"
              fill="#f59e0b"
              class="cursor-ns-resize"
              @pointerdown="startDrag('edge', 'bottom', $event)"
            />
          </template>

          <!-- 上下切线（立式才有） -->
          <template v-if="vertical && ready">
            <line
              :x1="box.left"
              :x2="box.right"
              :y1="tangentY"
              :y2="tangentY"
              stroke="#111111"
              stroke-width="2"
              stroke-dasharray="4 3"
              class="cursor-ns-resize"
              @pointerdown="startDrag('tangent', 'tangent', $event)"
            />
            <text :x="box.left" :y="tangentY - 6" font-size="16" fill="#111111">上切线</text>
            <template v-if="tangents.tangentBottom !== null">
              <line
                :x1="box.left"
                :x2="box.right"
                :y1="tangentBottomY"
                :y2="tangentBottomY"
                stroke="#111111"
                stroke-width="2"
                stroke-dasharray="4 3"
                class="cursor-ns-resize"
                @pointerdown="startDrag('tangent', 'tangentBottom', $event)"
              />
              <text :x="box.left" :y="tangentBottomY - 6" font-size="16" fill="#111111">下切线</text>
            </template>
          </template>
        </svg>
      </div>

      <p v-if="error" role="alert" class="text-xs text-rose-600">{{ error }}</p>
      <p v-else class="text-xs text-slate-500">
        保存后坐标存进台账；体积计算页只收「已启用 + 有底图 + 已标定 + 几何齐全」的设备。
      </p>
    </div>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" @click="handleSave">用这个坐标</el-button>
    </template>
  </el-dialog>
</template>
