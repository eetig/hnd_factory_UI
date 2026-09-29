import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '../api/request'
import { normalizeImageList } from '../utils/image'
import { useWorkOrderData } from './useWorkOrderData'

/**
 * 工单图片弹窗（查看 / 上传 / 删除）的状态与读写逻辑。
 *
 * 背景：工单汇总与周统计两个 Tab 曾各写了一份几乎逐字相同的实现
 * （列表加载、上传、删除、翻页各两遍）。周统计那份的模板入口从未挂上，
 * 属于不可达代码，已随本次重构删除 —— 这里保留唯一一份实现。
 *
 * 状态定义在模块级（与 useWorkOrderData / usePickData 等保持一致），
 * 因此弹窗组件与页面组件读到的是同一份状态，不需要逐层传 props，
 * 也不会因为组件重复创建而出现两份状态。
 */
const imageList = ref([])
const currentIndex = ref(0)
const currentMaterialDesc = ref('')
const currentConfirmedQty = ref('')
const currentOrderNo = ref('')
const dialogVisible = ref(false)
const uploading = ref(false)
const deleting = ref(false)

export function useOrderImages() {
  const { allWorkOrders, tableDataAll, filterWorkOrders, fetchWorkOrders } = useWorkOrderData()

  // 列表接口（部分后端版本会返回最新图片列表；失败时保留入参带过来的 imageList）
  async function refreshImageList(order) {
    if (!currentOrderNo.value) {
      imageList.value = normalizeImageList(order?.imageList)
      return
    }

    const res = await request.get('/api/work-order/image/list', {
      params: { orderNo: currentOrderNo.value },
    })
    imageList.value = normalizeImageList(res.data?.data || [])
  }

  // 图片增删后同步内存里的四份数据源，避免列表页仍显示旧图
  function updateOrderImages(images) {
    const normalizedImages = normalizeImageList(images)
    const updateImages = (order) => {
      if (String(order.orderNo) === String(currentOrderNo.value)) {
        order.imageList = normalizedImages
      }
    }

    allWorkOrders.value.forEach(updateImages)
    tableDataAll.value.forEach(updateImages)
    imageList.value = normalizedImages
    filterWorkOrders()
  }

  async function openImageDialog(order) {
    currentMaterialDesc.value = order?.materialDesc || '-'
    currentConfirmedQty.value = order?.confirmedQty ?? '-'
    currentOrderNo.value = order?.orderNo || ''
    imageList.value = normalizeImageList(order?.imageList)
    currentIndex.value = 0
    dialogVisible.value = true

    await refreshImageList(order)
  }

  function closeImageDialog() {
    dialogVisible.value = false
  }

  function showPreviousImage() {
    if (!imageList.value.length) return
    currentIndex.value = (currentIndex.value - 1 + imageList.value.length) % imageList.value.length
  }

  function showNextImage() {
    if (!imageList.value.length) return
    currentIndex.value = (currentIndex.value + 1) % imageList.value.length
  }

  async function uploadImages(files) {
    if (!files?.length || !currentOrderNo.value) return

    uploading.value = true

    try {
      const formData = new FormData()
      formData.append('orderNo', currentOrderNo.value)
      files.forEach((file) => formData.append('files', file))

      const res = await request.post('/api/work-order/image/upload', formData)
      // 业务失败也是 HTTP 200，必须自己判断 success
      if (res.data?.success === false) {
        throw new Error(res.data.msg || '图片上传失败。')
      }

      const uploadedImages = normalizeImageList(res.data?.data || [])
      if (uploadedImages.length) {
        updateOrderImages([...imageList.value, ...uploadedImages])
        currentIndex.value = imageList.value.length - 1
      } else {
        // 接口没回图片列表：重新拉工单，再从工单对象上取图片
        await fetchWorkOrders()
        const currentOrder = allWorkOrders.value.find(
          (order) => String(order.orderNo) === String(currentOrderNo.value),
        )
        await refreshImageList(currentOrder)
      }
      ElMessage.success('图片上传成功')
    } catch (error) {
      ElMessage.error(error.response?.data?.msg || error.message || '图片上传失败，请重试。')
    } finally {
      uploading.value = false
    }
  }

  async function deleteImage(image) {
    if (!currentOrderNo.value || !image?.imageId) return

    try {
      await ElMessageBox.confirm('删除后将无法在当前工单中查看该图片，是否继续？', '确认删除图片', {
        type: 'warning',
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }

    deleting.value = true

    try {
      const res = await request.delete('/api/work-order/image/delete', {
        params: { imageId: image.imageId },
        data: { imageId: image.imageId },
      })

      if (res.data?.success === false) {
        throw new Error(res.data.msg || '图片删除失败。')
      }

      const remainingImages = imageList.value.filter(
        (item) => String(item.imageId) !== String(image.imageId),
      )
      updateOrderImages(remainingImages)
      if (currentIndex.value >= imageList.value.length) {
        currentIndex.value = Math.max(0, imageList.value.length - 1)
      }
      ElMessage.success('图片已删除')
    } catch (error) {
      ElMessage.error(error.response?.data?.msg || error.message || '图片删除失败，请重试。')
    } finally {
      deleting.value = false
    }
  }

  return {
    imageList,
    currentIndex,
    currentMaterialDesc,
    currentConfirmedQty,
    currentOrderNo,
    dialogVisible,
    uploading,
    deleting,
    openImageDialog,
    closeImageDialog,
    showPreviousImage,
    showNextImage,
    uploadImages,
    deleteImage,
  }
}
