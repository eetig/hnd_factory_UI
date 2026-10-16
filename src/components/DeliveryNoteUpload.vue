<script setup>
import { computed, ref } from 'vue'
import { ElButton, ElImage, ElMessage } from 'element-plus'
import { isStoredImage, storedImageThumb, uploadDeliveryNote } from '../composables/usePurchaseTracking'

/**
 * 送货单图片：上传 / 缩略图预览 / 删除（变更-094，使用方「送货单是一张图片」）。
 *
 * 为什么单独一个组件：新增行与编辑行都要这个控件，写在两处就是两份要同步维护的代码。
 *
 * ⚠️ 用 `:value` + `@update:value` 而**不是** `v-model`：这个组件拿到的是别人（draft / edit）
 * 的对象，直接 v-model 就是改 prop，会踩 `vue/no-mutating-props`（本仓库 eslint 是
 * --max-warnings=0，过不了门禁）。改成显式事件，父子责任清楚。
 *
 * ⚠️ `delivery_note` 这一列**原本是文本**（送货单号），所以这里只认 `/files/…` 形态的图片；
 * 文本老数据由父组件按文本显示，这里不参与。
 */
const props = defineProps({
  value: { type: String, default: '' },
})

const emit = defineEmits(['update:value'])

const inputRef = ref(null)
const busy = ref(false)

const hasImage = computed(() => isStoredImage(props.value))
/** 表格里看缩略图（小、快），点开看原图 */
const thumb = computed(() => storedImageThumb(props.value))

function pick() {
  inputRef.value?.click()
}

async function onFile(event) {
  const file = event.target.files?.[0]
  // ⚠️ 立刻清掉 input 的值：否则**再次选中同一个文件不会触发 change** ——
  // 使用者重传同一张图时会以为"点了没反应"（这类静默失败最难排查）。
  event.target.value = ''
  if (!file) {
    return
  }
  busy.value = true
  try {
    emit('update:value', await uploadDeliveryNote(file))
    ElMessage.success('送货单已上传')
  } catch (e) {
    // api/request.js 已把「HTTP 200 + success:false」拦成拒绝（变更-085），这里拿得到后端原话
    ElMessage.error(`上传失败：${e?.response?.data?.msg || e?.message || '未知错误'}`)
  } finally {
    busy.value = false
  }
}

function clear() {
  emit('update:value', '')
}
</script>

<template>
  <div class="flex items-center gap-1.5">
    <input
      ref="inputRef"
      type="file"
      accept="image/png,image/jpeg"
      class="hidden"
      aria-label="选择送货单图片"
      @change="onFile"
    />
    <el-image
      v-if="hasImage"
      :src="thumb"
      :preview-src-list="[value]"
      :preview-teleported="true"
      fit="cover"
      alt="送货单图片"
      class="h-8 w-8 shrink-0 rounded border border-line"
    />
    <el-button size="small" :loading="busy" @click="pick">
      {{ hasImage ? '重传' : '上传图片' }}
    </el-button>
    <el-button v-if="hasImage" size="small" @click="clear">删除</el-button>
  </div>
</template>
