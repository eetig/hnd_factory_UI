<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import request from '../api/request'

/**
 * 「需要注册 / 需要管理员」的提示卡（变更-129）。
 *
 * 两处用：① 深链直接打开锁定页时，替换页面内容渲染这张卡
 * ② 点锁定导航项时的弹框也用同一套文案（那边是 el-dialog，文案在 AppShell 里）
 *
 * 顺带把"谁点了什么"留痕（POST /api/audit/locked-click）。**每会话每功能只调一次** ——
 * 游客乱点十几下就刷出十几条，审计表很快会废掉。
 */
const props = defineProps({
  pageKey: { type: String, default: '' },
  title: { type: String, default: '这个功能需要注册后才能使用' },
  needAdmin: { type: Boolean, default: false },
})

const router = useRouter()

const heading = computed(() =>
  props.needAdmin ? '这个功能需要管理员权限' : '这个功能需要注册后才能使用',
)
const detail = computed(() =>
  props.needAdmin
    ? '它涉及采购价格与单据，只对管理员开放。需要开通请联系管理员。'
    : '注册只需一次，注册后即可查看；写操作仍然需要管理员。',
)

function reportOnce() {
  if (!props.pageKey) return
  const key = `hnd-locked-reported:${props.pageKey}`
  try {
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
  } catch {
    // 隐私模式下 sessionStorage 可能不可用；记不到就算了，不要因此报错
  }
  request.post('/api/audit/locked-click', { pageKey: props.pageKey }).catch(() => {})
}

function goRegister() {
  reportOnce()
  router.push('/register')
}

function goLogin() {
  reportOnce()
  router.push('/login')
}

reportOnce()
</script>

<template>
  <section class="rounded-card border border-line bg-raised px-6 py-10 text-center">
    <p class="text-base font-semibold text-slate-900">{{ heading }}</p>
    <p class="mx-auto mt-2 max-w-md text-sm text-slate-500">{{ detail }}</p>
    <div class="mt-6 flex flex-wrap items-center justify-center gap-3">
      <button
        v-if="!needAdmin"
        type="button"
        class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:ring-offset-2"
        @click="goRegister"
      >
        去注册
      </button>
      <button
        type="button"
        class="rounded-md border border-line px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-region focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:ring-offset-2"
        @click="goLogin"
      >
        {{ needAdmin ? '换个管理员账号登录' : '我已注册，去登录' }}
      </button>
    </div>
  </section>
</template>