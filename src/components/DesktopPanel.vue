<script setup>
import { onMounted, ref } from 'vue'
import { ElButton, ElCheckbox, ElDialog, ElOption, ElSelect } from 'element-plus'
import { IS_DESKTOP } from '../api/base'
import { autostartOn, checkUpdate, desktopVersion, installUpdate, setAutostart } from '../desktop'
import { CLOSE_ACTIONS, getCloseAction, setCloseAction } from '../desktop/closePreference'

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
</script>

<template>
  <template v-if="IS_DESKTOP">
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

        <div class="flex items-center justify-between border-t border-line pt-3">
          <span class="text-slate-500">数据地址</span>
          <span class="text-xs text-slate-600">hbhnd.cloud</span>
        </div>
      </div>
    </ElDialog>
  </template>
</template>
