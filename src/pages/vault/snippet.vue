<template>
  <view class="se" :class="themeClass" :style="[themeVars, frameStyle]" @touchstart="onEdgeStart" @touchend="onEdgeEnd">
    <PageTitle :title="editing ? '改这条' : '记一条'" />

    <view class="se__body">
      <view class="se__field">
        <text class="se__label">叫什么</text>
        <input
          v-model="form.name"
          class="se__input se__input--big"
          placeholder="密码箱"
          placeholder-class="se__ph"
          :focus="autoFocus"
        />
      </view>

      <view class="se__field">
        <text class="se__label">一句话说明</text>
        <input
          v-model="form.desc"
          class="se__input"
          placeholder="装了以后能干什么"
          placeholder-class="se__ph"
        />
      </view>

      <view class="se__field">
        <text class="se__label">要粘贴给 DSH 的那段话</text>
        <textarea
          v-model="form.text"
          class="se__area"
          placeholder="帮我装「XX」：读 https://… 并照它做。装完…"
          placeholder-class="se__ph"
          :maxlength="-1"
        />
        <text class="se__hint">换电脑时点一下这条就复制这段，粘给那边的 DSH 就行。</text>
      </view>

      <!-- 和密码那边同一套记事习惯：什么时候、谁、在哪、干嘛用 -->
      <view class="se__quad">
        <view class="se__field">
          <text class="se__label">时间</text>
          <picker mode="date" :value="form.at || todayText" @change="onAtChange">
            <view class="se__input se__picker">
              <text :class="form.at ? 'se__picker-val' : 'se__ph-text'">{{ form.at || todayText }}</text>
              <text class="se__picker-arrow">⌄</text>
            </view>
          </picker>
        </view>

        <view class="se__field">
          <text class="se__label">人物</text>
          <input v-model="form.actor" class="se__input" placeholder="谁记的 / 谁在用" placeholder-class="se__ph" />
          <view class="se__chips">
            <text
              v-for="name in ACTOR_HINTS"
              :key="name"
              class="se__chip"
              :class="{ 'is-on': form.actor === name }"
              @click="form.actor = name"
            >
              {{ name }}
            </text>
          </view>
        </view>

        <view class="se__field">
          <text class="se__label">地点（哪台机器）</text>
          <input v-model="form.place" class="se__input" placeholder="公司 / 家里 / 云" placeholder-class="se__ph" />
        </view>

        <view class="se__field">
          <text class="se__label">事件（干嘛用）</text>
          <input v-model="form.event" class="se__input" placeholder="装工具 / 换电脑 / 演示" placeholder-class="se__ph" />
          <view class="se__chips">
            <text
              v-for="name in EVENT_HINTS"
              :key="name"
              class="se__chip"
              :class="{ 'is-on': form.event === name }"
              @click="form.event = name"
            >
              {{ name }}
            </text>
          </view>
        </view>
      </view>

      <view v-if="editing" class="se__danger" @click="confirmDelete">删掉这条</view>
    </view>

    <view class="se__bottom">
      <view class="se__save" @click="submit">存起来</view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import PageTitle from '../../components/PageTitle.vue'
import { useTheme } from '../../composables/useTheme'
import { usePageFrame } from '../../composables/usePageFrame'
import { useEdgeSwipe } from '../../composables/useEdgeSwipe'
import { isAdmin } from '../../api/auth'
import { findSnippet, removeSnippet, saveSnippet } from '../../utils/vault'

const { themeClass, themeVars } = useTheme()
const { frameStyle } = usePageFrame()
const { onTouchStart: onEdgeStart, onTouchEnd: onEdgeEnd } = useEdgeSwipe(() => uni.navigateBack())

const form = ref({ id: '', name: '', desc: '', text: '', at: '', actor: '', place: '', event: '' })
const editId = ref('')
const autoFocus = ref(false)
const editing = computed(() => !!editId.value)

const ACTOR_HINTS = ['我', '小D@公司电脑']
const EVENT_HINTS = ['装工具', '换电脑', '生产运维', '演示']
const todayText = new Date().toISOString().slice(0, 10)

function onAtChange(event) {
  form.value.at = String((event && event.detail && event.detail.value) || '')
}

