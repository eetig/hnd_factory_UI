import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/api/request', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

import request from '../../src/api/request'
import {
  BILL_TYPE_PICK,
  confirmDocument,
  documentRowsToTableRows,
  fetchDocumentDetail,
  mergeRowsByMaterialCode,
  parseQty,
} from '../../src/composables/useOcrConfirm'

// 变更-047 把「图片识别确认入库」从「预检 + 合并」扩成了 047 契约的前端落点，
// 所以本文件的断言重心是三处规矩：
//   ① **合并键是「物料编码 + 日期」**：同物料不同日期**不合并** —— 库里它们本就是两条
//      合法行（新唯一键 D4），前端先合并掉的话这两条数据根本到不了后端；
//   ② **行身份**：库中行的 id 要一路带出去（载入 → 表格 → payload），丢一次
//      「改的更新」就退化成「新增」（后端只能按「第X行已不存在」409 拒掉）；
//   ③ **只增不改**：新字段（mode / expectedRowCount / allowEmpty）给了才发 ——
//      不给时 payload 里连键都没有，老 PC dist 的行为逐字不变（统筹文档 §7）。
describe('useOcrConfirm（变更-047）：合并键、行身份与 payload', () => {
  beforeEach(() => {
    request.get.mockReset()
    request.post.mockReset()
  })

  describe('mergeRowsByMaterialCode：分组键是「物料编码 + 日期」', () => {
    it('同物料同日期两行相加（识别把一行拆成两行的老问题）', () => {
      const { rows, merges } = mergeRowsByMaterialCode([
        { index: 1, materialCode: '111001785', materialName: '硅粉', quantity: '6000', unit: 'kg', date: '2026-09-20' },
        { index: 2, materialCode: '111001785', materialName: '硅粉', quantity: '0.5', unit: 'kg', date: '2026-09-20' },
      ])

      expect(rows).toHaveLength(1)
      expect(rows[0].qty).toBe(6000.5)
      expect(rows[0].count).toBe(2)
      expect(merges).toEqual([
        { code: '111001785', date: '2026-09-20', name: '硅粉', before: 6000, add: 0.5, after: 6000.5 },
      ])
    })

    it('★同物料**不同日期**不合并：两行各自留下，日期是它们各自的身份', () => {
      const { rows, merges } = mergeRowsByMaterialCode([
        { index: 1, materialCode: '111001785', materialName: '硅粉', quantity: '6000', unit: 'kg', date: '2026-09-20' },
        { index: 2, materialCode: '111001785', materialName: '硅粉', quantity: '6000', unit: 'kg', date: '2026-09-21' },
      ])

      expect(merges).toEqual([])
      expect(rows.map((row) => [row.materialCode, row.date, row.qty])).toEqual([
        ['111001785', '2026-09-20', 6000],
        ['111001785', '2026-09-21', 6000],
      ])
    })

    it('日期缺失按空串参与分组（与后端 DocMaterialDateKey 同口径：NULL 归空串）', () => {
      const { rows } = mergeRowsByMaterialCode([
        { index: 1, materialCode: 'A', quantity: '1', date: null },
        { index: 2, materialCode: 'A', quantity: '2', date: '' },
      ])

      expect(rows).toHaveLength(1)
      expect(rows[0].date).toBe('')
      expect(rows[0].qty).toBe(3)
    })

    it('合并后的行保留第一条非空 id（库中行外又加同名同日期的一行时，仍认得出既有行）', () => {
      const { rows } = mergeRowsByMaterialCode([
        { index: 1, id: null, materialCode: 'A', quantity: '1', date: '2026-09-20' },
        { index: 2, id: 191, materialCode: 'A', quantity: '2', date: '2026-09-20' },
      ])

      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe(191)
    })

    it('seqNo 取该组第一行的序号（列序 = 载荷顺序，后端按它重排）', () => {
      const { rows } = mergeRowsByMaterialCode([
        { index: 1, materialCode: 'A', quantity: '1', date: '2026-09-20' },
        { index: 4, materialCode: 'B', quantity: '1', date: '2026-09-20' },
      ])

      expect(rows.map((row) => row.seqNo)).toEqual([1, 4])
    })
  })

  describe('documentRowsToTableRows：库中行 → 可编辑行（id 是行身份）', () => {
    it('保留 id / date，数量去掉尾部零', () => {
      const rows = documentRowsToTableRows([
        {
          id: 191,
          seqNo: 1,
          materialName: '硅粉',
          materialCode: '111001785',
          qty: 6000.0,
          unit: 'kg',
          date: '2026-09-20',
        },
      ])

      expect(rows).toEqual([
        {
          id: 191,
          materialName: '硅粉',
          materialCode: '111001785',
          quantity: '6000',
          unit: 'kg',
          date: '2026-09-20',
        },
      ])
    })

    it('缺字段兜底成空（后端没给图的那些列不该变成 undefined 传给输入框）', () => {
      expect(documentRowsToTableRows([{ id: 7 }])).toEqual([
        { id: 7, materialName: '', materialCode: '', quantity: '', unit: '', date: '' },
      ])
    })
  })

  describe('confirmDocument：payload 只增不改', () => {
    const rows = [
      {
        id: 191,
        seqNo: 1,
        materialName: '硅粉',
        materialCode: '111001785',
        qty: '6000',
        unit: 'kg',
        date: '2026-09-20',
      },
    ]

    function lastPayload() {
      const formData = request.post.mock.calls[0][1]
      return JSON.parse(formData.get('payload'))
    }

    it('document 模式：mode / expectedRowCount / allowEmpty 与行级 id、date 全都发出去', async () => {
      request.post.mockResolvedValue({ data: { code: 200, success: true, data: { addCount: 1 } } })

      await confirmDocument({
        billType: BILL_TYPE_PICK,
        documentNo: '0031271',
        mode: 'document',
        expectedRowCount: 2,
        allowEmpty: true,
        rows,
        file: new File(['x'], 'bill.png', { type: 'image/png' }),
      })

      expect(request.post.mock.calls[0][0]).toBe('/api/work-order/ocr/confirm')
      expect(lastPayload()).toEqual({
        billType: 'material_pick_summary',
        documentNo: '0031271',
        mode: 'document',
        expectedRowCount: 2,
        allowEmpty: true,
        rows,
      })
      // 单据级 date 不带（legacy 口径，日期已下沉到行）
      expect(lastPayload().date).toBeUndefined()
    })

    it('edit 模式也照传 file（后端惰性取图；不传会让编辑态新增的行静默没有线下单据图）', async () => {
      request.post.mockResolvedValue({ data: { code: 200, success: true, data: {} } })

      await confirmDocument({
        billType: BILL_TYPE_PICK,
        documentNo: '0031271',
        mode: 'document',
        expectedRowCount: 2,
        rows,
        file: new File(['x'], 'bill.png', { type: 'image/png' }),
      })

      const formData = request.post.mock.calls[0][1]
      expect(formData.get('file').name).toBe('bill.png')
    })

    it('不传 file 时不发 file 段（新行确实不需要图的那种调用）', async () => {
      request.post.mockResolvedValue({ data: { code: 200, success: true, data: {} } })

      await confirmDocument({ billType: BILL_TYPE_PICK, documentNo: '0031271', mode: 'document', rows })

      expect(request.post.mock.calls[0][1].get('file')).toBeNull()
    })

    it('legacy 调用（老代码那条路）：payload 里连 mode / expectedRowCount / allowEmpty 这几个键都没有', async () => {
      request.post.mockResolvedValue({ data: { code: 200, success: true, data: { skipCount: 2 } } })

      await confirmDocument({
        billType: BILL_TYPE_PICK,
        documentNo: '0031271',
        date: '2026-09-20',
        rows: [{ seqNo: 1, materialName: '硅粉', materialCode: '111001785', qty: '6000', unit: 'kg' }],
        file: new File(['x'], 'bill.png', { type: 'image/png' }),
      })

      expect(Object.keys(lastPayload()).sort()).toEqual(['billType', 'date', 'documentNo', 'rows'])
    })

    it('业务失败也是 HTTP 200：抛出的 Error 带 businessCode（409 靠它认出来）', async () => {
      request.post.mockResolvedValue({
        data: { code: 409, success: false, msg: '单据已被他人修改（载入时 2 行，当前 3 行），请重新载入后再保存' },
      })

      await expect(
        confirmDocument({ billType: BILL_TYPE_PICK, documentNo: '0031271', mode: 'document', rows }),
      ).rejects.toMatchObject({
        businessCode: 409,
        message: '单据已被他人修改（载入时 2 行，当前 3 行），请重新载入后再保存',
      })
    })

    it('返回体里没有 data（老后端的响应）时不报错，给一个空对象', async () => {
      request.post.mockResolvedValue({ data: { code: 200, success: true } })

      await expect(
        confirmDocument({ billType: BILL_TYPE_PICK, documentNo: '0031271', rows }),
      ).resolves.toEqual({})
    })
  })

  describe('fetchDocumentDetail：查一张单据的全部明细', () => {
    const detail = {
      billType: 'material_pick_summary',
      documentNo: '0031271',
      exists: true,
      rowCount: 2,
      imageUrl: '/files/x.jpg',
      thumbnailUrl: '/thumbs/x.jpg',
      rows: [{ id: 191, seqNo: 1, materialName: '硅粉', materialCode: '111001785', qty: 6000, unit: 'kg', date: '2026-09-20' }],
    }

    it('查询参数是 billType + documentNo，返回体里的 data 原样给出', async () => {
      request.get.mockResolvedValue({ data: { code: 200, success: true, data: detail } })

      await expect(
        fetchDocumentDetail({ billType: BILL_TYPE_PICK, documentNo: '0031271' }),
      ).resolves.toEqual(detail)
      expect(request.get).toHaveBeenCalledWith('/api/work-order/document/detail', {
        params: { billType: 'material_pick_summary', documentNo: '0031271' },
      })
    })

    it('不存在不是错误：exists:false 正常返回（前端据此走「新单据」分支）', async () => {
      request.get.mockResolvedValue({
        data: { code: 200, success: true, data: { exists: false, rowCount: 0, rows: [] } },
      })

      await expect(
        fetchDocumentDetail({ billType: BILL_TYPE_PICK, documentNo: 'TEST-1' }),
      ).resolves.toMatchObject({ exists: false, rowCount: 0, rows: [] })
    })

    it('业务失败抛错并带 businessCode（核对失败要能显示后端原文案）', async () => {
      request.get.mockResolvedValue({ data: { code: 500, success: false, msg: '单据类型不合法：xxx' } })

      await expect(
        fetchDocumentDetail({ billType: 'xxx', documentNo: '0031271' }),
      ).rejects.toMatchObject({ businessCode: 500, message: '单据类型不合法：xxx' })
    })
  })

  describe('parseQty：与后端 ImportUtil 的容忍度一致', () => {
    it('去千分位与空白，解析不出返回 null', () => {
      expect(parseQty(' 1,234.5 ')).toBe(1234.5)
      expect(parseQty('')).toBeNull()
      expect(parseQty('—')).toBeNull()
    })
  })
})
