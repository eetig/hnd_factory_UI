import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../src/api/request', () => ({
  default: { get: vi.fn() },
}))

import request from '../../src/api/request'
import {
  cancelEquipmentSearch,
  fetchEquipmentSuggestions,
  searchEquipment,
  useEquipmentLedger,
} from '../../src/composables/useEquipmentLedger'

// 设备台账里的一行（字段名对齐 EquipmentLedgerVO）
const ROWS = [
  { id: 1, equipmentCode: '', equipmentName: '三甲加料罐', workshop: '三甲', spec: 'DN1600x2000' },
  { id: 2, equipmentCode: '', equipmentName: '150产品罐', workshop: '一车间', spec: 'DN2400x1700' },
]

describe('useEquipmentLedger：容器名称的候选取自设备台账', () => {
  // options 是模块级单例，跨用例共享 —— 每个用例前清一次，免得读到上一个用例的残留
  const { equipmentOptions } = useEquipmentLedger()

  beforeEach(() => {
    request.get.mockReset()
    equipmentOptions.value = []
  })

  afterEach(() => {
    cancelEquipmentSearch()
    vi.useRealTimers()
  })

  it('带关键字与条数上限请求，候选取设备名称并带规格供辨认', async () => {
    request.get.mockResolvedValue({ data: { success: true, data: ROWS } })

    const options = await searchEquipment(' 三甲 ')

    // 关键字去空白后再发，免得「三甲 」和「三甲」被后端当成两次不同的检索
    expect(request.get).toHaveBeenCalledWith('/api/equipment/search', {
      params: { keyword: '三甲', limit: 100 },
    })
    expect(options).toEqual([
      { code: '', name: '三甲加料罐', spec: 'DN1600x2000', workshop: '三甲' },
      { code: '', name: '150产品罐', spec: 'DN2400x1700', workshop: '一车间' },
    ])
    expect(equipmentOptions.value).toHaveLength(2)
  })

  it('名称缺失的行不进候选（没名字的选项选不了）', async () => {
    request.get.mockResolvedValue({
      data: { success: true, data: [...ROWS, { id: 3, equipmentName: '' }] },
    })

    const options = await searchEquipment('罐')

    expect(options).toHaveLength(2)
  })

  it('接口失败只清空候选、不抛错：下拉取不到不该打断填表', async () => {
    request.get.mockRejectedValue(new Error('boom'))

    await expect(searchEquipment('罐')).resolves.toEqual([])
    expect(equipmentOptions.value).toEqual([])
  })

  it('过期响应不覆盖新结果：先发的慢请求后到也不能盖掉后发的', async () => {
    let resolveSlow
    request.get
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSlow = resolve
          }),
      )
      .mockResolvedValueOnce({ data: { success: true, data: [ROWS[1]] } })

    const slow = searchEquipment('三')
    const fast = searchEquipment('150')
    await fast
    resolveSlow({ data: { success: true, data: [ROWS[0]] } })
    await slow

    expect(equipmentOptions.value.map((option) => option.name)).toEqual(['150产品罐'])
  })

  it('空关键字立即检索、不防抖：点开下拉就该看到全部候选，不该再等 300ms', async () => {
    vi.useFakeTimers()
    request.get.mockResolvedValue({ data: { success: true, data: ROWS } })
    const callback = vi.fn()

    fetchEquipmentSuggestions('', callback)
    // 一个定时器都不该挂上 —— 这就是「不防抖」的证据
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(0)

    expect(request.get).toHaveBeenCalledWith('/api/equipment/search', {
      params: { keyword: '', limit: 100 },
    })
    expect(callback).toHaveBeenCalledWith([
      { code: '', name: '三甲加料罐', spec: 'DN1600x2000', workshop: '三甲' },
      { code: '', name: '150产品罐', spec: 'DN2400x1700', workshop: '一车间' },
    ])
  })

  it('防抖：连续输入只在停下 300ms 后打一次接口，并把结果交给回调', async () => {
    vi.useFakeTimers()
    request.get.mockResolvedValue({ data: { success: true, data: [ROWS[0]] } })
    const callback = vi.fn()

    fetchEquipmentSuggestions('三', callback)
    fetchEquipmentSuggestions('三甲', callback)
    fetchEquipmentSuggestions('三甲加', callback)
    expect(request.get).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(300)

    expect(request.get).toHaveBeenCalledTimes(1)
    expect(request.get.mock.calls[0][1].params.keyword).toBe('三甲加')
    expect(callback).toHaveBeenCalledWith([
      { code: '', name: '三甲加料罐', spec: 'DN1600x2000', workshop: '三甲' },
    ])
  })
})
