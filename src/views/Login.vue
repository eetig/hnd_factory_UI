<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import request from '../api/request'
import { saveAuth } from '../api/auth'

const router = useRouter()
const route = useRoute()
const username = ref('')
const password = ref('')
const loading = ref(false)
const errorMessage = ref('')

async function handleLogin() {
  const account = username.value.trim()
  const pass = password.value.trim()

  if (!account || !pass) {
    errorMessage.value = '请输入账号和密码'
    return
  }

  loading.value = true
  errorMessage.value = ''

  try {
    const res = await request.post('/api/login', {
      username: account,
      password: pass,
    })

    // 登录成功返回裸对象；失败时为 HTTP 200 + { success:false, msg }
    const body = res.data || {}
    const payload = { ...(body.data || {}), ...body }
    const token = payload.token || payload.accessToken || payload.access_token || payload.jwt

    if (!token) {
      throw new Error(body.msg || body.message || '登录失败，未返回 token')
    }

    // 保存 token 及角色、权限（用于按钮显隐与刷新后恢复）
    saveAuth({ ...payload, token })

    const redirectPath = route.query.redirect || '/'
    await router.replace(redirectPath)
  } catch (error) {
    const msg =
      error?.response?.data?.msg || error?.response?.data?.message || error.message || '登录失败'
    errorMessage.value = msg
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <!--
    三层与工作台同构（使用方 2026-10-07 定：登录页也要「跑在那张纸上」）：
      桌面（desk 暖骨）→ 纸（.minimal-field + rounded-card border border-line bg-canvas）
      → 白卡（rounded-card border border-line bg-raised）。

    x-minimalist 在这一页用的是 minimalist 的**全套版式**（不是宽表那套「只换令牌」）：
      · 字号对比是这一页唯一的层次手段：eyebrow 12px mono / h1 36px 紧字距 /
        说明 14px 行高 1.6 —— 三档，步进约 1.25，interval 本身就是节奏；
      · 没有阴影：卡靠 1px 发丝线站在纸上（minimalist：border replaces elevation）；
      · 输入框与按钮同构：6px 圆角（与 --el-border-radius-base 同一个值）、墨色实底 CTA、
        按下 scale(0.98) 的触觉反馈；
      · 色板只出现一次彩色 —— 错误行的 rose-600；其余全是墨与骨。
        这一页没有需要彩色表达的语义，所以连 eyebrow 都是灰的。

    高度取 100vh − 上下各 16px，与工作台那张纸同一个算式（spec 实算钉着），
    短内容也不会多出滚动条。
  -->
  <main class="flex min-h-screen items-center justify-center bg-desk p-4">
    <div
      class="minimal-field flex min-h-[calc(100vh-2rem)] w-full items-center justify-center rounded-card border border-line bg-canvas"
    >
      <div class="w-full max-w-md rounded-card border border-line bg-raised p-8">
        <div class="mb-8">
          <p class="font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
            Factory Operations
          </p>
          <h1 class="mt-4 text-4xl font-semibold leading-tight tracking-tight text-slate-900">
            登录
          </h1>
          <p class="mt-3 text-sm leading-relaxed text-slate-600">
            用工号与密码进入 HND 生产助手。
          </p>
        </div>

        <form class="space-y-5" @submit.prevent="handleLogin">
          <div>
            <label for="username" class="mb-2 block text-sm font-medium text-slate-700">账号</label>
            <input
              id="username"
              v-model="username"
              type="text"
              autocomplete="username"
              placeholder="请输入账号"
              class="w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-brand focus:ring-2 focus:ring-brand-100"
            />
          </div>

          <div>
            <label for="password" class="mb-2 block text-sm font-medium text-slate-700">密码</label>
            <input
              id="password"
              v-model="password"
              type="password"
              autocomplete="current-password"
              placeholder="请输入密码"
              class="w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-brand focus:ring-2 focus:ring-brand-100"
            />
          </div>

          <p v-if="errorMessage" role="alert" class="text-sm text-rose-600">{{ errorMessage }}</p>

          <button
            type="submit"
            :disabled="loading"
            class="w-full rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-on-brand transition hover:bg-brand-deep active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {{ loading ? '登录中...' : '登录' }}
          </button>
        </form>
      </div>
    </div>
  </main>
</template>
