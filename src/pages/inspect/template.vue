<template>
  <view class="tpl" :class="themeClass" :style="[themeVars, frameStyle]" @touchstart="onEdgeStart"
    @touchend="onEdgeEnd">
    <PageTitle :title="isNew ? '新建清单' : '编辑清单'" />

    <scroll-view class="tpl__body" :scroll-y="true">
      <view class="tpl__card">
        <text class="tpl__label">清单名称</text>
        <input class="tpl__input" v-model="form.name" maxlength="40" placeholder="比如：车间日常巡检"
          placeholder-class="tpl__ph" />

        <view class="tpl__kinds">
          <text class="tpl__kind" :class="{ 'tpl__kind--on': form.kind === 'shop' }" @click="form.kind = 'shop'">车间</text>
          <text class="tpl__kind" :class="{ 'tpl__kind--on': form.kind === 'pump' }"
            @click="form.kind = 'pump'">消防泵房</text>
        </view>
        <text class="tpl__tip">只用来分组显示，不影响正文。</text>
      </view>

      <view class="tpl__card">
        <view class="tpl__body-head">
          <text class="tpl__label">正文</text>
          <text class="tpl__count">{{ charCount }} 字</text>
        </view>

        <textarea class="tpl__essay" v-model="form.body" maxlength="20000"
          placeholder="把写好的检查内容整篇贴进来。换行就是分段，一、二、这种序号会显示成小标题。"
          placeholder-class="tpl__ph" />

        <view class="tpl__body-ops">
          <text class="tpl__act" @click="pasteFromClipboard">从剪贴板粘贴</text>
          <text class="tpl__act tpl__act--mute" @click="clearBody">清空</text>
        </view>
      </view>

      <view class="tpl__bottom-space"></view>
    </scroll-view>

    <view class="tpl__bar">
      <text v-if="!isNew" class="tpl__del" @click="removeTemplate">删除</text>
      <view class="tpl__bar-right">
        <text class="tpl__ghost" @click="goBack">取消</text>
        <button class="tpl__save" :class="{ 'tpl__save--busy': saving }" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </view>
    </view>

    <LoadingMask v-if="booting" />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onBackPress, onLoad } from '@dcloudio/uni-app'
import { handleGlobalBack } from '../../utils/popupStack'

import { createTemplate, deleteTemplate, getTemplate, updateTemplate } from '../../api/inspect'
import { useTheme } from '../../composables/useTheme'
import LoadingMask from '../../components/LoadingMask.vue'
import PageTitle from '../../components/PageTitle.vue'
import { usePageFrame } from '../../composables/usePageFrame'
import { useEdgeSwipe } from '../../composables/useEdgeSwipe'

const { themeClass, themeVars } = useTheme()
const { frameStyle } = usePageFrame()
const { onTouchStart: onEdgeStart, onTouchEnd: onEdgeEnd } = useEdgeSwipe(() => goBack())

const editingId = ref(0)
const booting = ref(false)
const saving = ref(false)
const form = ref({ name: '', kind: 'shop', body: '' })

const isNew = computed(() => !editingId.value)
const charCount = computed(() => String(form.value.body || '').replace(/\s/g, '').length)

async function loadTemplate(templateId) {
  booting.value = true
  try {
    const res = await getTemplate(templateId)
    const body = (res && res.data) || {}
    if (body.code !== 200) throw new Error(body.msg || '清单没取到')
    const data = body.data || {}
    editingId.value = data.id || 0
    form.value = {
      name: data.name || '',
      kind: data.kind || 'shop',
      body: data.body || '',
    }
  } catch (error) {
    toast(errorText(error, '清单没取到'))
  } finally {
    booting.value = false
  }
}

/* 稿子本来就在别处写着：粘贴是主路径，手打是兜底 */
function pasteFromClipboard() {
  uni.getClipboardData({
    success: (res) => {
      const text = String((res && res.data) || '')
      if (!text.trim()) {
        toast('剪贴板里没有文字')
        return
      }
      if (!form.value.body.trim()) {
        form.value.body = text
        toast('已粘贴')
        return
      }
      uni.showModal({
        title: '当前正文已经有内容',
        content: '剪贴板里这段文字，替换掉现有正文，还是接在后面？',
        confirmText: '替换',
        cancelText: '接在后面',
        success: (modal) => {
          if (modal.confirm) form.value.body = text
          else form.value.body = form.value.body + '\n\n' + text
        },
      })
    },
    fail: () => toast('读不到剪贴板'),
  })
}

function clearBody() {
  if (!form.value.body.trim()) return
  uni.showModal({
    title: '清空正文？',
    content: '清空后可以再粘贴或重新写。',
    confirmText: '清空',
    success: (res) => {
      if (res.confirm) form.value.body = ''
    },
  })
}

