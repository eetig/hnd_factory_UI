import { describe, it, expect, vi, beforeEach } from 'vitest'

// API 层打桩：单测不真的发请求
vi.mock('../../src/api/request', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))

import request from '../../src/api/request'
import {
  buildTankLevelDraft,
  buildTankLevelQuery,
  buildTankLevelSavePayload,
  formatMeasure,
  normalizeTankLevelRecord,
  useTankLevelData,
} from '../../src/composables/useTankLevelData'

describe('formatMeasure：液位 / 理论质量的展示格式', () => {
  it('空值显示为空串，而不是把 null 印出来', () => {
    expect(formatMeasure(null)).toBe('')
    expect(formatMeasure(undefined)).toBe('')
    expect(formatMeasure('')).toBe('')
  })

  it('去掉浮点尾巴，最多保留 3 位小数', () => {
    expect(formatMeasure('1250.0000')).toBe('1250')
    expect(formatMeasure(0.1 + 0.2)).toBe('0.3')
    // 注意别拿 1250.5555 这类值当期望：它在二进制里略小于字面值，toFixed 不会进位
    expect(formatMeasure(1234.56789)).toBe('1234.568')
  })

  it('非数字原样返回，交给人工判断', () => {
    expect(formatMeasure('满罐')).toBe('满罐')
  })
})

describe('normalizeTankLevelRecord：接口行归一化', () => {
  it('日期截到 yyyy-MM-dd，数值列统一格式', () => {
    const record = normalizeTankLevelRecord({
      recordDate: '2026-08-31T00:00:00',
      levelValue: '1250.0000',
      theoreticalWeight: 1500,
    })

    expect(record.recordDate).toBe('2026-08-31')
    expect(record.levelValue).toBe('1250')
    expect(record.theoreticalWeight).toBe('1500')
  })

  it('字段名有出入时按别名取值；没有图据时 images 是空数组而不是 undefined', () => {
    const record = normalizeTankLevelRecord({
      date: '2026-08-31',
      tankNo: 'V150储罐A',
    })

    expect(record.recordDate).toBe('2026-08-31')
    expect(record.tankName).toBe('V150储罐A')
    // 列表要读 images[0] 与 images.length，留成 undefined 的话每处都得再判一次
    expect(record.images).toEqual([])
  })

  it('图据归一化成数组（变更-011）：多张按原顺序，保留 imageId 与双字段', () => {
    const record = normalizeTankLevelRecord({
      images: [
        { imageId: 3, url: '/files/a.png', thumbnailUrl: '/thumbs/a.png' },
        { imageId: 4, url: '/files/b.png', thumbnailUrl: '/thumbs/b.png' },
      ],
    })

    expect(record.images).toHaveLength(2)
    expect(record.images[0]).toEqual({
      imageId: 3,
      url: '/files/a.png',
      thumbnailUrl: '/thumbs/a.png',
    })
    expect(record.images[1].imageId).toBe(4)
  })

  it('图据字段名有出入时也认（url / imageUrl 两种写法）', () => {
    const record = normalizeTankLevelRecord({
      images: [{ id: 9, imageUrl: '/files/c.png' }],
    })

    expect(record.images).toHaveLength(1)
    expect(record.images[0].imageId).toBe(9)
    expect(record.images[0].url).toBe('/files/c.png')
  })

  it('容器编号按别名取值；缺失时留空，不从容器名称里猜', () => {
    expect(normalizeTankLevelRecord({ tankCode: 'V150-A' }).tankCode).toBe('V150-A')
    expect(normalizeTankLevelRecord({ equipmentCode: 'TCS-01' }).tankCode).toBe('TCS-01')
    // 容器名称与容器编号是两栏数据，缺编号就空着，免得页面显示一个假编号
    expect(normalizeTankLevelRecord({ tankName: 'V150储罐A' }).tankCode).toBe('')
  })

  it('空行返回 null（由调用方 filter 掉）', () => {
    expect(normalizeTankLevelRecord(null)).toBeNull()
  })
})

