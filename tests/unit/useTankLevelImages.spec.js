import { describe, it, expect, vi, beforeEach } from 'vitest'

// 打桩液位列表数据源：本文件只验证图据弹窗这一件事，
// 上传/删除后「顺手刷列表让角标跟着变」这一步另有断言
vi.mock('../../src/composables/useTankLevelData', async () => {
  const fetchTankLevelRecords = vi.fn(async () => {})
  return {
    useTankLevelData: () => ({ fetchTankLevelRecords }),
  }
})

vi.mock('../../src/api/request', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))

import { ElMessage, ElMessageBox } from 'element-plus'
import request from '../../src/api/request'
import { useTankLevelData } from '../../src/composables/useTankLevelData'
import { useTankLevelImages } from '../../src/composables/useTankLevelImages'

const RECORD_IMAGES = [
  { imageId: 11, url: '/files/a.png', thumbnailUrl: '/thumbs/a.png' },
  { imageId: 12, url: '/files/b.png', thumbnailUrl: '/thumbs/b.png' },
]

const RECORD = {
  id: 7,
  recordDate: '2026-08-31',
  tankName: 'V150储罐A',
  tankCode: 'V150-A',
  images: RECORD_IMAGES,
}

describe('useTankLevelImages：储罐液位图据弹窗（可多张）', () => {
  let api
  let fetchTankLevelRecords

  beforeEach(() => {
    api = useTankLevelImages()
    fetchTankLevelRecords = useTankLevelData().fetchTankLevelRecords

    request.get.mockReset()
    request.post.mockReset()
    request.delete.mockReset()
    fetchTankLevelRecords.mockClear()
    request.get.mockResolvedValue({ data: { success: true, data: RECORD_IMAGES } })

    vi.spyOn(ElMessage, 'success').mockImplementation(() => {})
    vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
  })

  it('打开弹窗：先用手上的 images 渲染，再拉一份最新的，标题带上记录的三个字段', async () => {
    await api.openImageDialog(RECORD)

    expect(api.dialogVisible.value).toBe(true)
    expect(api.currentTitle.value).toEqual([
      { label: '记录日期', value: '2026-08-31' },
      { label: '容器名称', value: 'V150储罐A' },
      { label: '容器编号', value: 'V150-A' },
    ])
    expect(request.get).toHaveBeenCalledWith('/api/tank-level/image/list', {
      params: { recordId: 7 },
    })
    expect(api.images.value).toHaveLength(2)
  })

  it('拉最新列表失败时保留打开时那份，不把弹窗清空', async () => {
    request.get.mockRejectedValue(new Error('boom'))

    await api.openImageDialog(RECORD)

    expect(api.images.value).toHaveLength(2)
  })

  it('翻页首尾循环', async () => {
    await api.openImageDialog(RECORD)
    expect(api.currentIndex.value).toBe(0)

    api.showNextImage()
    expect(api.currentIndex.value).toBe(1)
    api.showNextImage()
    expect(api.currentIndex.value).toBe(0)

    api.showPreviousImage()
    expect(api.currentIndex.value).toBe(1)
  })

  it('上传：multipart 带 recordId 与多个 files，成功后追加并跳到最新一张', async () => {
    request.post.mockResolvedValue({
      data: { success: true, data: [{ imageId: 13, url: '/files/c.png' }] },
    })
    await api.openImageDialog(RECORD)

    await api.uploadImages([
      new File(['x'], 'c.png', { type: 'image/png' }),
      new File(['y'], 'd.png', { type: 'image/png' }),
    ])

    const [url, body] = request.post.mock.calls[0]
    expect(url).toBe('/api/tank-level/image/upload')
    expect(body).toBeInstanceOf(FormData)
    expect(body.get('recordId')).toBe('7')
    expect(body.getAll('files')).toHaveLength(2)
    expect(api.images.value).toHaveLength(3)
    // 跳到刚传的那张：用户接着就能确认「传的是不是这张」
    expect(api.currentIndex.value).toBe(2)
    expect(fetchTankLevelRecords).toHaveBeenCalledWith({ keepPage: true })
  })

  it('上传业务失败：提示后端消息，且不往列表里塞图', async () => {
    request.post.mockResolvedValue({
      data: { success: false, msg: '图据只支持 PNG / JPG 格式：a.gif' },
    })
    await api.openImageDialog(RECORD)

    await api.uploadImages([new File(['x'], 'a.gif', { type: 'image/gif' })])

    expect(ElMessage.error).toHaveBeenCalledWith('图据只支持 PNG / JPG 格式：a.gif')
    expect(api.images.value).toHaveLength(2)
  })

  it('未保存的记录（没有 id）不上传', async () => {
    await api.openImageDialog({ recordDate: '2026-08-31', tankName: '新罐', tankCode: '', images: [] })

    await api.uploadImages([new File(['x'], 'c.png', { type: 'image/png' })])

    expect(request.post).not.toHaveBeenCalled()
  })

  it('按 id 直接传图（不进弹窗）：返回图据列表，但不动弹窗状态、也不弹提示', async () => {
    request.post.mockResolvedValue({
      data: { success: true, data: [{ imageId: 21, url: '/files/e.png' }] },
    })

    const uploaded = await api.uploadImagesForRecord(77, [
      new File(['x'], 'e.png', { type: 'image/png' }),
    ])

    expect(request.post.mock.calls[0][0]).toBe('/api/tank-level/image/upload')
    expect(request.post.mock.calls[0][1].get('recordId')).toBe('77')
    expect(uploaded).toEqual([{ imageId: 21, url: '/files/e.png', thumbnailUrl: '' }])
    // 新增行的保存流程自己编排提示（要区分「数据已存、图没传上」），这里不能抢着弹 toast，
    // 也不能碰弹窗那份状态 —— 那时弹窗根本没打开过
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(api.images.value).toHaveLength(0)
  })

  it('按 id 传图：业务失败要抛出去，交给调用方决定怎么提示', async () => {
    request.post.mockResolvedValue({
      data: { success: false, msg: '图据只支持 PNG / JPG 格式：a.gif' },
    })

    await expect(
      api.uploadImagesForRecord(77, [new File(['x'], 'a.gif', { type: 'image/gif' })]),
    ).rejects.toThrow('图据只支持 PNG / JPG 格式：a.gif')
  })

  it('按 id 传图：没有 id 直接抛错，不发请求', async () => {
    await expect(api.uploadImagesForRecord(undefined, [new File(['x'], 'c.png')])).rejects.toThrow(
      '缺少记录 id',
    )
    expect(request.post).not.toHaveBeenCalled()
  })

  it('删除：确认后从列表移除，并刷新列表让角标跟着变', async () => {
    request.delete.mockResolvedValue({ data: { success: true } })
    await api.openImageDialog(RECORD)

    await api.deleteImage(RECORD_IMAGES[0])

    expect(request.delete).toHaveBeenCalledWith('/api/tank-level/image/delete', {
      params: { imageId: 11 },
    })
    expect(api.images.value).toHaveLength(1)
    expect(api.images.value[0].imageId).toBe(12)
    expect(fetchTankLevelRecords).toHaveBeenCalledWith({ keepPage: true })
  })

  it('删掉当前这张后索引不越界', async () => {
    request.delete.mockResolvedValue({ data: { success: true } })
    await api.openImageDialog(RECORD)
    api.showNextImage() // 停在最后一张（索引 1）
    expect(api.currentIndex.value).toBe(1)

    await api.deleteImage(RECORD_IMAGES[1])

    expect(api.images.value).toHaveLength(1)
    expect(api.currentIndex.value).toBe(0)
  })

  it('删空后索引归 0（不留一个指向不存在图片的索引）', async () => {
    request.delete.mockResolvedValue({ data: { success: true } })
    // 接口也返回只剩一张：否则 openImageDialog 里那次刷新会把列表覆盖回两张
    request.get.mockResolvedValue({ data: { success: true, data: [RECORD_IMAGES[0]] } })
    await api.openImageDialog({ ...RECORD, images: [RECORD_IMAGES[0]] })

    await api.deleteImage(RECORD_IMAGES[0])

    expect(api.images.value).toHaveLength(0)
    expect(api.currentIndex.value).toBe(0)
  })

  it('用户取消确认时什么都不做', async () => {
    ElMessageBox.confirm.mockRejectedValue('cancel')
    await api.openImageDialog(RECORD)

    await api.deleteImage(RECORD_IMAGES[0])

    expect(request.delete).not.toHaveBeenCalled()
    expect(api.images.value).toHaveLength(2)
  })
})
