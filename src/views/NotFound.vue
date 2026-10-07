<script setup>
import { useRouter } from 'vue-router'
import PanelState from '../components/PanelState.vue'

const router = useRouter()
</script>

<!--
  地址兜底页。外壳刻意照抄 Login.vue（同一个「整屏居中卡片」形状），
  正文复用 PanelState，不新造一套视觉词汇。
  useRouter 的 replace 而非 push：404 是死路，不该留在历史里让后退键再撞一次。
-->
<template>
  <main class="flex min-h-screen items-center justify-center bg-slate-50 px-4">
    <div class="w-full max-w-md rounded-card border border-slate-200 bg-white p-8 shadow-card">
      <p class="text-center text-sm font-semibold uppercase tracking-[0.2em] text-sky-700">404</p>

      <PanelState
        title="没有这个地址"
        description="链接可能过期了，或者地址里打错了一个字符。"
        action-text="返回工作台"
        @action="router.replace('/')"
      />
    </div>
  </main>
</template>
