import { ref } from 'vue'
import request from '../api/request'
import { uploadFiles } from '../api/upload'
import { normalizeImageList } from '../utils/image'
import { useTankLevelData } from './useTankLevelData'

// ===== 储罐液位图据（查看 / 上传 / 删除）的弹窗状态 =====
// 与电脑端同名文件对位：模块级单例，弹窗组件与页面读到同一份状态，不用逐层传 props。
//
// ⚠️ 与本项目其它 composable 的差别：这里**不碰 UI**（不弹提示、不做二次确认）。
//    原因是 wot 的 useToast()/useMessage() 走 provide/inject，只在组件 setup 里能拿到 ——
//    模块顶层调用会落空。于是提示与确认都留在弹窗组件里，本文件只负责请求与状态。
const images = ref([])
const currentRecordId = ref(null)
const currentTitle = ref([])
const dialogVisible = ref(false)
const uploading = ref(false)
const deleting = ref(false)

/** 后端业务失败也是 HTTP 200 + success:false，取消息统一走这里 */
function toWriteError(error, fallback) {
  return new Error(error?.response?.data?.msg || error?.message || fallback)
}

/**
 * 按记录 id 传图（不依赖弹窗状态）。
 *
 * <p>从 {@link uploadImages} 里抽出来给「新增行」用（变更-015，随电脑端 变更-012）：
 * 新增时图是先选在内存里的，保存拿到新 id 之后才传，而那一刻弹窗从没打开过、
 * `currentRecordId` 还是 null。这里只管发请求，失败抛带消息的 Error ——
 * 提示口径由调用方定：弹窗直接弹 toast，保存流程要区分「数据已存、只是图没传上」。
 *
 * @param {string|number} recordId 记录 id（保存接口返回的那个）
 * @param {string[]} paths uni.chooseImage 给的临时路径
 * @returns {Promise<Array>} 上传成功后的图据（{ imageId, url, thumbnailUrl }）
 */
async function uploadImagesForRecord(recordId, paths) {
  if (!paths?.length) return []
  if (recordId === null || recordId === undefined || recordId === '') {
    throw new Error('缺少记录 id，照片无法上传。')
  }

  const res = await uploadFiles({
    url: '/api/tank-level/image/upload',
    name: 'files',
    files: paths,
    formData: { recordId },
  })

  if (res.data?.success === false) {
    throw new Error(res.data.msg || '照片上传失败，请稍后重试。')
  }

  return normalizeImageList(res.data?.data || [])
}

export function useTankLevelImages() {
  const { fetchTankLevelRecords } = useTankLevelData()

  /** 重新拉该记录的图据；失败保留打开时那份（列表接口本来就把图据带下来了）*/
  async function refreshImages() {
    if (currentRecordId.value === null) return

    try {
      const res = await request.get('/api/tank-level/image/list', {
        params: { recordId: currentRecordId.value },
      })
      images.value = normalizeImageList(res.data?.data || [])
    } catch {
      // 刷不到就先用手上这份，不打断看图
    }
  }

  /** 打开某条记录的图据弹窗（先用手上这份渲染，再后台刷新） */
  async function openImageDialog(record) {
    currentRecordId.value = record?.id ?? null
    currentTitle.value = [
      { label: '记录日期', value: record?.recordDate || '-' },
      { label: '容器名称', value: record?.tankName || '-' },
    ]
    images.value = normalizeImageList(record?.images)
    dialogVisible.value = true

    await refreshImages()
  }

  function closeImageDialog() {
    dialogVisible.value = false
  }

  /**
   * 追加若干张图（不覆盖已有）—— 图据弹窗里的「拍照 / 从相册」走这里。
   * 要求该记录已保存：图据挂在记录 id 上，新增行要先保存拿到 id。
   *
   * @param {string[]} paths uni.chooseImage 给的临时路径
   */
  async function uploadImages(paths) {
    if (!paths?.length) return 0

    uploading.value = true

    try {
      const uploaded = await uploadImagesForRecord(currentRecordId.value, paths)
      if (uploaded.length) {
        images.value = [...images.value, ...uploaded]
      } else {
        await refreshImages()
      }

      // 列表那栏有张数角标，不刷新就还显示旧张数
      await fetchTankLevelRecords({ keepPage: true })
      return uploaded.length
    } catch (error) {
      throw toWriteError(error, '照片上传失败，请稍后重试。')
    } finally {
      uploading.value = false
    }
  }

  /** 删除一张图据（连同 img-service 上的文件，后端负责） */
  async function deleteImage(image) {
    if (!image?.imageId) return

    deleting.value = true

    try {
      const res = await request.delete('/api/tank-level/image/delete', {
        params: { imageId: image.imageId },
      })
      if (res.data?.success === false) {
        throw new Error(res.data.msg || '照片删除失败，请稍后重试。')
      }

      images.value = images.value.filter((item) => String(item.imageId) !== String(image.imageId))
      await fetchTankLevelRecords({ keepPage: true })
    } catch (error) {
      throw toWriteError(error, '照片删除失败，请稍后重试。')
    } finally {
      deleting.value = false
    }
  }

  return {
    images,
    currentTitle,
    dialogVisible,
    uploading,
    deleting,
    openImageDialog,
    closeImageDialog,
    refreshImages,
    uploadImagesForRecord,
    uploadImages,
    deleteImage,
  }
}
