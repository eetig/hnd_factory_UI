/**
 * 桌面版外观设置（2026-11-11）。
 *
 * 为什么放前端而不放 Rust：这几项都只是"画成什么样"，取值要实时喂给 CSS；
 * 存 localStorage 就够，不必为一个滑杆往返一次 IPC。
 *
 * 注意：壁纸的模糊是**选图时一次性烘进画布的**（`ctx.filter = blur(...)`），
 * 运行期图层上没有任何 filter。原因：
 *   · 背景模糊滤镜（让浏览器每帧采样背板再模糊）会让每次滚动都重采样背后像素，长列表一滑就掉帧；
 *   · 即便只是给"整屏大图层"加普通 blur()，合成器每帧也要重算这张大图，
 *     窗口拖动、截图、截图预览都会明显发涩 —— 车间的老机器尤其明显。
 * 内置渐变本身就是柔的，不需要模糊；滑杆只对自定义图生效。
 */
import { reactive, watch } from 'vue'

const STORAGE_KEY = 'hnd-desktop-appearance'

/**
 * 内置壁纸（2026-11-12 使用方口径：「浅色、带弥散效果、彩色」）。
 *
 * 每张都由 2–3 层 radial-gradient 叠出来，颜色是柔和的彩色而不是单色渐变：
 * 单层渐变在 24 寸屏上会看出一条明显的分界，多层错位才像"光斑弥散"。
 * 全部走 CSS 渐变、没有位图，窗口拉伸也不会糊。
 */
export const WALLPAPERS = [
  {
    id: 'peach',
    label: '桃霞',
    css: [
      'radial-gradient(58% 52% at 14% 4%, #ffe1ea 0%, rgba(255,225,234,0) 62%)',
      'radial-gradient(52% 46% at 88% 2%, #fff0d6 0%, rgba(255,240,214,0) 58%)',
      'radial-gradient(72% 62% at 62% 108%, #ffd9e4 0%, rgba(255,217,228,0) 66%)',
      'radial-gradient(140% 130% at 50% -10%, #fff9fb 0%, #fdf2f6 55%, #fbe9ef 100%)',
    ].join(', '),
  },
  {
    id: 'mint',
    label: '薄荷',
    css: [
      'radial-gradient(56% 50% at 10% 6%, #d9f6ec 0%, rgba(217,246,236,0) 62%)',
      'radial-gradient(54% 48% at 92% 6%, #dcf0ff 0%, rgba(220,240,255,0) 58%)',
      'radial-gradient(74% 64% at 58% 110%, #e8fbf3 0%, rgba(232,251,243,0) 66%)',
      'radial-gradient(140% 130% at 50% -10%, #f8fffc 0%, #f1fbf8 55%, #ecf7f4 100%)',
    ].join(', '),
  },
  {
    id: 'sky',
    label: '天青',
    css: [
      'radial-gradient(58% 50% at 16% 2%, #dceaff 0%, rgba(220,234,255,0) 60%)',
      'radial-gradient(50% 44% at 90% 10%, #e6f3ff 0%, rgba(230,243,255,0) 56%)',
      'radial-gradient(70% 60% at 60% 108%, #e3ecff 0%, rgba(227,236,255,0) 64%)',
      'radial-gradient(140% 130% at 50% -10%, #f9fbff 0%, #f2f7fe 55%, #edf2fc 100%)',
    ].join(', '),
  },
  {
    id: 'lotus',
    label: '藕荷',
    css: [
      'radial-gradient(58% 52% at 12% 4%, #efe2ff 0%, rgba(239,226,255,0) 62%)',
      'radial-gradient(52% 46% at 90% 4%, #ffe2f3 0%, rgba(255,226,243,0) 58%)',
      'radial-gradient(72% 60% at 64% 108%, #f7e9ff 0%, rgba(247,233,255,0) 66%)',
      'radial-gradient(140% 130% at 50% -10%, #fdfaff 0%, #f8f2fd 55%, #f3edfb 100%)',
    ].join(', '),
  },
  {
    id: 'night',
    label: '暮夜',
    css: [
      'radial-gradient(60% 50% at 14% 6%, #2a3350 0%, rgba(42,51,80,0) 62%)',
      'radial-gradient(50% 44% at 88% 8%, #3a2b45 0%, rgba(58,43,69,0) 58%)',
      'radial-gradient(140% 130% at 50% -10%, #20263c 0%, #191d2c 55%, #12141c 100%)',
    ].join(', '),
  },
]

const DEFAULTS = {
  /** 内置壁纸 id；custom 有值时优先用它 */
  wallpaper: 'peach',
  /** 自定义图片（压缩后的 dataURL），空串表示没选 */
  custom: '',
  /** 壁纸模糊半径 px：0–40 */
  blur: 18,
  /** 纸面不透明度 0.3–1：越小越"通透"，越大越像普通窗口 */
  veil: 0.58,
  /** 桌面版是否启用壁纸（关掉就退回纯亚克力） */
  enabled: true,
}

function read() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const saved = JSON.parse(raw)
    const merged = { ...DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) }
    /*
     * 迁移（2026-11-12，变更-195）：彩色壁纸上来了，旧的 0.34 通明白纸压不住字。
     * 已经存过设置的老机器不会自动吃到新默认值，这里把"明显偏透"的旧值抬到 0.58。
     * 只在低于 0.5 时动一次，用户自己调到 0.5 以上就不再覆盖。
     */
    if (typeof merged.veil === 'number' && merged.veil < 0.5) merged.veil = DEFAULTS.veil
    return merged
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
export function compressImage(file, maxWidth = 1920, quality = 0.82, blurPx = 0) {
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
        // 模糊在这里烤进去：画布内缩一圈再画，边缘不会渗出黑边
        if (blurPx > 0 && 'filter' in ctx) {
          const pad = Math.ceil(blurPx * 2)
          canvas.width += pad * 2
          canvas.height += pad * 2
          const padded = canvas.getContext('2d')
          padded.filter = `blur(${blurPx}px)`
          padded.drawImage(img, pad, pad, canvas.width - pad * 2, canvas.height - pad * 2)
          resolve(canvas.toDataURL('image/jpeg', quality))
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
