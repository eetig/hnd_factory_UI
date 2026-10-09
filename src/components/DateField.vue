<script setup>
import { computed, ref } from 'vue'
import { formatMonthDay, getToday } from '../utils/format'

// 日期选择字段（企业微信-会议同款的底部日历弹层）。
//
// 改造前这里包的是 wd-datetime-picker（滚轮式：年 / 月 / 日 三列），
// 现在换成「胶囊头 + 星期行 + 可按月滚动的月历网格」：
//   · 顶部灰底胶囊里嵌着当前选择，右侧是强调色的「确定」；
//   · 下面是「日一二三四五六」星期行 + 按自然月铺开的月历；
//   · 每月 1 号位显示「n月」而不是数字，滚动时一眼能看出月份分界；
//   · 今天 / 选中用强调色圆点标出。
//
// 为什么手写网格，而不用 wot-design-uni 的 wd-calendar / wd-calendar-view：
//   那两者的外观是「标题 + 年/月面板 + 今天标签」，要还原上面这套观感就得大量
//   :deep() 覆写库内部结构，与本项目「不再用 :deep() 覆写第三方结构」的约定冲突
//   （见 pages/index/index.vue 里储罐选择器那段注释）。自己画只有我们这一层类名，
//   三端表现一致，也不用跟库的选择器较劲。
//
// 交互契约（与改造前逐条对齐，调用方无感）：
//   · v-model 与 change 都只进出 'YYYY-MM-DD' 字符串；
//   · 弹层里点日期只改内部 draft，**不发事件**；只有点「确定」才发
//     update:modelValue + change —— 调用方多是用 change 触发一次筛选请求，
//     逐格触发会打爆接口（这是改造前定下的语义，别改回去）；
//   · 点遮罩关闭 = 放弃本次选择，不发 change。

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '请选择日期' },
  // 可选的范围限制，格式同 modelValue（'YYYY-MM-DD'）。
  // 默认空 = 不限制：这几个筛选（工单 / 领料 / 入库 / 周统计）的默认区间本来就在过去，
  // 任何历史日期都要能选。将来要收紧范围传这两个 prop 即可，置灰态是现成的。
  minDate: { type: String, default: '' },
  maxDate: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'change'])

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六']

// 月度窗口：选中月往前 6 个月、往后 2 个月，共 9 个月。
// 为什么是有限窗口而不是"无限滚动"：小程序端一次渲染的节点越多越慢，
// 9 个月约 780 个节点，是「够用（报表默认取本月 / 上周，回看也就几个月）」
// 与「小程序渲染开销」之间的折中。窗口每次打开都以当前选中月为锚点重建，
// 所以连着往更早的月份翻几次也能到达任意历史月份。想放宽改这两个常量即可。
const MONTHS_BEFORE = 6
const MONTHS_AFTER = 2

// 单元格高度与月块内边距（rpx），必须与样式里的数值一致 ——
// 用来把「打开时定位到选中月」换算成 scroll-top。
const CELL_HEIGHT_RPX = 96
const MONTH_PADDING_RPX = 12

const sheetVisible = ref(false)
// 弹层内正在编辑的日期：点「确定」前不回写 modelValue，点遮罩关闭就随它丢弃
const draft = ref('')
const scrollTop = ref(0)

const pad2 = (value) => String(value).padStart(2, '0')

// 'YYYY-MM-DD' → 本地零点的 Date；非法返回 null。
// 全程只用本地时间（不碰 UTC），所以不存在时区偏移导致"选 1 号显示 31 号"的问题。
function parseDate(value) {
  const [year, month, day] = String(value ?? '')
    .split('-')
    .map(Number)
  if (!year || !month || !day) return null
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? null : date
}

// 一个月 → 一块网格（前置空格 + 自然日）。行数按内容算，和系统日历一样是 4~6 行。
function buildMonth(first, todayKey) {
  const year = first.getFullYear()
  const month = first.getMonth() + 1
  const daysInMonth = new Date(year, month, 0).getDate() // 下个月「0 号」= 本月最后一天
  const cells = []

  // 前置空格：把 1 号推到它真实的星期列上（企微那版也是这样留白的）
  for (let i = 0; i < first.getDay(); i += 1) {
    cells.push({ key: `lead-${year}-${pad2(month)}-${i}`, label: '', lead: true })
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = `${year}-${pad2(month)}-${pad2(day)}`
    // ISO 日期串按字典序比较等价于按时间比较，不用转时间戳
    const disabled =
      (props.minDate && key < props.minDate) || (props.maxDate && key > props.maxDate)

    cells.push({
      key,
      // 每月 1 号位显示「n月」：不看标题也能知道月份分界
      label: day === 1 ? `${month}月` : String(day),
      lead: false,
      monthStart: day === 1,
      today: key === todayKey,
      selected: key === draft.value,
      disabled: Boolean(disabled),
    })
  }

  return { key: `${year}-${pad2(month)}`, cells }
}

