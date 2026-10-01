import { describe, it, expect, vi, beforeEach } from 'vitest'

// 打桩工单数据源：本文件只验证图片弹窗这一件事，不关心工单列表怎么来的
vi.mock('../../src/composables/useWorkOrderData', async () => {
  const { ref } = await import('vue')
  const allWorkOrders = ref([])
  const tableDataAll = ref([])
  const filterWorkOrders = vi.fn()
  const fetchWorkOrders = vi.fn(async () => {})

  return {
    useWorkOrderData: () => ({
      allWorkOrders,
      tableDataAll,
      filterWorkOrders,
      fetchWorkOrders,
    }),
  }
})

vi.mock('../../src/api/request', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

import { ElMessageBox } from 'element-plus'
import request from '../../src/api/request'
import { useOrderImages } from '../../src/composables/useOrderImages'
import { useWorkOrderData } from '../../src/composables/useWorkOrderData'

const images = [
  { imageId: '1', url: '/files/a.jpg', thumbnailUrl: '/thumbs/a.jpg' },
  { imageId: '2', url: '/files/b.jpg', thumbnailUrl: '/thumbs/b.jpg' },
]

describe('useOrderImages：工单图片弹窗（工单汇总 / 周统计共用的一份实现）', () => {
  let api

  beforeEach(() => {
    api = useOrderImages()
    const { allWorkOrders, tableDataAll, filterWorkOrders, fetchWorkOrders } = useWorkOrderData()

    allWorkOrders.value = []
    tableDataAll.value = []
    filterWorkOrders.mockClear()
    fetchWorkOrders.mockClear()
    request.get.mockReset()
    request.post.mockReset()
    request.delete.mockReset()
    request.get.mockResolvedValue({ data: { success: true, data: images } })
  })

  it('openImageDialog 带上工单表头信息，并从接口拉最新图片列表', async () => {
    await api.openImageDialog({
      orderNo: '1000001',
      materialDesc: 'HND-V150',
      confirmedQty: 12,
      imageList: [],
    })

    expect(api.dialogVisible.value).toBe(true)
    expect(api.currentOrderNo.value).toBe('1000001')
    expect(api.currentMaterialDesc.value).toBe('HND-V150')
    expect(api.currentConfirmedQty.value).toBe(12)
    expect(api.currentIndex.value).toBe(0)
    expect(api.imageList.value).toEqual(images)

    expect(request.get).toHaveBeenCalledWith('/api/work-order/image/list', {
      params: { orderNo: '1000001' },
    })
  })

  it('字段缺失时用占位符，不会把 undefined 显示到弹窗上', async () => {
    await api.openImageDialog({ orderNo: '1000002' })

    expect(api.currentMaterialDesc.value).toBe('-')
    expect(api.currentConfirmedQty.value).toBe('-')
  })

  it('翻页在首尾之间循环', () => {
    api.imageList.value = images
    api.currentIndex.value = 0

    api.showPreviousImage()
    expect(api.currentIndex.value).toBe(1)

    api.showNextImage()
    expect(api.currentIndex.value).toBe(0)
  })

  it('没有图片时翻页不越界', () => {
    api.imageList.value = []
    api.currentIndex.value = 0

    api.showPreviousImage()
    api.showNextImage()

    expect(api.currentIndex.value).toBe(0)
  })

  it('上传成功后把新图片追加进列表，并同步工单数据源里的 imageList', async () => {
    const { allWorkOrders, tableDataAll, filterWorkOrders } = useWorkOrderData()
    allWorkOrders.value = [{ orderNo: '1000001', imageList: [] }]
    tableDataAll.value = [{ orderNo: '1000001', imageList: [] }]

    api.currentOrderNo.value = '1000001'
    api.imageList.value = images
    request.post.mockResolvedValue({
      data: { success: true, data: [{ imageId: '3', url: '/files/c.jpg' }] },
    })

    await api.uploadImages([new File(['x'], 'c.jpg', { type: 'image/jpeg' })])

    expect(request.post).toHaveBeenCalledTimes(1)
    const [url, formData] = request.post.mock.calls[0]
    expect(url).toBe('/api/work-order/image/upload')
    expect(formData.get('orderNo')).toBe('1000001')
    expect(formData.getAll('files')).toHaveLength(1)

    expect(api.imageList.value).toHaveLength(3)
    // 列表页的数据源也要更新，否则关掉弹窗还显示旧图
    expect(allWorkOrders.value[0].imageList).toHaveLength(3)
    expect(tableDataAll.value[0].imageList).toHaveLength(3)
    expect(filterWorkOrders).toHaveBeenCalled()
  })

  it('上传接口返回 success:false 时不改动列表（业务失败也是 HTTP 200）', async () => {
    api.currentOrderNo.value = '1000001'
    api.imageList.value = images
    request.post.mockResolvedValue({ data: { success: false, msg: '磁盘满了' } })

    await api.uploadImages([new File(['x'], 'c.jpg', { type: 'image/jpeg' })])

    expect(api.imageList.value).toEqual(images)
  })

  it('删除：确认后从列表移除并同步数据源', async () => {
    const { allWorkOrders } = useWorkOrderData()
    allWorkOrders.value = [{ orderNo: '1000001', imageList: images }]

    api.currentOrderNo.value = '1000001'
    api.imageList.value = [...images]
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
    request.delete.mockResolvedValue({ data: { success: true } })

    await api.deleteImage(images[0])

    expect(request.delete).toHaveBeenCalledWith('/api/work-order/image/delete', {
      params: { imageId: '1' },
      data: { imageId: '1' },
    })
    expect(api.imageList.value).toEqual([images[1]])
    expect(allWorkOrders.value[0].imageList).toEqual([images[1]])
  })

  it('删除：用户取消确认时一个请求都不发', async () => {
    api.currentOrderNo.value = '1000001'
    api.imageList.value = [...images]
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancel'))

    await api.deleteImage(images[0])

    expect(request.delete).not.toHaveBeenCalled()
    expect(api.imageList.value).toEqual(images)
  })

  it('没有 imageId / 没有当前工单时删除直接返回', async () => {
    api.currentOrderNo.value = ''
    await api.deleteImage({ imageId: '1' })
    await api.deleteImage({})

    expect(request.delete).not.toHaveBeenCalled()
  })
})
