<script setup>
import { ref } from 'vue'
import request from '../../api/request'
import { saveAuth } from '../../api/auth'

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

    // 改造前用的是 vue-router 的 route.query.redirect；
    // uni-app 没有全局 query 转发，改用「有上一页就返回，否则回首页」，
    // 效果等价且不用维护 redirect 参数。
    const pages = getCurrentPages()
    if (pages.length > 1) {
      uni.navigateBack()
    } else {
      uni.reLaunch({ url: '/pages/index/index' })
    }
  } catch (error) {
    errorMessage.value =
      error?.response?.data?.msg ||
      error?.response?.data?.message ||
      error.message ||
      '登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <view class="login-page">
    <view class="login-card">
      <view class="login-head">
        <text class="login-eyebrow">Factory Operations</text>
        <text class="login-title">登录</text>
      </view>

      <view class="login-field">
        <text class="login-label">账号</text>
        <input
          v-model="username"
          class="login-input"
          type="text"
          placeholder="请输入账号"
          placeholder-class="login-placeholder"
        />
      </view>

      <view class="login-field">
        <text class="login-label">密码</text>
        <input
          v-model="password"
          class="login-input"
          password
          placeholder="请输入密码"
          placeholder-class="login-placeholder"
        />
      </view>

      <text v-if="errorMessage" class="login-error">{{ errorMessage }}</text>

      <button
        class="login-submit"
        :disabled="loading"
        @click="handleLogin"
      >
        {{ loading ? '登录中...' : '登录' }}
      </button>
    </view>
  </view>
</template>

<style lang="scss" scoped>
// 登录页的样式改用 SCSS 而不是 Tailwind：
// input / button 在各端的默认盒模型差异较大（小程序 button 自带边框与默认宽度），
// 用显式样式比用工具类逐个覆盖更稳，而这页总共也没几个元素。
.login-page {
  display: flex;
  min-height: 100vh;
  align-items: center;
  justify-content: center;
  background-color: $slate-100;
  padding: 32rpx;
}

.login-card {
  width: 100%;
  max-width: 720rpx;
  border: 1px solid $slate-200;
  border-radius: 32rpx;
  background-color: #fff;
  padding: 64rpx 48rpx;
}

.login-head {
  margin-bottom: 56rpx;
  text-align: center;
}

.login-eyebrow {
  display: block;
  color: $sky-600;
  font-size: 24rpx;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.login-title {
  display: block;
  margin-top: 20rpx;
  color: $slate-900;
  font-size: 56rpx;
  font-weight: 700;
}

.login-field {
  margin-bottom: 36rpx;
}

.login-label {
  display: block;
  margin-bottom: 16rpx;
  color: $slate-700;
  font-size: 28rpx;
  font-weight: 500;
}

.login-input {
  box-sizing: border-box;
  width: 100%;
  height: 92rpx;
  padding: 0 24rpx;
  border: 1px solid $slate-300;
  border-radius: 16rpx;
  background-color: $slate-50;
  color: $slate-900;
  font-size: 28rpx;
}

.login-placeholder {
  color: $slate-400;
}

.login-error {
  display: block;
  margin-bottom: 24rpx;
  color: $rose-600;
  font-size: 26rpx;
}

.login-submit {
  display: flex;
  width: 100%;
  height: 92rpx;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 16rpx;
  background-color: $slate-900;
  color: #fff;
  font-size: 28rpx;
  font-weight: 500;
  line-height: 1;

  &::after {
    // 小程序 button 默认带一条 1px 边框（::after 实现），去掉它
    border: 0;
  }

  &[disabled] {
    opacity: 0.7;
  }
}
</style>
