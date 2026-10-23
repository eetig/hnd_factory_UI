<script setup>
import { useVesselModel } from '../../composables/useVesselModel'
import { useVesselCanvas } from '../../composables/useVesselCanvas'
import { STATUS_TEXT } from '../../constants/statusTones'
import { ElOption, ElSelect, ElSlider } from 'element-plus'

/*
 * 压力容器体积计算（原 WorkOrderList.vue 的 `vessel` 页签）。
 *
 * 这一页在原文件里是最大的一块（模板 357 行 + 脚本 900 余行 + 样式 290 行），
 * 拆页时按「会动的东西 / 算出来的东西」一分为二，逻辑本身一行没改：
 *   · useVesselModel  —— 台账取数、几何参数、容积、规格说明、两处告警；
 *   · useVesselCanvas —— 画布绘制、水波纹、液位缓动、滑块与引线标注。
 * 本文件只剩模板、事件接线与 scoped 样式（样式跟着模板走，一个字都没动）。
 *
 * ⚠️ 帧循环原先自己判断「activeTab 还是不是 vessel」，现在判断「组件还在不在」
 * （useVesselCanvas 里的 disposed）—— 路由切走即卸载，语义等价。
 */
const model = useVesselModel()
const {
  vessels,
  vesselsLoading,
  vesselsFromCache,
  vesselKey,
  vesselGeometry,
  isVerticalVessel,
  CANVAS_MAX_HEIGHT,
  vesselCanvasAspect,
  vesselDescription,
  vesselReconcileWarning,
  vesselBundleWarning,
  vesselFormulaCaption,
} = model

const {
  vesselCanvas,
  vesselSwitching,
  vesselStartLevel,
  vesselEndLevel,
  vesselStartVolume,
  vesselEndVolume,
  vesselVolumeDelta,
  vesselStartMass,
  vesselEndMass,
  vesselMassDelta,
  vesselLevelPair,
  vesselLevelRangeLabels,
  vesselLevelSliderStyle,
  vesselStartCalloutStyle,
  vesselEndCalloutStyle,
  vesselLeaders,
  formatVesselLevelTooltip,
  setVesselLevelPair,
} = useVesselCanvas(model)
</script>

