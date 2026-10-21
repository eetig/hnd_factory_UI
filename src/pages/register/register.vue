<script setup>
import { ref } from 'vue'
import request from '../../api/request'
import { saveAuth } from '../../api/auth'
import ThemeToggle from '../../components/ThemeToggle.vue'
import { useTheme } from '../../composables/useTheme'
import SliderCaptcha from '../../components/SliderCaptcha.vue'

/**
 * 自助注册（2026-10-21，与网页端 RegisterView 同一套口径）。
 *
 * 使用方：「小程序或 App 要优化，默认不需要登录，而且这个登录页面也要优化，没有注册的链接」。
 * 所以登录页补上了「注册一个」入口，这里是它落的页面。
 *
 * 口径（与网页端一致，别再各写一份）：
 *   · 昵称选填，占位提示「只能包含中文、英文、下划线」；
 *   · 注册成功即登录，角色由**服务端**固定成 member（只读），客户端不传角色；
 *   · 写操作仍然要管理员 —— 这句话在登录页底部已经讲了，这里不重复堆文字。
 */
const { themeClass, wotTheme, themeVars } = useTheme()

const username = ref('')
const password = ref('')
const confirm = ref('')
const nickname = ref('')
const loading = ref(false)
const errorMessage = ref('')
// 滑动验证通过后由子组件回填的一次性 ticket（服务端消费，用过即失效）
const captchaTicket = ref('')

// 小程序端 :focus 伪类不生效，用聚焦态类名统一三端反馈（与登录页同一手法）
const focusField = ref('')

const NICKNAME_RE = /^[\u4e00-\u9fa5A-Za-z_]*$/

async function handleRegister() {
  const account = username.value.trim()
  const pass = password.value.trim()

  if (!account) {
    errorMessage.value = '请填写账号'
    return
  }
  if (account.length < 4) {
    errorMessage.value = '账号至少 4 位'
    return
  }
  if (pass.length < 6) {
    errorMessage.value = '密码至少 6 位'
    return
  }
  if (pass !== confirm.value.trim()) {
    errorMessage.value = '两次输入的密码不一致'
    return
  }
  if (nickname.value.trim() && !NICKNAME_RE.test(nickname.value.trim())) {
    errorMessage.value = '昵称只能包含中文、英文、下划线'
    return
  }
  if (!captchaTicket.value) {
    errorMessage.value = '请先拖动滑块完成验证'
    return
  }

  loading.value = true
  errorMessage.value = ''

  try {
    const res = await request.post('/api/register', {
      username: account,
      password: pass,
      realName: nickname.value.trim(),
      captchaTicket: captchaTicket.value,
    })

    // 注册成功即登录，返回结构与 /api/login 完全一致（含失败时 { success:false, msg }）
    const body = res.data || {}
    const payload = { ...(body.data || {}), ...body }
    const token = payload.token || payload.accessToken || payload.access_token || payload.jwt

    if (!token) {
      throw new Error(body.msg || body.message || '注册成功但没拿到登录凭据，请联系管理员')
    }

    saveAuth({ ...payload, token })
    uni.showToast({ title: '注册成功', icon: 'success', duration: 1200 })
    uni.reLaunch({ url: '/pages/index/index' })
  } catch (error) {
    // ticket 一次性：服务端已消费或已过期，重试前必须重新滑
    captchaTicket.value = ''
    errorMessage.value =
      error?.response?.data?.msg ||
      error?.response?.data?.message ||
      error.message ||
      '注册失败，请稍后再试'
  } finally {
    loading.value = false
  }
}

function goLogin() {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack()
  } else {
    uni.reLaunch({ url: '/pages/login/login' })
  }
}
</script>

