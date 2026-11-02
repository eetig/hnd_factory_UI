<script setup>
import { ref } from 'vue'
import { useTheme } from '../../composables/useTheme'

/*
 * 隐私政策（2026-11-02）。
 *
 * 使用方要求做管控日志（注册时间、登录 IP、设备信息、上下线、操作留痕），
 * 并「全按推荐」采纳了"采集必须告知"这一条 —— 这页就是那份告知。
 *
 * 写这份东西的原则：**采集了就写，没采集的不写**。
 * 下面每一条都对应后端真实写入 audit_event 的字段，不是模板话术。
 * 以后若新增采集项（比如精确定位），必须先改这页再加代码。
 */
const { themeClass, themeVars } = useTheme()
const today = ref(new Date().toISOString().slice(0, 10))

const sections = [
  {
    title: '我们记录什么',
    items: [
      '注册：注册时间、注册时的 IP 与设备。',
      '登录与退出：每次登录/退出的时间、IP、设备型号与系统、App 版本。',
      '操作留痕：录入、修改、删除、导入、确认入库等**写操作**，记录时间、IP、设备与操作对象（如工单号、单据号）。',
      '不在记录范围：查询、浏览这类只读操作；你上传的单据图片内容；任何密码。',
    ],
  },
  {
    title: '为什么记录',
    items: [
      '核对数据是谁在什么时候改的，出了问题能追溯（这是这套日志唯一的目的）。',
      '识别异常登录（例如陌生设备、异地 IP），保护账号与生产数据。',
    ],
  },
  {
    title: '谁能看',
    items: [
      '只有系统管理员能在 PC 端「管控日志」页查看。',
      '普通账号、班组长、操作工都看不到。',
      '日志**只读**：系统不提供按条删除的功能，避免"改完就把记录删掉"。',
    ],
  },
  {
    title: '保留多久',
    items: ['日志保留 180 天，之后由系统自动清理。'],
  },
  {
    title: '我们不做的事',
    items: [
      '不采集定位、通讯录、相册（除你主动选择上传的图片）、通话与短信。',
      '不把你的数据提供给任何第三方，不做广告投放。',
      '人脸、指纹等生物特征一概不采集。',
    ],
  },
  {
    title: '你可以做什么',
    items: [
      '需要核实或导出自己的记录，联系管理员。',
      '不希望被记录设备信息，可以选择不在共用设备上登录。',
    ],
  },
]
</script>

<template>
  <view class="privacy" :class="themeClass" :style="themeVars">
    <view class="privacy__head">
      <text class="privacy__title">隐私政策</text>
      <text class="privacy__sub">生效日期 {{ today }} · 内部系统</text>
    </view>

    <view class="privacy__intro">
      <text>
        本系统是公司内部的生产数据工具，不是面向公众的产品。为了能追溯数据改动、发现异常登录，
        系统会记录少量与"你和你的设备"有关的信息。这份说明把它们逐条写清楚。
      </text>
    </view>

    <view v-for="(section, index) in sections" :key="section.title" class="privacy__section">
      <view class="privacy__section-head">
        <text class="privacy__index">{{ index + 1 }}</text>
        <text class="privacy__section-title">{{ section.title }}</text>
      </view>
      <view class="privacy__list">
        <view v-for="item in section.items" :key="item" class="privacy__item">
          <text class="privacy__dot">·</text>
          <text class="privacy__text">{{ item }}</text>
        </view>
      </view>
    </view>

    <view class="privacy__foot">
      <text>有疑问请联系系统管理员。本政策如有变化，会在本页更新生效日期。</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.privacy {
  padding: 32rpx 32rpx 80rpx;
}

.privacy__head {
  margin-bottom: 24rpx;
}

.privacy__title {
  display: block;
  font-size: 44rpx;
  font-weight: 700;
  color: var(--ui-text);
}

.privacy__sub {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: var(--ui-text-3);
}

.privacy__intro {
  padding: 24rpx;
  border-radius: 20rpx;
  background-color: var(--ui-surface-2);
  font-size: 26rpx;
  line-height: 1.7;
  color: var(--ui-text-2);
}

.privacy__section {
  margin-top: 36rpx;
}

.privacy__section-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 14rpx;
}

/* 序号用一个小方块，像政策文件的条目编号；不用彩色，避免像"警告" */
.privacy__index {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34rpx;
  height: 34rpx;
  border-radius: 8rpx;
  background-color: var(--ui-surface-2);
  font-size: 20rpx;
  font-weight: 700;
  color: var(--ui-text-2);
}

.privacy__section-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.privacy__list {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.privacy__item {
  display: flex;
  gap: 10rpx;
}

.privacy__dot {
  flex-shrink: 0;
  font-size: 26rpx;
  line-height: 1.7;
  color: var(--ui-text-3);
}

.privacy__text {
  flex: 1;
  font-size: 26rpx;
  line-height: 1.7;
  color: var(--ui-text-2);
}

.privacy__foot {
  margin-top: 48rpx;
  padding-top: 24rpx;
  border-top: 2rpx solid var(--ui-hairline);
  font-size: 24rpx;
  line-height: 1.7;
  color: var(--ui-text-3);
}
</style>