<template>
  <div>
    <section class="rounded-card border border-line bg-raised shadow-card">
      <!-- 容器清单来自设备台账（异步）。取不到时必须给出明确提示：
      这个页面是纯前端计算，清单空了就什么都算不了，而页面本身不会报错，
      只会静静地显示一台空白罐与 0.00 —— 看着像「算出来是 0」。 -->
      <div
        v-if="vesselsLoading && !vessels.length"
        class="border-b border-line px-6 py-3 text-xs text-slate-500"
      >
        正在加载容器清单…
      </div>
      <div
        v-else-if="vesselsFromCache"
        class="border-b border-amber-200 bg-amber-50 px-6 py-3 text-xs leading-relaxed text-amber-800"
      >
        <template v-if="vessels.length">
          当前显示的是本地缓存的容器清单（设备台账接口暂时取不到）。若台账刚改过几何参数，
          这里的数值可能不是最新的 —— 恢复连接后会自动刷新。
        </template>
        <template v-else>
          取不到容器清单：设备台账接口连不上，本地也没有缓存。
          请稍后重试；若一直如此，请联系管理员核对台账里这几台容器的几何参数是否已填写。
        </template>
      </div>

      <!-- 储罐切换：位置在两种罐型下保持一致，切换时不跳动。
           变更-090：介质/几何那段说明**从这一行搬进右栏**（原先它横在顶部，
           把图往下压）。这个页面的图是「高度决定宽度」的（见 CANVAS_MAX_HEIGHT），
           顶部每让出一行、图就长高一行；而右栏加宽对图**零损失**。
           这里 py 也从 4 收到 2。 -->
      <div class="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 border-b border-line px-6 py-2">
        <!-- 告警留在顶部：它们是需要立刻看见的红字，塞进窄右栏会折成一片 -->
        <p v-if="vesselReconcileWarning" class="mr-auto text-xs font-medium text-rose-600">
          {{ vesselReconcileWarning }}
        </p>
        <p v-if="vesselBundleWarning" class="mr-auto text-xs font-medium text-rose-600">
          {{ vesselBundleWarning }}
        </p>
        <el-select v-model="vesselKey" class="vessel-select shrink-0" aria-label="选择储罐">
          <el-option
            v-for="vessel in vessels"
            :key="vessel.key"
            :label="vessel.label"
            :value="vessel.key"
          />
        </el-select>
      </div>

      <div class="flex flex-wrap items-stretch" :class="isVerticalVessel ? 'gap-x-6 p-6' : ''">
        <div class="flex justify-center" :class="isVerticalVessel ? 'shrink-0' : 'w-full p-6'">
          <canvas
            ref="vesselCanvas"
            class="vessel-canvas mx-auto block h-auto w-auto max-w-full"
            :class="{ 'is-switching': vesselSwitching }"
            :style="{
              maxWidth: `${vesselGeometry.displayWidth}px`,
              maxHeight: CANVAS_MAX_HEIGHT,
              aspectRatio: String(vesselCanvasAspect),
            }"
          ></canvas>
        </div>

        <div
          :class="
            isVerticalVessel
              ? 'flex min-w-[260px] max-w-[380px] flex-1 flex-col justify-center'
              : 'w-full'
          "
        >
          <!-- 介质 / 几何说明（变更-090：从顶部行搬到这里）。
               竖版：右栏是窄条，给它 260~380px 才折得好看 —— 而图是高度决定宽度的，
               多让出横向对它**没有任何损失**；横版：右栏在图下方、本来就占整幅宽。 -->
          <p class="text-xs leading-relaxed text-slate-500" :class="isVerticalVessel ? '' : 'mt-4'">
            {{ vesselDescription }}
          </p>
          <p v-if="vesselGeometry.note" class="mt-1 text-xs font-medium text-amber-700">
            {{ vesselGeometry.note }}
          </p>

          <!-- 横版：体积变化在左、液位控制列在右；竖版：体积变化居中在上 -->
          <div
            class="flex flex-wrap items-center justify-between gap-x-8 gap-y-5"
            :class="isVerticalVessel ? 'flex-col' : 'border-t border-line px-6 pt-5'"
          >
            <!-- 体积变化：横版居中于左侧空区，竖版居中在上 -->
            <div class="flex justify-center" :class="isVerticalVessel ? 'w-full' : 'flex-1'">
              <!-- 体积变化：居中作为视觉焦点 -->
              <div
                class="flex flex-wrap items-baseline justify-center gap-x-2 gap-y-1"
                :class="
                  isVerticalVessel
                    ? 'px-0 pb-4 pt-5'
                    : 'rounded-card border border-line bg-region px-6 py-4'
                "
              >
                <span class="text-sm text-slate-500">体积变化</span>
                <!-- 24px 粗体属「大字号」，阈值 3:1，-600 已过 —— 与下面那处刻意不同，别对齐 -->
                <span
                  class="text-2xl font-bold tracking-tight"
                  :class="vesselVolumeDelta >= 0 ? 'text-emerald-600' : 'text-rose-600'"
                  >{{ vesselVolumeDelta >= 0 ? '+' : '' }}{{ vesselVolumeDelta.toFixed(2) }}</span
                >
                <span class="text-sm text-slate-500">m³</span>
                <span
                  v-if="vesselMassDelta !== null"
                  class="text-base font-semibold"
                  :class="vesselVolumeDelta >= 0 ? STATUS_TEXT.success : STATUS_TEXT.error"
                  >（{{ vesselMassDelta >= 0 ? '+' : '' }}{{ vesselMassDelta.toFixed(2) }} t）</span
                >
              </div>
            </div>

            <!-- 竖轨 + 两根读数引线（变更-048，使用方 2026-10-12 拿实机截图定：
                 「红色框选部分不要了，相应的信息通过引线指向滑块按钮」）——
                 两根读数柱撤成**挂在钮上的引线标注**：钮在轨道上到哪，标注跟到哪；
                 引线走画布差值标注同一套折线语言（圆点 → 横出 → 折角），
                 墨色 = 该读数的墨（起始虚线 / 终止液面线），与钮环、图例三处同源 -->
            <div
              class="gap-x-6 gap-y-5"
              :class="
                isVerticalVessel
                  ? 'flex w-full items-center justify-center px-0'
                  : 'flex flex-1 flex-wrap items-center justify-center gap-x-6'
              "
            >
              <!-- 竖轨的定高柱（EP 竖版根是 height:100%，父柱不定高就塌成一条）：
                   宽 = 轨 42 + 右侧标注栏 250 —— 标注入列，柱心才是整组的视觉中心 -->
              <div class="relative flex h-[260px] w-[292px] shrink-0 items-center">
                <!-- 引线层：画在同一只 260 定高柱的坐标系里（无 viewBox，
                     用户单位即 px），overflow: visible 让线伸出柱外指到标注 -->
                <svg
                  class="vessel-level-leader"
                  width="42"
                  height="260"
                  aria-hidden="true"
                  focusable="false"
                >
                  <polyline
                    :points="vesselLeaders.start.points"
                    :stroke="vesselLeaders.start.color"
                    stroke-width="1.5"
                    fill="none"
                  />
                  <circle
                    :cx="vesselLeaders.start.x"
                    :cy="vesselLeaders.start.y"
                    r="3.4"
                    :fill="vesselLeaders.start.color"
                  />
                  <polyline
                    :points="vesselLeaders.end.points"
                    :stroke="vesselLeaders.end.color"
                    stroke-width="1.5"
                    fill="none"
                  />
                  <circle
                    :cx="vesselLeaders.end.x"
                    :cy="vesselLeaders.end.y"
                    r="3.4"
                    :fill="vesselLeaders.end.color"
                  />
                </svg>

                <!-- 起始读数标注：数字仍可键入（865 / 1525 的实测读数，045 定的分工），
                     只是不再画框 —— 见 .vessel-level-input 的「带下划线的数字」配方 -->
                <div
                  class="vessel-level-callout vessel-level-callout-start"
                  :style="vesselStartCalloutStyle"
                >
                  <div class="flex items-center gap-1.5 whitespace-nowrap text-sm text-slate-700">
                    <span
                      class="inline-block h-0 w-5 border-t-2 border-dashed border-slate-800"
                      aria-hidden="true"
                    ></span>
                    起始液位
                    <input
                      v-model.number="vesselStartLevel"
                      type="number"
                      min="0"
                      :max="vesselGeometry.maxLevel"
                      step="10"
                      aria-label="起始液位（毫米）"
                      class="vessel-level-input min-w-0 text-right"
                    />
                    <span class="text-slate-500">mm</span>
                  </div>
                  <div class="mt-0.5 text-sm text-slate-500">
                    体积：<span class="font-semibold text-brand-ink">{{
                      vesselStartVolume.toFixed(2)
                    }}</span>
                    m³<template v-if="vesselStartMass !== null"
                      ><span class="ml-1 whitespace-nowrap"
                        >（{{ vesselStartMass.toFixed(2) }} t）</span
                      ></template
                    >
                  </div>
                </div>

                <!-- 液位滑块（变更-046）：一根竖轨两个钮，上高下低 —— 钮环色 = 该钮
                     代表的读数在图上那根线的墨色（起始虚线 / 终止液面线），钮间色带 =
                     消耗·增加语义色（与画布剖面线同一对值）。range 两钮不许交叉：
                     倒挂（消耗）只能走数字框键入 —— 滑块收的是排序过的一对，
                     startIsLower 负责把两个数再映射回起始 / 终止，见 setVesselLevelPair -->
                <el-slider
                  class="vessel-level-slider"
                  vertical
                  range
                  height="260px"
                  :model-value="vesselLevelPair"
                  :min="0"
                  :max="vesselGeometry.maxLevel"
                  :step="1"
                  placement="right"
                  :format-tooltip="formatVesselLevelTooltip"
                  :range-start-label="vesselLevelRangeLabels[0]"
                  :range-end-label="vesselLevelRangeLabels[1]"
                  :style="vesselLevelSliderStyle"
                  @input="setVesselLevelPair"
                />

                <!-- 终止读数标注 -->
                <div
                  class="vessel-level-callout vessel-level-callout-end"
                  :style="vesselEndCalloutStyle"
                >
                  <div class="flex items-center gap-1.5 whitespace-nowrap text-sm text-slate-700">
                    <span
                      class="inline-block h-0 w-5 border-t-2"
                      :style="{ borderColor: vesselGeometry.liquid.line }"
                      aria-hidden="true"
                    ></span>
                    终止液位
                    <input
                      v-model.number="vesselEndLevel"
                      type="number"
                      min="0"
                      :max="vesselGeometry.maxLevel"
                      step="10"
                      aria-label="终止液位（毫米）"
                      class="vessel-level-input min-w-0 text-right"
                    />
                    <span class="text-slate-500">mm</span>
                  </div>
                  <div class="mt-0.5 text-sm text-slate-500">
                    体积：<span class="font-semibold text-brand-ink">{{
                      vesselEndVolume.toFixed(2)
                    }}</span>
                    m³<template v-if="vesselEndMass !== null"
                      ><span class="ml-1 whitespace-nowrap"
                        >（{{ vesselEndMass.toFixed(2) }} t）</span
                      ></template
                    >
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="border-t border-line bg-region/50 px-6 py-4">
        <div class="mx-auto max-w-[900px] overflow-x-auto">
          <p
            class="mb-3 text-center text-xs font-semibold uppercase tracking-[0.15em] text-slate-500"
          >
            液体体积计算公式
          </p>

          <div v-if="vesselGeometry.type === 'vertical'" class="math-formula text-center text-slate-700">
            <div>
              <i>V</i>(<i>h</i>) = π<i>r</i>²<i>h</i>
              <span class="ml-2 text-xs text-slate-500">（<i>h</i> ≤ <i>H</i>，筒体段）</span>
              <span class="mx-7 text-slate-500" aria-hidden="true">｜</span>
              <i>V</i>(<i>h</i>) = π<i>r</i>²<i>H</i> + π<i>r</i>²[ <i>t</i> −
              <span class="frac"
                ><span><i>t</i>³</span><span>3<i>h</i><sub>i</sub>²</span></span
              >
              ]
              <span class="ml-2 text-xs text-slate-500"
                >（<i>h</i> &gt; <i>H</i>，<i>t</i> = <i>h</i> − <i>H</i>）</span
              >
            </div>
          </div>

          <div v-else class="math-formula text-center text-slate-700">
            <div>
              <i>V</i>(<i>h</i>) = <i>L</i> [
              <span class="frac"><span>π<i>r</i>²</span><span>2</span></span>
              − (<i>r</i> − <i>h</i>)<span class="sqrt"
                >√<span>2<i>rh</i> − <i>h</i>²</span></span
              >
              − <i>r</i>² · arcsin<span class="paren">(</span
              ><span class="frac"
                ><span><i>r</i> − <i>h</i></span
                ><span><i>r</i></span></span
              ><span class="paren">)</span> ] &nbsp;+&nbsp;
              <span class="frac"
                ><span>π · <i>h</i><sub>i</sub></span
                ><span>3<i>r</i></span></span
              >
              · [ 3<i>r</i>²<i>h</i> − <i>r</i>³ + (<i>r</i> − <i>h</i>)³ ]
            </div>
          </div>

          <p
            v-if="vesselGeometry.type === 'vertical'"
            class="mt-3 text-center text-xs leading-relaxed text-slate-500"
          >
            <i>r</i> 筒体内半径　<i>h</i> 液位高度　<i>H</i> 筒体高度　<i>h</i
            ><sub>i</sub> 封头曲面内高度
            <span class="text-slate-500">｜</span>
            {{ vesselFormulaCaption }}
          </p>
          <p v-else class="mt-3 text-center text-xs leading-relaxed text-slate-500">
            <i>L</i> 筒体长度（含两端直边）　<i>r</i> 筒体内半径　<i>h</i> 液位高度　<i>h</i
            ><sub>i</sub> 封头曲面内高度
            <span class="text-slate-500">｜</span>
            {{ vesselFormulaCaption }}
          </p>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* 储罐图：切换罐型时淡出淡入 + 高度平滑过渡 */
