<script setup>
import { computed, ref } from 'vue'
import { PALETTES, usePalette } from '../composables/usePalette'
import { circularRevealSwitch } from '../utils/circularReveal'

/*
 * 配色切换按钮（2026-10-23，变更-170）。
 *
 * PC 之前**没有**任何主题开关，这是新加的。放主区顶栏右侧、与页标题同一行
 * （使用方选的"右上角"）。点一下以**按钮中心**为圆心做圆形揭露，切到另一套配色。
 *
 * 按钮本身是个 icon-only 的 <button>，所以必须有 aria-label（Web Interface Guidelines
 * 的硬规则，也是本仓 visualTokens 护栏里唯一零容忍的一类问题）。
 */
const { palette, togglePalette } = usePalette()

const buttonRef = ref(null)
const busy = ref(false)

const current = computed(() => PALETTES.find((p) => p.key === palette.value) || PALETTES[0])
const next = computed(() => PALETTES[(PALETTES.findIndex((p) => p.key === palette.value) + 1) % PALETTES.length])

async function onClick() {
  if (busy.value) return
  busy.value = true

  /*
   * 现在是"圆铺满 → 再切"（overlay 路径）：apply 由 circularRevealSwitch 在动画结束时调用，
   * 所以这里不再需要 260ms 保险丝 —— 有它反而会双切一次（2026-10-23 性能改造时移除）。
   * 动画期间按钮不响应重复点击。
   */
  /*
   * targetColor = **目标**配色的纸色：
   * 没有 VT 的浏览器上，圆用这个颜色扩散（圆里滚的是新主题，不是旧的）；
   * 有 VT 时忽略它 —— 那边圆里是真实的新界面。
   */
  const targetColor = next.value.key === 'violet' ? '#FBFAFF' : '#FFFFFF'
  try {
    await circularRevealSwitch({
      originElement: buttonRef.value,
      targetColor,
      apply: () => togglePalette(),
    })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <button
    ref="buttonRef"
    type="button"
    class="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-raised px-2.5 py-1.5 text-xs text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
    :aria-label="`切换配色：当前「${current.label}」，点击切到「${next.label}」`"
    :title="`配色：${current.label} → ${next.label}`"
    @click="onClick"
  >
    <!-- 三色小色点：一眼看出当前是哪套 -->
    <span class="flex items-center gap-0.5" aria-hidden="true">
      <span
        v-for="dot in current.dots"
        :key="dot"
        class="h-2 w-2 rounded-full ring-1 ring-black/5"
        :style="{ backgroundColor: dot }"
      ></span>
    </span>
    <span class="hidden sm:inline">{{ current.label }}</span>
  </button>
</template>