const months = computed(() => {
  const anchor = parseDate(draft.value) || new Date()
  const todayKey = getToday()
  const list = []
  for (let offset = -MONTHS_BEFORE; offset <= MONTHS_AFTER; offset += 1) {
    const first = new Date(anchor.getFullYear(), anchor.getMonth() + offset, 1)
    list.push(buildMonth(first, todayKey))
  }
  return list
})

// 头部胶囊里的文字：9月30日（跨年时补上年份，否则只看月日会有歧义）
const chipText = computed(() => {
  const date = parseDate(draft.value)
  if (!date) return props.placeholder
  const text = formatMonthDay(draft.value)
  const currentYear = new Date().getFullYear()
  return date.getFullYear() === currentYear ? text : `${date.getFullYear()}年${text}`
})

// 选中月之前的月份总共占多高 → scroll-top。
// 行数由网格自己决定，所以这里用同一份 months 数据算，不写死行数。
function scrollOffsetOf(value) {
  const date = parseDate(value) || new Date()
  const key = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`
  let offset = 0
  for (const month of months.value) {
    if (month.key === key) break
    offset += MONTH_PADDING_RPX + Math.ceil(month.cells.length / 7) * CELL_HEIGHT_RPX
  }
  // uni.upx2px：三端都有的 rpx → px 换算，基准与样式里的 rpx 一致
  return uni.upx2px(offset)
}

function openSheet() {
  draft.value = props.modelValue || getToday()
  // 打开前先算好 scroll-top：它跟着首帧一起生效，不会出现"弹层先停在顶部、
  // 动画结束后再跳一下"。这里不用 scroll-into-view —— wd-popup 的内容是懒渲染的，
  // 节点要等动画中间态才存在，"先设值再找节点"的写法在小程序端并不可靠。
  scrollTop.value = scrollOffsetOf(draft.value)
  sheetVisible.value = true
}

function pick(cell) {
  if (cell.lead || cell.disabled) return
  draft.value = cell.key
}

// 点头部胶囊：回到当前选择所在的月份（滚远了顺手点一下）
function backToDraftMonth() {
  scrollTop.value = scrollOffsetOf(draft.value)
}

function confirm() {
  if (!draft.value) return
  sheetVisible.value = false
  emit('update:modelValue', draft.value)
  emit('change', draft.value)
}
</script>

<template>
  <!-- 组件根：把触发器摆好即可。
       这里用 flex 而不是默认块级 —— 触发器是 inline-flex，放在块级容器里会多出
       一截基线（descender）高度，筛选行里的胶囊看起来就"没居中"。 -->
  <view class="date-picker">
    <!-- 触发器：深色胶囊，样式与改造前一致；点击由本组件接管
         （原来挂在 wd-datetime-picker 的默认插槽上，由它负责弹层） -->
    <view class="date-field" @click="openSheet">
      <text class="date-field__text" :class="{ 'is-empty': !modelValue }">
        {{ modelValue || placeholder }}
      </text>
      <wd-icon name="calendar" size="16px" />
    </view>

    <wd-popup
      v-model="sheetVisible"
      position="bottom"
      safe-area-inset-bottom
      custom-style="max-height: 82vh; border-radius: 32rpx 32rpx 0 0; overflow: hidden; background-color: var(--ui-glass-fill);"
    >
      <view class="date-sheet">
        <view class="date-sheet__head">
          <!-- 灰底轨道里嵌着当前选择，右侧是「确定」—— 对齐企业微信会议那版 -->
          <view class="date-sheet__track" @click="backToDraftMonth">
            <view class="date-sheet__chip">{{ chipText }}</view>
          </view>
          <view class="date-sheet__confirm" @click="confirm">确定</view>
        </view>

        <view class="date-sheet__week">
          <view v-for="label in WEEK_LABELS" :key="label" class="date-sheet__week-item">
            {{ label }}
          </view>
        </view>

        <!-- 滚动必须交给 scroll-view：小程序的 view 上写 overflow 不会滚
             （与 ProductSelectDialog / ImageParse 的选择器同一个原因） -->
        <scroll-view
          class="date-sheet__scroll"
          scroll-y
          scroll-with-animation
          :scroll-top="scrollTop"
        >
          <view v-for="month in months" :key="month.key" class="date-sheet__month">
            <view
              v-for="cell in month.cells"
              :key="cell.key"
              class="date-sheet__day"
              :class="{
                'is-lead': cell.lead,
                'is-month': cell.monthStart,
                'is-today': cell.today,
                'is-selected': cell.selected,
                'is-disabled': cell.disabled,
              }"
              @click="pick(cell)"
            >
              <text class="date-sheet__num">{{ cell.label }}</text>
            </view>
          </view>
        </scroll-view>
      </view>
    </wd-popup>
  </view>
</template>
<style scoped lang="scss">
// 组件根：只负责把触发器摆好。
// 用 flex 而不是默认的块级 —— 触发器是 inline-flex，放进块级容器会多出一截
// 基线（descender）高度，筛选行里的胶囊看起来就"没居中"。
.date-picker {
  display: flex;
  align-items: center;
}

// 深色胶囊样式的日期触发器（与改造前逐字一致）。
// 「丝滑」的来源：按下时轻微缩放 + 表面提亮，触屏上也有明确反馈。
.date-field {
  display: inline-flex;
  align-items: center;
  gap: 12rpx;
  padding: 16rpx 28rpx;
  border: 1px solid $ui-border;
  border-radius: $ui-radius-pill;
  background-color: $ui-surface-2;
  color: $ui-text;
  transition: background-color $ui-dur $ui-ease, border-color $ui-dur $ui-ease,
    transform 160ms $ui-ease;

  &:active {
    transform: scale(0.97);
    border-color: $ui-border-strong;
    background-color: $ui-surface-3;
  }

  &__text {
    font-size: 26rpx;
    line-height: 1.2;

    &.is-empty {
      color: $ui-text-3;
    }
  }
}

/* ===== 日历弹层 =====
   视觉对标企业微信-会议的日期弹层：灰底胶囊（内嵌当前选择）+ 强调色「确定」+
   星期行 + 可按月滚动的月历。弹层外壳（圆角 / 最大高度 / 安全区）交给 wd-popup。 */
.date-sheet {
  padding: 24rpx 24rpx 0;

  &__head {
    display: flex;
    align-items: center;
    padding-bottom: 20rpx;
  }

  &__track {
    // 灰底轨道：flex: 1 顺带把「确定」顶到最右
    display: flex;
    flex: 1;
    padding: 8rpx;
    border-radius: $ui-radius-pill;
    background-color: $ui-surface-2;
  }

  &__chip {
    // 选中段：铺满轨道，就是分段控件里被选中的那一段
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    padding: 12rpx 32rpx;
    border-radius: $ui-radius-pill;
    // 深色下 $ui-surface-3 比轨道更亮（选中填充）；浅色下由文件末尾那条覆盖成纯白
    background-color: $ui-surface-3;
    box-shadow: 0 4rpx 12rpx -6rpx $ui-shadow-strong;
    color: $ui-text;
    font-size: 28rpx;
    line-height: 1.2;
  }

  &__confirm {
    flex-shrink: 0;
    margin-left: 16rpx;
    padding: 12rpx 8rpx;
    color: $ui-accent;
    font-size: 30rpx;
    font-weight: 600;

    &:active {
      opacity: 0.6;
    }
  }

  &__week {
    display: flex;
    border-bottom: 1px solid $ui-hairline;
  }

  &__week-item {
    flex: 0 0 14.2857%; // 7 等分。不用 CSS grid：小程序端的表现更稳
    padding: 12rpx 0;
    color: $ui-text-3;
    font-size: 24rpx;
    text-align: center;
  }

  // scroll-view 必须有确定高度才会滚（小程序的 view 写 overflow 无效）
  &__scroll {
    height: 56vh;
  }

  &__month {
    display: flex;
    flex-wrap: wrap;
    padding: 8rpx 0 4rpx; // 与脚本里的 MONTH_PADDING_RPX 对应
  }

  &__day {
    display: flex;
    flex: 0 0 14.2857%;
    height: 96rpx; // 与脚本里的 CELL_HEIGHT_RPX 对应
    align-items: center;
    justify-content: center;
    color: $ui-text;
    font-size: 30rpx;
  }

  // 圆点：固定尺寸 + 50% 圆角，所以窄屏 / 宽屏上都是正圆（不会被格子拉成椭圆）
  &__num {
    display: flex;
    width: 72rpx;
    height: 72rpx;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition: background-color $ui-dur $ui-ease, color $ui-dur $ui-ease;
  }

  // ⚠️ 下面 5 条的先后顺序不能调：同一天可能同时命中多个状态，它们的选择器权重
  //    完全相同，靠"后写的赢"决定。顺序 = 前置空格 → 月标 → 置灰 → 今天 → 选中。
  &__day.is-lead &__num {
    color: transparent; // 前置空格：占位但不可见
  }

  &__day.is-month &__num {
    color: $ui-text-3; // 每月 1 号位显示「n月」，弱化成月份分界
    font-size: 26rpx;
  }

  &__day.is-disabled &__num {
    color: $ui-text-3; // 超出 minDate / maxDate（默认不传，等于不会触发）
  }

  &__day.is-today &__num {
    background-color: $ui-accent-soft;
    color: $ui-accent-text;
    font-weight: 600;
  }

  &__day.is-selected &__num {
    background-color: $ui-accent;
    color: $ui-on-accent;
    font-weight: 600;
  }
}

// 浅色主题下「选中段」要比轨道更亮才对（企微那版就是灰轨道 + 白胶囊）；
// 深色主题保持上面的 $ui-surface-3 —— 它在深色里本就是"比表面更亮"的选中填充。
// 类名由 useTheme() 挂在页面根 view 上，而 wd-popup 默认不 teleport，所以这里选得到。
.theme-light .date-sheet__chip {
  background-color: $ui-surface;
}
</style>