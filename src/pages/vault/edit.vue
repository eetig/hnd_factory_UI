<template>
  <view class="ve" :class="themeClass" :style="[themeVars, frameStyle]" @touchstart="onEdgeStart" @touchend="onEdgeEnd">
    <PageTitle :title="editing ? '改这条' : '记一条'" />

    <view class="ve__body">
      <!-- 三个常用的，放最上面 -->
      <view class="ve__field">
        <text class="ve__label">叫什么</text>
        <input
          v-model="form.name"
          class="ve__input ve__input--big"
          placeholder="本地 MySQL"
          placeholder-class="ve__ph"
          :focus="autoFocus"
          @blur="autoFill"
        />
      </view>

      <view class="ve__field">
        <text class="ve__label">地址</text>
        <input
          v-model="addressRaw"
          class="ve__input"
          placeholder="127.0.0.1:3306"
          placeholder-class="ve__ph"
          @blur="autoFill"
        />
        <text class="ve__hint">主机和端口写一起，只写主机也行。类型和归属我按它猜好了。</text>
      </view>

      <view class="ve__field">
        <text class="ve__label">密码</text>
        <view class="ve__row">
          <input
            v-model="form.password"
            class="ve__input ve__input--mono"
            placeholder="直接写明文，不用藏着"
            placeholder-class="ve__ph"
          />
        </view>
        <text v-if="!form.password" class="ve__hint">没密码就空着，比如本机 Redis。</text>
      </view>

      <!-- 其余折起来，别一屏塞八个框 -->
      <view class="ve__more-toggle" @click="more = !more">
        <text class="ve__more-text">{{ more ? '收起' : '还有：用户名、分组、类型、备注' }}</text>
        <text class="ve__more-arrow" :class="{ 'is-open': more }">⌄</text>
      </view>

      <view v-if="more" class="ve__more">
        <view class="ve__field">
          <text class="ve__label">用户名</text>
          <input v-model="form.username" class="ve__input" placeholder="root" placeholder-class="ve__ph" />
        </view>

        <view class="ve__field">
          <text class="ve__label">归属（哪台机器）</text>
          <input
            v-model="form.group"
            class="ve__input"
            placeholder="公司 / 家里 / 云"
            placeholder-class="ve__ph"
            @input="typedGroup = true"
          />
          <view v-if="groupOptions.length" class="ve__chips">
            <text
              v-for="name in groupOptions"
              :key="name"
              class="ve__chip"
              :class="{ 'is-on': form.group === name }"
              @click="pickGroup(name)"
            >
              {{ name }}
            </text>
          </view>
        </view>

        <view class="ve__field">
          <text class="ve__label">类型</text>
          <view class="ve__chips">
            <text
              v-for="type in VAULT_TYPES"
              :key="type.key"
              class="ve__chip"
              :class="{ 'is-on': form.type === type.key }"
              @click="pickType(type)"
            >
              {{ type.label }}
            </text>
          </view>
        </view>

        <view class="ve__field">
          <text class="ve__label">备注</text>
          <textarea
            v-model="form.note"
            class="ve__area"
            placeholder="先记着：取自哪个文件、有没有实测过"
            placeholder-class="ve__ph"
            :maxlength="-1"
          />
        </view>
      </view>

      <view v-if="editing" class="ve__danger" @click="confirmDelete">删除这条</view>
    </view>

    <view class="ve__bottom">
      <view class="ve__save" @click="submit">存起来</view>
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
import {
  HOME_GROUPS,
  UNGROUPED,
  VAULT_TYPES,
  addressOf,
  defaultPortOf,
  findItem,
  inferGroup,
  inferType,
  listGroups,
  parseAddress,
  removeItem,
  saveItem,
} from '../../utils/vault'

const { themeClass, themeVars } = useTheme()
const { frameStyle } = usePageFrame()
const { onTouchStart: onEdgeStart, onTouchEnd: onEdgeEnd } = useEdgeSwipe(() => uni.navigateBack())

const form = ref({
  id: '',
  name: '',
  type: 'mysql',
  host: '',
  port: '',
  username: '',
  password: '',
  group: '',
  note: '',
})
const addressRaw = ref('')
const editId = ref('')
const more = ref(false)
const autoFocus = ref(false)

const editing = computed(() => !!editId.value)

/** 五个预设归属永远露在 chips 里：空库里也能一点就选中 */
const groupOptions = computed(() => {
  const mine = listGroups().filter((name) => name !== UNGROUPED)
  const extra = mine.filter((name) => !HOME_GROUPS.includes(name))
  return [...HOME_GROUPS, ...extra]
})

/** 用户自己动过类型/归属就不再自动猜，免得跟他抢方向盘 */
const typedType = ref(false)
const typedGroup = ref(false)

