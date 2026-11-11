/**
 * 桌面版外观设置（2026-11-11）。
 *
 * 为什么放前端而不放 Rust：这几项都只是"画成什么样"，取值要实时喂给 CSS；
 * 存 localStorage 就够，不必为一个滑杆往返一次 IPC。
 *
 * 注意：壁纸是**静态图/渐变 + blur 滤镜**，不是背景模糊滤镜。
 * 背景模糊滤镜会让每次滚动都重新采样背后的像素，抄表页那种长列表一滑就掉帧；
 * 这里的模糊在图层上算一次就固定了。
 */
import { reactive, watch } from 'vue'

const STORAGE_KEY = 'hnd-desktop-appearance'

/** 内置壁纸：都是低饱和的，白卡片压上去不会花。 */
export const WALLPAPERS = [
  {
    id: 'mist',
    label: '雾',
    css: 'radial-gradient(120% 90% at 12% 8%, #eef1f6 0%, #dfe5ef 42%, #cfd8e6 100%)',
  },
  {
    id: 'dawn',
    label: '晨',
    css: 'radial-gradient(110% 80% at 85% 12%, #fdf1e4 0%, #f4e6dc 45%, #e6ded8 100%)',
  },
  {
    id: 'moss',
    label: '苔',
    css: 'radial-gradient(120% 85% at 20% 90%, #e8efe9 0%, #dbe6df 45%, #ccdbd3 100%)',
  },
  {
    id: 'night',
    label: '夜',
    css: 'radial-gradient(130% 90% at 18% 6%, #2b3242 0%, #202634 48%, #141821 100%)',
  },
]

const DEFAULTS = {
  /** 内置壁纸 id；custom 有值时优先用它 */
  wallpaper: 'mist',
  /** 自定义图片（压缩后的 dataURL），空串表示没选 */
  custom: '',
  /** 壁纸模糊半径 px：0–40 */
  blur: 18,
  /** 纸面不透明度 0.3–1：越小越"通透"，越大越像普通窗口 */
  veil: 0.62,
  /** 桌面版是否启用壁纸（关掉就退回纯亚克力） */
  enabled: true,
}

function read() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const saved = JSON.parse(raw)
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) }
  } catch {
    return { ...DEFAULTS }
  }
}

export const appearance = reactive(read())

watch(
  appearance,
  (value) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    } catch {
      // 存不下（自定义图太大）时只影响下次启动的壁纸，不影响本次
    }
  },
  { deep: true },
)

/** 当前壁纸的 CSS：自定义图优先，其次内置渐变。 */
export function wallpaperCss(state = appearance) {
  if (!state.enabled) return ''
  if (state.custom) return `url("${state.custom}") center / cover no-repeat`
  const found = WALLPAPERS.find((w) => w.id === state.wallpaper) || WALLPAPERS[0]
  return found.css
}

export function resetAppearance() {
  Object.assign(appearance, DEFAULTS)
}

/**
 * 把用户选的图片压到"够用但不撑爆 localStorage"的尺寸再存。
 * 1920 宽 + JPEG 0.82 通常 200–400KB，localStorage 的 5MB 放得下。
 */
export function compressImage(file, maxWidth = 1920, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读不到这张图'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('这张图打不开'))
      img.onload = () => {
        const scale = Math.min(1, maxWidth / (img.width || maxWidth))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('浏览器不支持画布'))
          return
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}
