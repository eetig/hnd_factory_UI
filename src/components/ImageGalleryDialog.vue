<script setup>
import { computed, ref } from 'vue'
import { ElButton, ElDialog } from 'element-plus'

/**
 * 图片浏览弹窗（纯展示）：看大图 / 左右翻页 / 加图 / 删图。
 *
 * <p>**不含任何数据逻辑** —— 图片从哪来、上传到哪去、删完怎么刷新，全由调用方的
 * composable 负责（工单是 `useOrderImages`，储罐液位是 `useTankLevelImages`）。
 * 抽出来是因为两处的交互逐字相同，各写一份迟早各自演化
 * （项目里就发生过：工单与周统计曾各有一份，周统计那份的入口从未挂上，成了死代码）。
 *
 * <p>`currentIndex` 保持**受控**（父组件持有并改）：翻页状态原本就在调用方的
 * composable 里，且有单测覆盖，塞进组件内部会连带改掉那份 API。
 */
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** [{ imageId, url, thumbnailUrl }] */
  images: { type: Array, default: () => [] },
  currentIndex: { type: Number, default: 0 },
  /** 弹窗头部展示的字段：[{ label, value }] */
  titleItems: { type: Array, default: () => [] },
  canUpload: { type: Boolean, default: false },
  canDelete: { type: Boolean, default: false },
  uploading: { type: Boolean, default: false },
  deleting: { type: Boolean, default: false },
  /**
   * file input 的 accept。
   *
   * 默认沿用工单那边的 `image/*`（不动既有行为）；储罐液位图传 `image/png,image/jpeg`，
   * 与后端白名单一致 —— 那边的后端会显式拒掉非 PNG/JPG，让用户先选到再被拒是白跑一趟。
   */
  accept: { type: String, default: 'image/*' },
  emptyText: { type: String, default: '暂无图片' },
  imageAlt: { type: String, default: '原图' },
})

const emit = defineEmits(['update:modelValue', 'prev', 'next', 'upload', 'delete'])

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

// 索引越界时（比如刚删掉最后一张）不渲染 <img>，而不是渲染 undefined 的 src
const currentImage = computed(() => props.images[props.currentIndex] || null)

const fileInput = ref(null)

function openFilePicker() {
  fileInput.value?.click()
}

function handleFileSelected(event) {
  const files = Array.from(event.target.files || [])
  // 清空 value：否则连续两次选同一批文件不会再触发 change
  event.target.value = ''
  if (files.length) {
    emit('upload', files)
  }
}
</script>

<template>
  <el-dialog v-model="dialogVisible" width="80vw" class="image-preview-dialog" align-center>
    <template v-if="titleItems.length" #header>
      <div class="flex flex-wrap items-center gap-x-5 gap-y-1 pr-6 text-sm text-slate-700">
        <span v-for="item in titleItems" :key="item.label">
          {{ item.label }}：{{ item.value }}
        </span>
      </div>
    </template>

    <div class="flex min-h-[520px] items-center gap-4 overflow-x-auto rounded-card bg-slate-50 p-6">
      <div v-if="currentImage" class="relative flex w-full items-center justify-center">
        <el-button
          v-if="images.length > 1"
          circle
          class="absolute left-2 z-10"
          aria-label="上一张"
          @click="emit('prev')"
        >
          ‹
        </el-button>
        <img
          :src="currentImage.url"
          :alt="imageAlt"
          class="max-h-[70vh] max-w-[85%] rounded-card object-contain"
        />
        <el-button
          v-if="images.length > 1"
          circle
          class="absolute right-2 z-10"
          aria-label="下一张"
          @click="emit('next')"
        >
          ›
        </el-button>
        <el-button
          v-if="canDelete"
          type="danger"
          size="small"
          class="absolute bottom-2 left-1/2 -translate-x-1/2"
          :loading="deleting"
          @click="emit('delete', currentImage)"
        >
          删除当前图片
        </el-button>
      </div>
      <span v-else class="w-full text-center text-sm text-slate-500">{{ emptyText }}</span>
    </div>

    <div v-if="images.length" class="mt-3 text-center text-sm text-slate-500">
      第 {{ currentIndex + 1 }} 张 / 共 {{ images.length }} 张
    </div>

    <template #footer>
      <div class="flex justify-end gap-3">
        <input
          ref="fileInput"
          type="file"
          :accept="accept"
          multiple
          class="hidden"
          @change="handleFileSelected"
        />
        <el-button v-if="canUpload" :loading="uploading" @click="openFilePicker">
          添加图片
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>
