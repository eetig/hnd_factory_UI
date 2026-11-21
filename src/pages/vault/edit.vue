<script setup>
import { computed, reactive, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { isAdmin } from '../../api/auth'
import { useTheme } from '../../composables/useTheme'
import { usePageFrame } from '../../composables/usePageFrame'
import { useEdgeSwipe } from '../../composables/useEdgeSwipe'
import PageTitle from '../../components/PageTitle.vue'
import {
  UNGROUPED,
  VAULT_TYPES,
  defaultPortOf,
  findItem,
  listGroups,
  removeItem,
  saveItem,
} from '../../utils/vault'

/*
 * 密码箱 · 新增 / 编辑（2026-11-21）
 *
 * ## 为什么是独立整页，不做弹层
 * 七个字段里有一个多行备注，安卓键盘一弹，弹层要同时处理抬升、内滚、按钮被顶走三件事，
 * 本仓已经在别的功能上踩过这个坑。整页表单交给系统滚动，键盘和保存条各管各的。
 *
 * ## 为什么保存条压在底部、键盘弹出时会被盖住
 * 输入框有 `adjust-position`（默认开），键盘弹出时页面会上滚把输入框顶到键盘之上；
 * 底部这条 fixed 的保存条则被键盘完全盖住。看起来"少了个按钮"，但这是可预期的：
 * 正在打字时不该误触保存，收起键盘就能点。强行用键盘高度去抬它，会和系统滚动叠成两层位移，
 * 光标和按钮一起跳，比盖住难用。
 *
 * ## 分组是自由输入 + 点现成的
 * 输入框直接打新名字就是建组（存的时候 rememberGroup 会记住顺序），
 * 下面把已有的组列成一排：老用户改一条时不用回忆上次怎么写的。
 */
const { themeClass, themeVars } = useTheme()
const { frameStyle } = usePageFrame()
const { onTouchStart: onEdgeStart, onTouchEnd: onEdgeEnd } = useEdgeSwipe(() => uni.navigateBack())

const editingId = ref('')
const showPassword = ref(false)
/** 上一次选中的类型，用来判断端口是不是"系统帮填的"，是就跟着换 */
const lastType = ref('mysql')

const form = reactive({
  name: '',
  type: 'mysql',
  host: '',
  port: defaultPortOf('mysql'),
  username: '',
  password: '',
  group: '',
  note: '',
})

const isEdit = computed(() => !!editingId.value)
const groupOptions = computed(() => listGroups().filter((name) => name !== UNGROUPED))

onLoad((options) => {
  if (!isAdmin()) {
    uni.showToast({ title: '只有管理员能改', icon: 'none' })
    setTimeout(() => uni.navigateBack(), 600)
    return
  }

  const id = options?.id
  if (!id) return

  const found = findItem(id)
  if (!found) {
    // 备份恢复时被合并掉了、或另一处已经删了：不能停在一张空表单上假装在改
    uni.showToast({ title: '这条已经不在了', icon: 'none' })
    setTimeout(() => uni.navigateBack(), 600)
    return
  }

  editingId.value = found.id
  lastType.value = found.type
  form.name = found.name
  form.type = found.type
  form.host = found.host
  form.port = found.port
  form.username = found.username
  form.password = found.password
  // 「未分组」不写进输入框，留空才是"没选组"
  form.group = found.group === UNGROUPED ? '' : found.group
  form.note = found.note
})

/**
 * 换类型时顺手把端口改成这种服务的默认端口。
 *
 * 只在「端口还是空的」或「端口仍是上一个类型的默认值」时覆盖 —— 用户手填的 3307、
 * 或者干脆清空不要端口，都不该被他随手点了一下类型就冲掉。
 */
function pickType(type) {
  const prevDefault = defaultPortOf(lastType.value)
  const nextDefault = defaultPortOf(type.key)
  const untouched = !form.port || form.port === prevDefault
  form.type = type.key
  lastType.value = type.key
  if (untouched) form.port = nextDefault
}

function submit() {
  if (!form.name.trim()) {
    uni.showToast({ title: '先给它起个名字', icon: 'none' })
    return
  }

  try {
    saveItem({
      id: editingId.value,
      name: form.name,
      type: form.type,
      host: form.host,
      port: form.port,
      username: form.username,
      password: form.password,
      group: form.group,
      note: form.note,
    })
  } catch (e) {
    uni.showToast({ title: e?.message || '保存失败', icon: 'none' })
    return
  }

  uni.showToast({ title: isEdit.value ? '改好了' : '记下了', icon: 'none' })
  setTimeout(() => uni.navigateBack(), 300)
}

function goBack() {
  uni.navigateBack()
}

function confirmDelete() {
  uni.showModal({
    title: '删除这条？',
    content: '删掉之后就只剩备份里那一份了，这里恢复不回来。',
    confirmText: '删除',
    confirmColor: '#D14343',
    success: (res) => {
      if (!res.confirm) return
      removeItem(editingId.value)
      uni.showToast({ title: '删了', icon: 'none' })
      setTimeout(() => uni.navigateBack(), 300)
    },
  })
}
</script>

<template>
  <view
    class="ed"
    :class="themeClass"
    :style="[themeVars, frameStyle]"
    @touchstart="onEdgeStart"
    @touchend="onEdgeEnd"
  >
    <PageTitle :title="isEdit ? '改一条' : '记一条'" />

    <view class="ed__body">
      <view class="ed__card">
        <view class="ed__row">
          <text class="ed__label">名称</text>
          <input
            v-model="form.name"
            class="ed__input"
            type="text"
            maxlength="40"
            placeholder="公司 MySQL 主库"
            placeholder-class="ed__ph"
          />
        </view>

        <view class="ed__row ed__row--block">
          <text class="ed__label">类型</text>
          <view class="ed__chips">
            <view
              v-for="type in VAULT_TYPES"
              :key="type.key"
              class="ed__chip"
              :class="{ 'is-on': form.type === type.key }"
              @click="pickType(type)"
            >
              {{ type.label }}
            </view>
          </view>
        </view>

        <view class="ed__row">
          <text class="ed__label">地址</text>
          <view class="ed__pair">
            <input
              v-model="form.host"
              class="ed__input ed__input--grow"
              type="text"
              placeholder="IP 或域名，可留空"
              placeholder-class="ed__ph"
            />
            <input
              v-model="form.port"
              class="ed__input ed__input--port"
              type="number"
              maxlength="5"
              placeholder="端口"
              placeholder-class="ed__ph"
            />
          </view>
        </view>

        <view class="ed__row">
          <text class="ed__label">用户名</text>
          <input
            v-model="form.username"
            class="ed__input"
            type="text"
            placeholder="root"
            placeholder-class="ed__ph"
          />
        </view>

        <view class="ed__row">
          <text class="ed__label">密码</text>
          <view class="ed__pair">
            <input
              v-model="form.password"
              class="ed__input ed__input--grow"
              :password="!showPassword"
              type="text"
              placeholder="可以留空，比如免密登录"
              placeholder-class="ed__ph"
            />
            <text class="ed__eye" @click="showPassword = !showPassword">
              {{ showPassword ? '隐藏' : '显示' }}
            </text>
          </view>
        </view>
      </view>

      <view class="ed__card">
        <view class="ed__row">
          <text class="ed__label">分组</text>
          <input
            v-model="form.group"
            class="ed__input"
            type="text"
            maxlength="20"
            placeholder="公司电脑 / 腾讯云 / 家里服务器"
            placeholder-class="ed__ph"
          />
        </view>

        <view v-if="groupOptions.length" class="ed__row ed__row--sub">
          <view class="ed__chips">
            <view
              v-for="name in groupOptions"
              :key="name"
              class="ed__chip ed__chip--sm"
              :class="{ 'is-on': form.group.trim() === name }"
              @click="form.group = name"
            >
              {{ name }}
            </view>
          </view>
        </view>

        <view class="ed__row ed__row--block">
          <text class="ed__label">备注</text>
          <textarea
            v-model="form.note"
            class="ed__area"
            auto-height
            :maxlength="-1"
            placeholder="私钥、跳板机、注意事项都写这儿"
            placeholder-class="ed__ph"
          />
        </view>
      </view>

      <view v-if="isEdit" class="ed__danger" @click="confirmDelete">删除这条</view>

      <text class="ed__hint">
        只存在这台手机里，不上传服务器。换手机或重装前，回列表页点右上「备份」导出一份。
      </text>
    </view>

    <view class="ed__foot">
      <view class="ed__cancel" @click="goBack">取消</view>
      <view class="ed__save" @click="submit">保存</view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ed {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  box-sizing: border-box;
  background-color: var(--ui-bg);
}

/* 底部保存条是 fixed 的，内容区得给它让出位置，否则最后一行永远压在按钮下面 */
.ed__body {
  flex: 1;
  padding: 0 20rpx calc(180rpx + env(safe-area-inset-bottom));
}

.ed__card {
  margin-bottom: 20rpx;
  padding: 4rpx 24rpx;
  border-radius: 22rpx;
  background-color: var(--ui-surface);
}

.ed__row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  min-height: 96rpx;
  border-bottom: 2rpx solid var(--ui-border);
}