describe('buildTankLevelQuery：查询参数组装', () => {
  // ⚠️ 分页参数永远带上，且**不受**「空白条件不传」影响：
  // 后端把 pageNum / pageSize 标了必传（缺了回 400）—— 那是有意为之，
  // 老版 App 的请求里没有这两个参数，若给默认值它会安静地只拿到第 1 页（10 条），
  // 使用方看到的是「数据丢了」，比一个明确的 400 难排查得多。
  const PAGING = { pageNum: 1, pageSize: 10 }

  it('空白条件不传给后端（未传 = 不限制），但分页参数照带', () => {
    expect(
      buildTankLevelQuery({
        ...PAGING,
        startDate: '2026-01-01',
        endDate: '',
        location: '',
        category: '',
        keyword: '   ',
      }),
    ).toStrictEqual({ ...PAGING, startDate: '2026-01-01' })
  })

  it('关键字去掉首尾空格后传递', () => {
    expect(buildTankLevelQuery({ ...PAGING, keyword: ' V150 ' })).toStrictEqual({
      ...PAGING,
      keyword: 'V150',
    })
  })

  it('条件齐备时原样带上', () => {
    expect(
      buildTankLevelQuery({
        ...PAGING,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        location: '一车间',
        category: '产品',
        keyword: 'V150',
      }),
    ).toStrictEqual({
      ...PAGING,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      location: '一车间',
      category: '产品',
      keyword: 'V150',
    })
  })
})

describe('fetchTankLevelRecords：接口查询与异常处理', () => {
  beforeEach(() => {
    request.get.mockReset()
  })

  it('成功时按 /api/tank-level/list 取数并写入列表', async () => {
    request.get.mockResolvedValue({
      data: {
        success: true,
        dataList: [
          {
            id: 1,
            recordDate: '2026-08-31',
            location: '一车间',
            category: '产品',
            materialName: 'HND-V150',
            tankName: 'V150储罐A',
            tankCode: 'V150-A',
            levelValue: 1250,
            theoreticalWeight: 1500,
          },
        ],
        // ⚠️ 2026-10-10 起分页在服务端：总数必须取接口给的 total，不能拿 dataList.length 当总数，
        // 否则分页器永远只有一页（分页整改后最容易漏的一处）
        total: 37,
        pageNum: 1,
        pageSize: 10,
      },
    })

    const { fetchTankLevelRecords, tankLevelTableData, tankLevelTotal, tankLevelError, tankLevelPageNum } =
      useTankLevelData()

    await fetchTankLevelRecords()

    // 分页参数必传（后端缺参会回 400）
    expect(request.get).toHaveBeenCalledWith('/api/tank-level/list', {
      params: expect.objectContaining({ pageNum: 1, pageSize: 10 }),
    })
    expect(tankLevelTotal.value).toBe(37)
    expect(tankLevelTableData.value).toHaveLength(1)
    expect(tankLevelTableData.value[0]).toMatchObject({
      recordDate: '2026-08-31',
      tankName: 'V150储罐A',
      tankCode: 'V150-A',
      levelValue: '1250',
      theoreticalWeight: '1500',
    })
    expect(tankLevelError.value).toBe('')
    expect(tankLevelPageNum.value).toBe(1)
  })

  it('业务失败（HTTP 200 + success=false）取后端提示，且不留下半截数据', async () => {
    request.get.mockResolvedValue({ data: { success: false, msg: '库表不存在' } })

    const { fetchTankLevelRecords, tankLevelTableData, tankLevelTotal, tankLevelError } =
      useTankLevelData()

    await fetchTankLevelRecords()

    expect(tankLevelError.value).toBe('库表不存在')
    expect(tankLevelTotal.value).toBe(0)
    expect(tankLevelTableData.value).toEqual([])
  })

  it('接口不存在（404）时给出可操作提示', async () => {
    request.get.mockRejectedValue({ response: { status: 404 } })

    const { fetchTankLevelRecords, tankLevelError } = useTankLevelData()
    await fetchTankLevelRecords()

    expect(tankLevelError.value).toContain('接口不存在')
  })

  it('属地下拉失败不影响主表：选项清空、不抛错', async () => {
    request.get.mockRejectedValue(new Error('boom'))

    const { fetchTankLevelLocations, tankLevelLocations } = useTankLevelData()

    await expect(fetchTankLevelLocations()).resolves.toBeUndefined()
    expect(tankLevelLocations.value).toEqual([])
  })
})

