# 手势跟手翻页（GesturePager）参考实现

抄表页那套「横向卡片连续跟手 + 惯性预测吸附」的完整实现，配套技能 `gesture-pager`。

## 这个目录里有什么

| 文件 | 用途 |
|---|---|
| `GesturePager.vue` | 可复用组件：一条 `translate3d` 轨道 + 速度预测 + 收尾吸附 + 窗口化渲染。**当前未接进任何页面**，是给你下次直接拿去用的参考实现。 |
| `../../scripts/verify-pager.mjs` | 用 CDP 合成触摸，量跟手比例 / 落点偏差 / 跨页数 / 滑行时长 / DOM 页数。 |

现网真正在跑的是 `src/pages/meterRead/meterRead.vue` 里的内联版本，算法一致、变量名一致，只是没抽成组件。

## 为什么没直接接进抄表页

2026-11-11 试过一次：引擎和页面逻辑（`cardStyle`、`intent`、`remaining`、`filledEntries`、`trackH`、标签测量…）在同一个 script 块里交错，按行号切会连带删掉页面变量，页面直接白屏（`stageW is not defined` → 修完又 `namesStyle/trackH/cardStyle` 未定义）。已回滚，现网未受影响。

要接的话按这个顺序做，别再按行号切：

1. 先把页面里**只跟轨道有关**的符号列出来（`scrollX / stageW / pageStyleAt / windowCards / trackStyle / onTouchStart|Move|End / startGlide / snapNearest / animateTo / jumpTo`），确认它们没有被页面别处引用；
2. 模板改成 `<GesturePager v-model="index" :items="cards" item-key="meterId" :height="trackH">` + 一个默认插槽，插槽里保留 `<view v-if="active">可编辑卡</view>` / `<view v-else>预览卡</view>`；
3. 底部动作条留在 `GesturePager` **外面**（它原来是 `.mr__stage` 的第二个子节点，别一起搬进插槽）；
4. 标签带的 touch 事件转给组件暴露的 `startDrag / moveDrag / endDrag`；
5. 换页时 `commitDraft()` 必须在切数据**之前**（组件只负责 `page-change` 事件，落草稿是页面的事）；
6. 改完立刻跑 `node scripts/verify-pager.mjs`，六项全 PASS 再算完。

## 组件用法

```vue
<GesturePager
  ref="pagerRef"
  v-model="index"
  :items="cards"
  item-key="meterId"
  :height="trackH"
  :peek-scale="0.14"
  :peek-fade="0.45"
  :peek-inset="8"
  @page-change="onPageChange"
  @update:progress="floatIndex = $event"
>
  <template #default="{ item, active }">
    <view v-if="active" class="card">…可编辑表单…</view>
    <view v-else class="peek" @click="pagerRef.goTo(item.i)">…只读预览…</view>
  </template>
</GesturePager>
```

- `height`：轨道高度（px）。页是绝对定位，不给高度轨道会塌成 0。要在 `activeIndex`、提示行、键盘、数据长度变化后重新量。
- `update:progress`：浮点页号（1.5 = 卡在一二页中间），标签带用它做连续位移与高亮。
- `page-change`：整数页变了才发，页面在这里落草稿、换数据。
- 暴露方法：`goTo(i)`、`snapNearest(ms)`、`measure()`、`startDrag/moveDrag/endDrag(e)`。

## 实测基线（2026-11-11，390×844，抄表页）

| 指标 | 实测 |
|---|---|
| 拖动 50px 跟手 | 1.00（寸步不离） |
| 松手落点偏差 | ≤ 0.052 页 |
| 中甩跨页 | 12.02 页 / 1.50s |
| 快甩跨页 | 21.03 页 / 1.91s |
| 点标签跨 7 页 | 787ms |
| 滑行中 DOM 页数 | 最多 5 |
| 按住停 260ms 再松手 | 231ms 停住（不再白飞） |

参数含义与调法见技能 `gesture-pager` 的「参数表」；踩过的坑见「坑」那一节。
