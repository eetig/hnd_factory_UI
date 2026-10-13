<script setup>
import { computed, nextTick, ref } from 'vue'
import { formatMonthDay, getToday } from '../utils/format'

// 日期选择字段（企业微信-会议同款的底部日历弹层）。
//
// 改造前这里包的是 wd-datetime-picker（滚轮式：年 / 月 / 日 三列），
// 现在换成「胶囊头 + 星期行 + 可按月滚动的月历网格」：
//   · 顶部灰底胶囊里嵌着当前选择，右侧是强调色的「确定」；
//   · 下面是「日一二三四五六」星期行 + 按自然月铺开的月历；
//   · 每月 1 号位显示「n月」而不是数字，滚动时一眼能看出月份分界；
//   · 今天 / 选中用强调色圆点标出；
//   · 点那颗胶囊切出**年月面板**（‹ 年 › + 12 个月），用来一步跳到很早/很晚的年月
//     —— 月历一次只铺 9 个月，光靠滚要到几年前得来回翻好几轮（使用方 2026-10-13 反馈）。
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

// 月度窗口：锚点月往前 6 个月、往后 2 个月，共 9 个月。
// 为什么是有限窗口而不是"无限滚动"：小程序端一次渲染的节点越多越慢，
// 9 个月约 780 个节点，是「够用（报表默认取本月 / 上周，回看也就几个月）」
// 与「小程序渲染开销」之间的折中。
// 窗口之外的月份由年月面板直接跳（改造前是靠"滚到最早一个月点一天 → 窗口跟着重建"
// 一点点往回蹭，走到 2024 年得点好几轮；面板出来后这条路就不需要了）。想放宽改这两个常量即可。
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

// 年月面板是否盖在日历上（点顶部胶囊切换）。
// 它只负责「跳到哪个月」，**不改选中值** —— 选哪天仍然只能在月历里点，
// 免得"从年月面板进来看一眼"就把选择改掉了。
const ymVisible = ref(false)
// 面板里正在浏览的年份（‹ › 改它，点某个「n月」才真正跳走）
const ymYear = ref(new Date().getFullYear())

// 年月面板的年份上下限：只防手滑走到离谱的年份。
// 为什么要有：Date 把 0~99 当 1900+ 处理，真翻到那儿显示会错乱；
// 本项目的报表数据都在近几年，1970~2100 足够，想放开改这两个常量即可。
const MIN_YEAR = 1970
const MAX_YEAR = 2100

// 月历窗口的锚点月（'YYYY-MM'），以它为轴往前 6 / 往后 2 铺 9 个月。
// ⚠️ 刻意**不跟着 draft 走**（改造前是跟的）：点某一天只该换选中圆点，
//    列表不能在脚下重排 —— 从前点一个远一点的日期，9 个月窗口会当场挪位，
//    滚动位置就指到别的月份上去了。现在只有两处会换锚点：打开弹层、年月面板里跳月。
const anchorMonthKey = ref('')

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

// 'YYYY-MM' → 该月 1 号（本地零点）；非法返回 null
function parseMonth(value) {
  const [year, month] = String(value ?? '')
    .split('-')
    .map(Number)
  if (!year || !month) return null
  const date = new Date(year, month - 1, 1)
  return Number.isNaN(date.getTime()) ? null : date
}

