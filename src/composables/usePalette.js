/**
 * 配色（调色板）状态 —— 2026-10-23，变更-170。
 *
 * 使用方给了两套弥散三色：
 *   粉紫元气  #945FFA / #F698B8 / #F7DFD9
 *   粉橙暖调  #BBADE6 / #FEC96D / #E2ADB4（默认，2026-10-23 之前线上就是它）
 *
 * ## 为什么是"调色板"而不是"深浅色"
 *
 * App 上早就有 light / dark 两个开关（useTheme）。调色板与深浅色是**正交**的两件事：
 * 浅色粉紫、深色粉紫、浅色粉橙、深色粉橙都是合法组合（使用方 2026-10-23 确认）。
 * 所以这里只管三色，不碰深浅。
 *
 * ⚠️ PC 没有深色模式 —— 只有调色板这一层。
 */
import { ref } from 'vue'

export const PALETTE_STORAGE_KEY = 'hnd-palette'

/** 两套调色板的元数据（值写死在 minimal-field.css 里，这里只放名字与用于按钮提示的色点） */
export const PALETTES = [
  { key: 'warm', label: '粉橙暖调', dots: ['#BBADE6', '#FEC96D', '#E2ADB4'] },
  { key: 'violet', label: '粉紫元气', dots: ['#945FFA', '#F698B8', '#F7DFD9'] },
]

export const DEFAULT_PALETTE = 'warm'

const KNOWN = new Set(PALETTES.map((p) => p.key))

/** 读存储：坏值 / 隐私模式一律回默认（与 sidebarCollapsed 同一套兜底口径） */
export function readStoredPalette(storage) {
  const store = storage ?? globalThis.localStorage
  if (!store) return DEFAULT_PALETTE
  try {
    const raw = store.getItem(PALETTE_STORAGE_KEY)
    return KNOWN.has(raw) ? raw : DEFAULT_PALETTE
  } catch {
    return DEFAULT_PALETTE
  }
}

export function writeStoredPalette(key, storage) {
  const store = storage ?? globalThis.localStorage
  if (!store || !KNOWN.has(key)) return
  try {
    store.setItem(PALETTE_STORAGE_KEY, key)
  } catch {
    // 隐私模式 / 配额满：静默放弃持久化，本次会话内仍然生效
  }
}

/** 模块级单例：顶栏按钮与 .minimal-field 的 data-palette 读同一份 */
const palette = ref(readStoredPalette())

export function usePalette() {
  function setPalette(key) {
    if (!KNOWN.has(key)) return
    palette.value = key
    writeStoredPalette(key)
  }

  function togglePalette() {
    const index = PALETTES.findIndex((p) => p.key === palette.value)
    const next = PALETTES[(index + 1) % PALETTES.length]
    setPalette(next.key)
    return next.key
  }

  /** 只给测试用：把内存状态对齐到某个 storage */
  function reloadFromStorage(storage) {
    palette.value = readStoredPalette(storage)
  }

  return { palette, PALETTES, setPalette, togglePalette, reloadFromStorage }
}