.ed__card .ed__row:last-child {
  border-bottom: none;
}

/* 类型和备注要占满整行：标签在上，控件在下 */
.ed__row--block {
  display: block;
  padding: 22rpx 0;
}

.ed__row--block .ed__label {
  display: block;
  margin-bottom: 14rpx;
}

/* 已有分组那一行：没有标签，只借右边距对齐上面的输入框 */
.ed__row--sub {
  display: block;
  padding: 18rpx 0;
}

.ed__label {
  flex-shrink: 0;
  width: 96rpx;
  font-size: 26rpx;
  color: var(--ui-text-3);
}

.ed__input {
  flex: 1;
  height: 92rpx;
  font-size: 28rpx;
  color: var(--ui-text);
}

.ed__input--grow {
  flex: 1;
  min-width: 0;
}

.ed__input--port {
  flex: none;
  width: 130rpx;
  text-align: right;
}

.ed__pair {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 16rpx;
  min-width: 0;
}

.ed__ph {
  font-size: 26rpx;
  color: var(--ui-text-3);
}

.ed__eye {
  flex-shrink: 0;
  padding: 10rpx 16rpx;
  border-radius: 12rpx;
  font-size: 24rpx;
  color: var(--ui-accent-text);
  background-color: var(--ui-accent-soft);
}

