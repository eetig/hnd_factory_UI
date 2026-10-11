/*
 * 日期面板滚轮翻页（变更-039）。
 *
 * 使用方 2026-10-11：「日历能用（通过）鼠标滚轮翻页」。Element Plus 的日期面板
 * 对 wheel **零处理**（date-picker-panel / time-picker / popper 目录 grep wheel 零命中），
 * 鼠标停在打开的日历上滚轮什么都不发生。
 *
 * 做法：一条 document 级（capture）监听，事件目标落在**单日期面板**内时，
 * 替用户去点面板头部的前/后翻箭头按钮 —— 而不是调内部 API：
 *   · 四个箭头是真 <button>，切视图（date ↔ month ↔ year）只换表格子树、header 不重建，
 *     类名稳定（EP 2.14.5 编译产物核实过）；
 *   · 点它 = 走 EP 自己的全部逻辑（边界、disabled），不依赖未导出的内部方法；
 *   · disabled 的按钮 .click() 不触发事件，天然安全。
 *
 * 为什么是 document 级而不是去 10 个使用点上挂指令：面板是 teleport 到 body 的
 * （body > #el-popper-container-* > .el-popper.el-picker__popper > .el-picker-panel），
 * 不在任何一个组件的子树里 —— 组件级指令够不着它。全站 10 个 el-date-picker
 * （WorkOrderList 8 个 + TankLevelPanel 2 个）就这样一次全覆盖。
 *
 * 按键映射（使用方 2026-10-11 选定）：滚轮＝单箭头（翻月），Shift+滚轮＝双箭头（翻年）。
 * 月/年视图里单箭头被 v-show 藏起，此时「滚轮跟着可见的箭头走」自动变成翻年 / 翻十年
 * （EP 的 moveByYear 在 year 视图步进 10 年）—— 这是刻意的，不是 bug。
 */

const PANEL_SELECTOR = '.el-picker-panel.el-date-picker'

/*
 * 面板内**靠原生滚轮**的滚动区，滚轮要放行给它们：
 * 时分秒列（datetime 面板）与快捷方式侧栏（shortcuts）。全站目前没有这两样，
 * 这条是给将来的护栏。⚠️ 判定必须再限定在面板内（见 onWheel 第 3 步）——
 * 裸的 closest 会向上爬出面板、命中面板外的祖先，整块面板就失灵了。
 */
const INNER_SCROLL_SELECTOR =
  '.el-time-panel, .el-time-spinner__wrapper, .el-scrollbar__wrap, .el-picker-panel__sidebar'

/*
 * 三个手感常数，嫌快 / 嫌慢就调这里：
 *   STEP        —— 归一化后累计滚过多远翻一格（Windows 鼠标一格 deltaY=100，必翻）
 *   LINE_PX     —— deltaMode=1（按行）时的行换算像素
 *   COOLDOWN_MS —— 翻完一格后的静默窗，窗口内只吞不翻，专治触控板惯性连翻。
 *                  是**固定窗**不是滑动窗：锁内的事件不会把锁续期 ——
 *                  否则鼠标快滚的连续事件互相续期，一次快滚全被吞掉。
 *                  150ms 对惯性是「减轻」不是「消除」，真机上仍嫌连翻就往小调。
 */
const STEP = 40
const LINE_PX = 40
const COOLDOWN_MS = 150

let uninstall = null

/**
 * 装上「日历滚轮翻页」。重复调用不会装第二条（返回同一个卸载函数）；
 * 重新安装即重置累计器 —— 测试里每个用例一次干净的安装。
 *
 * @returns {() => void} 卸载函数（生产不用；测试收尾与将来可能的按需关停）
 */
export function installDatePickerWheel() {
  if (uninstall) return uninstall

  let acc = 0 // 当前面板上累计的滚过量
  let lastPanel = null // 累计按面板分桶：换面板清零，免得上一块的余量挪到下一块上
  let lockedUntil = 0

  /** 点箭头：优先可见的单箭头（翻月），被 v-show 藏起或按了 Shift 就点双箭头（翻年/翻十年） */
  function clickArrow(panelEl, forward, yearJump) {
    const single = panelEl.querySelector(forward ? '.arrow-right' : '.arrow-left')
    const double = panelEl.querySelector(forward ? '.d-arrow-right' : '.d-arrow-left')
    // v-show 写的是 inline style：可见时是空串（不是 'inline-block'），只许判 !== 'none'
    const arrow = yearJump || !single || single.style.display === 'none' ? double : single
    arrow?.click()
  }

  function onWheel(event) {
    // ① 触控板捏合就是带 ctrlKey 的 wheel —— 先排掉，否则会「既翻月又吞掉缩放」
    if (event.ctrlKey) return

    const target = event.target
    if (!target || typeof target.closest !== 'function') return

    // ② 只有事件目标落在**单日期面板**里才接管。面板与 .el-picker-panel 是同一个节点。
    //    daterange 的根类是 el-date-range-picker（不会命中）—— 全站没有范围选择器，
    //    将来真加了，滚轮维持现状，不猜着翻。
    const panelEl = target.closest(PANEL_SELECTOR)
    if (!panelEl) return

    // ③ 面板内靠原生滚轮的区域放行（判定限定在面板内，见 INNER_SCROLL_SELECTOR 注释）
    const blocked = target.closest(INNER_SCROLL_SELECTOR)
    if (blocked && panelEl.contains(blocked)) return

    // ④ Shift 判断必须排在轴向比较**之前**：Chrome 把 Shift+滚轮改写成横向滚动
    //    （deltaX≠0、deltaY≈0），先按「横向主导就放行」过滤会把 Shift 变成死分支。
    const shift = event.shiftKey
    const dy =
      event.deltaMode === 1
        ? event.deltaY * LINE_PX
        : event.deltaMode === 2
          ? event.deltaY * 100
          : event.deltaY
    const delta = shift ? dy || event.deltaX : dy
    if (!delta) return
    if (!shift && Math.abs(event.deltaX) > Math.abs(delta)) return // 横向滚轮（触控板左右滑）不掺和

    // ⑤ 面板上没有可滚内容，别让滚轮穿透去滚背后的列表 —— 面板开着、指针在日历上，
    //    背后的列表跟着动观感很怪。这条也让「静默窗只吞」自洽：进到这里的事件一律被拦。
    event.preventDefault()

    const now = Date.now()
    if (panelEl !== lastPanel) {
      lastPanel = panelEl
      acc = 0
    }
    if (now < lockedUntil) {
      acc = 0 // 静默窗内：只吞不记账
      return
    }

    acc += delta
    if (Math.abs(acc) < STEP) return

    const forward = acc > 0
    acc = 0
    lockedUntil = now + COOLDOWN_MS
    clickArrow(panelEl, forward, shift)
  }

  // passive: false 必须显式写 —— Chrome 对 document 上的 wheel 监听默认按 passive 处理，
  // 那样 preventDefault() 不生效（控制台还会留一条 Intervention 警告）
  document.addEventListener('wheel', onWheel, { capture: true, passive: false })

  uninstall = () => {
    document.removeEventListener('wheel', onWheel, { capture: true })
    uninstall = null
  }
  return uninstall
}
