import { describe, it, expect } from 'vitest'
import {
  boundsPayload,
  clamp,
  clampBox,
  defaultBox,
  deriveTangents,
  parseBounds,
  showsTangents,
} from '../../src/utils/vesselCalibration'

/**
 * 底图标定的纯计算（变更-082）。
 *
 * 最值钱的一条是 `deriveTangents` 的**真数据回归**：拿生产库里 674 甲醇计量罐
 * （框 83~1247、上封头 550、筒体 3400、下封头 550，人工标的切线是 218 / 1114）
 * 验算自动反推的结果。自动值只用来当标定界面的**初值**，但它必须落在人眼可接受的范围里，
 * 否则每次标定都要从错很远的地方拖起。
 */
describe('vesselCalibration', () => {
  describe('showsTangents：只有立式（2/3）需要上下切线', () => {
    it('卧式与再沸器不需要', () => {
      expect(showsTangents(1)).toBe(false)
      expect(showsTangents(4)).toBe(false)
      expect(showsTangents(null)).toBe(false)
    })
    it('平底立式与立式需要', () => {
      expect(showsTangents(2)).toBe(true)
      expect(showsTangents(3)).toBe(true)
    })
  })

  describe('parseBounds', () => {
    it('解析像素口径（含切线）', () => {
      const b = parseBounds(
        '{"top":83,"left":72,"right":627.5,"width":708,"bottom":1247,"height":1520,"tangent":218,"tangentBottom":1114}',
      )
      expect(b.width).toBe(708)
      expect(b.height).toBe(1520)
      expect(b.left).toBe(72)
      expect(b.right).toBe(627.5)
      expect(b.tangent).toBe(218)
      expect(b.tangentBottom).toBe(1114)
    })

    it('归一化口径（width=1、无切线）也能解析', () => {
      const b = parseBounds({ width: 1, height: 0.5, left: 0, right: 1, top: 0, bottom: 0.5 })
      expect(b.width).toBe(1)
      expect(b.tangent).toBeUndefined()
    })

    it('空值/坏数据一律返回 null（不抛：页面不能因为一行数据坏掉就打不开）', () => {
      expect(parseBounds('')).toBeNull()
      expect(parseBounds(null)).toBeNull()
      expect(parseBounds(undefined)).toBeNull()
      expect(parseBounds('{oops')).toBeNull()
      expect(parseBounds('[1,2]')).toBeNull()
      expect(parseBounds('{"width":708,"height":1520}')).toBeNull() // 缺轮廓框
      expect(parseBounds('{"width":"abc","height":1520,"left":0,"right":1,"top":0,"bottom":1}')).toBeNull()
      expect(parseBounds('{"width":0,"height":1520,"left":0,"right":1,"top":0,"bottom":1}')).toBeNull()
    })
  })

  describe('defaultBox：起手框必须是「居中的一列」而不是整张图', () => {
    it('落在图内，且四周留出余量', () => {
      const box = defaultBox(1312, 1664)
      expect(box.left).toBeGreaterThan(0)
      expect(box.right).toBeLessThan(1312)
      expect(box.top).toBeGreaterThan(0)
      expect(box.bottom).toBeLessThan(1664)
      expect(box.right - box.left).toBeGreaterThan(200)
    })
  })

  describe('deriveTangents：按几何反推切线初值', () => {
    it('真数据回归 —— 674 甲醇计量罐（人工标 218 / 1114，误差须在框高的 1.5% 以内）', () => {
      const box = { left: 72, right: 627.5, top: 83, bottom: 1247 }
      const t = deriveTangents(box, {
        topHeadDepth: 550,
        shellLength: 3400,
        bottomHeadDepth: 550,
      })
      const boxHeight = box.bottom - box.top // 1164
      // 自动值 = 框顶 + 上封头深×比例；比例 = 框高 /(上封头+筒体+下封头)
      expect(Math.abs(t.tangent - 218)).toBeLessThan(boxHeight * 0.015)
      expect(Math.abs(t.tangentBottom - 1114)).toBeLessThan(boxHeight * 0.015)
    })

    it('平底（下封头为空/0）不产出下切线', () => {
      const box = { left: 131, right: 1351, top: 63, bottom: 1930 }
      expect(deriveTangents(box, { topHeadDepth: 900, shellLength: 4800, bottomHeadDepth: null }))
        .toEqual({ tangent: expect.any(Number) })
      expect(
        deriveTangents(box, { topHeadDepth: 900, shellLength: 4800, bottomHeadDepth: 0 }).tangentBottom,
      ).toBeUndefined()
    })

    it('几何不全 → 返回空对象（不猜）', () => {
      const box = { left: 0, right: 100, top: 0, bottom: 200 }
      expect(deriveTangents(box, {})).toEqual({})
      expect(deriveTangents(box, { topHeadDepth: 550 })).toEqual({})
      expect(deriveTangents(box, { topHeadDepth: 550, shellLength: 3400 })).toEqual({
        tangent: expect.any(Number),
      })
    })
  })

  describe('clampBox / clamp：拖动不许跑出图外、不许拖塌', () => {
    it('收拢到图内', () => {
      const box = clampBox({ left: -50, right: 9999, top: -10, bottom: 9999 }, 1312, 1664)
      expect(box.left).toBe(0)
      expect(box.right).toBe(1312)
      expect(box.top).toBe(0)
      expect(box.bottom).toBe(1664)
    })

    it('至少保留 min 宽度（否则框会塌成一条线，切线也没地方放）', () => {
      const box = clampBox({ left: 100, right: 101, top: 100, bottom: 101 }, 1312, 1664, 8)
      expect(box.right - box.left).toBeGreaterThanOrEqual(8)
      expect(box.bottom - box.top).toBeGreaterThanOrEqual(8)
    })

    it('clamp 夹数值', () => {
      expect(clamp(-1, 0, 10)).toBe(0)
      expect(clamp(11, 0, 10)).toBe(10)
      expect(clamp(5, 0, 10)).toBe(5)
    })
  })

  describe('boundsPayload：组装成后端要的 JSON（原图像素）', () => {
    const box = { left: 72, right: 627.5, top: 83, bottom: 1247 }

    it('立式：带上落在框内的上下切线，并四舍五入到 1 位小数', () => {
      const json = boundsPayload({
        imgW: 708,
        imgH: 1520,
        box,
        containerType: 3,
        tangents: { tangent: 218.04, tangentBottom: 1114.06 },
      })
      expect(JSON.parse(json)).toEqual({
        width: 708,
        height: 1520,
        left: 72,
        right: 627.5,
        top: 83,
        bottom: 1247,
        tangent: 218,
        tangentBottom: 1114.1,
      })
    })

    it('卧式：即使传了切线也不写进去（多一个没用的键只会让绘制多一条分支）', () => {
      const obj = JSON.parse(
        boundsPayload({
          imgW: 2150,
          imgH: 1060,
          box: { left: 75, right: 2069, top: 131, bottom: 931 },
          containerType: 1,
          tangents: { tangent: 300, tangentBottom: 800 },
        }),
      )
      expect(obj.tangent).toBeUndefined()
      expect(obj.tangentBottom).toBeUndefined()
      expect(obj.width).toBe(2150)
    })

    it('平底立式：只有上切线', () => {
      const obj = JSON.parse(
        boundsPayload({
          imgW: 1760,
          imgH: 1938,
          box: { left: 131, right: 1351, top: 63, bottom: 1930 },
          containerType: 2,
          tangents: { tangent: 310 },
        }),
      )
      expect(obj.tangent).toBe(310)
      expect(obj.tangentBottom).toBeUndefined()
    })

    it('切线越界或顺序颠倒 → 丢弃（宁可少写，也不写入一个后端会拒的坐标）', () => {
      const outside = JSON.parse(
        boundsPayload({
          imgW: 708,
          imgH: 1520,
          box,
          containerType: 3,
          tangents: { tangent: 10, tangentBottom: 1114 }, // 10 在框外
        }),
      )
      expect(outside.tangent).toBeUndefined()
      expect(outside.tangentBottom).toBe(1114)

      const reversed = JSON.parse(
        boundsPayload({
          imgW: 708,
          imgH: 1520,
          box,
          containerType: 3,
          tangents: { tangent: 1100, tangentBottom: 300 },
        }),
      )
      expect(reversed.tangent).toBe(1100)
      expect(reversed.tangentBottom).toBeUndefined()
    })

    it('产出能被 parseBounds 原样读回（往返一致）', () => {
      const json = boundsPayload({
        imgW: 708,
        imgH: 1520,
        box,
        containerType: 3,
        tangents: { tangent: 218, tangentBottom: 1114 },
      })
      const back = parseBounds(json)
      expect(back.width).toBe(708)
      expect(back.tangent).toBe(218)
      expect(back.tangentBottom).toBe(1114)
    })
  })
})