async function save() {
  if (saving.value) return
  const name = String(form.value.name || '').trim()
  if (!name) {
    toast('给这篇清单起个名')
    return
  }
  const body = String(form.value.body || '').trim()
  if (!body) {
    toast('正文还是空的，把检查内容贴进去')
    return
  }

  saving.value = true
  try {
    const payload = { name, kind: form.value.kind, body }
    const res = editingId.value
      ? await updateTemplate(editingId.value, payload)
      : await createTemplate(payload)
    const data = (res && res.data) || {}
    if (data.code !== 200) throw new Error(data.msg || '没保存上')
    toast('清单已保存')
    setTimeout(() => uni.navigateBack(), 500)
  } catch (error) {
    toast(errorText(error, '没保存上'))
  } finally {
    saving.value = false
  }
}

function removeTemplate() {
  if (!editingId.value) return
  uni.showModal({
    title: '删掉这篇清单？',
    content: '删了以后不能再照着它巡检；已经做过的巡检记录还在。',
    confirmText: '删掉',
    success: async (res) => {
      if (!res.confirm) return
      try {
        const resp = await deleteTemplate(editingId.value)
        const body = (resp && resp.data) || {}
        if (body.code !== 200) throw new Error(body.msg || '没删掉')
        toast('已删除')
        setTimeout(() => uni.navigateBack(), 500)
      } catch (error) {
        toast(errorText(error, '没删掉'))
      }
    },
  })
}

function goBack() {
  uni.navigateBack()
}

function errorText(error, fallback) {
  return error?.body?.msg || error?.data?.msg || error?.message || fallback
}

function toast(title) {
  uni.showToast({ title, icon: 'none' })
}

onLoad((options) => {
  const templateId = Number((options && options.id) || 0)
  if (templateId) loadTemplate(templateId)
})

onBackPress(() => handleGlobalBack() !== 'root')
</script>

<style lang="scss" scoped>
.tpl {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--ui-scene-bg);
}

.tpl__body {
  flex: 1;
  min-height: 0;
  padding: 10rpx 20rpx 0;
}

.tpl__card {
  margin-top: 14rpx;
  padding: 22rpx;
  border-radius: 18rpx;
  background: var(--ui-surface);
}

.tpl__label {
  font-size: 24rpx;
  color: var(--ui-text-3);
}

/* 原生 input 必须给死高度：只写 padding 的话 App 端行高算不出来，
   文字会被裁成一条（清单名称看不见就是这么来的） */
.tpl__input {
  width: 100%;
  height: 92rpx;
  margin-top: 14rpx;
  padding: 0 22rpx;
  border-radius: 14rpx;
  background: var(--ui-raise-2);
  font-size: 28rpx;
  color: var(--ui-text);
  box-sizing: border-box;
}

.tpl__ph {
  color: var(--ui-text-3);
}

.tpl__kinds {
  display: flex;
  gap: 14rpx;
  margin-top: 16rpx;
}

.tpl__kind {
  padding: 13rpx 30rpx;
  border-radius: 999rpx;
  font-size: 25rpx;
  color: var(--ui-text-2);
  background: var(--ui-raise-2);
}

.tpl__kind--on {
  color: var(--ui-on-accent);
  background: var(--ui-accent);
  font-weight: 600;
}

.tpl__tip {
  display: block;
  margin-top: 14rpx;
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.tpl__body-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.tpl__count {
  font-size: 22rpx;
  color: var(--ui-text-3);
}

/* 正文编辑区：够高才像在写一段话，而不是填一条表单 */
.tpl__essay {
  width: 100%;
  height: 52vh;
  margin-top: 14rpx;
  padding: 18rpx;
  border-radius: 14rpx;
  background: var(--ui-raise-2);
  font-size: 27rpx;
  color: var(--ui-text);
  line-height: 1.8;
  box-sizing: border-box;
}

.tpl__body-ops {
  display: flex;
  align-items: center;
  gap: 26rpx;
  margin-top: 16rpx;
}

.tpl__act {
  font-size: 25rpx;
  color: var(--ui-accent);
  padding: 6rpx 0;
}

.tpl__act--mute {
  color: var(--ui-text-3);
}

.tpl__bottom-space {
  height: 50rpx;
}

.tpl__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 16rpx 24rpx calc(16rpx + env(safe-area-inset-bottom));
  background: var(--ui-surface);
}

.tpl__del {
  font-size: 25rpx;
  color: var(--ui-amber-800);
  padding: 10rpx 4rpx;
}

.tpl__bar-right {
  display: flex;
  align-items: center;
  gap: 18rpx;
}

.tpl__ghost {
  padding: 0 24rpx;
  height: 80rpx;
  line-height: 80rpx;
  border-radius: 999rpx;
  font-size: 27rpx;
  color: var(--ui-text-2);
  background: var(--ui-raise-2);
}

.tpl__save {
  margin: 0;
  padding: 0 42rpx;
  height: 84rpx;
  line-height: 84rpx;
  border-radius: 999rpx;
  font-size: 28rpx;
  color: var(--ui-on-accent);
  background: var(--ui-accent);
  border: none;
}

.tpl__save--busy {
  opacity: 0.6;
}
</style>