describe('buildTankLevelDraft：列表行 → 编辑草稿', () => {
  it('带出可编辑字段，数值沿用列表里的展示字符串', () => {
    const draft = buildTankLevelDraft({
      id: 7,
      recordDate: '2026-08-31',
      location: '一车间',
      category: '产品',
      materialCode: '114001897',
      materialName: 'HND-V150',
      tankName: 'V150储罐A',
      tankCode: 'V150-A',
      levelValue: '1250',
      theoreticalWeight: '1500',
    })

    expect(draft).toEqual({
      id: 7,
      recordDate: '2026-08-31',
      location: '一车间',
      category: '产品',
      materialCode: '114001897',
      materialName: 'HND-V150',
      tankName: 'V150储罐A',
      tankCode: 'V150-A',
      levelValue: '1250',
      theoreticalWeight: '1500',
    })
  })

  it('新增行（传 null）得到一张 id 为空的空草稿，各字段是空串而不是 undefined', () => {
    const draft = buildTankLevelDraft(null)

    expect(draft.id).toBeNull()
    // 空串而不是 undefined：这些值直接绑到 input 的 v-model 上，
    // undefined 会让输入框从「非受控」变成「受控」，控制台会报 Vue 警告
    expect(draft.recordDate).toBe('')
    expect(draft.tankCode).toBe('')
    expect(draft.levelValue).toBe('')
  })
})

describe('buildTankLevelSavePayload：草稿 → 提交体', () => {
  it('文本字段去掉首尾空格', () => {
    const payload = buildTankLevelSavePayload({
      recordDate: '2026-08-31',
      tankCode: '  V150-A  ',
      tankName: ' V150储罐A ',
    })

    expect(payload.tankCode).toBe('V150-A')
    expect(payload.tankName).toBe('V150储罐A')
  })

  it('空串一律转 null：「没填」与「填了一个空值」在库里是两回事', () => {
    const payload = buildTankLevelSavePayload({
      recordDate: '2026-08-31',
      materialCode: '',
      materialName: '   ',
      levelValue: '',
      theoreticalWeight: undefined,
    })

    expect(payload.materialCode).toBeNull()
    expect(payload.materialName).toBeNull()
    expect(payload.levelValue).toBeNull()
    expect(payload.theoreticalWeight).toBeNull()
  })

  it('id 为空表示新增，原样保持 null（后端按 id 有无分流）', () => {
    expect(buildTankLevelSavePayload({ id: null }).id).toBeNull()
    expect(buildTankLevelSavePayload({ id: 12 }).id).toBe(12)
    // 空串 id 不能当成 0 之类的真值传下去，否则会被后端当成「编辑第 0 条」
    expect(buildTankLevelSavePayload({ id: '' }).id).toBeNull()
  })

  it('数值以字符串提交，交给后端 BigDecimal 解析', () => {
    const payload = buildTankLevelSavePayload({ levelValue: 1250, theoreticalWeight: '1500.5' })

    expect(payload.levelValue).toBe('1250')
    expect(payload.theoreticalWeight).toBe('1500.5')
  })
})

