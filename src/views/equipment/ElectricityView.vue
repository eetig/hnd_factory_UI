<script setup>
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'

/*
 * 电费预提（旧入口，2026-11-04 改道）
 *
 * 原来这一页是「电价档位说明 + 功能建设中」的占位卡。预提功能已经做完，
 * 但做在「电费抄表」页的「预提单」标签里 ⇒ 出现两个入口：一个能用、一个还写着"建设中"，
 * 使用方点错入口，以为我改的东西没生效（2026-11-04 他截图问"没变化呀"）。
 *
 * 现在这一页**不再自己画计算界面**，自动跳到真正的预提单；
 * 但保留一句可见内容与标题 —— 路由护栏测试会渲染这一页，全空会红。
 */
const router = useRouter()

onMounted(() => {
  router.replace({ path: '/equipment/meters', query: { tab: 'bill' } })
})
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <section class="rounded-card border border-line bg-raised px-6 py-10 text-center shadow-card">
      <h1 class="text-base font-semibold text-slate-900">电费预提</h1>
      <p class="mt-2 text-sm text-slate-600">预提功能已并入「电费抄表 · 预提单」，正在打开…</p>
      <p class="mt-1 text-xs text-slate-500">
        如果 3 秒内没有跳转，点左侧「设备 → 电费抄表」，再切到「预提单」标签。
      </p>
    </section>
  </div>
</template>
