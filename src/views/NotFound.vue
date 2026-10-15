<script setup>
import { useRouter } from 'vue-router'
import PanelState from '../components/PanelState.vue'

const router = useRouter()
</script>

<!--
  地址兜底页。外壳刻意照抄 Login.vue（同一个「整屏居中卡片」形状），
  正文复用 PanelState，不新造一套视觉词汇。
  useRouter 的 replace 而非 push：404 是死路，不该留在历史里让后退键再撞一次。

  x-minimalist：三层与 Login.vue 同构（桌面 desk → 纸 .minimal-field → 白卡）。
  数字 404 用 mono 灰字而不是主色 —— minimalist 的颜色是稀缺的，
  这一页没有需要彩色表达的语义。
-->
<template>
  <main class="flex min-h-screen items-center justify-center bg-desk p-4">
    <div
      class="minimal-field flex min-h-[calc(100vh-2rem)] w-full items-center justify-center rounded-card border border-line bg-canvas"
    >
      <div class="w-full max-w-md rounded-card border border-line bg-raised p-8">
        <p class="text-center font-mono text-xs uppercase tracking-[0.2em] text-slate-500">404</p>

        <PanelState
          title="没有这个地址"
          description="链接可能过期了，或者地址里打错了一个字符。"
          action-text="返回工作台"
          @action="router.replace('/')"
        />
      </div>
    </div>
  </main>
</template>
