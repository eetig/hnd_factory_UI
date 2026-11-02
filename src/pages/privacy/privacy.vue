<script setup>
import { useTheme } from '../../composables/useTheme'

/*
 * 隐私政策（2026-11-02）。
 *
 * 两条硬约束（使用方明确）：
 *   1. 这个页面**不能被自动打开** —— 只能从「我的 / 抽屉」主动点进来。
 *      （曾经因为把它排进 pages.json 第一项变成启动页，用户一打开 App 就卡在这。）
 *   2. 内容要把**法律依据**说清楚：我们是内部管理系统，采集是为人力资源管理所必需，
 *      依据《个人信息保护法》第 13 条、第 17 条与《网络安全法》第 21 条，合法且必要。
 *
 * ⚠️ 别在文案里写 `**` 或 markdown 记号：App 端不解析，屏幕上就是两个星号。
 */
const { themeClass, themeVars } = useTheme()

const EFFECTIVE_DATE = '2026-11-02'

/** 首屏那句话：先给结论（合法、必要、有限），再给细节 */
const summary = [
  '本系统是公司内部的生产管理工具，只给本公司员工使用。',
  '为了能追溯数据由谁改动、发现异常登录，系统会记录少量与你账号和设备有关的信息。',
  '这些记录属于「实施人力资源管理所必需」，依据《个人信息保护法》第 13 条合法处理；',
  '我们按第 17 条的要求在此如实告知，并按《网络安全法》第 21 条把日志留存不少于六个月。',
]

const sections = [
  {
    title: '法律依据',
    intro: '这一段是这份说明的核心：为什么这些记录是合法的。',
    items: [
      '《中华人民共和国个人信息保护法》第 13 条第（二）项：为订立、履行个人作为一方当事人的合同所必需，或者按照依法制定的劳动规章制度和依法签订的集体合同实施人力资源管理所必需，可以处理个人信息。',
      '《中华人民共和国个人信息保护法》第 17 条：处理个人信息前，应当以显著方式、清晰易懂的语言真实、准确、完整地向个人告知处理目的、方式、种类、保存期限等 —— 本页即履行该告知义务。',
      '《中华人民共和国网络安全法》第 21 条：采取监测、记录网络运行状态、网络安全事件的技术措施，并按照规定留存相关的网络日志不少于六个月。',
      '因此本系统：只处理人力资源管理所必需的最小范围；不采集敏感个人信息（生物识别、宗教信仰、医疗健康、行踪轨迹、金融账户等）；数据只存放在公司自有服务器（境内），不向境外提供。',
    ],
  },
  {
    title: '我们记录什么',
    items: [
      '注册：注册时间、注册时的 IP 与设备。',
      '登录与退出：每次登录 / 退出的时间、IP、设备型号与操作系统、App 版本。',
      '操作留痕：录入、修改、删除、导入、确认入库等写操作，记录时间、IP、设备与操作对象（例如工单号、单据号）。',
      '不在记录范围：查询与浏览这类只读操作；你上传的单据图片内容；任何密码（密码只以加密摘要形式存储，任何人都看不到原文）。',
    ],
  },
  {
    title: '为什么记录（处理目的）',
    items: [
      '核对生产数据是谁在什么时候改的，出了问题能追溯到人、到单据。',
      '识别异常登录（陌生设备、异常地点），保护账号与生产数据安全。',
      '配合网络日志留存要求，满足内部审计与外部检查。',
      '不用于绩效考核、不做员工行为分析 —— 这一点由使用方确认。',
    ],
  },
  {
    title: '谁能看到',
    items: [
      '只有系统管理员能在 PC 端「管控日志」页查看。',
      '普通账号、班组长、操作工都看不到，接口层也会拒绝。',
      '日志只读：系统不提供按条删除的功能，避免「改完就把记录删掉」。',
    ],
  },
  {
    title: '保存多久',
    items: [
      '登录 / 退出 / 操作留痕：365 天（满足《网络安全法》不少于六个月的要求）。',
      '到期后由系统自动清理，不需要任何人手动删。',
    ],
  },
  {
    title: '我们明确不做的事',
    items: [
      '不采集精确定位、通讯录、通话记录、短信、相册（除你主动选择上传的图片）。',
      '不采集人脸、指纹、声纹等生物识别信息。',
      '不把你的数据提供给任何第三方，不做广告投放，不做用户画像。',
      '数据不出境。',
    ],
  },
  {
    title: '你的权利',
    intro: '按《个人信息保护法》第四章，你有下列权利，通过管理员即可行使：',
    items: [
      '查阅、复制：可以要求导出与你账号相关的记录。',
      '更正：发现记录有误（例如不是本人操作），可以要求核实更正并保留更正痕迹。',
      '删除：在不违反法定留存义务的前提下，可以要求删除超出必要范围的记录。',
      '说明：可以要求解释本系统的处理规则，本页就是这份说明。',
    ],
  },
]
</script>

