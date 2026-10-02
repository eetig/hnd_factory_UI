import { vi } from 'vitest'

/**
 * jsdom 缺的能力在这里补齐，让 Element Plus 组件与画布代码都能在测试里跑起来。
 */

// canvas：jsdom 不实现 2D 上下文。用一个「什么方法都能调」的代理兜底，
// 这样压力容器体积计算那套绘图代码在测试里不会因为 ctx 为 null 而抛错。
const canvasContextStub = new Proxy(
  { canvas: null },
  {
    get(target, prop) {
      if (prop in target) return target[prop]
      return vi.fn()
    },
    set(target, prop, value) {
      target[prop] = value
      return true
    },
  },
)

HTMLCanvasElement.prototype.getContext = vi.fn(() => canvasContextStub)

// Element Plus 的若干组件依赖这两个浏览器 API
globalThis.ResizeObserver =
  globalThis.ResizeObserver ||
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

if (!window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    media: '',
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false
    },
  })
}

// objectURL：选图预览（图片解析页、储罐液位新增行）都要它生成 <img src>。
// 不能写成「缺了才补」—— jsdom 里已经有 vitest 自带的一份 compat 实现，
// 但它对 jsdom 的 File 会抛 `Cannot read properties of undefined (reading '_bytes')`，
// 于是「选完文件」那一步就炸，而不是在断言上失败。这里一律换成不生成真实地址的桩。
URL.createObjectURL = vi.fn(() => 'blob:mock')
URL.revokeObjectURL = vi.fn()
