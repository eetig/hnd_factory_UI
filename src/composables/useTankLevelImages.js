import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '../api/request'
import { normalizeImageList } from '../utils/image'
import { useTankLevelData } from './useTankLevelData'

/**
 * 储罐液位图据弹窗（查看 / 上传 / 删除）的状态与读写逻辑。
 *
 * <p>结构与 `useOrderImages` 对位：模块级单例，弹窗组件与页面读到同一份状态，
 * 不需要逐层传 props（项目约定 4）。
 *
 * <p>与 `useTankLevelData` 里那些写方法的**风格差异是有意的**：那边抛带消息的 Error、
 * 由页面决定怎么提示；这里像 `useOrderImages` 一样在内部直接 ElMessage ——
 * 弹窗是个自成一体的小界面，上传/删除的成功失败都有固定文案，没必要绕出去再绕回来。
 *
 * <p>写成功后会顺手刷新列表：图据列上有个数量角标，不刷新就还显示旧张数。
 */
const images = ref([])
const currentIndex = ref(0)
const currentRecordId = ref(null)
const currentTitle = ref([])
const dialogVisible = ref(false)
const uploading = ref(false)
const deleting = ref(false)

/** 删掉最后一张后索引可能越界，收回到有效范围 */
function clampIndex() {
  if (!images.value.length) {
    currentIndex.value = 0
  } else if (currentIndex.value >= images.value.length) {
    currentIndex.value = images.value.length - 1
  }
}

export function useTankLevelImages() {
  const { fetchTankLevelRecords } = useTankLevelData()

  /** 重新拉该记录的图据；失败保留打开时那份（入参带过来的 images 先渲染）*/
  async function refreshImages() {
    if (currentRecordId.value === null) return

    try {
      const res = await request.get('/api/tank-level/image/list', {
        params: { recordId: currentRecordId.value },
      })
      images.value = normalizeImageList(res.data?.data || [])
      clampIndex()
    } catch {
      // 列表接口本来就把图据带下来了，刷不到就先用手上这份，不打断看图
    }
  }

  async function openImageDialog(record) {
    currentRecordId.value = record?.id ?? null
    currentTitle.value = [
      { label: '记录日期', value: record?.recordDate || '-' },
      { label: '容器名称', value: record?.tankName || '-' },
      { label: '容器编号', value: record?.tankCode || '-' },
    ]
    images.value = normalizeImageList(record?.images)
    currentIndex.value = 0
    dialogVisible.value = true

    await refreshImages()
  }

  function showPreviousImage() {
    if (!images.value.length) return
    currentIndex.value = (currentIndex.value - 1 + images.value.length) % images.value.length
  }

  function showNextImage() {
    if (!images.value.length) return
    currentIndex.value = (currentIndex.value + 1) % images.value.length
  }

  /** 追加若干张图（不覆盖已有）。要求该记录已保存 —— 图据挂在记录 id 上 */
  async function uploadImages(files) {
    if (!files?.length || currentRecordId.value === null) return

    uploading.value = true

    try {
      const formData = new FormData()
      formData.append('recordId', currentRecordId.value)
      files.forEach((file) => formData.append('files', file))

      const res = await request.post('/api/tank-level/image/upload', formData)
      // 业务失败也是 HTTP 200，必须自己判断 success
      if (res.data?.success === false) {
        throw new Error(res.data.msg || '图据上传失败，请稍后重试。')
      }

      const uploaded = normalizeImageList(res.data?.data || [])
      if (uploaded.length) {
        images.value = [...images.value, ...uploaded]
        // 跳到刚传上去的那张：用户接着就能确认「传的是不是这张」
        currentIndex.value = images.value.length - 1
      } else {
        await refreshImages()
      }

      ElMessage.success('图据上传成功')
      await fetchTankLevelRecords({ keepPage: true })
    } catch (error) {
      ElMessage.error(error.response?.data?.msg || error.message || '图据上传失败，请稍后重试。')
    } finally {
      uploading.value = false
    }
  }

  async function deleteImage(image) {
    if (!image?.imageId) return

    try {
      await ElMessageBox.confirm('删除后将无法在本条记录中查看该图，是否继续？', '确认删除图据', {
        type: 'warning',
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
      })
    } catch {
      return // 用户点了取消
    }

    deleting.value = true

    try {
      const res = await request.delete('/api/tank-level/image/delete', {
        params: { imageId: image.imageId },
      })
      if (res.data?.success === false) {
        throw new Error(res.data.msg || '图据删除失败，请稍后重试。')
      }

      images.value = images.value.filter(
        (item) => String(item.imageId) !== String(image.imageId),
      )
      clampIndex()

      ElMessage.success('图据已删除')
      await fetchTankLevelRecords({ keepPage: true })
    } catch (error) {
      ElMessage.error(error.response?.data?.msg || error.message || '图据删除失败，请稍后重试。')
    } finally {
      deleting.value = false
    }
  }

  return {
    images,
    currentIndex,
    currentTitle,
    dialogVisible,
    uploading,
    deleting,
    openImageDialog,
    showPreviousImage,
    showNextImage,
    uploadImages,
    deleteImage,
  }
}
