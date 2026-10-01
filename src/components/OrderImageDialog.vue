<script setup>
import { hasPerm } from '../api/auth'
import ImageGalleryDialog from './ImageGalleryDialog.vue'
import { useOrderImages } from '../composables/useOrderImages'

/**
 * 工单图片弹窗：查看 / 上传 / 删除。
 *
 * <p>状态与请求逻辑全部在 `useOrderImages`（模块级单例），弹窗的**渲染**交给
 * `ImageGalleryDialog`（与储罐液位图据共用同一个组件）。本组件只做「把两边接起来」，
 * 所以页面里写 `<OrderImageDialog />` 即可，不需要传 props。
 *
 * <p>变更-011 之前这里自带一份完整的弹窗模板；抽出去是为了避免储罐液位那边
 * 再抄一份 —— 项目里曾有两份逐字相同的图片弹窗，其中一份的入口从未挂上。
 */
const {
  imageList,
  currentIndex,
  currentMaterialDesc,
  currentConfirmedQty,
  dialogVisible,
  uploading,
  deleting,
  showPreviousImage,
  showNextImage,
  uploadImages,
  deleteImage,
} = useOrderImages()
</script>

<template>
  <ImageGalleryDialog
    v-model="dialogVisible"
    :images="imageList"
    :current-index="currentIndex"
    :title-items="[
      { label: '物料描述', value: currentMaterialDesc },
      { label: '确认的产量', value: currentConfirmedQty },
    ]"
    :can-upload="hasPerm('work_order:image:upload')"
    :can-delete="hasPerm('work_order:image:delete')"
    :uploading="uploading"
    :deleting="deleting"
    image-alt="物料原图"
    @prev="showPreviousImage"
    @next="showNextImage"
    @upload="uploadImages"
    @delete="deleteImage"
  />
</template>