.ed__area {
  width: 100%;
  min-height: 150rpx;
  font-size: 28rpx;
  line-height: 1.6;
  color: var(--ui-text);
}

/* ---------- 类型 / 分组 chip ---------- */
.ed__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.ed__chip {
  padding: 12rpx 24rpx;
  border-radius: 14rpx;
  font-size: 24rpx;
  color: var(--ui-text-2);
  background-color: var(--ui-raise);
}

.ed__chip.is-on {
  color: var(--ui-on-accent);
  background-color: var(--ui-accent);
}

.ed__chip--sm {
  padding: 10rpx 20rpx;
  font-size: 23rpx;
}

/* ---------- 删除 ---------- */
.ed__danger {
  margin-bottom: 20rpx;
  padding: 26rpx;
  border-radius: 22rpx;
  font-size: 27rpx;
  text-align: center;
  color: var(--ui-danger);
  background-color: var(--ui-surface);
}

.ed__hint {
  display: block;
  padding: 4rpx 8rpx 0;
  font-size: 23rpx;
  line-height: 1.7;
  color: var(--ui-text-3);
}

/* ---------- 底部保存条 ---------- */
.ed__foot {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  gap: 16rpx;
  padding: 16rpx 20rpx calc(16rpx + env(safe-area-inset-bottom));
  border-top: 2rpx solid var(--ui-border);
  background-color: var(--ui-surface);
}

.ed__cancel {
  flex: none;
  width: 180rpx;
  height: 92rpx;
  border-radius: 18rpx;
  font-size: 28rpx;
  line-height: 92rpx;
  text-align: center;
  color: var(--ui-text-2);
  background-color: var(--ui-raise);
}

.ed__save {
  flex: 1;
  height: 92rpx;
  border-radius: 18rpx;
  font-size: 30rpx;
  font-weight: 600;
  line-height: 92rpx;
  text-align: center;
  color: var(--ui-on-accent);
  background-color: var(--ui-accent);
}
</style>
