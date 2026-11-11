<script setup>
import { onMounted, ref } from 'vue'
import { ElButton, ElCheckbox, ElDialog, ElOption, ElSelect, ElSlider } from 'element-plus'
import { IS_DESKTOP } from '../api/base'
import { autostartOn, checkUpdate, desktopVersion, installUpdate, setAutostart } from '../desktop'
import { CLOSE_ACTIONS, getCloseAction, setCloseAction } from '../desktop/closePreference'
import { WALLPAPERS, appearance, compressImage, resetAppearance } from '../desktop/appearance'

/**
 * 桌面版的小设置面板（2026-11-11，Tauri 接入）。
 *
 * 网页版里这个组件只渲染一个空字符串 —— 网页没有"开机自启/更新 exe"这回事，
 * 把按钮藏掉的代价比在 AppShell 里到处写 v-if 小得多。
 *
 * 四件事：版本号 / 开机自启 / 检查更新 / 数据地址。
 * 更新走 https://hbhnd.cloud/desktop/latest.json，见 src-tauri/tauri.conf.json。
 */
const open = ref(false)
const version = ref('')
const autostart = ref(false)
const busy = ref(false)

/**
 * 是否显示这块面板：真桌面版才显示；开发时加 `?desktop=1` 可以在浏览器里预览外观设置
 * （窗口/更新这些按钮在浏览器里点了只会报错，不影响静态预览）。
 */
const visible =
  IS_DESKTOP || (import.meta.env.DEV && new URLSearchParams(window.location.search).has('desktop'))

/*
 * 关闭按钮的行为（2026-11-11 第二轮）：默认「最小化到托盘」——点 ✕ 直接收起、不弹窗。
 * 想改成每次问、或直接退出，在这里改，存在本机 localStorage。
 */
const closeAction = ref(getCloseAction())

function changeCloseAction(next) {
  closeAction.value = setCloseAction(next)
}

function closeHint(value) {
  return CLOSE_ACTIONS.find((item) => item.value === value)?.hint || ''
}

/** 更新检查的四种状态：idle 未查 / checking 查中 / latest 已最新 / found 有新版 */
const updateState = ref('idle')
const updateInfo = ref(null)
const updateError = ref('')
const progress = ref(null)

onMounted(async () => {
  if (!IS_DESKTOP) return
  version.value = await desktopVersion()
  autostart.value = await autostartOn()
})

async function toggleAutostart(next) {
  busy.value = true
  autostart.value = await setAutostart(next)
  busy.value = false
}

async function runCheck() {
  updateState.value = 'checking'
  updateError.value = ''
  updateInfo.value = null
  const result = await checkUpdate()
  if (result?.error) {
    updateState.value = 'idle'
    updateError.value = '暂时查不到更新，稍后再试'
    return
  }
  if (!result) {
    updateState.value = 'latest'
    return
  }
  updateState.value = 'found'
  updateInfo.value = result
}

async function runInstall() {
  if (progress.value !== null) return
  progress.value = 0
  try {
    await installUpdate((ratio) => {
      progress.value = ratio === null ? null : ratio
    })
  } catch {
    progress.value = null
    updateError.value = '下载失败，稍后再试'
  }
}

/* 壁纸：内置四张渐变 + 自己选的图（压到 1920 宽后存本地）。 */
const wallpaperError = ref('')
const picking = ref(false)

async function onPickWallpaper(event) {
  const file = event.target.files?.[0]
  if (!file) return
  picking.value = true
  wallpaperError.value = ''
  try {
    appearance.custom = await compressImage(file)
    appearance.enabled = true
  } catch (error) {
    wallpaperError.value = error?.message || '这张图用不了'
  } finally {
    picking.value = false
    event.target.value = ''
  }
}

function usePresetWallpaper(id) {
  appearance.custom = ''
  appearance.wallpaper = id
  appearance.enabled = true
}

function clearWallpaper() {
  appearance.enabled = false
}
</script>

