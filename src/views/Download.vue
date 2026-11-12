<template>
  <div class="lp">
    <!-- 背景：浅粉 / 奶白 / 淡玫瑰的弥散光,纯 CSS（radial 多层,不用线性渐变） -->
    <div class="lp__bg" aria-hidden="true">
      <span class="lp__blob lp__blob--rose" />
      <span class="lp__blob lp__blob--cream" />
      <span class="lp__blob lp__blob--peach" />
      <span class="lp__haze" />
    </div>

    <header class="lp__bar">
      <button
        type="button"
        class="lp__burger"
        aria-label="打开菜单"
        :aria-expanded="drawerOpen ? 'true' : 'false'"
        @click="drawerOpen = true"
      >
        <span /><span /><span />
      </button>

      <div class="lp__brand">
        <span class="lp__mark" aria-hidden="true">H</span>
        <span class="lp__brand-text">HND 生产助手</span>
      </div>
    </header>

    <main class="lp__main">
      <p class="lp__eyebrow">内部系统 · Windows 客户端</p>
      <h1 class="lp__title">HND 生产助手</h1>
      <p class="lp__lead">现在，开箱即用</p>
      <p class="lp__desc">本系统已迁移至 Windows 客户端，所有业务操作请使用桌面端。</p>

      <div class="lp__cta-wrap">
        <div class="lp__cta">
          <a class="lp__cta-main" :href="downloadUrl" @click="onDownload">
            <svg class="lp__cta-icon" viewBox="0 0 20 20" aria-hidden="true">
              <path
                d="M10 3v9m0 0 3.2-3.2M10 12 6.8 8.8M4 15.5h12"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            下载 Windows 版
          </a>

          <button
            type="button"
            class="lp__cta-pick"
            aria-label="选择版本"
            :aria-expanded="menuOpen ? 'true' : 'false'"
            @click="menuOpen = !menuOpen"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path
                d="m6 8 4 4 4-4"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>

        <ul v-if="menuOpen" class="lp__menu">
          <li v-for="item in versions" :key="item.id">
            <a class="lp__menu-item" :href="item.url" @click="menuOpen = false">
              <span class="lp__menu-label">{{ item.label }}</span>
              <span class="lp__menu-note">{{ item.note }}</span>
            </a>
          </li>
          <li class="lp__menu-foot">64 位安装包 · Windows 10 及以上</li>
        </ul>

        <p class="lp__note">当前版本 v{{ version }} · 已登录账号与数据照旧</p>
      </div>

      <figure class="lp__shot">
        <img :src="shot" alt="HND 生产助手 Windows 客户端界面：采购看板" />
        <figcaption>客户端界面预览 · 采购看板</figcaption>
      </figure>
    </main>

    <footer class="lp__foot">HND 生产助手 · 仅限厂内使用</footer>

    <transition name="lp-fade">
      <div v-if="drawerOpen" class="lp__scrim" @click="drawerOpen = false" />
    </transition>

    <transition name="lp-slide">
      <aside v-if="drawerOpen" class="lp__drawer" aria-label="菜单">
        <div class="lp__drawer-head">
          <span class="lp__mark lp__mark--sm" aria-hidden="true">H</span>
          <span class="lp__drawer-title">HND 生产助手</span>
          <button type="button" class="lp__close" aria-label="关闭菜单" @click="drawerOpen = false">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path
                d="m5 5 10 10M15 5 5 15"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </div>

        <nav class="lp__nav">
          <a class="lp__nav-item" :href="downloadUrl" @click="drawerOpen = false">
            <span>下载 Windows 版</span>
            <span class="lp__nav-hint">v{{ version }}</span>
          </a>
          <button type="button" class="lp__nav-item" @click="installOpen = !installOpen">
            <span>安装说明</span>
            <span class="lp__nav-hint">{{ installOpen ? '收起' : '展开' }}</span>
          </button>
          <ol v-if="installOpen" class="lp__steps">
            <li>点「下载 Windows 版」拿到安装包</li>
            <li>双击安装，按向导下一步到底</li>
            <li>用原来的账号登录，数据照旧</li>
          </ol>
        </nav>

        <p class="lp__drawer-foot">网页端已停止业务功能，仅作下载引导。</p>
      </aside>
    </transition>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import shot from '../assets/landing/purchase-board.webp'

