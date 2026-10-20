<script setup>
import { computed, getCurrentInstance, ref } from 'vue'
import { useMessage, useToast } from 'wot-design-uni'
import dayjs from 'dayjs'
import PhotoGrid from './PhotoGrid.vue'
import { resolveAssetUrl } from '../api/config'
import { hasPerm } from '../api/auth'
import { useTankLevelImages } from '../composables/useTankLevelImages'
import { chooseImages } from '../utils/chooseImages'
import { buildStampLines, CANVAS_EDGE, watermarkPhoto } from '../utils/photoWatermark'

/**
 * 月底储罐液位记录的图据弹层（看大图 / 拍照上传 / 删除）。
 *
 * <p>开关与请求都在 useTankLevelImages（模块级单例），所以本组件没有 props ——
 * 面板只调 openImageDialog(record)，这里读同一份状态渲染（与电脑端同名组件对位）。
 *
 * <p>看大图、勾选、滑动连选、批量删除都在 PhotoGrid 里（三处缩略图网格共用一份）。
 * 大图走 uni.previewImage —— 平台自带的查看器可左右滑、可缩放、可长按保存，
 * 而且不带 transform 祖先的问题（本组件原来 emit 给页面根部那个全局 <ImageViewer>）。
 */
const toast = useToast()
const message = useMessage()

const {
  images,
  currentTitle,
  currentRecord,
  dialogVisible,
  uploading,
  deleting,
  closeImageDialog,
  uploadImages,
  deleteImage,
} = useTankLevelImages()

const canEdit = computed(() => hasPerm('tank_level:edit'))

const gridRef = ref(null)
const batchDeleting = ref(false)

// 水印画布（同 TankLevelFormDialog）：拍照时把「时间 + 属地/容器」烧进图片。
// 尺寸固定（uni-canvas 的像素尺寸在挂载时定死，不能动态改）。
const WATERMARK_CANVAS_ID = 'tli-watermark'

/**
 * 交给网格的条目。
 *
 * ⚠️ 后端给的是相对路径，**必须在这一层 resolve 好**再传进去 —— 漏了的话
 *    App / 小程序端白屏、H5 端反而正常，是最难在本地发现的一类问题。
 *    缩略图加载失败的三级降级（缩略图 → 原图 → 隐藏）在 PhotoGrid 里。
 *
 * image 原样带上：网格会把选中的条目原封不动回传，删除要用它身上的 imageId。
 */
const gridItems = computed(() =>
  images.value.map((image) => ({
    key: String(image.imageId || image.url),
    url: resolveAssetUrl(image.url),
    thumb: resolveAssetUrl(image.thumbnailUrl || image.url),
    image,
  })),
)

/**
 * 拍照 / 从相册选。
 *
 * ⚠️ 刻意一次只给一个 sourceType：两个都给的话，App / 小程序会先弹平台自带的
 *    「拍摄 / 从相册选择」ActionSheet（系统 UI，样式改不了，各机型还不一样），
 *    所以这里摆成两个按钮，各自带单一来源（同图片解析页的做法）。
 *
 * <p>走 utils/chooseImages：「相册」这一支在 App 端去起手机自带的相册（见该文件），
 * 拍照与 H5 / 小程序原样走框架。
 */
function pickImage(source) {
  if (uploading.value) return

  chooseImages({
    count: 3,
    sizeType: ['original', 'compressed'],
    sourceType: [source],
    success: async (res) => {
      const paths = res.tempFilePaths || []
      if (!paths.length) return

      // 只有「拍照」盖水印：相册里的旧图不是此刻拍的，盖当前时间等于伪造时间证据
      const finalPaths = source === 'camera'
        ? await Promise.all(paths.map((path) => stampOne(path)))
        : paths

      try {
        const count = await uploadImages(finalPaths)
        toast.success(count ? `已上传 ${count} 张照片` : '照片已上传')
      } catch (error) {
        toast.error(error?.message || '照片上传失败，请稍后重试。')
      }
    },
  })
}

/** 给一张刚拍的照片盖章；失败自动退回原图（见 utils/photoWatermark 的取舍） */
function stampOne(path) {
  return watermarkPhoto({
    path,
    lines: buildStampLines({
      time: dayjs().format('YYYY-MM-DD HH:mm'),
      location: currentRecord.value?.location,
      tankName: currentRecord.value?.tankName,
    }),
    canvasId: WATERMARK_CANVAS_ID,
    instance: getCurrentInstance()?.proxy,
  })
}

/**
 * 网格里勾了一批点删除：**整批只确认一次**，然后逐张删。
 *
 * <p>单张删失败不中断整批（剩下的还是要删掉），最后一次性报失败张数，
 * 比中途抛错留在半路的状态好收拾。
 */
