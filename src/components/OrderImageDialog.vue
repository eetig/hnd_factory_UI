<script setup>
import { ref } from 'vue'
import { ElButton, ElDialog } from 'element-plus'
import { hasPerm } from '../api/auth'
import { useOrderImages } from '../composables/useOrderImages'

/**
 * 工单图片弹窗：查看 / 上传 / 删除。
 *
 * 状态与请求逻辑全部在 useOrderImages（模块级单例），本组件只负责渲染，
 * 所以页面里写 <OrderImageDialog /> 即可，不需要传 props。
 * 这样「同一段逻辑在多个 Tab 各写一份」的问题不会再出现 ——
 * 后续任何面板需要看图，复用这个组件即可。
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

const fileInput = ref(null)

function openFilePicker() {
  fileInput.value?.click()
}

async function handleFileSelected(event) {
  const files = Array.from(event.target.files || [])
  // 清空 value：否则连续两次选同一批文件不会触发 change
  event.target.value = ''
  await uploadImages(files)
}
</script>

<template>
  <el-dialog v-model="dialogVisible" width="80vw" class="image-preview-dialog" align-center>
    <template #header>
      <div class="flex flex-wrap items-center gap-x-5 gap-y-1 pr-6 text-sm text-slate-700">
        <span>物料描述：{{ currentMaterialDesc }}</span>
        <span>确认的产量：{{ currentConfirmedQty }}</span>
      </div>
    </template>

    <div class="flex min-h-[520px] items-center gap-4 overflow-x-auto rounded-lg bg-slate-50 p-6">
      <div v-if="imageList.length" class="relative flex w-full items-center justify-center">
        <el-button
          v-if="imageList.length > 1"
          circle
          class="absolute left-2 z-10"
          aria-label="上一张"
          @click="showPreviousImage"
        >
          ‹
        </el-button>
        <img
          :src="imageList[currentIndex].url"
          alt="物料原图"
          class="max-h-[70vh] max-w-[85%] rounded-lg object-contain"
        />
        <el-button
          v-if="imageList.length > 1"
          circle
          class="absolute right-2 z-10"
          aria-label="下一张"
          @click="showNextImage"
        >
          ›
        </el-button>
        <el-button
          v-if="hasPerm('work_order:image:delete')"
          type="danger"
          size="small"
          class="absolute bottom-2 left-1/2 -translate-x-1/2"
          :loading="deleting"
          @click="deleteImage(imageList[currentIndex])"
        >
          删除当前图片
        </el-button>
      </div>
      <span v-if="!imageList.length" class="w-full text-center text-sm text-slate-400">
        暂无图片
      </span>
    </div>

    <div v-if="imageList.length" class="mt-3 text-center text-sm text-slate-500">
      第 {{ currentIndex + 1 }} 张 / 共 {{ imageList.length }} 张
    </div>

    <template #footer>
      <div class="flex justify-end gap-3">
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          multiple
          class="hidden"
          @change="handleFileSelected"
        />
        <el-button
          v-if="hasPerm('work_order:image:upload')"
          :loading="uploading"
          @click="openFilePicker"
        >
          添加图片
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>