// Date → 'YYYY-MM'（与 buildMonth 里造 key 用的是同一套写法）
function monthKeyOf(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`
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
  // 锚点还没设过（弹层没开过）时按今天铺一份，保证首帧就有内容
  const anchor = parseMonth(anchorMonthKey.value) || new Date()
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

// 锚点月之前的月份总共占多高 → scroll-top。
// 行数由网格自己决定，所以这里用同一份 months 数据算，不写死行数。
// ⚠️ 必须在锚点已经落定之后再调（它读的是 months，而 months 认锚点）。
function scrollOffsetOf(monthKey) {
  let offset = 0
  for (const month of months.value) {
    if (month.key === monthKey) break
    offset += MONTH_PADDING_RPX + Math.ceil(month.cells.length / 7) * CELL_HEIGHT_RPX
  }
  // uni.upx2px：三端都有的 rpx → px 换算，基准与样式里的 rpx 一致
  return uni.upx2px(offset)
}

// 滚到指定位置。
// scroll-view 只在 scroll-top **变化**时才动 —— 目标值和当前值刚好相同时（典型场景：
// 在日历里滚远了，点开年月面板又选了同一个月份），直接设值等于什么都没发生，
// 看着就像点了个死键。所以先挪 1px 再挪回去，让"回到这个月"这件事永远有效。
function scrollTo(offset) {
  if (scrollTop.value === offset) {
    scrollTop.value = offset - 1
    nextTick(() => {
      scrollTop.value = offset
    })
    return
  }
  scrollTop.value = offset
}

function openSheet() {
  draft.value = props.modelValue || getToday()
  const date = parseDate(draft.value) || new Date()
  // 打开前先算好 scroll-top：它跟着首帧一起生效，不会出现"弹层先停在顶部、
  // 动画结束后再跳一下"。这里不用 scroll-into-view —— wd-popup 的内容是懒渲染的，
  // 节点要等动画中间态才存在，"先设值再找节点"的写法在小程序端并不可靠。
  anchorMonthKey.value = monthKeyOf(date)
  scrollTo(scrollOffsetOf(anchorMonthKey.value))
  ymVisible.value = false // 每次打开都从月历开始，年月面板不留在上次的状态
  ymYear.value = date.getFullYear()
  sheetVisible.value = true
}

function pick(cell) {
  if (cell.lead || cell.disabled) return
  draft.value = cell.key
}

/**
 * 点头部胶囊：切出 / 收起年月面板。
 *
 * 它替掉了改造前那句「回到当前选择所在的月份」—— 原来叫得动这条路的只有
 * "滚远了想点回来"，而那件事在年月面板里点一下高亮的月份就能做，还能顺带跳到别的年月。
 */
function toggleYm() {
  if (!ymVisible.value) {
    // 面板打开时定位到「正在看的那个月」所在的年：翻着看的时候，
    // 直接跳到选中日期的年份会让人一愣（正在看 2024-03，弹出来却是 2026 年）
    const viewing = parseMonth(anchorMonthKey.value) || parseDate(draft.value) || new Date()
    ymYear.value = viewing.getFullYear()
  }
  ymVisible.value = !ymVisible.value
}

const canPrevYear = computed(() => ymYear.value > MIN_YEAR)
const canNextYear = computed(() => ymYear.value < MAX_YEAR)

function shiftYear(step) {
  ymYear.value = Math.min(MAX_YEAR, Math.max(MIN_YEAR, ymYear.value + step))
}

/** 年月面板里点某个月：收起面板，把月历滚到那个月（选中值不动） */
async function jumpToMonth(month) {
  const key = `${ymYear.value}-${pad2(month)}`
  ymVisible.value = false
  anchorMonthKey.value = key
  // ⚠️ 顺序不能反过来：换锚点会把 9 个月**整块重建**（每块的 key 都变了），
  //    必须等这次 DOM 换完再设 scroll-top —— 设早了浏览器会先滚到位、紧接着内容被替换，
  //    滚动位置被重置回 0，人看到的是"点了月份，日历还停在原来的地方"。
  //    （2026-10-13 H5 无头实测：先设值的话 scrollTop 停在 0，目标月落在可视区外 1.5 屏。）
  await nextTick()
  scrollTo(scrollOffsetOf(key))
}

// 年月面板里的状态标记：与月历同一套约定（今天 → 淡填充，选中 → 实心强调色）
function isCurrentMonth(month) {
  const now = new Date()
  return now.getFullYear() === ymYear.value && now.getMonth() + 1 === month
}

function isSelectedMonth(month) {
  const date = parseDate(draft.value)
  return Boolean(date) && date.getFullYear() === ymYear.value && date.getMonth() + 1 === month
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
          <!-- 灰底轨道里嵌着当前选择，右侧是「确定」—— 对齐企业微信会议那版。
               胶囊末尾那颗小箭头＝「这里点得开年月面板」，点它切出 ‹ 年 › + 12 个月。 -->
          <view class="date-sheet__track" @click="toggleYm">
            <view class="date-sheet__chip">
              <text>{{ chipText }}</text>
              <wd-icon name="caret-down" size="12px" />
            </view>
          </view>
          <view class="date-sheet__confirm" @click="confirm">确定</view>
        </view>

        <!-- 星期行 + 月历包一层，好让年月面板绝对定位盖住它们俩。
             面板开着时给这层打上 is-ym：底下的日历会被藏起来（见样式里那段说明） -->
        <view class="date-sheet__body" :class="{ 'is-ym': ymVisible }">
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

          <!-- 年月面板：一步跳到任意年月（月历一次只铺 9 个月，光靠滚要到几年前得翻好几轮）。
               它是一层**盖在日历上的**覆盖层而不是替换内容 —— 这样底层 scroll-view 始终挂载，
               点完月份把新的 scroll-top 设进去就能立即生效。
               面板自己没有背景色：底下的日历已经用 visibility 藏了（见样式），
               留空才和弹层其它地方一模一样、看不出这里叠了一层。 -->
          <view v-if="ymVisible" class="date-sheet__ym">
            <view class="date-sheet__ym-bar">
              <view
                class="date-sheet__ym-nav"
                :class="{ 'is-disabled': !canPrevYear }"
                @click="shiftYear(-1)"
              >
                <wd-icon name="arrow-left" size="16px" />
              </view>
              <text class="date-sheet__ym-year">{{ ymYear }}年</text>
              <view
                class="date-sheet__ym-nav"
                :class="{ 'is-disabled': !canNextYear }"
                @click="shiftYear(1)"
              >
                <wd-icon name="arrow-right" size="16px" />
              </view>
            </view>

            <view class="date-sheet__ym-grid">
              <view
                v-for="month in 12"
                :key="month"
                class="date-sheet__ym-cell"
                :class="{ 'is-today': isCurrentMonth(month), 'is-selected': isSelectedMonth(month) }"
                @click="jumpToMonth(month)"
              >
                <text class="date-sheet__ym-num">{{ month }}月</text>
              </view>
            </view>
          </view>
        </view>
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
    gap: 8rpx; // 文字与那颗「点得开年月面板」的小箭头之间
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

  // 星期行 + 月历的公共容器：年月面板要绝对定位盖在它们上面，所以得有个定位基准
  &__body {
    position: relative;
  }

  // 年月面板打开时把日历藏起来。
  // 为什么是 visibility 而不是别的：
  //   · v-if / v-show(display:none) 都会让 scroll-view 丢掉布局或整块重挂，
  //     滚动位置随之被清零 —— 而"点完月份要立刻滚到那个月"正依赖它保持挂载；
  //   · visibility 只是不画，布局与滚动位置都原样留着。
  // 为什么要藏：弹层底色是玻璃膜（--ui-glass-fill＝5% 白），面板若只靠一层半透明盖上去，
  // 日历的数字会从面板里透出来（2026-10-13 H5 无头实测，截图里两层数字叠在一起）。
  &__body.is-ym &__week,
  &__body.is-ym &__scroll {
    visibility: hidden;
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

  /* ===== 年月面板 =====
     盖在「星期行 + 月历」上的覆盖层，用来一步跳到任意年月。 */
  &__ym {
    position: absolute;
    // 四边都写：inset 简写在小程序端老一些的 WebView 上不一定认
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    display: flex;
    flex-direction: column;
    // 刻意不写背景：日历已经被上面的 is-ym 规则藏了，这里透出的就是弹层自己的底色
    // （写一层半透明的玻璃膜反而会花：那是"再盖一层"，不是"换成它"）
  }

  &__ym-bar {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    padding: 12rpx 0; // 让 ‹ 2026年 › 这行的中线与「当前选择」胶囊大致齐平
  }

  &__ym-nav {
    display: flex;
    width: 64rpx;
    height: 64rpx;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    color: $ui-text-2;

    &:active {
      background-color: $ui-surface-2;
    }

    // 到顶 / 到底的年份箭头：还是可以点（点了也不会越界），只是看得出"到头了"
    &.is-disabled {
      color: $ui-text-3;
      opacity: 0.4;
    }
  }

  &__ym-year {
    min-width: 200rpx;
    color: $ui-text;
    font-size: 32rpx;
    font-weight: 600;
    text-align: center;
  }

  &__ym-grid {
    display: flex;
    flex: 1; // 撑满面板剩下的高度，4 行月份才分布得开
    flex-wrap: wrap;
    align-content: space-evenly;
  }

  &__ym-cell {
    display: flex;
    flex: 0 0 33.3333%; // 3 列 × 4 行 = 一整年
    height: 96rpx; // 与日期格同高，两层的疏密看起来是一套
    align-items: center;
    justify-content: center;
    color: $ui-text;
    font-size: 30rpx;
  }

  // 月份胶囊（比日期的圆点宽，好放下「10月」两个字）
  &__ym-num {
    display: flex;
    width: 148rpx;
    height: 76rpx;
    align-items: center;
    justify-content: center;
    border-radius: $ui-radius-pill;
    transition: background-color $ui-dur $ui-ease, color $ui-dur $ui-ease;
  }

  // ⚠️ 同上面日期格那套：后写的赢。顺序 = 今天 → 选中。
  &__ym-cell.is-today &__ym-num {
    background-color: $ui-accent-soft;
    color: $ui-accent-text;
    font-weight: 600;
  }

  &__ym-cell.is-selected &__ym-num {
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