<template>
  <WindowFrame>
    <RouterView />
  </WindowFrame>
</template>

<script setup>
import { onMounted } from 'vue'
import WindowFrame from './layouts/WindowFrame.vue'
import { installDesktopCloseBehavior } from './desktop/closeBehavior'

/*
 * 桌面版才有意义：点 ✕ 时问「退出 / 最小化到托盘」。
 * 网页版这个函数直接返回（见 src/desktop/closeBehavior.js 第一行判断）。
 */
onMounted(() => {
  installDesktopCloseBehavior()
})

/*
 * 2026-11-23：原来这里只有一句 `<RouterView />`。加 WindowFrame 是为了给
 * **壳外**的整页（登录 / 注册 / 404 / 落地页 / 下载页）补上拖动与窗口钮 ——
 * 它们没有 AppShell 的顶栏，窗口又关掉了系统装饰，于是连关都关不掉。
 * 壳内不受影响：WindowFrame 读 `meta.shell`，工作台路由一律不插手。
 */
</script>