const FALLBACK_URL =
  'https://hbhnd.cloud/desktop/HND%E7%94%9F%E4%BA%A7%E5%8A%A9%E6%89%8B_1.0.13_x64-setup.exe'

const version = ref('1.0.13')
const downloadUrl = ref(FALLBACK_URL)
const drawerOpen = ref(false)
const installOpen = ref(false)
const menuOpen = ref(false)

/*
 * 版本号与下载地址都从 `desktop/latest.json` 读，不在页面里写死。
 *
 * 理由：安装包换成 1.0.14 之后，如果这里还写着 1.0.13，按钮就会把人引到一个
 * 已经不存在的旧文件上 —— 页面看着正常，点了 404。放到服务端同一份文件里，
 * 发布脚本改一处，下载页自动跟上。取不到就退回常量（网络抖动时不至于没按钮）。
 */
async function loadRelease() {
  try {
    const res = await fetch('/desktop/latest.json', { cache: 'no-store' })
    if (!res.ok) return
    const data = await res.json()
    if (data?.version) version.value = data.version
    const url = data?.platforms?.['windows-x86_64']?.url
    if (url) downloadUrl.value = url
  } catch {
    /* 取不到就保持兜底，不打扰用户 */
  }
}

/**
 * 下拉里的版本。
 *
 * 现在服务端只维护「最新版」一条（`desktop/latest.json`），没有历史版本目录 ——
 * 所以这里不编造旧的下载地址：只给最新版一条，加上一句"更早版本找管理员"。
 * 将来 `latest.json` 加上 `history` 数组时，在这里 map 一遍即可。
 */
const versions = computed(() => [
  { id: 'latest', label: `v${version.value}`, note: '最新版 · 推荐', url: downloadUrl.value },
])

function onDownload() {
  drawerOpen.value = false
  menuOpen.value = false
}

function onKeydown(event) {
  if (event.key !== 'Escape') return
  if (menuOpen.value) {
    menuOpen.value = false
    return
  }
  if (drawerOpen.value) drawerOpen.value = false
}

function onPointerDown(event) {
  if (!menuOpen.value) return
  if (!event.target.closest?.('.lp__cta-wrap')) menuOpen.value = false
}

