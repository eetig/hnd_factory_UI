import { describe, it, expect, vi, beforeEach } from 'vitest'

// API 层打桩：单测不真的发请求
vi.mock('../../src/api/request', () => ({
  default: { get: vi.fn() },
}))

import request from '../../src/api/request'
import {
  buildTankLevelQuery,
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

  it('字段名有出入时按别名取值；图片缺失不报错', () => {
    const record = normalizeTankLevelRecord({
      date: '2026-08-31',
      tankNo: 'V150储罐A',
      fileUrl: '/files/tank.png',
    })

    expect(record.recordDate).toBe('2026-08-31')
    expect(record.tankName).toBe('V150储罐A')
    expect(record.imageUrl).toBe('/files/tank.png')
    expect(record.thumbnailUrl).toBe('')
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
  it('空白条件不传给后端（未传 = 不限制）', () => {
    expect(
      buildTankLevelQuery({
        startDate: '2026-01-01',
        endDate: '',
        location: '',
        category: '',
        keyword: '   ',
      }),
    ).toEqual({ startDate: '2026-01-01' })
  })

  it('关键字去掉首尾空格后传递', () => {
    expect(buildTankLevelQuery({ keyword: ' V150 ' })).toEqual({ keyword: 'V150' })
  })

  it('条件齐备时原样带上', () => {
    expect(
      buildTankLevelQuery({
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        location: '一车间',
        category: '产品',
        keyword: 'V150',
      }),
    ).toEqual({
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
      },
    })

    const { fetchTankLevelRecords, tankLevelTableData, tankLevelTotal, tankLevelError } =
      useTankLevelData()

    await fetchTankLevelRecords()

    expect(request.get).toHaveBeenCalledWith('/api/tank-level/list', {
      params: expect.any(Object),
    })
    expect(tankLevelTotal.value).toBe(1)
    expect(tankLevelTableData.value).toHaveLength(1)
    expect(tankLevelTableData.value[0]).toMatchObject({
      recordDate: '2026-08-31',
      tankName: 'V150储罐A',
      tankCode: 'V150-A',
      levelValue: '1250',
      theoreticalWeight: '1500',
    })
    expect(tankLevelError.value).toBe('')
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
