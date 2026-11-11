# 系统选择器与弹层：项目里现在怎么用

配套全局技能：`~/.dsh/skills/uni-native-pickers/SKILL.md`（遇到同类需求先读它）。
这份文档只记**本仓库里实际落地的实现与位置**，改代码时照着抄。

## 一、日期：一律用 `components/DateField.vue`

不要用 `<picker mode="date">`。它在 App 端就是安卓 Material DatePicker，顶上一大条青绿色，主题跟系统走、前端改不了。

```vue
<DateField v-model="date" variant="inline" display="monthDay" placeholder="选择日期" @change="onDateChange" />
```

- `display="monthDay"` 让头部只显示 `11-11`；不加就显示 `2026-11-11`，窄地方会把旁边的胶囊挤掉。
- `@change` 给的是 `'YYYY-MM-DD'` **字符串**（老代码若收 `event.detail.value`，两种都判一下）。
- 抄表页用法见 `src/pages/meterRead/meterRead.vue` 的 `onReadDateChange`。

## 二、相册：一律用 `utils/chooseImages.js`

`uni.chooseImage({ sourceType: ['album'] })` 在 App 端弹的是框架自绘那套「选择图片 / 完成(n/m) / 所有图片 / 预览」，绿色按钮，不是手机相册。HBuilderX 2.9.6 起无法切回 `system: true`。

```js
import { chooseImages } from '../../utils/chooseImages'

const options = { count: 1, sizeType: ['compressed'], sourceType: ['album'], success, fail }
chooseImages(options)   // 相册 → 手机自带相册（小米是「安全访问」）
```

- 只有 `sourceType` 恰好 `['album']` 且 `isAndroidBridgeAvailable()` 时才走系统相册；`['camera','album']` 合并入口会原样交给框架。
- 拿回来的是 `file://` 本地路径（已拷贝 + 压过一次），别当临时路径、也别再压。
- 拍照继续用 `uni.chooseImage({ sourceType: ['camera'] })`，它调的就是系统相机。

## 三、来源选择弹层：`wd-popup` + `.source-sheet` 样式

不要 `uni.showActionSheet`。参考实现：`src/components/ImageParse.vue`

- 模板：`:1496` 的 `wd-popup`（`round` + `safe-area-inset-bottom`）、`:1502` 标题、`:1504` / `:1511` 两个条目（`wd-icon` camera / picture）、`:1518` 取消键。
- 样式：`:1581`—`:1643` 的 `.source-sheet*`。变量来自 `src/uni.scss`（`$ui-sheet-fill` / `$ui-surface-2` / `$ui-radius-md` / `$ui-accent-soft` / `$ui-raise-2` / `$ui-radius-pill`）。
- 抄表页副本：`meterRead.vue` 的 `.photo-sheet*`（2026-11-11，提交 83ec24a）。
- 顺序：点条目先关弹层（`photoSheetOpen = false`）再起相机/相册。

## 四、常驻提示：不要 `uni.showToast`

真机上它的 `duration` 可能不生效，页面一重排就关不掉，会一直压在输入框上。要在页面上停留几秒的信息，画一行自己的提示条（可自动收 + 「知道了」立刻收）。抄表页的 `.mr__note` 就是（提交 de90666）。

## 五、当前仓库里的调用点清单

| 位置 | 用途 | 状态 |
|---|---|---|
| `src/pages/meterRead/meterRead.vue` | 抄表拍照/相册、抄表日期 | ✅ 已按上面四条改（`chooseImages` + `DateField` + `.photo-sheet` + `.mr__note`） |
| `src/components/ImageParse.vue` | 单据图片解析 | ✅ 原始参考实现（2026-10-10 起就用 `chooseImages`） |
| `src/components/EquipmentFormDialog.vue:117` | 设备图片 | ✅ 已用 `chooseImages` |
| `src/components/TankLevelFormDialog.vue` | 罐体照 OCR | ✅ 2026-11-11 改：`source === 'album'` 走 `chooseImages` |
| `src/pages/index/index.vue:946`、`:1664` | 工单/周报上传图片 | ⚠️ 仍是 `uni.chooseImage({ sourceType: ['camera','album'] })` 合并入口 —— 框架会先弹它自己的 ActionSheet、再弹自绘相册。改它等于改选择流程，需要单独确认后再动。 |

排查命令：

```bash
grep -rn 'picker mode="date"' src
grep -rn 'uni\.chooseImage' src
grep -rn 'plus\.gallery\.pick' src
```

## 六、验证

- 这些是 App 原生能力，**只能在真机（HBuilderX 运行到手机）上看**；H5 上 `chooseImages` 会退回浏览器文件选择框，看不出区别。
- 日期：底部月历、选中日是项目蓝、头部不撑破。
- 相册：出现手机自带相册（小米「安全访问」）。仍是绿色那套 ⇒ 查 `utils/androidContent.js` 的 `isAndroidBridgeAvailable()` 与相关权限。
