import { describe, it, expect } from 'vitest'
import { normalizeImage, normalizeImageList } from '../../src/utils/image'

describe('normalizeImage', () => {
  it('字符串按 URL 处理', () => {
    expect(normalizeImage('/files/a.jpg')).toEqual({
      imageId: '/files/a.jpg',
      url: '/files/a.jpg',
      thumbnailUrl: '',
    })
  })

  it('兼容后端多种字段名', () => {
    expect(normalizeImage({ id: '1', imageUrl: '/files/a.jpg' })).toMatchObject({
      imageId: '1',
      url: '/files/a.jpg',
    })
    expect(normalizeImage({ imageId: '2', fileUrl: '/files/b.jpg' })).toMatchObject({
      imageId: '2',
      url: '/files/b.jpg',
    })
    expect(normalizeImage({ imageId: '3', path: '/files/c.jpg' })).toMatchObject({
      imageId: '3',
      url: '/files/c.jpg',
    })
  })

  it('保留 thumbnailUrl：列表画的是缩略图，扔了就只能回退去拉原图', () => {
    expect(normalizeImage({ imageId: '1', url: '/files/a.jpg', thumbnailUrl: '/thumbs/a.jpg' }))
      .toEqual({
        imageId: '1',
        url: '/files/a.jpg',
        thumbnailUrl: '/thumbs/a.jpg',
      })
    // 别名也认
    expect(normalizeImage({ imageId: '2', url: '/files/b.jpg', thumbUrl: '/thumbs/b.jpg' })
      .thumbnailUrl).toBe('/thumbs/b.jpg')
  })

  it('缺字段时给空值，不抛异常', () => {
    expect(normalizeImage(null)).toEqual({ imageId: '', url: '', thumbnailUrl: '' })
  })
})

describe('normalizeImageList', () => {
  it('JSON 字符串（后端把列表序列化过）能被解析', () => {
    const raw = JSON.stringify([{ imageId: '1', url: '/files/a.jpg' }])
    expect(normalizeImageList(raw)).toEqual([
      { imageId: '1', url: '/files/a.jpg', thumbnailUrl: '' },
    ])
  })

  it('普通字符串当作单张图片', () => {
    expect(normalizeImageList('/files/a.jpg')).toEqual([
      { imageId: '/files/a.jpg', url: '/files/a.jpg', thumbnailUrl: '' },
    ])
  })

  it('单个对象也能收成数组', () => {
    expect(normalizeImageList({ imageId: '1', url: '/files/a.jpg' })).toHaveLength(1)
  })

  it('过滤掉没有 url 的脏数据（imageId 缺失不算脏数据）', () => {
    expect(normalizeImageList([{ imageId: '1' }, '', null, { url: '/files/a.jpg' }])).toEqual([
      { imageId: '', url: '/files/a.jpg', thumbnailUrl: '' },
    ])
  })

  it('空值返回空数组', () => {
    expect(normalizeImageList(null)).toEqual([])
    expect(normalizeImageList(undefined)).toEqual([])
    expect(normalizeImageList('')).toEqual([])
  })
})