.vessel-canvas {
  transition:
    aspect-ratio 320ms cubic-bezier(0.4, 0, 0.2, 1),
    opacity 200ms ease;
}

.vessel-canvas.is-switching {
  opacity: 0;
}

/*
 * 液位控件：一根竖轨两钮（变更-046 定形）。
 *
 * 变更-045 第一次动到形态：使用方要求「把输入框形式改成滑块」——
 * 两个软拟态步进圆钮（−/+）整体退役，改为同一套光影配方的轨道 + 圆钮滑块；
 * 数字输入框保留（865 / 1525 这类非整十的实测读数要能直接键入，滑块扫值、键盘录值）。
 * 变更-046 收了形态：使用方看过 045 实机截图后定稿「竖放 + 一根轨两个钮」。
 *
 * 变更-058（x-minimalist）**换掉了材质**：软拟态那套光影整组退役 ——
 * 凹槽的两笔方向性内阴影、钮的渐变 + 四层投影、色带的压暗、输入框的亮出/压入，
 * 全部换成**垫底档位 + 1px 发丝线 + 语义环**（minimalist 的高程不来自光影）。
 * ⚠️ **几何一字未动**：轨厚 10 / 钮 22 / 钮座 30 / 对中量 −10px 全部照旧，
 * 拖动即时落位、引线标注、语义色带这些行为与语义也一字未动。
 */
