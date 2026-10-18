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

/**
 * 列表图片加载失败的逐级降级（整流-001）：
 *   缩略图失败 → 回退原图 → 仍失败则隐藏，露出底层占位图标
 *
 * 领料汇总与入库汇总的「线下单据」列共用这一份（拆页前它是 WorkOrderList 里的
 * 一个局部函数；两页各抄一份必然漂移 —— 降级级数是最容易被随手改掉的那类细节）。
 */
export function handleImgError(event, record) {
  const el = event.target

  if (record?.imageUrl && el.dataset.thumbFallback !== '1') {
    el.dataset.thumbFallback = '1'
    el.src = record.imageUrl
    return
  }

  el.style.display = 'none'
}

/**
 * 这张单子能不能点开大图 —— 判据与弹窗函数里那道守卫完全一致（只看原图 imageUrl）。
 * 能点开才把缩略图当按钮（role/tabindex/键盘都跟着它走）；点不开时它只是个占位图标，
 * 不能变成键盘上停得下来、按下去却没反应的死节点。
 */
export function canOpenImage(record) {
  return Boolean(record?.imageUrl)
}
