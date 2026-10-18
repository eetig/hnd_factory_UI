import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { liquidVolumeMm3 } from './useVesselModel'

/**
 * 压力容器的**画布与液位交互**（原 WorkOrderList.vue 里「储罐体积计算」那一段）。
 *
 * 与 `useVesselModel`（几何 / 容积 / 说明）分开的理由只有一个：那段脚本连模板带样式
 * 一千三百多行，拆页时它是唯一一个拆完仍会超过 900 行的候选。边界是现成的 ——
 * 这里全是「会动的东西」：画布绘制、水波纹、液位缓动、滑块与引线标注；
 * 那边全是「算出来的东西」。
 *
 * 三件事**不许动**，各有理由（DESIGN.md §4）：
 *   ① `.vessel-canvas` 的**内容色**（液面按罐号取色的 PALETTE）—— 那是数据不是 chrome；
 *   ② 语义红绿（`VESSEL_DELTA_COLOR`）—— 状态语义，全站唯一允许的高饱和；
 *   ③ 计算几何与键盘通路（可拖、可键入、可 Tab）。
 */
export function useVesselCanvas(model) {
  const { selectedVessel, vesselGeometry, vesselKey } = model

  // 起始液位 / 终止液位：两个独立液位，用于对比与体积差计算
  const vesselStartLevel = ref(1400)
  const vesselEndLevel = ref(1400)
  const vesselStartDisplay = ref(1400) // 动画中的起始液位
  const vesselEndDisplay = ref(1400) // 动画中的终止液位
  const vesselCanvas = ref(null)
  const vesselImage = ref(null)
  const vesselSwitching = ref(false) // 切换储罐时淡出/淡入

  // 体积：与模型那边的 vesselCapacity 同一个函数（液体体积 = 壳体 − 液面以下的管束）
  const vesselStartVolume = computed(
    () => liquidVolumeMm3(vesselStartDisplay.value, vesselGeometry.value) / 1e9,
  )
  const vesselEndVolume = computed(
    () => liquidVolumeMm3(vesselEndDisplay.value, vesselGeometry.value) / 1e9,
  )
  // 体积变化 = 终止 − 起始（正数为增加）
  const vesselVolumeDelta = computed(() => vesselEndVolume.value - vesselStartVolume.value)

  // 物料重量（吨）：体积 × 密度（g/cm³ 数值上等于 t/m³）；未配置密度时为 null
  function toMass(volume) {
    const density = vesselGeometry.value.density
    return density ? volume * density : null
  }

  const vesselStartMass = computed(() => toMass(vesselStartVolume.value))
  const vesselEndMass = computed(() => toMass(vesselEndVolume.value))
  const vesselMassDelta = computed(() =>
    vesselStartMass.value === null ? null : toMass(vesselVolumeDelta.value),
  )

  // 水波纹参数
  const VESSEL_WAVE = {
    amplitude: 3.5, // 波幅（画布像素）
    wavelength: 120, // 波长（画布像素）
    speed: 0.04, // 相位推进速度（弧度 / 60fps 帧），约 2.6 秒一个周期
  }

  let vesselFrameId = null
  let vesselWavePhase = 0
  let vesselLastFrameTime = 0
  let vesselTransitions = { start: null, end: null } // 起始/终止液位的缓动过渡状态

  /*
   * 「这一页还在不在」—— 替代改造前的 `activeTab.value === 'vessel'`。
   *
   * 原先帧循环自己判断「用户是否还停在体积计算页签」：切走就停帧，不白烧 CPU。
   * 现在页面随路由卸载，所以「还在不在」= 本组件有没有被卸载。`stopVesselLoop`
   * 也由 onUnmounted 调用，双保险（卸载后即使还有一帧排进队列，它也只会停自己）。
   */
  let disposed = false

  function stopVesselLoop() {
    if (vesselFrameId !== null) {
      cancelAnimationFrame(vesselFrameId)
      vesselFrameId = null
    }
    vesselLastFrameTime = 0
  }

  // 单帧：推进液位缓动 + 波纹相位，然后重绘
  function vesselFrame(now) {
    // 按真实时间推进，避免不同刷新率下速度不一致
    const deltaMs = vesselLastFrameTime ? Math.min(50, now - vesselLastFrameTime) : 16.7
    vesselLastFrameTime = now

    for (const which of ['start', 'end']) {
      const transition = vesselTransitions[which]
      if (!transition) continue

      const progress = Math.min(1, (now - transition.startTime) / transition.duration)
      const eased = 1 - Math.pow(1 - progress, 3) // easeOutCubic：起步快、接近目标时放缓

      levelDisplayRef(which).value = transition.from + transition.delta * eased

      if (progress >= 1) {
        levelDisplayRef(which).value = transition.from + transition.delta
        vesselTransitions[which] = null
      }
    }

    vesselWavePhase += VESSEL_WAVE.speed * (deltaMs / 16.7)
    renderVessel()

    // 页面卸载后自动停帧，不浪费性能
    if (!disposed) {
      vesselFrameId = requestAnimationFrame(vesselFrame)
    } else {
      vesselFrameId = null
    }
  }

  function startVesselLoop() {
    if (vesselFrameId === null && !disposed) {
      vesselFrameId = requestAnimationFrame(vesselFrame)
    }
  }

  // 液位平滑过渡到目标值（时长随变化幅度自适应，700~2000ms）
  function levelTargetRef(which) {
    return which === 'start' ? vesselStartLevel : vesselEndLevel
  }

  function levelDisplayRef(which) {
    return which === 'start' ? vesselStartDisplay : vesselEndDisplay
  }

  function animateVesselTo(which, target) {
    const displayRef = levelDisplayRef(which)
    const from = displayRef.value
    const delta = target - from

    if (Math.abs(delta) < 0.5) {
      displayRef.value = target
      vesselTransitions[which] = null
      renderVessel()
      return
    }

    vesselTransitions[which] = {
      from,
      delta,
      duration: 700 + (Math.abs(delta) / vesselGeometry.value.maxLevel) * 1300,
      startTime: performance.now(),
    }

    startVesselLoop()
  }

  // 变更-045 定的两处墨色，变更-046 把「差值语义色」也收拢成常量：
  // 起始 = 图上虚线（#1e293b = slate-800，与图例 border-slate-800 同一只墨）；
  // 差值一对墨 = 消耗玫红 / 增加翡翠 —— 画布剖面线 + 引线标注 + 滑块钮间色带三处共用。
  const VESSEL_START_INK = '#1e293b'
  const VESSEL_DELTA_COLOR = { consume: '#e11d48', increase: '#059669' }

  /**
   * 语义色的**低透明度版**（差值带的底色）—— 由上面那一对**派生**，不再各写一份字面量。
   *
   * x-minimalist（变更-058）收敛的：原先是 rose-500 / emerald-500 的手写 rgba，
   * 与线用的 rose-600 / emerald-600 **不是同一只色** —— 于是"带"与"线"是两家人，
   * 只是肉眼看着差不多才一直没露馅。派生之后两者必然同色相，spec 也钉得住这条关系。
   *
   * 两档 α 的差别是**观察强度**不是笔误：消耗（玫红）比增加（翡翠）更刺眼，
   * 所以同样铺一层时它给得更少（0.10 vs 0.12），两种带的"分量感"才相当。
   */
  const withAlpha = (hex, alpha) => {
    const n = Number.parseInt(hex.slice(1), 16)
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
  }
  const VESSEL_DELTA_FILL = {
    consume: withAlpha(VESSEL_DELTA_COLOR.consume, 0.1),
    increase: withAlpha(VESSEL_DELTA_COLOR.increase, 0.12),
  }

  /**
   * 画布里的字族必须与 `src/style.css` 的 `:root` **同源**（同一份墨、同一套字）。
   *
   * x-minimalist 把全站字体栈从 Inter 换成系统人文无衬线时，画布这里漏了 ——
   * 后果是图上的数字与页面上同一串数字落在两套字形里（`tabular-nums` 还在，
   * 但字形不同）。spec 有一条跨文件断言钉着两者同源。
   */
  const VESSEL_CANVAS_FONT =
    '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'

  // 绘制罐体底图与液位填充
  function renderVessel() {
    const canvas = vesselCanvas.value
    if (!canvas) return

    const image = vesselImage.value
    if (!image) return

    const geometry = vesselGeometry.value
    const bounds = geometry.imageBounds
    const dpr = window.devicePixelRatio || 1

    // 画布尺寸按底图比例自适应
    const IMAGE_W = model.VESSEL_CANVAS_WIDTH
    const LABEL_COLUMN = model.VESSEL_LABEL_COLUMN
    const W = IMAGE_W + LABEL_COLUMN
    const H = Math.round((IMAGE_W * bounds.height) / bounds.width)

    canvas.width = W * dpr
    canvas.height = H * dpr

    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    ctx.drawImage(image, 0, 0, IMAGE_W, H)

    const s = IMAGE_W / bounds.width
    const vesselPath = new Path2D()
    let tankLeft
    let tankRight
    let bottomY
    let levelToY

    if (geometry.type === 'vertical') {
      // 立式罐：顶部半椭球封头 + 等径筒体（+ 可选的底部半椭球封头）
      const left = bounds.left * s
      const right = bounds.right * s
      const tangentY = bounds.tangent * s
      const bottom = bounds.bottom * s
      const cx = (left + right) / 2
      const rx = (right - left) / 2
      const ry = tangentY - bounds.top * s
      const apexY = bounds.top * s
      // 下封头：150 产品储罐是平底（没有 tangentBottom），此时 tangentBottomY 就是 bottom，
      // 下面走 else 分支画平底，与改造前完全一致
      const hasBottomHead = geometry.bottomHeadDepth > 0 && bounds.tangentBottom !== undefined
      const tangentBottomY = hasBottomHead ? bounds.tangentBottom * s : bottom
      const ryBottom = bottom - tangentBottomY

      vesselPath.moveTo(left, tangentY)
      vesselPath.ellipse(cx, tangentY, rx, ry, 0, Math.PI, Math.PI * 2)
      vesselPath.lineTo(right, tangentBottomY)
      if (hasBottomHead) {
        // 由右下角沿椭圆逆时针扫到左下角，画出下半个椭球
        vesselPath.ellipse(cx, tangentBottomY, rx, ryBottom, 0, 0, Math.PI)
      } else {
        vesselPath.lineTo(left, bottom)
      }
      vesselPath.closePath()

      tankLeft = left
      tankRight = right
      bottomY = bottom

      // 液位映射：下封头段 / 筒体段 / 上封头段分别对应底图中各自的高度
      // （底图封头绘制得比实际略扁，分段映射可保证液面始终贴合图纸结构）
      const bottomHead = hasBottomHead ? geometry.bottomHeadDepth : 0
      levelToY = (level) => {
        if (bottomHead > 0 && level <= bottomHead) {
          return bottom - (level / bottomHead) * ryBottom
        }
        const shellLevel = level - bottomHead
        if (shellLevel <= geometry.cylinderHeight) {
          return tangentBottomY - (shellLevel / geometry.cylinderHeight) * (tangentBottomY - tangentY)
        }
        const t = Math.min(geometry.headDepth, shellLevel - geometry.cylinderHeight)
        return tangentY - (t / geometry.headDepth) * (tangentY - apexY)
      }
    } else {
      // 卧式罐：椭圆封头曲面 + 直边 + 圆筒
      const R = ((bounds.bottom - bounds.top) / 2) * s
      const cy = ((bounds.top + bounds.bottom) / 2) * s
      const hiPx = (geometry.headDepth / geometry.diameter) * 2 * R // 曲面深度
      const flangePx = (geometry.straightFlange / geometry.diameter) * 2 * R // 直边
      const xEllipseLeft = bounds.left * s + hiPx
      const xEllipseRight = bounds.right * s - hiPx
      const xCylLeft = xEllipseLeft + flangePx
      const bottom = bounds.bottom * s

      vesselPath.moveTo(xCylLeft, cy - R)
      vesselPath.lineTo(xEllipseRight, cy - R)
      vesselPath.ellipse(xEllipseRight, cy, hiPx, R, 0, -Math.PI / 2, Math.PI / 2)
      vesselPath.lineTo(xEllipseLeft, cy + R)
      vesselPath.ellipse(xEllipseLeft, cy, hiPx, R, 0, Math.PI / 2, Math.PI * 1.5)
      vesselPath.closePath()

      tankLeft = bounds.left * s
      tankRight = bounds.right * s
      bottomY = bottom
      levelToY = (level) => bottom - (level / geometry.diameter) * 2 * R
    }

    const levelY = levelToY(vesselEndDisplay.value)
    const startLevelY = levelToY(vesselStartDisplay.value)

    // 液位绘制：终止液位（实线 + 填充）与起始液位（黑色粗虚线），均为波浪形
    if (vesselEndDisplay.value > 0 || vesselStartDisplay.value > 0) {
      const span = tankRight - tankLeft
      const steps = 140

      // 生成指定基准高度上的波浪路径点（与液面同一波形、同相位）
      const buildWave = (baseY) => {
        const points = []
        for (let i = 0; i <= steps; i += 1) {
          const x = tankLeft + (span * i) / steps
          const phase = ((x - tankLeft) / VESSEL_WAVE.wavelength) * Math.PI * 2 + vesselWavePhase
          points.push([x, baseY + Math.sin(phase) * VESSEL_WAVE.amplitude])
        }
        return points
      }

      const toPath = (points, closeToBottom) => {
        const path = new Path2D()
        points.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)))
        if (closeToBottom) {
          path.lineTo(tankRight, bottomY + 6)
          path.lineTo(tankLeft, bottomY + 6)
          path.closePath()
        }
        return path
      }

      ctx.save()
      ctx.clip(vesselPath)
      ctx.lineJoin = 'round'

      // 终止液位：填充 + 实线液面
      if (vesselEndDisplay.value > 0) {
        const wavePoints = buildWave(levelY)
        ctx.fillStyle = geometry.liquid.fill
        ctx.fill(toPath(wavePoints, true))

        ctx.strokeStyle = geometry.liquid.line
        ctx.lineWidth = 2
        ctx.stroke(toPath(wavePoints, false))
      }

      // 起止液位之间的差值区：斜线剖面填充，直观展示消耗量/增加量
      const levelDelta = vesselStartDisplay.value - vesselEndDisplay.value

      if (Math.abs(levelDelta) > 1) {
        const isDecrease = levelDelta > 0 // 终止低于起始 → 消耗
        const upperY = Math.min(startLevelY, levelY)
        const lowerY = Math.max(startLevelY, levelY)

        // 差值带：上边界波浪 + 下边界波浪（同相位，等厚）
        const upperWave = buildWave(upperY)
        const lowerWave = buildWave(lowerY)
        const bandPath = new Path2D()
        upperWave.forEach(([x, y], i) => (i === 0 ? bandPath.moveTo(x, y) : bandPath.lineTo(x, y)))
        for (let i = lowerWave.length - 1; i >= 0; i -= 1) {
          bandPath.lineTo(lowerWave[i][0], lowerWave[i][1])
        }
        bandPath.closePath()

        ctx.save()
        ctx.clip(bandPath)

        const bandTop = upperY - VESSEL_WAVE.amplitude - 4
        const bandHeight = lowerY - upperY + VESSEL_WAVE.amplitude * 2 + 8
        const bandWidth = tankRight - tankLeft

        // 底色 = 同一只语义色的低透明度版（派生关系见 VESSEL_DELTA_FILL）
        ctx.fillStyle = isDecrease ? VESSEL_DELTA_FILL.consume : VESSEL_DELTA_FILL.increase
        ctx.fillRect(tankLeft, bandTop, bandWidth, bandHeight)

        // 斜线剖面线
        ctx.globalAlpha = 0.4
        ctx.strokeStyle = isDecrease ? VESSEL_DELTA_COLOR.consume : VESSEL_DELTA_COLOR.increase
        ctx.lineWidth = 1.4
        ctx.beginPath()
        for (let offset = -bandHeight; offset < bandWidth; offset += 11) {
          ctx.moveTo(tankLeft + offset, bandTop + bandHeight)
          ctx.lineTo(tankLeft + offset + bandHeight, bandTop)
        }
        ctx.stroke()
        ctx.globalAlpha = 1
        ctx.restore()
      }

      // 起始液位：黑色偏粗波浪虚线，用于对比起止液位
      if (vesselStartDisplay.value > 0) {
        ctx.strokeStyle = '#0f172a'
        ctx.lineWidth = 3
        ctx.setLineDash([9, 6])
        ctx.stroke(toPath(buildWave(startLevelY), false))
        ctx.setLineDash([])
      }

      ctx.restore()

      // 差值区引线标注（绘制在裁剪区之外）
      if (Math.abs(levelDelta) > 1) {
        const isDecrease = levelDelta > 0
        const color = isDecrease ? VESSEL_DELTA_COLOR.consume : VESSEL_DELTA_COLOR.increase

        // 画布会被 CSS 缩放显示，字号按缩放比例反向补偿，保证屏幕上大小恒定
        const displayWidth = canvas.clientWidth || IMAGE_W
        const uiScale = Math.min(4, W / displayWidth)
        const fs = 13 * uiScale

        const sign = isDecrease ? '−' : '+'
        const lines = [
          `${isDecrease ? '消耗' : '增加'} ${Math.abs(levelDelta).toFixed(0)} mm`,
          `${sign}${Math.abs(vesselVolumeDelta.value).toFixed(2)} m³`,
        ]

        // 配置了密度时，追加质量变化
        const massDelta = vesselMassDelta.value
        if (massDelta !== null) {
          lines.push(`${sign}${Math.abs(massDelta).toFixed(2)} t`)
        }

        ctx.font = `600 ${fs}px ${VESSEL_CANVAS_FONT}`
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'

        const textRight = W - fs * 0.7
        const textWidth = Math.max(...lines.map((text) => ctx.measureText(text).width))
        const textLeft = textRight - textWidth

        const anchorX = tankRight - 30
        const anchorY = (Math.min(startLevelY, levelY) + Math.max(startLevelY, levelY)) / 2
        const labelY = Math.max(fs * 1.9, Math.min(H - fs * 1.9, anchorY - fs * 3.2))

        // 引线：罐体 → 水平出线 → 折角指向文字
        ctx.strokeStyle = color
        ctx.lineWidth = Math.max(1.2, fs * 0.12)
        ctx.beginPath()
        ctx.moveTo(anchorX, anchorY)
        ctx.lineTo(textLeft - fs * 1.5, anchorY)
        ctx.lineTo(textLeft - fs * 0.45, labelY)
        ctx.stroke()

        // 起点圆点
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(anchorX, anchorY, fs * 0.26, 0, Math.PI * 2)
        ctx.fill()

        // 文字：整体相对 labelY 垂直居中
        const lineGap = fs * 1.25
        const startOffset = -((lines.length - 1) / 2) * lineGap
        lines.forEach((text, i) => {
          ctx.fillText(text, textRight, labelY + startOffset + i * lineGap)
        })
      }
    }
  }

  // 滑块调节液位（变更-045）：拖动/点击要的是**跟手** —— 直接落到目标值，不走缓动。
  // 缓动（animateVesselTo，700~2000ms）留给键入、罐型切换这类「变化事件」的表演；
  // 拖动若走缓动，液面会一直拖着一条明显的尾巴，滑块就没法用来扫值了。
  // 清掉进行中的补间后，watcher 随后跑的那次会因 delta≈0 走进 animateVesselTo 的落位分支。
  function setVesselLevelImmediate(which, value) {
    const clamped = Math.max(0, Math.min(vesselGeometry.value.maxLevel, Number(value) || 0))
    levelTargetRef(which).value = clamped
    vesselTransitions[which] = null
    levelDisplayRef(which).value = clamped
    renderVessel()
  }

  // 滑块工具提示：值 + 单位（液位一律 mm）
  const formatVesselLevelTooltip = (value) => `${Math.round(value)} mm`

  // ── 变更-046：一根竖轨两个钮（EP vertical + range）────────────────────────────
  // 起始 / 终止是两个独立值、允许倒挂（倒挂即为「消耗」），而 range 模式两钮**不许交叉**：
  // EP 把下钮的 max 钉在上钮、上钮的 min 钉在下钮。于是轨道收的是**排好序**的一对 [低, 高]；
  // 「哪个钮是起始」由 startIsLower 映射。倒挂态想再往交叉方向拉 —— 走数字框键入（watcher 照常缓动）。
  const startIsLower = computed(() => vesselStartLevel.value <= vesselEndLevel.value)

  const vesselLevelPair = computed(() =>
    startIsLower.value
      ? [vesselStartLevel.value, vesselEndLevel.value]
      : [vesselEndLevel.value, vesselStartLevel.value],
  )

  // 下钮 / 上钮的可访问名跟着映射走（倒挂时下钮是终止）
  const vesselLevelRangeLabels = computed(() =>
    startIsLower.value ? ['起始液位滑块', '终止液位滑块'] : ['终止液位滑块', '起始液位滑块'],
  )

  // 钮环 = 该钮代表的读数在图上那根线的墨色；钮间色带 = 差值语义色，与画布剖面线同一对值
  const vesselLevelSliderStyle = computed(() => ({
    '--el-slider-main-bg-color':
      vesselVolumeDelta.value >= 0 ? VESSEL_DELTA_COLOR.increase : VESSEL_DELTA_COLOR.consume,
    '--v-thumb-lower': startIsLower.value ? VESSEL_START_INK : vesselGeometry.value.liquid.line,
    '--v-thumb-upper': startIsLower.value ? vesselGeometry.value.liquid.line : VESSEL_START_INK,
  }))

  // ── 变更-048：读数引线标注（挂在钮上）────────────────────────────────────────
  // 两根读数柱退役，读数改挂到**钮**上。钮心位置是算出来的，不是量的：
  // EP 竖版把钮座的 bottom 写成「值的百分比」（bottom: p% + translateY(50%) ⇒
  // 钮心恰好落在读数刻度上），所以以定高柱顶为原点，钮心 y = 柱高 − 值/量程 × 柱高。
  // 三个数（柱高 260 / 轨宽 42 = 16 + 10 + 16 / 标注栏左缘 76）与模板和 CSS 里
  // 那几处字面量是同一只数，改一处必须三处一起改。
  const VESSEL_RAIL_HEIGHT = 260
  const VESSEL_RAIL_KNOB_X = 21 // 轨心：16（EP 竖版 runway 的左右 margin） + 10 / 2
  const VESSEL_CALLOUT_LEFT = 76 // 与 .vessel-level-callout 的 left 同一只数
  // 两个标注的下限间距 = 标注两行的高度 + 余量：两个钮靠得再近，标注也不叠
  const VESSEL_CALLOUT_GAP = 52

  function vesselKnobY(level) {
    const maxLevel = vesselGeometry.value.maxLevel || 1
    const ratio = Math.max(0, Math.min(1, level / maxLevel))
    return VESSEL_RAIL_HEIGHT * (1 - ratio)
  }

  // 标注的 top：先钉在自己的钮心上；两个靠得太近时向两边让开（只在柱内挪，柱外不许）——
  // 让位只动标注，引线的折角负责把「标注挪了位」画回来。等值（两钮叠一起）时
  // start <= end 成立，自然拆成「起始在上、终止在下」。
  const vesselCalloutTops = computed(() => {
    const half = VESSEL_CALLOUT_GAP / 2
    const pad = 25 // 标注半高 + 1：柱口之内留得下整个标注
    const clampTop = (value) => Math.max(pad, Math.min(VESSEL_RAIL_HEIGHT - pad, value))
    const start = clampTop(vesselKnobY(vesselStartLevel.value))
    const end = clampTop(vesselKnobY(vesselEndLevel.value))

    if (Math.abs(start - end) < VESSEL_CALLOUT_GAP) {
      const upper = Math.max(
        pad,
        Math.min((start + end) / 2 - half, VESSEL_RAIL_HEIGHT - pad - VESSEL_CALLOUT_GAP),
      )
      return start <= end ? [upper, upper + VESSEL_CALLOUT_GAP] : [upper + VESSEL_CALLOUT_GAP, upper]
    }
    return [start, end]
  })

  // 引线（折线 + 起点圆点），坐标系与定高柱一致：圆点钉在钮心，横出到标注栏前，
  // 折角指到标注的垂直中心 —— 与画布差值标注同一套语言（圆点 → 横出 → 折角）
  const vesselLeaders = computed(() => {
    const [startTop, endTop] = vesselCalloutTops.value
    const leader = (level, top, color) => {
      const y = Math.round(vesselKnobY(level) * 10) / 10
      return {
        color,
        x: VESSEL_RAIL_KNOB_X,
        y,
        points: `${VESSEL_RAIL_KNOB_X},${y} ${VESSEL_CALLOUT_LEFT - 18},${y} ${VESSEL_CALLOUT_LEFT - 5},${top}`,
      }
    }
    return {
      start: leader(vesselStartLevel.value, startTop, VESSEL_START_INK),
      end: leader(vesselEndLevel.value, endTop, vesselGeometry.value.liquid.line),
    }
  })

  // 标注的 top 走内联 style（值驱动）；--v-callout-ink 把该读数的墨带进标注内部 ——
  // 数字框的下划线用它（起始虚线 / 终止实线，与画布那两根线、钮环三处同相）
  const vesselStartCalloutStyle = computed(() => ({
    top: `${vesselCalloutTops.value[0]}px`,
    '--v-callout-ink': VESSEL_START_INK,
  }))
  const vesselEndCalloutStyle = computed(() => ({
    top: `${vesselCalloutTops.value[1]}px`,
    '--v-callout-ink': vesselGeometry.value.liquid.line,
  }))

  function setVesselLevelPair([lower, upper]) {
    // 方向快照就在 if 处一次取定：两次 setVesselLevelImmediate 之间 refs 会变，
    // 若中途重判 startIsLower，会把两钮的值对调。
    if (startIsLower.value) {
      setVesselLevelImmediate('start', lower)
      setVesselLevelImmediate('end', upper)
    } else {
      setVesselLevelImmediate('end', lower)
      setVesselLevelImmediate('start', upper)
    }
  }

  function clampAndAnimateLevel(which, value) {
    const maxLevel = vesselGeometry.value.maxLevel
    const clamped = Math.max(0, Math.min(maxLevel, Number(value) || 0))

    if (clamped !== value) {
      levelTargetRef(which).value = clamped
      return
    }

    animateVesselTo(which, clamped)
  }

  watch(vesselStartLevel, (value) => clampAndAnimateLevel('start', value))
  watch(vesselEndLevel, (value) => clampAndAnimateLevel('end', value))

  // 切换储罐：液位按新罐径钳制、底图按需重载
  let loadedVesselImageUrl = ''

  function loadVesselImage() {
    // 清单还没到（或台账取不到）时没有底图可加载 —— 直接返回，等清单到位后会再调一次
    const url = selectedVessel.value?.image
    if (!url) return
    if (loadedVesselImageUrl === url && vesselImage.value) {
      renderVessel()
      return
    }

    loadedVesselImageUrl = url
    const image = new Image()
    image.onload = () => {
      vesselImage.value = image
      renderVessel()
      // 等淡出动画基本结束再淡入，避免闪烁
      window.setTimeout(() => {
        vesselSwitching.value = false
      }, 330)
    }
    image.src = url
  }

  watch(vesselKey, () => {
    const maxLevel = vesselGeometry.value.maxLevel

    for (const which of ['start', 'end']) {
      const targetRef = levelTargetRef(which)
      const displayRef = levelDisplayRef(which)

      if (targetRef.value > maxLevel) targetRef.value = maxLevel
      if (displayRef.value > maxLevel) {
        displayRef.value = maxLevel
        vesselTransitions[which] = null
      }
    }

    loadVesselImage()
  })

  // 罐体底图（约 645 KB）按需加载：进这一页才拉，不拖慢别的页
  onMounted(() => {
    loadVesselImage()
    startVesselLoop()
  })

  onUnmounted(() => {
    disposed = true
    stopVesselLoop()
  })

  return {
    vesselCanvas,
    vesselSwitching,
    vesselImage,
    vesselStartLevel,
    vesselEndLevel,
    vesselStartDisplay,
    vesselEndDisplay,
    vesselStartVolume,
    vesselEndVolume,
    vesselVolumeDelta,
    vesselStartMass,
    vesselEndMass,
    vesselMassDelta,
    startIsLower,
    vesselLevelPair,
    vesselLevelRangeLabels,
    vesselLevelSliderStyle,
    vesselStartCalloutStyle,
    vesselEndCalloutStyle,
    vesselLeaders,
    vesselCalloutTops,
    formatVesselLevelTooltip,
    setVesselLevelPair,
    setVesselLevelImmediate,
    animateVesselTo,
    renderVessel,
    loadVesselImage,
    startVesselLoop,
    stopVesselLoop,
    VESSEL_START_INK,
    VESSEL_DELTA_COLOR,
    VESSEL_DELTA_FILL,
    VESSEL_CANVAS_FONT,
    VESSEL_WAVE,
    VESSEL_RAIL_HEIGHT,
    VESSEL_CALLOUT_LEFT,
  }
}