.vessel-level-slider {
  --el-slider-height: 10px;
  --el-slider-button-size: 22px;
  --el-slider-button-wrapper-size: 30px;
  /* 钮座在轨道上的横向对中量 =（轨厚 − 钮座）/ 2 =（10 − 30）/ 2。EP 出厂按
     （6 − 36）/ 2 = −15px 写死这个变量；045 改了轨厚与钮座却没跟它，钮一直偏 5px ——
     046 竖过来放大了这个偏心（左右偏），一并校正 */
  --el-slider-button-wrapper-offset: -10px;
}

.vessel-level-slider :deep(.el-slider__runway) {
  border-radius: 9999px;
  /*
   * x-minimalist（变更-058）：凹槽不再是软拟态的两笔方向性内阴影
   * （冷投影 `rgba(90,110,150,.32)` + 白高光）。这一代的高程不来自光影 ——
   * 「槽」靠**比纸深半档的垫底** + **1px 发丝线**读出来就够：
   *   · 底色挂 token `--el-fill-color`（= region，与全站垫底同一档）；
   *   · 描边走 `inset 0 0 0 1px` 的**扩散环**而不是 border —— 不动盒子几何
   *     （`--el-slider-button-wrapper-offset: -10px` 那套对中量是按 10px 轨厚算的，
   *     加真 border 会让它偏 1px）。
   */
  background-color: var(--el-fill-color);
  box-shadow: inset 0 0 0 1px #eaeaea;
}

