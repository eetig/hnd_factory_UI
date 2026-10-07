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
  <div class="flex min-h-72 flex-col items-center justify-center px-6 text-center">
    <div
      class="mb-4 flex h-12 w-12 items-center justify-center rounded-full"
      :class="TONE[type] || TONE.empty"
    >
      {{ GLYPH[type] || GLYPH.empty }}
    </div>

    <h2 class="text-base font-semibold text-slate-900">{{ title }}</h2>
    <p v-if="description" class="mt-2 text-sm text-slate-500">{{ description }}</p>

    <button
      v-if="actionText"
      type="button"
      class="mt-5 rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-sky-800 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
      @click="emit('action')"
    >
      {{ actionText }}
    </button>
  </div>
</template>