onLoad((options = {}) => {
  if (!isAdmin()) {
    uni.showToast({ title: '只有管理员能改', icon: 'none' })
    setTimeout(() => uni.navigateBack(), 600)
    return
  }

  const id = options.id ? decodeURIComponent(options.id) : ''
  if (!id) {
    autoFocus.value = true
    return
  }

  const hit = findSnippet(id)
  if (!hit) {
    uni.showToast({ title: '这条已经不在了', icon: 'none' })
    setTimeout(() => uni.navigateBack(), 600)
    return
  }

  editId.value = id
  form.value = {
    id: hit.id,
    name: hit.name,
    desc: hit.desc,
    text: hit.text,
    at: hit.at || '',
    actor: hit.actor || '',
    place: hit.place || '',
    event: hit.event || '',
  }
})

function submit() {
  try {
    saveSnippet({
      ...form.value,
      id: editId.value || '',
      at: form.value.at || todayText,
    })
  } catch (err) {
    uni.showToast({ title: (err && err.message) || '存不进去', icon: 'none' })
    return
  }
  uni.showToast({ title: editing.value ? '改好了' : '记下了', icon: 'none' })
  setTimeout(() => uni.navigateBack(), 300)
}

function confirmDelete() {
  uni.showModal({
    title: '删掉这条？',
    content: '删了就没了，电脑那边同步下来也会跟着没。',
    confirmText: '删',
    confirmColor: '#D14343',
    success: ({ confirm }) => {
      if (!confirm) return
      removeSnippet(editId.value)
      uni.showToast({ title: '删了', icon: 'none' })
      setTimeout(() => uni.navigateBack(), 300)
    },
  })
}
</script>

<style lang="scss" scoped>
.se {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--ui-bg);
}

.se__body {
  flex: 1;
  padding: 8rpx 28rpx 220rpx;
}

.se__field {
  margin-top: 24rpx;
}

.se__label {
  display: block;
  padding: 0 6rpx 10rpx;
  font-size: 24rpx;
  color: var(--ui-text-3);
}

.se__input {
  height: 92rpx;
  padding: 0 24rpx;
  border-radius: 20rpx;
  font-size: 30rpx;
  color: var(--ui-text);
  background: var(--ui-surface);
  box-sizing: border-box;
}

.se__input--big {
  font-size: 34rpx;
  font-weight: 600;
}

.se__ph {
  color: var(--ui-text-3);
  font-weight: 400;
}

.se__area {
  width: 100%;
  height: 320rpx;
  padding: 20rpx 24rpx;
  border-radius: 20rpx;
  font-size: 25rpx;
  line-height: 1.7;
  color: var(--ui-text);
  background: var(--ui-surface);
  box-sizing: border-box;
}

.se__hint {
  display: block;
  padding: 10rpx 6rpx 0;
  font-size: 22rpx;
  line-height: 1.6;
  color: var(--ui-text-3);
}

/* 记事四样：跟密码那张表单一模一样的位置和厚度 */
.se__quad {
  margin-top: 32rpx;
  padding: 4rpx 20rpx 20rpx;
  border-radius: 24rpx;
  background: var(--ui-raise);
}

.se__quad .se__field {
  margin-top: 20rpx;
}

.se__picker {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.se__picker-val {
  font-size: 30rpx;
  color: var(--ui-text);
}

.se__ph-text {
  font-size: 30rpx;
  color: var(--ui-text-3);
  font-weight: 400;
}

.se__picker-arrow {
  font-size: 26rpx;
  color: var(--ui-text-3);
}

.se__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
  margin-top: 16rpx;
}

.se__chip {
  padding: 12rpx 24rpx;
  border-radius: 999rpx;
  font-size: 25rpx;
  color: var(--ui-text-2);
  background: var(--ui-surface);
}

.se__chip.is-on {
  color: var(--ui-accent);
  background: var(--ui-accent-soft);
}

.se__danger {
  margin-top: 56rpx;
  text-align: center;
  font-size: 26rpx;
  color: var(--ui-danger);
}

.se__bottom {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 16rpx 28rpx calc(16rpx + env(safe-area-inset-bottom));
  background: var(--ui-surface);
  box-shadow: 0 -6rpx 24rpx rgba(0, 0, 0, 0.06);
}

.se__save {
  height: 96rpx;
  line-height: 96rpx;
  text-align: center;
  border-radius: 24rpx;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ui-on-accent);
  background: var(--ui-accent);
}
</style>