<template>
  <view class="reg-page" :class="themeClass">
    <view class="reg-aurora" aria-hidden="true"></view>

    <view class="reg-theme">
      <ThemeToggle />
    </view>

    <wd-config-provider :theme="wotTheme" :theme-vars="themeVars" custom-class="reg-shell">
      <view class="reg-card">
        <view class="reg-brand">
          <view class="reg-brand__mark">
            <text>HND</text>
          </view>
          <view class="reg-brand__text">
            <text class="reg-eyebrow">Factory Operations</text>
            <text class="reg-title">注册</text>
          </view>
        </view>

        <view class="reg-field">
          <text class="reg-label">账号</text>
          <input
            v-model="username"
            class="reg-input"
            :class="{ 'is-focus': focusField === 'username' }"
            type="text"
            placeholder="4-32 位，字母或数字"
            placeholder-class="reg-placeholder"
            @focus="focusField = 'username'"
            @blur="focusField = ''"
          />
        </view>

        <view class="reg-field">
          <text class="reg-label">密码</text>
          <input
            v-model="password"
            class="reg-input"
            :class="{ 'is-focus': focusField === 'password' }"
            password
            placeholder="至少 6 位"
            placeholder-class="reg-placeholder"
            @focus="focusField = 'password'"
            @blur="focusField = ''"
          />
        </view>

        <view class="reg-field">
          <text class="reg-label">确认密码</text>
          <input
            v-model="confirm"
            class="reg-input"
            :class="{ 'is-focus': focusField === 'confirm' }"
            password
            placeholder="再输一次"
            placeholder-class="reg-placeholder"
            @focus="focusField = 'confirm'"
            @blur="focusField = ''"
          />
        </view>

        <view class="reg-field">
          <text class="reg-label">昵称（选填）</text>
          <input
            v-model="nickname"
            class="reg-input"
            :class="{ 'is-focus': focusField === 'nickname' }"
            type="text"
            maxlength="32"
            placeholder="只能包含中文、英文、下划线"
            placeholder-class="reg-placeholder"
            @focus="focusField = 'nickname'"
            @blur="focusField = ''"
          />
        </view>

        <view class="reg-captcha">
          <text class="reg-label">滑动验证</text>
          <SliderCaptcha v-model="captchaTicket" />
        </view>

        <text v-if="errorMessage" class="reg-error">{{ errorMessage }}</text>

        <button class="reg-submit" :disabled="loading" @click="handleRegister">
          {{ loading ? '注册中...' : '注册并登录' }}
        </button>

        <view class="reg-links">
          <text class="reg-links__label">已有账号？</text>
          <text class="reg-links__action" @click="goLogin">去登录</text>
        </view>
      </view>
    </wd-config-provider>
  </view>
</template>

<style lang="scss" scoped>
/* 与登录页同一套材质（玻璃卡 + 光晕 + 主题变量），只是字段多两个。
   刻意复制而不是抽组件：这两页的元素结构差异（字段数、底部链接）比共性大，
   抽出来会变成一堆 props 分支，反而更难读。 */
.reg-page {
  position: relative;
  display: flex;
  min-height: 100vh;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  @include scene-bg;
  padding: 56rpx 32rpx;
}

.reg-aurora {
  position: absolute;
  top: -300rpx;
  left: 50%;
  width: 920rpx;
  height: 920rpx;
  margin-left: -460rpx;
  border-radius: 50%;
  background: radial-gradient(circle, $ui-aurora-1 0%, $ui-aurora-2 42%, transparent 68%);
}

.reg-theme {
  position: absolute;
  top: 40rpx;
  right: 40rpx;
  z-index: 2;
}

.reg-shell {
  width: 100%;
  max-width: 720rpx;
}

.reg-card {
  position: relative;
  @include glass($radius: 44rpx);
  padding: 56rpx 44rpx;
}

.reg-brand {
  display: flex;
  align-items: center;
  gap: 22rpx;

  &__mark {
    display: flex;
    width: 88rpx;
    height: 88rpx;
    align-items: center;
    justify-content: center;
    border-radius: 26rpx;
    background: linear-gradient(135deg, $ui-accent, $ui-accent-2);
    color: $ui-on-accent;
    font-size: 24rpx;
    font-weight: 700;
    letter-spacing: 0.06em;
    box-shadow: 0 18rpx 36rpx -18rpx $ui-accent-glow;
  }

  &__text {
    display: flex;
    flex-direction: column;
  }
}

.reg-eyebrow {
  color: $ui-accent-text;
  font-size: 22rpx;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.reg-title {
  margin-top: 6rpx;
  color: $ui-text;
  font-size: 46rpx;
  font-weight: 700;
}

.reg-field {
  margin-top: 28rpx;
}

.reg-label {
  display: block;
  margin-bottom: 14rpx;
  color: $ui-text-2;
  font-size: 26rpx;
  font-weight: 500;
}

.reg-input {
  box-sizing: border-box;
  width: 100%;
  height: 96rpx;
  padding: 0 30rpx;
  border: 1px solid $ui-border;
  border-radius: $ui-radius-pill;
  background-color: $ui-surface-2;
  color: $ui-text;
  font-size: 28rpx;
  transition: border-color $ui-dur $ui-ease, background-color $ui-dur $ui-ease;

  &:focus,
  &.is-focus {
    border-color: $ui-accent;
    background-color: $ui-surface-3;
  }
}

.reg-placeholder {
  color: $ui-text-3;
}

.reg-captcha {
  margin-top: 28rpx;
}

.reg-error {
  display: block;
  margin-top: 24rpx;
  padding: 18rpx 26rpx;
  border: 1px solid $ui-danger-line;
  border-radius: $ui-radius-md;
  background-color: $ui-danger-soft;
  color: $ui-danger;
  font-size: 25rpx;
  line-height: 1.5;
}

.reg-submit {
  display: flex;
  width: 100%;
  height: 96rpx;
  align-items: center;
  justify-content: center;
  margin-top: 36rpx;
  @include pill-button($ui-text, $ui-on-light, 30rpx);
}

.reg-links {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  margin-top: 30rpx;

  &__label {
    color: $ui-text-3;
    font-size: 24rpx;
  }

  &__action {
    color: $ui-accent-text;
    font-size: 24rpx;
    font-weight: 600;
    text-decoration: underline;
  }
}
</style>