/* 拖动要**即时跟手**（液面同步落位），所以钮与轨道都禁掉 CSS 过渡 ——
   留着的话钮会以 ~0.2s 自己滑过去，而液面是瞬移，二者肉眼可见地错位 */
.vessel-level-slider :deep(.el-slider__bar),
.vessel-level-slider :deep(.el-slider__button-wrapper) {
  transition: none;
}

/* 钮间色带 = 差值语义色（消耗玫红 / 增加翡翠），由使用处经 --el-slider-main-bg-color
   注入，与画布剖面线共用 VESSEL_DELTA_COLOR；两根线各自的墨色改走钮环（见下）。
   x-minimalist：那笔 `inset 0 1px 2px rgba(0,0,0,.14)` 压暗退役 —— 色带是**实色语义**，
   让颜色自己说话，而不是再叠一层"带子凸起"的错觉。 */
.vessel-level-slider :deep(.el-slider__bar) {
  border-radius: 9999px;
}

.vessel-level-slider :deep(.el-slider__button) {
  /* border-box：2px 环占钮径内圈，换成 transparent 只是「先不画」，几何与 045 一字不差 */
  border: 2px solid transparent;
  /*
   * x-minimalist（变更-058）：**平的白面**取代软拟态那套四层光影
   * （`linear-gradient(145deg,…)` + 外投影 + 白高光 + 内压暗 + 内高光）。
   * 钮的辨识现在靠两件事，都不依赖光影：
   *   ① 2px 的**语义环**（`--v-thumb-lower` / `--v-thumb-upper`，与读数同色）；
   *   ② 白面压在白纸上 —— 环就是它的边界（minimalist：border 取代 elevation）。
   * 顺带说明为什么这次可以删而不心虚：拖动是**瞬时**的（见下面的 transition: none），
   * 那套光影从来不参与"手感"，只参与观感。
   */
  background-color: #ffffff;
}

