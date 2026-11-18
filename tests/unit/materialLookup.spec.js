import { describe, expect, it } from 'vitest'
import { looksLikeDocNo } from '../../src/composables/useMaterialLookup'

/**
 * 物料「规格型号」里混进了 OA 单号（变更-228）。
 *
 * 使用方原话（2026-11-18）：「填完物料编码后……2.规格型号填充不对」
 * 实际数据：`/api/stock/list?keyword=劳务费` 返回
 *   `{ materialCode: '250000032', materialName: '劳务费', spec: 'F-FWCGSQ-20261109003' }`
 * —— 物料表里这一行的规格存的就是单据号，带进采购单就变成了错的规格。
 *
 * 这条判据要满足两件事：
 *   1. 本项目三种 OA 单号都认得出来（CG-CGSQ / F-FWCGSQ / F-ZCSG）；
 *   2. 真规格一个都别误伤（DN50、额定流量:50t/h、尺寸:100*55cm、99%）。
 * 误伤比漏认更糟：漏认只是带出脏数据，误伤会把真规格清空。
 */
describe('looksLikeDocNo', () => {
  it('认得出采购 / 服务采购 / 资产申购三种单号', () => {
    expect(looksLikeDocNo('CG-CGSQ-20261022006')).toBe(true)
    expect(looksLikeDocNo('F-FWCGSQ-20261109003')).toBe(true)
    expect(looksLikeDocNo('F-ZCSG-2026100008')).toBe(true)
    // 前后有空白也算（接口字段常带空格）
    expect(looksLikeDocNo('  F-FWCGSQ-20261109003  ')).toBe(true)
    // 小写也认（历史数据大小写不统一）
    expect(looksLikeDocNo('cg-cgsq-20261022006')).toBe(true)
  })

  it('真规格一个都不误伤', () => {
    const specs = [
      'DN50',
      '公称通径:DN50,公称压力:PN16',
      '额定流量:50t/h,扬程:8m',
      '尺寸:100*55cm',
      '长90CM*宽90CM*高100~110CM',
      '99%',
      '内径:φ75mm,壁厚:6mm',
      '1台',
      '',
      null,
      undefined,
    ]
    for (const spec of specs) {
      expect(looksLikeDocNo(spec), `「${spec}」被当成单据号了`).toBe(false)
    }
  })
})
