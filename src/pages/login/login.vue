<script setup>
import { ref } from 'vue'
import request from '../../api/request'
import { saveAuth } from '../../api/auth'
import ThemeToggle from '../../components/ThemeToggle.vue'
import { useTheme } from '../../composables/useTheme'

const username = ref('')
const password = ref('')
const loading = ref(false)
const errorMessage = ref('')

// 当前聚焦的输入框。小程序端 :focus 伪类不生效，
// 用「聚焦态类名」统一 H5 / App / 小程序三端的聚焦反馈。
const focusField = ref('')

// 主题：颜色本体是 App.vue 里的两组 CSS 变量，这里只取「当前是哪套」。
// 深色是默认值（写在 page 上），浅色靠给 .login-page 加 .theme-light。
const { themeClass, wotTheme, themeVars } = useTheme()

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
  <view class="login-page" :class="themeClass">
    <!-- 背景光晕：唯一的氛围层，纯 CSS 径向渐变，不额外引入图片资源。
         颜色按主题给（深色那支偏亮，浅色那支收敛），见 App.vue。 -->
    <view class="login-aurora" aria-hidden="true"></view>

    <!-- 主题切换：放在登录页右上角，未登录也能先选深浅色 -->
    <view class="login-theme">
      <ThemeToggle />
    </view>

    <!-- 主题由 wd-config-provider 统一接管（输入框、日期选择器等弹层都跟着变）。
         theme="light" 时它加的 wot-theme-light 没有样式 = wot 自己的浅色默认值。 -->
    <wd-config-provider :theme="wotTheme" :theme-vars="themeVars" custom-class="login-shell">
      <view class="login-card">
        <view class="login-brand">
          <view class="login-brand__mark">
            <text>HND</text>
          </view>
          <view class="login-brand__text">
            <text class="login-eyebrow">Factory Operations</text>
            <text class="login-title">登录</text>
          </view>
        </view>

        <text class="login-hint">登录后可录入工单、领料、入库，并使用图片识别辅助录入</text>

        <view class="login-field">
          <text class="login-label">账号</text>
          <input
            v-model="username"
            class="login-input"
            :class="{ 'is-focus': focusField === 'username' }"
            type="text"
            placeholder="请输入账号"
            placeholder-class="login-placeholder"
            @focus="focusField = 'username'"
            @blur="focusField = ''"
          />
        </view>

        <view class="login-field">
          <text class="login-label">密码</text>
          <input
            v-model="password"
            class="login-input"
            :class="{ 'is-focus': focusField === 'password' }"
            password
            placeholder="请输入密码"
            placeholder-class="login-placeholder"
            @focus="focusField = 'password'"
            @blur="focusField = ''"
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

        <text class="login-foot">未登录也可以浏览物料、周统计等查询页</text>
      </view>
    </wd-config-provider>
  </view>
</template>

<style lang="scss" scoped>
// 登录页的样式仍然用 SCSS 而不是 Tailwind：
// input / button 在各端的默认盒模型差异较大（小程序 button 自带边框与默认宽度），
// 用显式样式比用工具类逐个覆盖更稳，而这页总共也没几个元素。
//
// 场景：与首页同一套 @mixin scene-bg（深墨蓝夜景 + 柔光光斑 / 浅色轻量版）。
// 登录页额外保留 .login-aurora 那个大光斑 —— 登录卡片压在上面，需要一处focal 光源，
// 它的两个 token（--ui-aurora-1/2）已经跟着换成月光钢蓝 + 香槟金。
.login-page {
  position: relative;
  display: flex;
  min-height: 100vh;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  @include scene-bg;
  padding: 56rpx 32rpx;
}

.login-aurora {
  position: absolute;
  top: -300rpx;
  left: 50%;
  width: 920rpx;
  height: 920rpx;
  margin-left: -460rpx;
  border-radius: 50%;
  // 外圈用 transparent，不能写死深色底 —— 否则浅色主题下顶部压出一圈灰
  background: radial-gradient(circle, $ui-aurora-1 0%, $ui-aurora-2 42%, transparent 68%);
}

/* 主题切换按钮：贴在右上角。z-index 抬到极光之上，避免被半透明光晕糊住 */
.login-theme {
  position: absolute;
  top: 40rpx;
  right: 40rpx;
  z-index: 2;
}

// wd-config-provider 的根节点（custom-class 落在这里）
.login-shell {
  width: 100%;
  max-width: 720rpx;
}

.login-card {
  position: relative;
  /* 登录卡是这块夜景上最大的一块玻璃 —— 直接吃统一材质（膜 + 模糊 + 顶边受光/底边暗缘 + 描边） */
  @include glass($radius: 44rpx);
  padding: 56rpx 44rpx;
}

.login-brand {
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

.login-eyebrow {
  color: $ui-accent-text;
  font-size: 22rpx;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.login-title {
  margin-top: 6rpx;
  color: $ui-text;
  font-size: 46rpx;
  font-weight: 700;
}

.login-hint {
  display: block;
  margin: 28rpx 0 44rpx;
  color: $ui-text-3;
  font-size: 24rpx;
  line-height: 1.6;
}

.login-field {
  margin-bottom: 28rpx;
}

.login-label {
  display: block;
  margin-bottom: 14rpx;
  color: $ui-text-2;
  font-size: 26rpx;
  font-weight: 500;
}

.login-input {
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

  // H5 / App 端还能吃到原生 :focus，作为聚焦态的兜底；
  // 小程序端靠 @focus 事件切换的 .is-focus
  &:focus,
  &.is-focus {
    border-color: $ui-accent;
    background-color: $ui-surface-3;
  }
}

.login-placeholder {
  color: $ui-text-3;
}

.login-error {
  display: block;
  margin-bottom: 24rpx;
  padding: 18rpx 26rpx;
  border: 1px solid $ui-danger-line;
  border-radius: $ui-radius-md;
  background-color: $ui-danger-soft;
  color: $ui-danger;
  font-size: 25rpx;
  line-height: 1.5;
}

.login-submit {
  display: flex;
  width: 100%;
  height: 96rpx;
  align-items: center;
  justify-content: center;
  // mixin 放在最后一行：它内部有嵌套规则，声明写在它后面会触发 Sass 的
  // mixed-decls 警告（且未来版本会改变声明顺序）。字号通过参数传入。
  @include pill-button($ui-text, $ui-on-light, 30rpx);
}

.login-foot {
  display: block;
  margin-top: 32rpx;
  color: $ui-text-3;
  font-size: 23rpx;
  text-align: center;
}
</style>
