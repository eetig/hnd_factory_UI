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