onMounted(() => {
  loadRelease()
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('pointerdown', onPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('pointerdown', onPointerDown)
})
</script>

<style scoped>
/*
 * 下载首页（2026-11-12 第 3 版,使用方定稿:浅粉弥散）。
 *
 * 骨架照 DSH 落地页:一条极简顶栏、居中一列「标题 / 副标题 / 说明 / 一个按钮」、
 * 下面一张产品预览。配色按使用方要求反过来 —— 不要深色、不要蓝色科技感,
 * 要浅粉 + 奶白 + 淡玫瑰的雾化光斑,按钮用深玫红压住。
 *
 * 刻意不做:表格、筛选、标签页、外层底板、厚阴影、卡片边框堆叠。
 * 对比度锚点:深玫红 #8E2B49 压奶白 #FFF8F5 ≈ 7.0:1;正文 #6B5A60 ≈ 5.1:1。
 *
 * ⚠️ 本项目守卫禁止 `linear-gradient(` 与 `backdrop-filter`（变更-124）,
 *    所以底色、光斑、按钮光泽全部用 radial-gradient 与纯色实现。
 */
.lp {
  --lp-ink: #2a1f22;
  --lp-ink-2: #6b5a60;
  --lp-rose: #b23a5e;
  --lp-rose-deep: #8e2b49;
  --lp-paper: #fff8f5;
  --lp-line: rgba(178, 58, 94, 0.16);

  position: relative;
  min-height: 100vh;
  overflow-x: hidden;
  background: radial-gradient(120% 92% at 50% 0%, #fffdfb 0%, var(--lp-paper) 44%, #fdeef0 100%);
  color: var(--lp-ink);
  -webkit-font-smoothing: antialiased;
}

.lp__bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.lp__blob {
  position: absolute;
  display: block;
  border-radius: 50%;
  filter: blur(60px);
  opacity: 0.55;
}

.lp__blob--rose {
  top: -18vh;
  left: -10vw;
  width: 58vw;
  height: 58vw;
  background: radial-gradient(circle at 40% 40%, #f6c9d3 0%, rgba(246, 201, 211, 0) 68%);
}

.lp__blob--cream {
  top: 6vh;
  right: -14vw;
  width: 52vw;
  height: 52vw;
  background: radial-gradient(circle at 55% 45%, #ffe9d6 0%, rgba(255, 233, 214, 0) 66%);
}

.lp__blob--peach {
  bottom: -26vh;
  left: 26vw;
  width: 62vw;
  height: 62vw;
  background: radial-gradient(circle at 50% 50%, #fbd9dc 0%, rgba(251, 217, 220, 0) 70%);
  opacity: 0.42;
}

.lp__haze {
  position: absolute;
  inset: 0;
  background: radial-gradient(120% 62% at 50% -12%, rgba(255, 255, 255, 0.72) 0%, rgba(255, 255, 255, 0) 72%);
}

/* ---------- 顶栏:汉堡 + 品牌,无外层底板 ---------- */
.lp__bar {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px clamp(16px, 4vw, 40px);
}

.lp__burger {
  display: inline-flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  width: 44px;
  height: 44px;
  padding: 0 11px;
  border: none;
  border-radius: 12px;
  background: transparent;
  cursor: pointer;
  transition: background-color 160ms ease;
}

.lp__burger span {
  display: block;
  height: 1.5px;
  border-radius: 2px;
  background: var(--lp-ink);
}

.lp__burger:hover {
  background: rgba(178, 58, 94, 0.08);
}

.lp__brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.lp__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: radial-gradient(circle at 32% 26%, #cf6483 0%, var(--lp-rose-deep) 72%);
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  box-shadow: 0 6px 16px rgba(142, 43, 73, 0.22);
}

.lp__mark--sm {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  font-size: 13px;
}

.lp__brand-text {
  font-size: 14px;
  font-weight: 600;
}

.lp__burger:focus-visible,
.lp__cta-main:focus-visible,
.lp__cta-pick:focus-visible,
.lp__close:focus-visible,
.lp__nav-item:focus-visible,
.lp__menu-item:focus-visible {
  outline: 2px solid var(--lp-rose);
  outline-offset: 2px;
}

/* ---------- 主列 ---------- */
.lp__main {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: clamp(28px, 6vh, 76px) 24px 0;
  text-align: center;
}

.lp__eyebrow {
  margin: 0 0 18px;
  padding: 5px 12px;
  border: 1px solid var(--lp-line);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.62);
  color: var(--lp-ink-2);
  font-size: 12px;
  letter-spacing: 0.04em;
}

.lp__title {
  margin: 0;
  font-size: clamp(38px, 5.2vw, 62px);
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.08;
}

.lp__lead {
  margin: 14px 0 0;
  font-size: clamp(20px, 2.4vw, 28px);
  font-weight: 400;
  color: #43323a;
  letter-spacing: -0.01em;
}

.lp__desc {
  margin: 20px 0 0;
  max-width: 32em;
  font-size: 15px;
  line-height: 1.75;
  color: var(--lp-ink-2);
}

/* ---------- 下载按钮 + 版本下拉 ---------- */
.lp__cta-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 26px;
}

.lp__cta {
  display: inline-flex;
  align-items: stretch;
  border-radius: 999px;
  background: var(--lp-rose-deep);
  box-shadow: 0 14px 30px rgba(142, 43, 73, 0.24);
}

.lp__cta-main {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  min-height: 48px;
  padding: 0 24px;
  border-radius: 999px 0 0 999px;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
}

.lp__cta-icon {
  width: 18px;
  height: 18px;
}

.lp__cta-pick {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  min-height: 48px;
  border: none;
  border-left: 1px solid rgba(255, 255, 255, 0.26);
  border-radius: 0 999px 999px 0;
  background: transparent;
  color: #fff;
  cursor: pointer;
}

.lp__cta-pick svg {
  width: 18px;
  height: 18px;
}

.lp__cta-main:hover,
.lp__cta-pick:hover {
  background: rgba(255, 255, 255, 0.1);
}

.lp__menu {
  position: absolute;
  top: calc(100% + 10px);
  left: 50%;
  z-index: 5;
  transform: translateX(-50%);
  min-width: 236px;
  margin: 0;
  padding: 6px;
  list-style: none;
  border: 1px solid var(--lp-line);
  border-radius: 14px;
  background: rgba(255, 252, 250, 0.98);
  box-shadow: 0 18px 40px rgba(90, 50, 62, 0.16);
}

.lp__menu-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 10px 12px;
  border-radius: 10px;
  text-decoration: none;
}

.lp__menu-item:hover {
  background: rgba(178, 58, 94, 0.08);
}

.lp__menu-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--lp-ink);
}

