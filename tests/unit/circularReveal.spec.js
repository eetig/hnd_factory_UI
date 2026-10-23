import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BASE_CIRCLE_PX,
  REVEAL_DURATION,
  circularRevealSwitch,
  prefersReducedMotion,
  readRevealMode,
  revealGeometry,
} from '../../src/utils/circularReveal'
import {
  DEFAULT_PALETTE,
  PALETTES,
  PALETTE_STORAGE_KEY,
  readStoredPalette,
  writeStoredPalette,
} from '../../src/composables/usePalette'

/*
 * 圆形揭露转场 + 双调色板（2026-10-23，变更-170 / 170 续性能版）。
 *
 * 使用方要求（逐条对应下面的用例）：
 *   · 圆心 = **按钮中心**，不是屏幕中心；
 *   · 半径要能把整屏铺满（到最远角）；
 *   · 拿不到按钮 / 算不出几何 ⇒ 无动画直接切，不许报错卡死；
 *   · 两套配色：粉紫元气 / 粉橙暖调（默认粉橙），并记忆选择。
 *
 * 性能版新增（使用方「特别卡」）：
 *   · 遮罩是**固定 240px 的小圆 + scale**，不是直径两千多像素的大实色块；
 *   · 有 `will-change` / `backface-visibility` 这两条合成层提示；
 *   · 顺序是"圆铺满 → 再切主题"，避免一边动画一边重排；
 *   · VT 变成 `?vt=1` 才走（整页快照就是卡的那一下）。
 */

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

  it('半径 = 到最远角的距离（四角都能覆盖）', () => {
    const vw = 1280
    const vh = 720
    const g = revealGeometry({ left: 900, top: 40, width: 100, height: 30 }, { width: vw, height: vh })
    const corners = [
      Math.hypot(g.cx, g.cy),
      Math.hypot(vw - g.cx, g.cy),
      Math.hypot(g.cx, vh - g.cy),
      Math.hypot(vw - g.cx, vh - g.cy),
    ]
    expect(g.radius).toBeCloseTo(Math.max(...corners), 6)
  })

  it('几何算不出来时返回 null（调用方据此降级）', () => {
    expect(revealGeometry(null, { width: 100, height: 100 })).toBeNull()
    expect(revealGeometry({ left: 0, top: 0, width: 0, height: 10 }, { width: 100, height: 100 })).toBeNull()
    expect(revealGeometry({ left: 0, top: 0, width: 10, height: 10 }, { width: 0, height: 100 })).toBeNull()
    expect(revealGeometry({ left: NaN, top: 0, width: 10, height: 10 }, { width: 100, height: 100 })).toBeNull()
  })
})

describe('性能版遮罩（使用方反馈"特别卡"之后的口径）', () => {
  it('小圆基准 240px，靠 scale 放大 —— 不是直径两千多像素的实色块', () => {
    expect(BASE_CIRCLE_PX).toBe(240)
    expect(BASE_CIRCLE_PX).toBeLessThan(400)
  })

  it('默认优先 VT（观感正确比省一次快照重要）；只有 ?noVT=1 才跳过', () => {
    expect(readRevealMode('')).toBe('auto')
    expect(readRevealMode('?noVT=1')).toBe('none')
  })

  it('时长落在 ui-taste 的区间内（状态切换 200–300 / 页面级 300–500）：取 320ms', () => {
    expect(REVEAL_DURATION).toBe(320)
    expect(REVEAL_DURATION).toBeGreaterThanOrEqual(200)
    expect(REVEAL_DURATION).toBeLessThanOrEqual(500)
  })

  it('尊重 prefers-reduced-motion：开了减弱动效就不播，直接切', async () => {
    const originalMatch = globalThis.matchMedia
    Object.defineProperty(globalThis, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: true }),
    })
    try {
      expect(prefersReducedMotion()).toBe(true)
      let applied = 0
      const mode = await circularRevealSwitch({
        apply: () => (applied += 1),
        // 几何完全合法，但减弱动效应当压过它
        originElement: { getBoundingClientRect: () => ({ left: 900, top: 40, width: 100, height: 30 }) },
      })
      expect(mode).toBe('no-anim')
      expect(applied).toBe(1)
    } finally {
      Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: originalMatch })
    }
  })

  it('源码里有合成层提示（will-change / backface-visibility）—— 少了就每帧重绘整屏', () => {
    const src = readFileSync(join(process.cwd(), 'src/utils/circularReveal.js'), 'utf8')
    expect(src).toContain('willChange')
    expect(src).toContain('backfaceVisibility')
    // 小圆 + scale
    expect(src).toContain('BASE_CIRCLE_PX')
    expect(src).toMatch(/scale\(/)
  })
})