/* 钮环 = 该钮代表的读数色。range 模式下轨道子的 DOM 序 = [bar, 下钮, 上钮]：
   nth-child(2) 是下钮、nth-child(3) 是上钮 —— 与值的高低走，与起止解耦 */
.vessel-level-slider
  :deep(.el-slider__runway > .el-slider__button-wrapper:nth-child(2) .el-slider__button) {
  border-color: var(--v-thumb-lower);
}

.vessel-level-slider
  :deep(.el-slider__runway > .el-slider__button-wrapper:nth-child(3) .el-slider__button) {
  border-color: var(--v-thumb-upper);
}

/* 键盘聚焦：EP 自带的焦点表现落在被上面覆写的钮上，这里显式补一圈
   （品牌蓝 = 主色 #1E40AF；更早是墨色 #111111 / #171719） */
.vessel-level-slider :deep(.el-slider__button-wrapper:focus-visible .el-slider__button) {
  outline: 2px solid #2c5fa8;
  outline-offset: 2px;
}

/* 引线层：与定高柱同一坐标系（无 viewBox，用户单位即 px）。
   overflow: visible —— 引线要从柱里伸出去指到标注栏 */
.vessel-level-leader {
  position: absolute;
  left: 0;
  top: 0;
  overflow: visible;
  pointer-events: none;
}

/* 读数标注：绝对定位在标注栏里，top 由使用处按「钮心」注入（见 vesselCalloutTops），
   translateY(-50%) 让标注以钮心为中轴。**刻意不给过渡** —— 钮与液面都是瞬移
   （046 的规矩），标注自己滑会跟钮错开，引线圆点就对不上了 */
.vessel-level-callout {
  position: absolute;
  left: 76px;
  width: 216px;
  transform: translateY(-50%);
}

/* 液位数字：仍可键入（865 / 1525 这类实测读数落不到步长格点上，「扫值」与
   「录值」是两种手势 —— 045 定的分工）；048 起**不再画框**，退成「带下划线的数字」：
   下划线即该读数的墨相（起始虚线 / 终止实线，与画布那两根线、钮环同一只墨，
   经外层的 --v-callout-ink 带进来）。
   x-minimalist（变更-058）：悬停/聚焦不再用软拟态的"亮出/压入"两笔方向性光影，
   改成**三档垫底 + 1px 发丝环**：悬停浮起一档（`-lighter`）、聚焦落下两档（`fill`
   = region）并亮出发丝环 —— 「按进去录值」这层意思还在，但它由**深浅**说，
   不由投影说。三个值全部挂 EP 的填充 token（region 系），不再写 043 的字面量。 */