describe('saveTankLevelRecord：新增 / 编辑', () => {
  beforeEach(() => {
    request.get.mockReset()
    request.post.mockReset()
    request.get.mockResolvedValue({ data: { success: true, dataList: [] } })
  })

  it('POST /api/tank-level/save，成功后重新拉列表', async () => {
    request.post.mockResolvedValue({ data: { success: true, data: { id: 9 } } })

    const { saveTankLevelRecord } = useTankLevelData()
    const saved = await saveTankLevelRecord({ id: null, tankCode: 'V150-A' })

    expect(request.post).toHaveBeenCalledWith('/api/tank-level/save', expect.objectContaining({ tankCode: 'V150-A' }))
    expect(saved).toEqual({ id: 9 })
    expect(request.get).toHaveBeenCalledWith('/api/tank-level/list', { params: expect.any(Object) })
  })

  it('业务失败（HTTP 200 + success=false）抛出后端消息，且不再刷新列表', async () => {
    request.post.mockResolvedValue({
      data: { success: false, msg: '同一天已存在容器编号为「V150-A」的记录，请改记录日期或容器编号。' },
    })

    const { saveTankLevelRecord } = useTankLevelData()

    await expect(saveTankLevelRecord({ id: null })).rejects.toThrow('同一天已存在容器编号')
    // 保存没成功就不该刷新：刷了会让用户以为改动生效了
    expect(request.get).not.toHaveBeenCalled()
  })

  it('权限不足（403）时把后端的提示透出来，而不是吞成通用文案', async () => {
    request.post.mockRejectedValue({
      response: { status: 403, data: { msg: '无权限访问：tank_level:edit' } },
    })

    const { saveTankLevelRecord } = useTankLevelData()

    await expect(saveTankLevelRecord({ id: null })).rejects.toThrow('无权限访问：tank_level:edit')
  })

  it('保存后停在当前页，不把用户弹回第 1 页', async () => {
    // 服务端分页：每次取数都要按请求里的 pageNum 回对应的那一页
    request.get.mockImplementation((url, config) => {
      const page = config?.params?.pageNum ?? 1
      const all = Array.from({ length: 15 }, (_, i) => ({ id: i + 1, tankCode: `T-${i + 1}` }))
      return Promise.resolve({
        data: {
          success: true,
          dataList: all.slice((page - 1) * 10, page * 10),
          total: 15,
          pageNum: page,
        },
      })
    })
    request.post.mockResolvedValue({ data: { success: true, data: { id: 1 } } })

    const { saveTankLevelRecord, getTankLevelPageData, tankLevelPageNum, tankLevelTableData } =
      useTankLevelData()

    await saveTankLevelRecord({ id: null })
    await getTankLevelPageData(2)
    expect(tankLevelTableData.value).toHaveLength(5)
    expect(tankLevelPageNum.value).toBe(2)

    await saveTankLevelRecord({ id: 1 })

    // 保存后按**当前页**重取，而不是回到第 1 页（否则用户改完一行就被弹回开头）
    expect(tankLevelPageNum.value).toBe(2)
    expect(request.get.mock.calls.at(-1)[1].params).toMatchObject({ pageNum: 2 })
    // 页面内容仍是第 2 页的 5 条
    expect(tankLevelTableData.value).toHaveLength(5)
  })

  it('删除最后一条后页码不越界：停在新的末页而不是一张空表', async () => {
    // 11 条 / 每页 10 → 第 2 页只有 1 条；删掉之后只剩 10 条、只有 1 页
    request.get.mockImplementation((url, config) => {
      const page = config?.params?.pageNum ?? 1
      const remain = request.get.mock.calls.length > 2 ? 10 : 11
      const all = Array.from({ length: remain }, (_, i) => ({ id: i + 1, tankCode: `T-${i + 1}` }))
      return Promise.resolve({
        data: {
          success: true,
          dataList: all.slice((page - 1) * 10, page * 10),
          total: remain,
          pageNum: page,
        },
      })
    })
    request.delete.mockResolvedValue({ data: { success: true } })

    const { fetchTankLevelRecords, getTankLevelPageData, deleteTankLevelRecord, tankLevelPageNum, tankLevelTableData } =
      useTankLevelData()

    await fetchTankLevelRecords()
    await getTankLevelPageData(2)
    expect(tankLevelPageNum.value).toBe(2)

    // 删掉后只剩 10 条 → 只剩 1 页，页码必须跟着回到第 1 页，
    // 否则表格空着、分页器却停在第 2 页，看着像数据丢了
    await deleteTankLevelRecord(11)

    expect(tankLevelPageNum.value).toBe(1)
    expect(tankLevelTableData.value).toHaveLength(10)
  })
})

describe('deleteTankLevelRecord', () => {
  beforeEach(() => {
    request.get.mockReset()
    request.post.mockReset()
    request.delete.mockReset()
    request.get.mockResolvedValue({ data: { success: true, dataList: [] } })
  })

  it('删除走 DELETE /api/tank-level/delete，用 query 传 id', async () => {
    request.delete.mockResolvedValue({ data: { success: true } })

    const { deleteTankLevelRecord } = useTankLevelData()
    await deleteTankLevelRecord(5)

    expect(request.delete).toHaveBeenCalledWith('/api/tank-level/delete', { params: { id: 5 } })
  })
})
