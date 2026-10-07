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
    三层与工作台同构（使用方 2026-10-07 定：登录页也要「跑在暖白卡片上」）：
      冷灰底（min-h-screen + p-4）→ 暖白纸（rounded-card bg-canvas）→ 白色表单卡片。
    高度取 100vh − 上下各 16px，与工作台那张纸同一个算式，短内容也不会多出滚动条。
  -->
  <main class="flex min-h-screen items-center justify-center bg-slate-50 p-4">
    <div
      class="flex min-h-[calc(100vh-2rem)] w-full items-center justify-center rounded-card bg-canvas shadow-card"
    >
      <div class="w-full max-w-md rounded-card border border-slate-200 bg-white p-8 shadow-card">
        <div class="mb-8 text-center">
          <p class="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-700">
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
              class="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
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
              class="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
            />
          </div>

          <p v-if="errorMessage" role="alert" class="text-sm text-rose-600">{{ errorMessage }}</p>

          <button
            type="submit"
            :disabled="loading"
            class="w-full rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {{ loading ? '登录中...' : '登录' }}
          </button>
        </form>
      </div>
    </div>
  </main>
</template>
