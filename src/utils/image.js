// 图片数据结构归一化（后端返回格式可能为字符串、对象或 JSON 字符串）

/**
 * 单张图片归一化。
 *
 * <p>**thumbnailUrl 也要保留**：列表画的是缩略图（`thumbnailUrl || url`），
 * 早先这里只输出 `{ imageId, url }` 把它扔了，于是列表只能回退去拉原图 ——
 * 工单那个弹窗只用大图所以一直没暴露，储罐液位列表要按首张缩略图渲染才现出来。
 */
export function normalizeImage(image) {
  if (typeof image === 'string') {
    return { imageId: image, url: image, thumbnailUrl: '' }
  }

  return {
    imageId: image?.imageId ?? image?.id ?? '',
    url: image?.url ?? image?.imageUrl ?? image?.fileUrl ?? image?.path ?? '',
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