function pickGroup(name) {
  form.value.group = name
  typedGroup.value = true
}

/**
 * 名字或地址填完时自动补类型和归属。
 * 只补「还没填过」的，编辑已有条目不动它。
 */
function autoFill() {
  if (editing.value) return
  if (!typedType.value) form.value.type = inferType(addressRaw.value, form.value.name)
  if (!typedGroup.value && !form.value.group.trim()) {
    form.value.group = inferGroup(form.value.name, addressRaw.value)
  }
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

  const hit = findItem(id)
  if (!hit) {
    uni.showToast({ title: '这条已经不在了', icon: 'none' })
    setTimeout(() => uni.navigateBack(), 600)
    return
  }

  editId.value = id
  form.value = { ...hit }
  addressRaw.value = addressOf(hit)
  // 有备注或用户名，说明用户把这页当"完整表单"用过，进来就把更多展开
  more.value = !!(hit.username || hit.note)
})

/** 换类型时补端口：只在地址没写端口、或端口正好是上一个类型的默认值时才动 */
function pickType(type) {
  const previous = form.value.type
  const current = parseAddress(addressRaw.value)
  const shouldFill =
    !current.port || (previous !== type && current.port === defaultPortOf(previous) && !!defaultPortOf(type))
  if (shouldFill && defaultPortOf(type)) {
    addressRaw.value = `${current.host || form.value.host}:${defaultPortOf(type)}`
  }
  form.value.type = type.key
  typedType.value = true
}

function submit() {
  if (!editing.value) autoFill()
  const name = form.value.name.trim()
  if (!name) {
    uni.showToast({ title: '先给它起个名', icon: 'none' })
    return
  }

  const { host, port } = parseAddress(addressRaw.value)
  const payload = {
    ...form.value,
    id: editId.value || '',
    name,
    host: host || form.value.host,
    port: port || (addressRaw.value.includes(':') ? '' : form.value.port),
    group: form.value.group.trim(),
  }

  try {
    saveItem(payload)
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
      removeItem(editId.value)
      uni.showToast({ title: '删了', icon: 'none' })
      setTimeout(() => uni.navigateBack(), 300)
    },
  })
}
</script>

<style lang="scss" scoped>
.ve {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--ui-bg);
}

/* 用页面自身的滚动：安卓键盘 adjust-position 才对得上，底部条 fixed 不跟着抬 */
.ve__body {
  flex: 1;
  padding: 8rpx 28rpx 220rpx;
}

.ve__field {
  margin-top: 24rpx;
}

.ve__label {
  display: block;
  padding: 0 6rpx 10rpx;
  font-size: 24rpx;
  color: var(--ui-text-3);
}

.ve__input {
  height: 92rpx;
  padding: 0 24rpx;
  border-radius: 20rpx;
  font-size: 30rpx;
  color: var(--ui-text);
  background: var(--ui-surface);
  box-sizing: border-box;
}

.ve__input--big {
  font-size: 34rpx;
  font-weight: 600;
}

.ve__input--mono {
  letter-spacing: 0.02em;
}

.ve__ph {
  color: var(--ui-text-3);
  font-weight: 400;
}

.ve__row {
  display: flex;
  gap: 16rpx;
}

.ve__row .ve__input {
  flex: 1;
}

.ve__hint {
  display: block;
  padding: 10rpx 6rpx 0;
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.ve__more-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  margin-top: 40rpx;
  padding: 20rpx;
}

.ve__more-text {
  font-size: 25rpx;
  color: var(--ui-text-2);
}

.ve__more-arrow {
  font-size: 26rpx;
  color: var(--ui-text-3);
  transition: transform 0.16s ease;
}

.ve__more-arrow.is-open {
  transform: rotate(180deg);
}

.ve__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
  margin-top: 16rpx;
}

.ve__chip {
  padding: 12rpx 24rpx;
  border-radius: 999rpx;
  font-size: 25rpx;
  color: var(--ui-text-2);
  background: var(--ui-surface);
}

.ve__chip.is-on {
  color: var(--ui-accent);
  background: var(--ui-accent-soft);
}

.ve__area {
  width: 100%;
  height: 180rpx;
  padding: 20rpx 24rpx;
  border-radius: 20rpx;
  font-size: 26rpx;
  line-height: 1.6;
  color: var(--ui-text);
  background: var(--ui-surface);
  box-sizing: border-box;
}

.ve__danger {
  margin-top: 56rpx;
  text-align: center;
  font-size: 26rpx;
  color: var(--ui-danger);
}

.ve__bottom {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 16rpx 28rpx calc(16rpx + env(safe-area-inset-bottom));
  background: var(--ui-surface);
  box-shadow: 0 -6rpx 24rpx rgba(0, 0, 0, 0.06);
}

.ve__save {
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
