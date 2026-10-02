<script setup>
import { computed, ref } from 'vue'
import { useMessage, useToast } from 'wot-design-uni'
import { resolveAssetUrl } from '../api/config'
import { hasPerm } from '../api/auth'
import { useTankLevelImages } from '../composables/useTankLevelImages'

/**
 * 月底储罐液位记录的图据弹层（看大图 / 拍照上传 / 删除）。
 *
 * <p>开关与请求都在 useTankLevelImages（模块级单例），所以本组件没有 props ——
 * 面板只调 openImageDialog(record)，这里读同一份状态渲染（与电脑端同名组件对位）。
 *
 * <p>大图用页面根部那个全局 <ImageViewer>（本组件只 emit 出去）：
 * 弹层里可能有 transform 祖先，`position: fixed` 的浮层挂进去会跟着弹层定位。
 */
const emit = defineEmits(['preview'])

const toast = useToast()
const message = useMessage()

const {
  images,
  currentTitle,
  dialogVisible,
  uploading,
  deleting,
  closeImageDialog,
  uploadImages,
  deleteImage,
} = useTankLevelImages()

const canEdit = computed(() => hasPerm('tank_level:edit'))

// 拇指图加载失败逐级降级：缩略图 → 原图 → 隐藏（露出底层的占位图标）。
// 用 getAttribute('src') 比较：img.src 会被补成绝对 URL，与相对路径永远不相等
const thumbFallbacks = ref({})

function thumbSrc(image) {
  const key = String(image.imageId || image.url)
  return thumbFallbacks.value[key] || resolveAssetUrl(image.thumbnailUrl || image.url)
}

function handleThumbError(event, image) {
  const el = event?.target
  if (!el) return

  const key = String(image.imageId || image.url)
  const original = resolveAssetUrl(image.url)

  if (original && el.getAttribute('src') !== original) {
    thumbFallbacks.value = { ...thumbFallbacks.value, [key]: original }
    return
  }
  el.style.display = 'none'
}

function handlePreview(index) {
  if (!images.value.length) return
  emit('preview', { urls: images.value.map((image) => image.url), index })
}

/**
 * 拍照 / 从相册选。
 *
 * ⚠️ 刻意一次只给一个 sourceType：两个都给的话，App / 小程序会先弹平台自带的
 *    「拍摄 / 从相册选择」ActionSheet（系统 UI，样式改不了，各机型还不一样），
 *    所以这里摆成两个按钮，各自带单一来源（同图片解析页的做法）。
 */
function pickImage(source) {
  if (uploading.value) return

  uni.chooseImage({
    count: 3,
    sizeType: ['original', 'compressed'],
    sourceType: [source],
    success: async (res) => {
      const paths = res.tempFilePaths || []
      if (!paths.length) return

      try {
        const count = await uploadImages(paths)
        toast.success(count ? `已上传 ${count} 张照片` : '照片已上传')
      } catch (error) {
        toast.error(error?.message || '照片上传失败，请稍后重试。')
      }
    },
  })
}

async function handleDelete(image) {
  if (deleting.value) return

  try {
    await message.confirm({
      title: '确认删除照片',
      msg: '删除后将无法在本条记录中查看该照片，是否继续？',
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
    })
  } catch {
    return // 用户点了取消
  }

  try {
    await deleteImage(image)
    toast.success('照片已删除')
  } catch (error) {
    toast.error(error?.message || '照片删除失败，请稍后重试。')
  }
}
</script>

<template>
  <wd-popup
    :model-value="dialogVisible"
    position="bottom"
    round
    safe-area-inset-bottom
    custom-style="max-height: 80vh; display: flex; flex-direction: column; background-color: var(--ui-surface); overscroll-behavior: contain;"
    @update:model-value="(visible) => !visible && closeImageDialog()"
  >
    <view class="tli">
      <view class="tli__grabber"></view>

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
        <view v-if="images.length" class="tli__grid">
          <view v-for="(image, index) in images" :key="image.imageId || image.url" class="tli__item">
            <image
              class="tli__thumb"
              :src="thumbSrc(image)"
              mode="aspectFill"
              @click="handlePreview(index)"
              @error="handleThumbError($event, image)"
            />
            <view
              v-if="canEdit"
              class="tli__remove"
              aria-label="删除这张照片"
              @click.stop="handleDelete(image)"
            >
              <wd-icon name="close" size="12px" />
            </view>
          </view>
        </view>

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

  &__grid {
    display: flex;
    flex-wrap: wrap;
    gap: 20rpx;
  }

  &__item {
    position: relative;
    width: 200rpx;
    height: 200rpx;
  }

  &__thumb {
    width: 100%;
    height: 100%;
    border-radius: $ui-radius-md;
    background-color: $ui-raise-2;
  }

  &__remove {
    position: absolute;
    top: -10rpx;
    right: -10rpx;
    display: flex;
    width: 40rpx;
    height: 40rpx;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background-color: $ui-scrim;
    color: #fff;
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