.lp__menu-note {
  font-size: 12px;
  color: var(--lp-ink-2);
}

.lp__menu-foot {
  padding: 9px 12px 7px;
  margin-top: 4px;
  border-top: 1px solid var(--lp-line);
  font-size: 12px;
  color: var(--lp-ink-2);
}

.lp__note {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--lp-ink-2);
}

/* ---------- 客户端截图:轻卡片,不压重阴影 ---------- */
.lp__shot {
  width: min(880px, 100%);
  margin: clamp(28px, 5vh, 56px) 0 0;
  padding: 8px;
  border: 1px solid var(--lp-line);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.62);
  box-shadow: 0 18px 44px rgba(120, 70, 85, 0.12);
}

.lp__shot img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 12px;
}

.lp__shot figcaption {
  padding: 9px 4px 3px;
  font-size: 12px;
  color: var(--lp-ink-2);
}

.lp__foot {
  position: relative;
  z-index: 1;
  padding: 32px 16px 26px;
  font-size: 12px;
  color: var(--lp-ink-2);
  text-align: center;
}

/* ---------- 抽屉 ---------- */
.lp__scrim {
  position: fixed;
  inset: 0;
  z-index: 20;
  background: rgba(42, 31, 34, 0.28);
}

.lp__drawer {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 21;
  display: flex;
  flex-direction: column;
  width: min(300px, 84vw);
  padding: 16px 14px calc(16px + env(safe-area-inset-bottom, 0px));
  border-right: 1px solid var(--lp-line);
  background: rgba(255, 251, 249, 0.99);
  box-shadow: 12px 0 40px rgba(90, 50, 62, 0.14);
}

.lp__drawer-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 6px 14px;
}

.lp__drawer-title {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
}

.lp__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--lp-ink-2);
  cursor: pointer;
}

.lp__close svg {
  width: 18px;
  height: 18px;
}

.lp__close:hover {
  background: rgba(178, 58, 94, 0.08);
}

.lp__nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.lp__nav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  padding: 0 12px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--lp-ink);
  font-size: 14px;
  text-decoration: none;
  cursor: pointer;
  text-align: left;
}

.lp__nav-item:hover {
  background: rgba(178, 58, 94, 0.07);
}

.lp__nav-hint {
  font-size: 12px;
  color: var(--lp-ink-2);
}

.lp__steps {
  margin: 4px 0 8px;
  padding: 10px 12px 10px 30px;
  border-radius: 10px;
  background: rgba(178, 58, 94, 0.05);
  color: var(--lp-ink-2);
  font-size: 12.5px;
  line-height: 1.8;
}

.lp__drawer-foot {
  margin: auto 0 0;
  padding: 12px 8px 0;
  border-top: 1px solid var(--lp-line);
  font-size: 12px;
  line-height: 1.7;
  color: var(--lp-ink-2);
}

/* ---------- 过渡:只动 opacity / transform ---------- */
.lp-fade-enter-active,
.lp-fade-leave-active {
  transition: opacity 180ms ease;
}

.lp-fade-enter-from,
.lp-fade-leave-to {
  opacity: 0;
}

.lp-slide-enter-active,
.lp-slide-leave-active {
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.lp-slide-enter-from,
.lp-slide-leave-to {
  transform: translateX(-100%);
}

@media (prefers-reduced-motion: reduce) {
  .lp-fade-enter-active,
  .lp-fade-leave-active,
  .lp-slide-enter-active,
  .lp-slide-leave-active,
  .lp__burger {
    transition: none;
  }
}
</style>