<template>
  <view class="privacy" :class="themeClass" :style="themeVars">
    <view class="privacy__head">
      <text class="privacy__title">隐私政策与数据说明</text>
      <text class="privacy__sub">生效日期 {{ EFFECTIVE_DATE }} · 内部系统 · 仅本公司员工使用</text>
    </view>

    <!-- 首屏先给结论：合法 / 必要 / 有限。细节放后面的分节 -->
    <view class="privacy__summary">
      <view v-for="line in summary" :key="line" class="privacy__summary-line">
        <text class="privacy__summary-dot">·</text>
        <text class="privacy__summary-text">{{ line }}</text>
      </view>
    </view>

    <view v-for="(section, index) in sections" :key="section.title" class="privacy__section">
      <view class="privacy__section-head">
        <text class="privacy__index">{{ index + 1 }}</text>
        <text class="privacy__section-title">{{ section.title }}</text>
      </view>
      <text v-if="section.intro" class="privacy__intro">{{ section.intro }}</text>
      <view class="privacy__list">
        <view v-for="item in section.items" :key="item" class="privacy__item">
          <text class="privacy__dot">·</text>
          <text class="privacy__text">{{ item }}</text>
        </view>
      </view>
    </view>

    <view class="privacy__foot">
      <text>
        本政策如有变化会在本页更新生效日期。有疑问或要行使上述权利，请联系系统管理员。
      </text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.privacy {
  padding: 32rpx 32rpx 96rpx;
}

.privacy__head {
  margin-bottom: 24rpx;
}

.privacy__title {
  display: block;
  font-size: 42rpx;
  font-weight: 700;
  line-height: 1.3;
  color: var(--ui-text);
}

.privacy__sub {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: var(--ui-text-3);
}

/* 首屏结论块：用一层浅底把它和下面的分节区分开，让人先读结论 */
.privacy__summary {
  padding: 24rpx;
  border-radius: 20rpx;
  background-color: var(--ui-surface-2);
}

.privacy__summary-line {
  display: flex;
  gap: 10rpx;
}

.privacy__summary-line + .privacy__summary-line {
  margin-top: 8rpx;
}

.privacy__summary-dot {
  flex-shrink: 0;
  font-size: 26rpx;
  line-height: 1.75;
  color: var(--ui-text-3);
}

.privacy__summary-text {
  flex: 1;
  font-size: 26rpx;
  line-height: 1.75;
  color: var(--ui-text-2);
}

.privacy__section {
  margin-top: 40rpx;
}

.privacy__section-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 12rpx;
}

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

.privacy__intro {
  display: block;
  margin-bottom: 10rpx;
  font-size: 24rpx;
  line-height: 1.7;
  color: var(--ui-text-3);
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
  line-height: 1.75;
  color: var(--ui-text-3);
}

.privacy__text {
  flex: 1;
  font-size: 26rpx;
  line-height: 1.75;
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
