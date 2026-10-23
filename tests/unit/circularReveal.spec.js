import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PALETTE,
  PALETTES,
  PALETTE_STORAGE_KEY,
  readStoredPalette,
  writeStoredPalette,
} from '../../src/composables/usePalette'
import { circularRevealSwitch, revealGeometry } from '../../src/utils/circularReveal'

/*
 * 圆形揭露转场 + 双调色板（2026-10-23，变更-170）。
 *
 * 使用方要求（逐条对应到下面的用例）：
 *   · 圆心 = **按钮中心**，不是屏幕中心；
 *   · 半径要能把整屏铺满（到最远角）；
 *   · 拿不到按钮 / 算不出几何 / 浏览器不支持 ⇒ **无动画直接切**，不许报错卡死；
 *   · ease-out 520ms（常量导出，单测钉住）；
 *   · 两套配色：粉紫元气 / 粉橙暖调（默认粉橙），并记忆选择。
 */

/** 最小 storage 假体（隐私模式下 setItem 会抛，这里也要能兜住） */
function fakeStorage(initial = {}, { throwOnWrite = false } = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (throwOnWrite) throw new Error('QuotaExceededError')
      map.set(k, String(v))
    },
  }
}

describe('圆形揭露的几何', () => {
  it('圆心取按钮中心（不是视口中心）', () => {
    const g = revealGeometry({ left: 900, top: 40, width: 100, height: 30 }, { width: 1280, height: 720 })
    expect(g.cx).toBe(950)
    expect(g.cy).toBe(55)
  })

  it('半径 = 到最远角的距离（保证铺满整屏，四角都覆盖）', () => {
    const vw = 1280
    const vh = 720
    const g = revealGeometry({ left: 900, top: 40, width: 100, height: 30 }, { width: vw, height: vh })
    const corners = [
      Math.hypot(0 - g.cx, 0 - g.cy),
      Math.hypot(vw - g.cx, 0 - g.cy),
      Math.hypot(0 - g.cx, vh - g.cy),
      Math.hypot(vw - g.cx, vh - g.cy),
    ]
    expect(g.radius).toBeCloseTo(Math.max(...corners), 6)
    expect(g.radius).toBeGreaterThanOrEqual(Math.max(...corners))
  })

  it('按钮在左上角时半径 ≈ 对角线（不至于只铺一半）', () => {
    const g = revealGeometry({ left: 0, top: 0, width: 20, height: 20 }, { width: 1280, height: 720 })
    expect(g.radius).toBeGreaterThan(Math.hypot(1280, 720) * 0.95)
  })

  it('几何算不出来时返回 null（调用方据此降级）', () => {
    expect(revealGeometry(null, { width: 100, height: 100 })).toBeNull()
    expect(revealGeometry({ left: 0, top: 0, width: 0, height: 10 }, { width: 100, height: 100 })).toBeNull()
    expect(revealGeometry({ left: 0, top: 0, width: 10, height: 10 }, { width: 0, height: 100 })).toBeNull()
    expect(revealGeometry({ left: NaN, top: 0, width: 10, height: 10 }, { width: 100, height: 100 })).toBeNull()
  })
})

describe('切主题的降级路径', () => {
  it('没有按钮元素 ⇒ 直接切、返回 no-anim', async () => {
    let applied = 0
    const mode = await circularRevealSwitch({ apply: () => (applied += 1), originElement: null })
    expect(mode).toBe('no-anim')
    expect(applied).toBe(1)
  })

  it('浏览器没有 startViewTransition ⇒ 直接切、返回 no-anim', async () => {
    let applied = 0
    const mode = await circularRevealSwitch({
      apply: () => (applied += 1),
      originElement: { getBoundingClientRect: () => ({ left: 10, top: 10, width: 20, height: 20 }) },
    })
    expect(mode).toBe('no-anim')
    expect(applied).toBe(1)
  })

  it('apply 自己抛错也不把异常抛给调用方（配色是视觉，不该搞死页面）', async () => {
    const mode = await circularRevealSwitch({
      apply: () => {
        throw new Error('boom')
      },
      originElement: null,
    })
    expect(mode).toBe('no-anim')
  })

  it('有 startViewTransition 时走 VT：apply 被调用一次、返回 view-transition', async () => {
    const original = globalThis.document
    const animations = []
    const fakeDocument = {
      startViewTransition: (cb) => {
        cb()
        return { ready: Promise.resolve(), finished: Promise.resolve() }
      },
      documentElement: {
        animate: (frames, opts) => {
          animations.push({ frames, opts })
          return { finished: Promise.resolve() }
        },
      },
    }
    Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument })
    try {
      let applied = 0
      const mode = await circularRevealSwitch({
        apply: () => (applied += 1),
        originElement: { getBoundingClientRect: () => ({ left: 900, top: 40, width: 100, height: 30 }) },
      })
      expect(mode).toBe('view-transition')
      expect(applied).toBe(1)
      expect(animations).toHaveLength(1)
      // 起点是 0 半径、终点是铺满半径，圆心是按钮中心
      expect(animations[0].frames.clipPath[0]).toBe('circle(0px at 950px 55px)')
      expect(animations[0].frames.clipPath[1]).toMatch(/^circle\(\d+(\.\d+)?px at 950px 55px\)$/)
      expect(animations[0].opts).toMatchObject({ easing: 'ease-out', pseudoElement: '::view-transition-new(root)' })
      expect(animations[0].opts.duration).toBe(520)
    } finally {
      Object.defineProperty(globalThis, 'document', { configurable: true, value: original })
    }
  })
})

describe('两套调色板', () => {
  it('两套三色与使用方给的值逐位一致', () => {
    expect(PALETTES.map((p) => p.key)).toEqual(['warm', 'violet'])
    expect(PALETTES[0].dots).toEqual(['#BBADE6', '#FEC96D', '#E2ADB4'])
    expect(PALETTES[1].dots).toEqual(['#945FFA', '#F698B8', '#F7DFD9'])
  })

  it('默认粉橙（线上现状，不能一打开就变）', () => {
    expect(DEFAULT_PALETTE).toBe('warm')
    expect(readStoredPalette(fakeStorage())).toBe('warm')
  })

  it('读到合法值就用它，读到脏值/抛错就回默认', () => {
    expect(readStoredPalette(fakeStorage({ [PALETTE_STORAGE_KEY]: 'violet' }))).toBe('violet')
    expect(readStoredPalette(fakeStorage({ [PALETTE_STORAGE_KEY]: 'nope' }))).toBe('warm')
    const angry = {
      getItem: () => {
        throw new Error('SecurityError')
      },
    }
    expect(readStoredPalette(angry)).toBe('warm')
  })

  it('写存储：隐私模式写失败也不抛（本次会话仍然生效）', () => {
    expect(() => writeStoredPalette('violet', fakeStorage({}, { throwOnWrite: true }))).not.toThrow()
    const store = fakeStorage()
    writeStoredPalette('violet', store)
    expect(store.getItem(PALETTE_STORAGE_KEY)).toBe('violet')
  })

  it('写非法值不落盘', () => {
    const store = fakeStorage()
    writeStoredPalette('whatever', store)
    expect(store.getItem(PALETTE_STORAGE_KEY)).toBeNull()
  })
})
