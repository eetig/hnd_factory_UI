<script setup>
import { hasPerm } from '../api/auth'
import ImageGalleryDialog from './ImageGalleryDialog.vue'
import { useTankLevelImages } from '../composables/useTankLevelImages'

/**
 * 储罐液位图据弹窗：查看 / 上传 / 删除（可多张）。
 *
 * <p>状态与请求逻辑在 `useTankLevelImages`（模块级单例），渲染交给
 * `ImageGalleryDialog`（与工单图片弹窗共用）。页面里写 `<TankLevelImageDialog />` 即可。
 *
 * <p>图据的增删都归 `tank_level:edit` —— 图据是记录的一个字段，改字段就是编辑。
 */
const {
  images,
  currentIndex,
  currentTitle,
  dialogVisible,
  uploading,
  deleting,
  showPreviousImage,
  showNextImage,
  uploadImages,
  deleteImage,
} = useTankLevelImages()
</script>

<template>
  <ImageGalleryDialog
    v-model="dialogVisible"
    :images="images"
    :current-index="currentIndex"
    :title-items="currentTitle"
    :can-upload="hasPerm('tank_level:edit')"
    :can-delete="hasPerm('tank_level:edit')"
    :uploading="uploading"
    :deleting="deleting"
    accept="image/png,image/jpeg"
    empty-text="暂无图据"
    image-alt="储罐液位图据"
    @prev="showPreviousImage"
    @next="showNextImage"
    @upload="uploadImages"
    @delete="deleteImage"
  />
</template>
