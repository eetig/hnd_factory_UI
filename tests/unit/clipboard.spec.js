import { describe, expect, it, vi } from 'vitest'
import { buildCopyText, copyText, isCopyColumn, legacyCopy } from '../../src/utils/clipboard.js'

/*
 * 单元格复制（2026-10-22，变更-144）。
 *
 * 使用方确认的口径：
 *   · 点序号 → 复制「物料名称 ⇥ 物料编码 ⇥ 规格型号」一行三列（能直接粘进 Excel）
 *   · 点物料名称 / 物料编码 / 规格型号 → 复制那一项
 *   · 这四个格子只复制、不开抽屉（其它列仍然点开抽屉）
 *
 * 复制的两条路径各有坑，这里都钉住：
 *   · navigator.clipboard 需要安全上下文（内网 http://192.168.3.7:9091 没有）；
 *   · execCommand 虽废弃但仍可用，且不需要安全上下文 —— 内网靠它。
 */

const ROW = {
  materialName: '电磁隔膜计量泵',
  materialCode: '230016578',
  spec: '额定流量:120L/h,最大工作压力:0.3MPa',
}

describe('buildCopyText：点哪个格子复制什么', () => {
  it('序号：三样用 Tab 连成一行（粘进 Excel 就是三列）', () => {
    const { text, empty } = buildCopyText(ROW, 'index')
    expect(text).toBe(`${ROW.materialName}\t${ROW.materialCode}\t${ROW.spec}`)
    expect(text.split('\t')).toHaveLength(3)
    expect(empty).toBe(false)
  })

  it('三个字段列各复制自己', () => {
    expect(buildCopyText(ROW, 'materialName').text).toBe(ROW.materialName)
    expect(buildCopyText(ROW, 'materialCode').text).toBe(ROW.materialCode)
    expect(buildCopyText(ROW, 'spec').text).toBe(ROW.spec)
  })

  it('空值标记 empty（调用方据此提示"这一项是空的"，不会"复制成功"却没有内容）', () => {
    expect(buildCopyText({ materialName: '  ', materialCode: null }, 'materialName').empty).toBe(true)
    expect(buildCopyText({}, 'index').empty).toBe(true)
    expect(buildCopyText({ materialName: 'A' }, 'index').empty).toBe(false)
  })

  it('只有可复制的四列返回 true；其它列不受影响（它们要继续开抽屉）', () => {
    for (const key of ['index', 'materialName', 'materialCode', 'spec']) {
      expect(isCopyColumn(key), key).toBe(true)
    }
    for (const key of ['status', 'category', 'quantity', 'requester', 'purpose']) {
      expect(isCopyColumn(key), key).toBe(false)
    }
  })

  it('不认识的列 → 空文本 + empty', () => {
    expect(buildCopyText(ROW, 'quantity')).toEqual({ text: '', label: '', empty: true })
  })
})

describe('copyText：新 API 优先，非安全上下文退回 execCommand', () => {
  it('clipboard 可用时走 writeText', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await expect(copyText('abc')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('abc')

    vi.unstubAllGlobals()
  })

  it('clipboard 抛错（权限被拒 / 非安全上下文）→ 退回 execCommand', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    const exec = vi.fn().mockReturnValue(true)
    vi.stubGlobal('document', {
      createElement: () => ({ style: {}, setAttribute: () => {}, select: () => {}, setSelectionRange: () => {} }),
      body: { appendChild: () => {}, removeChild: () => {} },
      execCommand: exec,
    })

    await expect(copyText('abc')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalled()
    expect(exec).toHaveBeenCalledWith('copy')

    vi.unstubAllGlobals()
  })

  it('没有 clipboard 对象（内网 http 常见）→ 直接走 execCommand', async () => {
    vi.stubGlobal('navigator', {})
    const exec = vi.fn().mockReturnValue(true)
    vi.stubGlobal('document', {
      createElement: () => ({ style: {}, setAttribute: () => {}, select: () => {}, setSelectionRange: () => {} }),
      body: { appendChild: () => {}, removeChild: () => {} },
      execCommand: exec,
    })

    await expect(copyText('abc')).resolves.toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')

    vi.unstubAllGlobals()
  })

  it('两条路都失败 → false（调用方提示"复制失败，请手动选中复制"）', async () => {
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('document', {
      createElement: () => ({ style: {}, setAttribute: () => {}, select: () => {}, setSelectionRange: () => {} }),
      body: { appendChild: () => {}, removeChild: () => {} },
      execCommand: () => false,
    })

    await expect(copyText('abc')).resolves.toBe(false)

    vi.unstubAllGlobals()
  })

  it('execCommand 抛异常也不炸（老浏览器 / 被策略禁掉）', () => {
    vi.stubGlobal('document', {
      createElement: () => ({
        style: {},
        setAttribute: () => {},
        select: () => {},
        setSelectionRange: () => {
          throw new Error('boom')
        },
      }),
      body: { appendChild: () => {}, removeChild: () => {} },
      execCommand: () => true,
    })

    expect(legacyCopy('abc')).toBe(false)

    vi.unstubAllGlobals()
  })
})
