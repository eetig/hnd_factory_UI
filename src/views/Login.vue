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
    三层与工作台同构（使用方 2026-10-07 定：登录页也要「跑在那张纸上」；
    043 起那张纸是中性柔光场）：
      桌面（desk）→ 场（rounded-card bg-canvas + `.minimal-field` 光斑）→ 白色表单卡片。
    白表单卡浮在浅场上天然成立（白压 canvas ≈1.2；字是 slate-900 家族压白 16+）——
    这一页**不做玻璃**：表单需要的是安静的底，不必再吸光。
    高度取 100vh − 上下各 16px，与工作台那张纸同一个算式，短内容也不会多出滚动条。
  -->
  <main class="flex min-h-screen items-center justify-center bg-desk p-4">
    <div
      class="minimal-field flex min-h-[calc(100vh-2rem)] w-full items-center justify-center rounded-card border border-line bg-canvas"
    >
      <div class="w-full max-w-md rounded-card border border-slate-200 bg-white p-8 shadow-card">
        <div class="mb-8 text-center">
          <p class="text-sm font-semibold uppercase tracking-[0.2em] text-brand-deep">
            Factory Operations
          </p>
          <h1 class="mt-3 text-3xl font-bold text-slate-900">登录</h1>
        </div>

        <form class="space-y-6" @submit.prevent="handleLogin">
          <div>
            <label for="username" class="mb-2 block text-sm font-medium text-slate-700">账号</label>
            <input
              id="username"
              v-model="username"
              type="text"
              autocomplete="username"
              placeholder="请输入账号"
              class="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand-100"
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
              class="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand-100"
            />
          </div>

          <p v-if="errorMessage" role="alert" class="text-sm text-rose-600">{{ errorMessage }}</p>

          <button
            type="submit"
            :disabled="loading"
            class="w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-deep disabled:cursor-not-allowed disabled:opacity-70"
          >
            {{ loading ? '登录中...' : '登录' }}
          </button>
        </form>
      </div>
    </div>
  </main>
</template>
