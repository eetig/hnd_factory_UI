// 图片数据结构归一化（后端返回格式可能为字符串、对象或 JSON 字符串）

export function normalizeImage(image) {
  if (typeof image === 'string') {
    return { imageId: image, url: image, thumbnailUrl: '' }
  }

  return {
    imageId: image?.imageId ?? image?.id ?? '',
    url: image?.url ?? image?.imageUrl ?? image?.fileUrl ?? image?.path ?? '',
    // thumbnailUrl 保留：列表画的是缩略图（thumbnailUrl || url），
    // 只输出 { imageId, url } 的话列表就只能去拉原图。
    // 月底储罐液位记录按首张缩略图渲染，全靠这个字段（电脑端同一个坑）。
    thumbnailUrl: image?.thumbnailUrl ?? image?.thumbUrl ?? '',
  }
}

export function normalizeImageList(images) {
  let imageValues = images

  if (typeof imageValues === 'string') {
    try {
      imageValues = JSON.parse(imageValues)
    } catch {
      imageValues = imageValues ? [imageValues] : []
    }
  }

  if (!Array.isArray(imageValues)) {
    imageValues = imageValues ? [imageValues] : []
  }

  return imageValues.map(normalizeImage).filter((image) => image.url)
}