.vessel-level-input {
  border: none;
  border-bottom: 1px dashed var(--v-callout-ink);
  border-radius: 6px;
  padding: 1px 4px;
  width: 3.75rem;
  background-color: transparent;
  color: #0f172a;
  font-size: 14px;
  font-weight: 600;
  outline: none;
  box-shadow: none;
  font-variant-numeric: tabular-nums;
  transition:
    background-color 160ms ease,
    box-shadow 160ms ease;
}

/* 终止的下划线是实线 —— 与它在图上那根实线液面同相 */
.vessel-level-callout-end .vessel-level-input {
  border-bottom-style: solid;
}

.vessel-level-input:hover {
  background-color: var(--el-fill-color-lighter);
}

/* 聚焦 = 落下一档 + 发丝环（"按入"的扁平写法，取代原来的 inset 光影） */
.vessel-level-input:focus {
  background-color: var(--el-fill-color);
  border-bottom-color: transparent;
  box-shadow: inset 0 0 0 1px #eaeaea;
}

.vessel-level-input::-webkit-outer-spin-button,
.vessel-level-input::-webkit-inner-spin-button {
  margin: 0;
  -webkit-appearance: none;
  appearance: none;
}

.vessel-level-input {
  -moz-appearance: textfield;
  appearance: textfield;
}

/* 储罐选择器：按标题样式呈现 */
.vessel-select {
  width: 224px; /* 固定宽度，避免被 Element Plus 默认样式拉伸到整行 */
}

.vessel-select :deep(.el-select__wrapper) {
  padding: 7px 12px;
  font-size: 15px;
  font-weight: 600;
  color: rgb(15 23 42);
  border-radius: 10px;
  box-shadow: 0 0 0 1px rgb(203 213 225) inset;
  transition: box-shadow 0.2s ease;
}

.vessel-select :deep(.el-select__wrapper:hover) {
  box-shadow: 0 0 0 1px rgb(148 163 184) inset;
}

/* 聚焦环跟随主色（变更-043：苹果蓝 brand/brand-100 → 石墨 brand/brand-100。
   变更-033 起的规矩没变：正文界面的聚焦环一律用主色档，
   天蓝（statusTones 的 info）不在这出现） */
.vessel-select :deep(.el-select__wrapper.is-focused) {
  box-shadow:
    0 0 0 1px rgb(29 29 31) inset,
    0 0 0 3px rgb(210 210 210);
}

/* 公式排版：衬线斜体变量 + 真分数 + 根号上划线 */
.math-formula {
  font-family: Cambria, 'Cambria Math', 'Times New Roman', 'Songti SC', serif;
  font-size: 16px;
  line-height: 2.1;
  white-space: nowrap;
  letter-spacing: 0.02em;
}

.math-formula i {
  font-style: italic;
}

.math-formula sub {
  font-size: 0.7em;
}

.math-formula .frac {
  display: inline-flex;
  flex-direction: column;
  margin: 0 4px;
  vertical-align: middle;
  font-size: 0.85em;
  line-height: 1.25;
  text-align: center;
}

.math-formula .frac > span:first-child {
  border-bottom: 1px solid currentColor;
  padding: 0 5px;
}

.math-formula .frac > span:last-child {
  padding: 0 5px;
}

.math-formula .sqrt > span {
  border-top: 1px solid currentColor;
  padding: 0 4px 0 2px;
  margin-left: -1px;
}

.math-formula .paren {
  display: inline-block;
  transform: scaleY(1.35);
  margin: 0 2px;
}
</style>
