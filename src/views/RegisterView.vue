<script setup>
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import request from '../api/request'
import { saveAuth } from '../api/auth'
import SliderCaptcha from '../components/SliderCaptcha.vue'

/**
 * 自助注册（变更-129）。
 *
 * 设计口径（使用方 2026-10-20 定的）：
 *   · 不强制任何人注册 —— 游客能看见所有功能，点锁定的才提示注册；
 *   · 注册后立刻可用、只读（角色由服务端固定成 member）；
 *   · 写操作仍然要管理员。这句话必须写在页面上，否则人会以为注册完就能改数据。
 */
const router = useRouter()
const route = useRoute()

const form = reactive({ username: '', password: '', confirm: '', realName: '' })
const error = ref('')
// 滑动验证通过后由子组件回填的一次性 ticket（服务端消费，过期/用过即失效）
const captchaTicket = ref('')
const submitting = ref(false)

async function submit() {
  error.value = ''
  if (!form.username.trim()) {
    error.value = '请填写账号'
    return
  }
  if (form.username.trim().length < 4) {
    error.value = '账号至少 4 位'
    return
  }
  if (form.password.length < 6) {
    error.value = '密码至少 6 位'
    return
  }
  if (form.password !== form.confirm) {
    error.value = '两次输入的密码不一致'
    return
  }
  // 昵称只允许中文、英文、下划线（后端 RegisterDTO 上有同一条正则，两边口径必须一致）
  if (form.realName && !/^[\u4e00-\u9fa5A-Za-z_]+$/.test(form.realName)) {
    error.value = '昵称只能包含中文、英文、下划线'
    return
  }
  // 滑动验证（2026-10-21）：没过就不能提交，服务端也会再验一次
  if (!captchaTicket.value) {
    error.value = '请先拖动滑块完成验证'
    return
  }

  submitting.value = true
  try {
    const res = await request.post('/api/register', {
      username: form.username.trim(),
      password: form.password,
      realName: form.realName.trim(),
      captchaTicket: captchaTicket.value,
    })

    // 注册成功即登录，返回结构与 /api/login 完全一致 —— 这里用同一套解析（含失败时的 { success:false, msg }）
    const body = res.data || {}
    const payload = { ...(body.data || {}), ...body }
    const token = payload.token || payload.accessToken || payload.access_token || payload.jwt
    if (!token) {
      throw new Error(body.msg || body.message || '注册成功但没有返回 token，请联系管理员')
    }
    saveAuth({ ...payload, token })
    // 注册即登录；如果是从某个锁定功能跳过来的，直接送他去那一页
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : ''
    await router.replace(redirect || '/')
  } catch (e) {
    error.value = e?.response?.data?.msg || e?.message || '注册失败，请稍后再试'
    // ticket 是一次性的：服务端已消费 / 已过期，重试前必须重新滑
    captchaTicket.value = ''
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-md py-10">
    <h1 class="text-xl font-semibold text-slate-900">注册账号</h1>


    <form class="mt-6 space-y-4" @submit.prevent="submit">
      <label class="block">
        <span class="text-sm text-slate-700">账号</span>
        <input
          v-model="form.username"
          type="text"
          autocomplete="username"
          class="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
          placeholder="4-32 位，字母或数字"
        />
      </label>
      <label class="block">
        <span class="text-sm text-slate-700">密码</span>
        <input
          v-model="form.password"
          type="password"
          autocomplete="new-password"
          class="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
          placeholder="至少 6 位"
        />
      </label>
      <label class="block">
        <span class="text-sm text-slate-700">确认密码</span>
        <input
          v-model="form.confirm"
          type="password"
          autocomplete="new-password"
          class="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
        />
      </label>
      <label class="block">
        <span class="text-sm text-slate-700">昵称（选填）</span>
        <input
          v-model="form.realName"
          type="text"
          maxlength="32"
          class="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
          placeholder="只能包含中文、英文、下划线"
        />
      </label>

      <div>
        <span class="mb-1 block text-sm text-slate-700">滑动验证</span>
        <SliderCaptcha v-model="captchaTicket" />
      </div>

      <p v-if="error" class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error }}</p>

      <button
        type="submit"
        :disabled="submitting"
        class="w-full rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {{ submitting ? '注册中…' : '注册并登录' }}
      </button>
    </form>

    <p class="mt-4 text-sm text-slate-500">
      已有账号？<router-link to="/login" class="text-brand-ink underline">去登录</router-link>
    </p>
  </div>
</template>