<template>
  <template v-if="visible">
    <button
      type="button"
      class="rounded-full border border-line bg-raised px-2 py-1 text-xs text-slate-500 hover:text-slate-900"
      title="桌面版设置"
      @click="open = true"
    >
      桌面版
    </button>

    <ElDialog v-model="open" title="桌面版设置" width="400px" append-to-body>
      <div class="space-y-4 text-sm">
        <div class="flex items-center justify-between">
          <span class="text-slate-500">版本</span>
          <span class="font-medium text-slate-900">{{ version || '—' }}</span>
        </div>

        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-slate-900">开机自启</p>
            <p class="mt-0.5 text-xs text-slate-500">登录 Windows 后自动打开，不用去桌面找图标</p>
          </div>
          <ElCheckbox
            :model-value="autostart"
            :disabled="busy"
            @update:model-value="toggleAutostart"
          >
            {{ autostart ? '已开启' : '已关闭' }}
          </ElCheckbox>
        </div>

        <div class="flex items-start justify-between gap-4 border-t border-line pt-3">
          <div>
            <p class="text-slate-900">点关闭时</p>
            <p class="mt-0.5 text-xs text-slate-500">{{ closeHint(closeAction) }}</p>
          </div>
          <ElSelect
            :model-value="closeAction"
            class="!w-[132px]"
            size="small"
            @update:model-value="changeCloseAction"
          >
            <ElOption
              v-for="item in CLOSE_ACTIONS"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </ElSelect>
        </div>

        <div class="border-t border-line pt-3">
          <div class="flex items-center justify-between gap-4">
            <div>
              <p class="text-slate-900">更新</p>
              <p class="mt-0.5 text-xs text-slate-500">
                <template v-if="updateState === 'latest'">已经是最新版本</template>
                <template v-else-if="updateState === 'found'">
                  有新版本 {{ updateInfo?.version }}，装完会自动重启
                </template>
                <template v-else-if="updateState === 'checking'">正在检查…</template>
                <template v-else-if="updateError">{{ updateError }}</template>
                <template v-else>通常不用管，需要时会提示</template>
              </p>
            </div>
            <ElButton
              v-if="updateState === 'found'"
              size="small"
              type="primary"
              :loading="progress !== null"
              @click="runInstall"
            >
              {{ progress === null ? '立即更新' : `下载中 ${Math.round(progress * 100)}%` }}
            </ElButton>
            <ElButton v-else size="small" :loading="updateState === 'checking'" @click="runCheck">
              检查更新
            </ElButton>
          </div>
        </div>

        <div class="border-t border-line pt-3">
          <div class="flex items-center justify-between gap-4">
            <div>
              <p class="text-slate-900">背景</p>
              <p class="mt-0.5 text-xs text-slate-500">
                窗口材质是 Windows 原生亚克力；壁纸只压在内容后面，不参与滚动
              </p>
            </div>
            <ElCheckbox v-model="appearance.enabled">启用</ElCheckbox>
          </div>

          <div class="mt-3 flex flex-wrap items-center gap-2">
            <button
              v-for="item in WALLPAPERS"
              :key="item.id"
              type="button"
              class="h-8 w-8 rounded-md border transition"
              :class="
                appearance.enabled && !appearance.custom && appearance.wallpaper === item.id
                  ? 'border-brand-ink ring-2 ring-brand-ink/25'
                  : 'border-line hover:border-slate-400'
              "
              :style="{ background: item.css }"
              :title="item.label"
              :aria-label="`壁纸：${item.label}`"
              :aria-pressed="appearance.enabled && !appearance.custom && appearance.wallpaper === item.id"
              @click="usePresetWallpaper(item.id)"
            />

            <label
              class="cursor-pointer rounded-md border border-line px-2.5 py-1 text-xs text-slate-700 transition hover:bg-region"
            >
              {{ picking ? '处理中…' : '选本地图片' }}
              <input type="file" accept="image/*" class="hidden" @change="onPickWallpaper" />
            </label>

            <button
              type="button"
              class="rounded-md border border-line px-2.5 py-1 text-xs text-slate-600 transition hover:bg-region"
              @click="clearWallpaper"
            >
              不用壁纸
            </button>
            <button
              type="button"
              class="ml-auto text-xs text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
              @click="resetAppearance"
            >
              恢复默认
            </button>
          </div>

          <p v-if="wallpaperError" class="mt-2 text-xs text-rose-700">{{ wallpaperError }}</p>

          <div class="mt-3 space-y-2">
            <div class="flex items-center gap-3">
              <span class="w-14 shrink-0 text-xs text-slate-500">模糊</span>
              <ElSlider v-model="appearance.blur" :min="0" :max="40" :step="1" class="flex-1" />
              <span class="w-9 text-right text-xs text-slate-500">{{ appearance.blur }}px</span>
            </div>
            <div class="flex items-center gap-3">
              <span class="w-14 shrink-0 text-xs text-slate-500">纸面</span>
              <ElSlider v-model="appearance.veil" :min="0.3" :max="1" :step="0.02" class="flex-1" />
              <span class="w-9 text-right text-xs text-slate-500">{{ Math.round(appearance.veil * 100) }}%</span>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between border-t border-line pt-3">
          <span class="text-slate-500">数据地址</span>
          <span class="text-xs text-slate-600">hbhnd.cloud</span>
        </div>
      </div>
    </ElDialog>
  </template>
</template>
