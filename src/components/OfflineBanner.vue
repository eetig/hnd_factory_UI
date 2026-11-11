<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 断网提示条（2026-11-11，桌面版接入时补）。
 *
 * 桌面版把前端打进了 exe，断网时页面照样能打开 —— 但接口全部失败，
 * 使用方看到的是"点了没反应"。一条明确的黄条，比让他们猜"是不是电脑坏了"好。
 *
 * 判据只有 navigator.onLine：它不代表"服务器活着"（服务器挂了它仍是 true），
 * 所以文案写"网络"，不写"服务器"。真实接口失败仍由各页自己的错误条负责。
 */
const offline = ref(typeof navigator !== 'undefined' ? !navigator.onLine : false)

function onOffline() {
  offline.value = true
}
function onOnline() {
  offline.value = false
}

onMounted(() => {
  window.addEventListener('offline', onOffline)
  window.addEventListener('online', onOnline)
})
onBeforeUnmount(() => {
  window.removeEventListener('offline', onOffline)
  window.removeEventListener('online', onOnline)
})
</script>

<template>
  <div
    v-if="offline"
    role="status"
    class="mb-2 flex items-center gap-2 rounded-card border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
  >
    <span class="font-semibold">网络断了</span>
    <span class="text-amber-700">现在打开的还能看，但保存、刷新都会失败。连上网络后刷新一下。</span>
  </div>
</template>
