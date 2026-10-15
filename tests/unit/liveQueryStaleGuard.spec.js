import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/api/request', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

import request from '../../src/api/request'
import { useMaterialStockData } from '../../src/composables/useMaterialStockData'
import { useTankLevelData } from '../../src/composables/useTankLevelData'
import { useEquipmentLedgerData } from '../../src/composables/useEquipmentLedgerData'

/**
 * 过期响应护栏的行为测试（变更-066）。
 *
 * 这三条护栏原先只有**源码字符串断言**兜着，而那种断言抓不到任何东西：
 * `toContain('if (seq !== stockRequestSeq) return')` 分不清这句话在文件里出现 2 次还是 1 次 ——
 * 删掉 catch 分支那一条、只留 try 里那条，断言照样绿，而过期请求的**失败**就会覆盖新结果。
 *
 * 这里用可控的 deferred 让"先发的请求后回来"成为**确定事实**（不靠 sleep 赌时序），
 * 然后逐条断言数据 / 错误 / loading 三个通道都不被旧响应写。
 */
function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const ok = (dataList, total) => ({ data: { success: true, dataList, total, pageNum: 1 } })

describe('过期响应护栏：慢的旧请求后回来时，一个通道都不许写', () => {
  beforeEach(() => {
    request.get.mockReset()
  })

  describe('物料查询（useMaterialStockData）', () => {
    const api = useMaterialStockData()

    beforeEach(() => {
      api.stockTableData.value = []
      api.stockTotal.value = 0
      api.stockError.value = ''
      api.stockLoading.value = false
      api.stockKeyword.value = ''
    })

    it('旧响应晚到：不许覆盖数据，也不许改总数', async () => {
      const older = deferred()
      const newer = deferred()
      request.get.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)

      const first = api.fetchStockRecords()
      const second = api.fetchStockRecords()

      newer.resolve(ok([{ materialCode: 'M-NEW', materialName: '新结果' }], 1))
      await second
      expect(api.stockTableData.value.map((r) => r.materialCode)).toEqual(['M-NEW'])

      older.resolve(ok([{ materialCode: 'M-OLD', materialName: '旧结果' }], 99))
      await first

      expect(api.stockTableData.value.map((r) => r.materialCode), '旧响应把新结果盖掉了').toEqual([
        'M-NEW',
      ])
      expect(api.stockTotal.value, '旧响应的总数盖掉了新的').toBe(1)
    })

    it('过期请求的失败不算数：不许写错误，也不许清空已经显示的行', async () => {
      const older = deferred()
      const newer = deferred()
      request.get.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)

      const first = api.fetchStockRecords()
      const second = api.fetchStockRecords()
      newer.resolve(ok([{ materialCode: 'M-NEW', materialName: '新结果' }], 1))
      await second

      older.reject(new Error('用户已经改了条件，这次失败不该报出来'))
      await first

      expect(api.stockError.value, '过期请求的失败写进了错误位').toBe('')
      expect(api.stockTableData.value, '过期请求的失败把已显示的行清空了').toHaveLength(1)
    })

    it('旧请求结束不许把新请求的 loading 提前关掉', async () => {
      const older = deferred()
      const newer = deferred()
      request.get.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)

      const first = api.fetchStockRecords()
      const second = api.fetchStockRecords()
      expect(api.stockLoading.value).toBe(true)

      older.resolve(ok([], 0))
      await first
      expect(api.stockLoading.value, '旧请求结束时把新请求的 loading 关了').toBe(true)

      newer.resolve(ok([{ materialCode: 'M-NEW', materialName: '新结果' }], 1))
      await second
      expect(api.stockLoading.value).toBe(false)
    })
  })

  describe('储罐液位（useTankLevelData）', () => {
    const api = useTankLevelData()

    beforeEach(() => {
      api.tankLevelTableData.value = []
      api.tankLevelTotal.value = 0
      api.tankLevelError.value = ''
      api.tankLevelLoading.value = false
      api.tankLevelPageNum.value = 1
    })

    it('旧响应晚到：总数不被覆盖（数据通道以总数为观测量，行归一化由 tankLevel.spec.js 覆盖）', async () => {
      const older = deferred()
      const newer = deferred()
      request.get.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)

      const first = api.fetchTankLevelRecords()
      const second = api.fetchTankLevelRecords()
      newer.resolve(ok([{ tankNo: '1#', measure: '100' }], 1))
      await second
      expect(api.tankLevelTotal.value).toBe(1)

      older.resolve(ok([], 5))
      await first
      expect(api.tankLevelTotal.value, '旧响应的总数盖掉了新的').toBe(1)
    })

    it('过期请求的失败不算数：不写错误、loading 也不被提前关掉', async () => {
      const older = deferred()
      const newer = deferred()
      request.get.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)

      const first = api.fetchTankLevelRecords()
      const second = api.fetchTankLevelRecords()

      older.reject(new Error('过期失败'))
      await first
      expect(api.tankLevelError.value, '过期请求的失败写进了错误位').toBe('')
      expect(api.tankLevelLoading.value, '旧请求结束时把新请求的 loading 关了').toBe(true)

      newer.resolve(ok([{ tankNo: '1#', measure: '100' }], 1))
      await second
      expect(api.tankLevelLoading.value).toBe(false)
    })
  })

  describe('设备台账（useEquipmentLedgerData）', () => {
    const api = useEquipmentLedgerData()

    beforeEach(() => {
      api.rows.value = []
      api.total.value = 0
      api.loadError.value = ''
      api.loading.value = false
    })

    it('旧响应晚到：不许覆盖行，也不许写 loadError', async () => {
      const older = deferred()
      const newer = deferred()
      request.get.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)

      const first = api.loadLedger()
      const second = api.loadLedger()
      newer.resolve(ok([{ id: 2, equipmentName: '新结果' }], 1))
      await second
      expect(api.rows.value.map((r) => r.id)).toEqual([2])

      older.resolve(ok([{ id: 1, equipmentName: '旧结果' }], 9))
      await first
      expect(api.rows.value.map((r) => r.id), '旧响应把新结果盖掉了').toEqual([2])
      expect(api.total.value).toBe(1)
      expect(api.loadError.value).toBe('')
    })

    it('过期请求的失败不算数：本页「失败不清空数据」，所以尤其不能让旧错误写进 loadError', async () => {
      const older = deferred()
      const newer = deferred()
      request.get.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)

      const first = api.loadLedger()
      const second = api.loadLedger()
      newer.resolve(ok([{ id: 2, equipmentName: '新结果' }], 1))
      await second

      older.reject(new Error('过期失败'))
      await first

      expect(api.loadError.value, '过期请求的失败写进了错误位').toBe('')
      expect(api.rows.value.map((r) => r.id)).toEqual([2])
      expect(api.loading.value).toBe(false)
    })
  })
})
