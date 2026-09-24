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
    const token =
      payload.token || payload.accessToken || payload.access_token || payload.jwt

    if (!token) {
      throw new Error(body.msg || body.message || '登录失败，未返回 token')
    }

    // 保存 token 及角色、权限（用于按钮显隐与刷新后恢复）
    saveAuth({ ...payload, token })

    const redirectPath = route.query.redirect || '/'
    await router.replace(redirectPath)
  } catch (error) {
    const msg = error?.response?.data?.msg || error?.response?.data?.message || error.message || '登录失败'
    errorMessage.value = msg
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-slate-100 px-4">
    <div class="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
      <div class="mb-8 text-center">
        <p class="text-sm font-semibold uppercase tracking-[0.2em] text-sky-600">Factory Operations</p>
        <h1 class="mt-3 text-3xl font-bold text-slate-900">登录</h1>
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
            class="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white focus:ring-2 focus:ring-sky-100"
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
            class="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white focus:ring-2 focus:ring-sky-100"
          />
        </div>

        <p v-if="errorMessage" class="text-sm text-rose-600">{{ errorMessage }}</p>

        <button
          type="submit"
          :disabled="loading"
          class="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {{ loading ? '登录中...' : '登录' }}
        </button>
      </form>
    </div>
  </main>
</template>