describe('切主题的顺序与降级', () => {
  /** 造一个最小的 DOM 环境：body.appendChild / animate / remove */
  function fakeDom() {
    const created = []
    const doc = {
      body: {
        appendChild: (el) => {
          created.push(el)
          el.parentNode = doc.body
        },
      },
      createElement: () => {
        const el = {
          dataset: {},
          style: {},
          setAttribute() {},
          remove: () => {
            const i = created.indexOf(el)
            if (i >= 0) created.splice(i, 1)
          },
          animate: () => ({ finished: Promise.resolve() }),
          parentNode: null,
        }
        return el
      },
      documentElement: { animate: () => ({ finished: Promise.resolve() }) },
    }
    return { doc, created }
  }

  it('没有按钮元素 ⇒ 直接切、返回 no-anim', async () => {
    let applied = 0
    const mode = await circularRevealSwitch({ apply: () => (applied += 1), originElement: null })
    expect(mode).toBe('no-anim')
    expect(applied).toBe(1)
  })

  it('apply 抛错也不抛给调用方', async () => {
    const mode = await circularRevealSwitch({
      apply: () => {
        throw new Error('boom')
      },
      originElement: null,
      mode: 'overlay',
    })
    expect(mode).toBe('no-anim')
  })

  it('overlay：先画圆、铺满之后才 apply（顺序反了就会一边动画一边重排）', async () => {
    const original = globalThis.document
    const { doc, created } = fakeDom()
    Object.defineProperty(globalThis, 'document', { configurable: true, value: doc })
    try {
      let appliedAt = null
      let createdAt = null
      doc.body.appendChild = (el) => {
        createdAt = performance.now()
        created.push(el)
      }
      const mode = await circularRevealSwitch({
        apply: () => {
          appliedAt = performance.now()
        },
        originElement: { getBoundingClientRect: () => ({ left: 900, top: 40, width: 100, height: 30 }) },
        mode: 'overlay',
        duration: 20,
      })
      expect(mode).toBe('overlay')
      expect(createdAt).not.toBeNull()
      expect(appliedAt).not.toBeNull()
      expect(appliedAt).toBeGreaterThanOrEqual(createdAt)
      // 圆用完必须移除，别在 body 里留垃圾节点
      expect(created).toHaveLength(0)
    } finally {
      Object.defineProperty(globalThis, 'document', { configurable: true, value: original })
    }
  })

  it('?vt=1 时走 View Transitions 并返回 view-transition', async () => {
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
      body: { appendChild() {} },
      createElement: () => ({ style: {}, setAttribute() {}, remove() {}, animate: () => ({ finished: Promise.resolve() }) }),
    }
    Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument })
    try {
      let applied = 0
      const mode = await circularRevealSwitch({
        apply: () => (applied += 1),
        originElement: { getBoundingClientRect: () => ({ left: 900, top: 40, width: 100, height: 30 }) },
        mode: 'view-transition',
      })
      expect(mode).toBe('view-transition')
      expect(applied).toBe(1)
      expect(animations).toHaveLength(1)
      expect(animations[0].frames.clipPath[0]).toBe('circle(0px at 950px 55px)')
      expect(animations[0].opts).toMatchObject({ easing: 'ease-out', pseudoElement: '::view-transition-new(root)' })
      expect(animations[0].opts.duration).toBe(REVEAL_DURATION)
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
    expect(
      readStoredPalette({
        getItem: () => {
          throw new Error('SecurityError')
        },
      }),
    ).toBe('warm')
  })

  it('写存储在隐私模式下不抛', () => {
    expect(() => writeStoredPalette('violet', fakeStorage({}, { throwOnWrite: true }))).not.toThrow()
    const store = fakeStorage()
    writeStoredPalette('violet', store)
    expect(store.getItem(PALETTE_STORAGE_KEY)).toBe('violet')
    writeStoredPalette('whatever', store)
    expect(store.getItem(PALETTE_STORAGE_KEY)).toBe('violet')
  })
})
