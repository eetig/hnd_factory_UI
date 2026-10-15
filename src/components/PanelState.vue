<script setup>
import { STATUS_TONE } from '../constants/statusTones'

/*
 * 面板内的占位状态：empty 查无记录 / error 取数失败 / pending 功能未建成。
 *
 * pending 单列一类，是因为它原本借用 empty 的 ∅——「这个功能还没做」和
 * 「这里没有记录」是两件事，共用一个符号会让使用方先去翻自己的筛选条件。
 */
defineProps({
  type: { type: String, default: 'empty' }, // 'empty' | 'error' | 'pending'
  title: { type: String, required: true },
  description: { type: String, default: '' },
  actionText: { type: String, default: '' },
})

// 两套查表都留 empty 兜底：type 是自由字符串，写错值不该渲染出一个没有底色的圆
const TONE = {
  empty: STATUS_TONE.info,
  error: STATUS_TONE.error,
  pending: STATUS_TONE.neutral,
}
// 三个符号都是满高或中线字形。别把 pending 换成 `…`——那是基线字形，
// 在这个 items-center 的圆里会明显偏低，与另外两个不齐。
const GLYPH = { empty: '∅', error: '!', pending: '···' }

const emit = defineEmits(['action'])
</script>

<template>
  <!--
    x-minimalist：空态/错误态是**版面**问题，不是装饰问题。
      · 层次三档：符号徽章 → 标题（tracking-tight，字阶比正文大一档）→ 说明
        （行高 1.6、行宽收到 46ch，长句子不会拉成一整行）；
      · 按钮与全站同构：6px 圆角 + 墨色实底 + 按下 scale(0.98)（minimalist 的签名
        CTA；原来 12px 的圆角是全站统一到 6px 之前的遗留）；
      · 徽章的语义底色来自 statusTones（pale 系），**这一代不动它** —— 它是状态
        语义的唯一载体，spec 拿实算比值钉着，动它等于改语义色；
      · 不放插图、不放插画：empty 状态要"看得出怎么把数据放进来"，而那由各面板
        传进来的 description 负责，不是靠图形。
  -->
  <div
    :role="type === 'error' ? 'alert' : undefined"
    class="flex min-h-72 flex-col items-center justify-center px-6 text-center"
  >
    <div
      class="mb-4 flex h-12 w-12 items-center justify-center rounded-full font-mono text-base"
      :class="TONE[type] || TONE.empty"
    >
      {{ GLYPH[type] || GLYPH.empty }}
    </div>

    <h2 class="text-lg font-semibold tracking-tight text-slate-900">{{ title }}</h2>
    <p v-if="description" class="mt-2 max-w-[46ch] text-sm leading-relaxed text-slate-500">
      {{ description }}
    </p>

    <button
      v-if="actionText"
      type="button"
      class="mt-5 rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-deep active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2"
      @click="emit('action')"
    >
      {{ actionText }}
    </button>
  </div>
</template>
