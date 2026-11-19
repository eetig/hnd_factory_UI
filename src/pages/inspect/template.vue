<template>
  <view class="tpl" :class="themeClass" :style="[themeVars, frameStyle]" @touchstart="onEdgeStart"
    @touchend="onEdgeEnd">
    <PageTitle :title="isNew ? '新建清单' : '编辑清单'" />

    <scroll-view class="tpl__body" :scroll-y="true">
      <view class="tpl__card">
        <text class="tpl__label">清单名称</text>
        <input class="tpl__input" v-model="form.name" maxlength="40" placeholder="比如：车间日常巡检"
          placeholder-class="tpl__ph" />
      </view>

      <view class="tpl__card">
        <text class="tpl__label">巡检类型</text>
        <view class="tpl__kinds">
          <text class="tpl__kind" :class="{ 'tpl__kind--on': form.kind === 'shop' }" @click="form.kind = 'shop'">车间</text>
          <text class="tpl__kind" :class="{ 'tpl__kind--on': form.kind === 'pump' }" @click="form.kind = 'pump'">消防泵房</text>
        </view>
        <text class="tpl__tip">只用来分组显示，不影响检查内容。</text>
      </view>

      <view class="tpl__card">
        <view class="tpl__items-head">
          <text class="tpl__label">检查项（{{ form.items.length }}）</text>
          <text class="tpl__add" @click="addItem">＋ 加一项</text>
        </view>

        <view v-if="!form.items.length" class="tpl__empty">
          <text class="tpl__empty-text">还没写检查项，点右上「＋ 加一项」</text>
        </view>

        <view v-for="(item, index) in form.items" :key="index" class="tpl__item">
          <view class="tpl__item-head">
            <text class="tpl__item-no">{{ index + 1 }}</text>
            <view class="tpl__item-ops">
              <text class="tpl__op" :class="{ 'tpl__op--off': index === 0 }" @click="move(index, -1)">上移</text>
              <text class="tpl__op" :class="{ 'tpl__op--off': index === form.items.length - 1 }"
                @click="move(index, 1)">下移</text>
              <text class="tpl__op tpl__op--del" @click="removeItem(index)">删除</text>
            </view>
          </view>
          <input class="tpl__input tpl__input--sm" v-model="item.title" maxlength="60"
            placeholder="检查什么（必填）" placeholder-class="tpl__ph" />
          <input class="tpl__input tpl__input--sm" v-model="item.hint" maxlength="120"
            placeholder="怎么看才算正常（选填）" placeholder-class="tpl__ph" />
        </view>
      </view>

      <view class="tpl__bottom-space"></view>
    </scroll-view>

    <view class="tpl__bar">
      <text v-if="!isNew" class="tpl__del" @click="removeTemplate">删除清单</text>
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
const form = ref({ name: '', kind: 'shop', items: [{ title: '', hint: '' }] })

const isNew = computed(() => !editingId.value)

function addItem() {
  form.value.items.push({ title: '', hint: '' })
}

function removeItem(index) {
  form.value.items.splice(index, 1)
  if (!form.value.items.length) addItem()
}

function move(index, step) {
  const list = form.value.items
  const target = index + step
  if (target < 0 || target >= list.length) return
  const [one] = list.splice(index, 1)
  list.splice(target, 0, one)
}

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
      items: (Array.isArray(data.items) ? data.items : []).map((one) => ({
        title: one.title || '',
        hint: one.hint || '',
      })),
    }
    if (!form.value.items.length) addItem()
  } catch (error) {
    toast(errorText(error, '清单没取到'))
  } finally {
    booting.value = false
  }
}

async function save() {
  if (saving.value) return
  const name = String(form.value.name || '').trim()
  if (!name) {
    toast('给清单起个名')
    return
  }
  const items = form.value.items
    .map((one) => ({ title: String(one.title || '').trim(), hint: String(one.hint || '').trim() }))
    .filter((one) => one.title)
  if (!items.length) {
    toast('至少写一个检查项')
    return
  }

  saving.value = true
  try {
    const payload = { name, kind: form.value.kind, items }
    const res = editingId.value
      ? await updateTemplate(editingId.value, payload)
      : await createTemplate(payload)
    const body = (res && res.data) || {}
    if (body.code !== 200) throw new Error(body.msg || '没保存上')
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
    title: '删掉这份清单？',
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

.tpl__input {
  width: 100%;
  margin-top: 14rpx;
  padding: 18rpx 18rpx;
  border-radius: 14rpx;
  background: var(--ui-raise-2);
  font-size: 28rpx;
  color: var(--ui-text);
  box-sizing: border-box;
}

.tpl__input--sm {
  margin-top: 12rpx;
  font-size: 26rpx;
  padding: 15rpx 18rpx;
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
  padding: 14rpx 32rpx;
  border-radius: 999rpx;
  font-size: 26rpx;
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

.tpl__items-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tpl__add {
  font-size: 25rpx;
  color: var(--ui-accent);
  padding: 6rpx 0;
}

.tpl__empty {
  padding: 40rpx 0 20rpx;
  text-align: center;
}

.tpl__empty-text {
  font-size: 24rpx;
  color: var(--ui-text-3);
}

.tpl__item {
  margin-top: 18rpx;
  padding: 16rpx 16rpx 18rpx;
  border-radius: 14rpx;
  background: var(--ui-raise-2);
}

.tpl__item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tpl__item-no {
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.tpl__item-ops {
  display: flex;
  gap: 16rpx;
}

.tpl__op {
  font-size: 22rpx;
  color: var(--ui-text-2);
  padding: 4rpx 0;
}

.tpl__op--off {
  color: var(--ui-text-3);
  opacity: 0.4;
}

.tpl__op--del {
  color: var(--ui-amber-800);
}

.tpl__item .tpl__input {
  background: var(--ui-surface);
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