async function deleteSelected(chosen) {
  if (deleting.value || batchDeleting.value) return

  // 没有 imageId 的删不动，先剔掉 —— 免得用户确认完却什么都没发生
  const targets = chosen.map((item) => item.image).filter((image) => image?.imageId)
  if (!targets.length) return

  const count = targets.length

  try {
    await message.confirm({
      title: '确认删除照片',
      msg:
        count > 1
          ? `将删除所选的 ${count} 张照片，删除后无法在本条记录中查看，是否继续？`
          : '删除后将无法在本条记录中查看该照片，是否继续？',
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
    })
  } catch {
    return // 用户点了取消
  }

  batchDeleting.value = true
  let failed = 0

  try {
    for (const image of targets) {
      try {
        await deleteImage(image)
      } catch {
        failed += 1
      }
    }
  } finally {
    batchDeleting.value = false
  }

  gridRef.value?.clearSelection()

  if (!failed) {
    toast.success(count > 1 ? `已删除 ${count} 张照片` : '照片已删除')
  } else if (failed < count) {
    toast.error(`已删除 ${count - failed} 张，${failed} 张删除失败，请重试。`)
  } else {
    toast.error('照片删除失败，请稍后重试。')
  }
}
</script>

<template>
  <wd-popup
    :model-value="dialogVisible"
    position="bottom"
    round
    safe-area-inset-bottom
    custom-style="max-height: 80vh; display: flex; flex-direction: column; background-color: var(--ui-sheet-fill); overscroll-behavior: contain;"
    @update:model-value="(visible) => !visible && closeImageDialog()"
  >
    <view class="tli">
      <view class="tli__grabber"></view>

      <!-- 水印画布：屏幕外，只给 canvasToTempFilePath 读像素 -->
      <canvas
        :canvas-id="WATERMARK_CANVAS_ID"
        :id="WATERMARK_CANVAS_ID"
        class="tli__watermark"
        :style="`width:${CANVAS_EDGE}px;height:${CANVAS_EDGE}px;`"
      ></canvas>

      <view class="tli__head">
        <view class="tli__head-text">
          <text class="tli__title">图据</text>
          <text v-for="line in currentTitle" :key="line.label" class="tli__subtitle">
            {{ line.label }}：{{ line.value }}
          </text>
        </view>
        <view class="tli__close" @click="closeImageDialog">
          <wd-icon name="close" size="18px" />
        </view>
      </view>

      <scroll-view class="tli__body" scroll-y>
        <PhotoGrid
          v-if="images.length"
          ref="gridRef"
          :items="gridItems"
          :selectable="canEdit"
          :disabled="uploading || batchDeleting"
          :delete-busy="batchDeleting"
          @delete-selected="deleteSelected"
        />

        <view v-else class="tli__empty">
          <text class="tli__empty-title">还没有上传照片</text>
          <text class="tli__empty-desc">
            {{ canEdit ? '点下方「拍照」或「从相册」上传现场照片。' : '照片由管理员在电脑端或手机端上传。' }}
          </text>
        </view>
      </scroll-view>

      <!-- 只读用户不给上传入口：后端写接口要 tank_level:edit 权限，摆出来只会点出一串报错 -->
      <view v-if="canEdit" class="tli__footer">
        <wd-button plain :loading="uploading" @click="pickImage('camera')">
          <wd-icon name="camera" size="16px" />
          <text class="tli__btn-text">拍照</text>
        </wd-button>
        <wd-button type="primary" :loading="uploading" @click="pickImage('album')">从相册选择</wd-button>
      </view>
    </view>
  </wd-popup>
</template>

<style scoped lang="scss">
.tli {
  display: flex;
  max-height: 80vh;
  flex-direction: column;

  /* 水印画布：挪出可视区（不能 display:none，隐藏的 canvas 在部分平台导不出像素） */
  &__watermark {
    position: fixed;
    top: -10000px;
    left: -10000px;
  }

  &__grabber {
    width: 72rpx;
    height: 8rpx;
    margin: 20rpx auto 0;
    border-radius: $ui-radius-pill;
    background-color: $ui-raise-3;
  }

  &__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 24rpx 32rpx 16rpx;
  }

  &__head-text {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 6rpx;
  }

  &__title {
    color: $ui-text;
    font-size: 32rpx;
    font-weight: 600;
  }

  &__subtitle {
    color: $ui-text-3;
    font-size: 24rpx;
  }

  &__close {
    display: flex;
    width: 56rpx;
    height: 56rpx;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background-color: $ui-raise-2;
    color: $ui-text-3;

    &:active {
      background-color: $ui-raise-3;
      color: $ui-text;
    }
  }

  &__body {
    // scroll-view 必须有确定高度才会滚动
    min-height: 0;
    flex-grow: 1;
    overscroll-behavior: contain;
    // uni 的 uni-scroll-view 自带 width: 100%，而 100% 不扣边框，会平白溢出 2px
    width: auto;
    border-top: 1px solid $ui-hairline;
    padding: 24rpx 32rpx;
  }

  &__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12rpx;
    padding: 80rpx 0;
  }

  &__empty-title {
    color: $ui-text;
    font-size: 30rpx;
    font-weight: 600;
  }

  &__empty-desc {
    color: $ui-text-3;
    font-size: 26rpx;
    text-align: center;
  }

  &__footer {
    display: flex;
    align-items: center;
    gap: 16rpx;
    border-top: 1px solid $ui-hairline;
    padding: 20rpx 32rpx;
  }

  &__btn-text {
    margin-left: 8rpx;
  }
}
</style>
