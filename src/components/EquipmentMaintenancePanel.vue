<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import {
  ElButton,
  ElCheckbox,
  ElDialog,
  ElInput,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElPagination,
  ElSelect,
} from 'element-plus'
import { CONTAINER_TYPES, containerTypeLabel, useEquipmentLedgerData } from '../composables/useEquipmentLedgerData'
import { STATUS_TEXT } from '../constants/statusTones'
import { useLiveQuery } from '../composables/useLiveQuery'
import { vesselImageUrl } from '../composables/useVesselList'
import VesselCalibrateDialog from './VesselCalibrateDialog.vue'

// ===== 设备数据维护（2026-10-06）=====
//
// 为什么是「列表 + 点行弹窗」而不是全字段行内编辑：使用方要**逐个设备对着图纸核对参数**，
// 16 个字段横着排一屏放不下，行内编辑要在横向滚动的表格里拖着填，极易改错行；
// 弹窗一次把字段按「台账信息 / 几何参数 / 底图」三组铺开，比对着图纸改顺手得多。
// （手机端同理，见 uni-app 的 EquipmentFormDialog。）
//
// ⚠️ 2026-10-10 统一整改后，**搜索与分页都在服务端**（原先是一次拉全表 92 行 + 前端 filter
// + 前端分页）。所以：
//   · 关键字**边打边查**（变更-060 起：停 250ms 发一次，不用回车）—— 走公共接线
//     `useLiveQuery`（防抖 + 查询签名去重 + 卸载撤销），过期响应护栏在
//     `useEquipmentLedgerData` 的 `ledgerRequestSeq`。
//     ⚠️ 这不等于退回「逐字实时过滤」：服务端查询**逐字发**才会把接口打烂，
//     防抖正是那条线（打字 8 个字仍然只发 1 次）。
//   · 分页器照旧，只是页码/条数/关键字都发给服务端；「停用的行也要显示」这条口径没变。

const {
  rows,
  total,
  loading,
  saving,
  loadError,
  pageNum,
  pageSize,
  keyword,
  onlyEnabled,
  loadLedger,
  loadLedgerPage,
  applyLedgerFilters,
  setLedgerPageSize,
  saveLedger,
  setLedgerEnabled,
  uploadVesselDrawing,
} = useEquipmentLedgerData()

/*
 * 关键字**边打边查**（变更-060）：停 250ms 就发请求，不用回车。
 *
 * 公共接线（防抖 + 查询签名去重 + 卸载撤销）见 src/composables/useLiveQuery.js；
 * 过期响应护栏在数据层（`ledgerRequestSeq`）—— 那层必须贴着请求写。
 * 「刷新」按钮仍走 `loadLedger`（纯强制重取），回车/清空走 `flushLedgerQuery`（先取消待发再查）。
 */
const { flush: flushLedgerQuery } = useLiveQuery(keyword, applyLedgerFilters)

/**
 * 已经有行、又正在查（实时查询的「细化」阶段）：只在计数处提示"查询中…"。
 * 台账原先完全没有细化阶段的信号 —— 遮罩只盖首屏（`v-if="loading && !rows.length"`），
 * 于是打字期间屏上一点"在查"的迹象都没有（变更-066）。
 */
const ledgerRefining = computed(() => loading.value && rows.value.length > 0)

/**
 * 封头深度一列显示「上 / 下」。用一个列而不是两列：表格已经 14 列了，
 * 而下封头为空只可能是平底这一种情况，并排写反而占地方。
 */
function headDepthText(row) {
  const top = row.topHeadDepth ?? '—'
  const bottom = row.bottomHeadDepth > 0 ? row.bottomHeadDepth : '平底'
  return `${top} / ${bottom}`
}

onMounted(() => {
  // loadLedger 自己吞错误并落到 loadError（失败时保留上一次取到的行），这里不必再包 try
  loadLedger()
})

/** 「只看启用的」勾选变化：写回查询条件并回第 1 页重查 */
function toggleOnlyEnabled(value) {
  onlyEnabled.value = value
  applyLedgerFilters()
}

// ===== 编辑弹窗 =====

const dialogVisible = ref(false)
const isNew = ref(false)
const draft = reactive({})
const message = ref('')
/** 上面那条提示是"成功"还是"失败"（只有失败才是红的） */
const messageOk = ref(false)
/** 底图上传中：按钮转圈 + 禁止重复点（原先上传没有任何反馈，使用者不知道传没传成功） */
const uploadingDrawing = ref(false)
const uploadInput = ref(null)

function resetDraft(source = {}) {
  Object.assign(draft, {
    id: source.id ?? null,
    equipmentCode: source.equipmentCode ?? '',
    equipmentName: source.equipmentName ?? '',
    nickname: source.nickname ?? '',
    workshop: source.workshop ?? '',
    spec: source.spec ?? '',
    containerType: source.containerType ?? 3,
    innerDiameter: source.innerDiameter ?? null,
    shellLength: source.shellLength ?? null,
    straightFlange: source.straightFlange ?? null,
    topHeadDepth: source.topHeadDepth ?? null,
    bottomHeadDepth: source.bottomHeadDepth ?? null,
    volumePerMm: source.volumePerMm ?? null,
    density: source.density ?? null,
    medium: source.medium ?? '',
    remark: source.remark ?? '',
    imageFile: source.imageFile ?? '',
    // 底图坐标（变更-081 起后端可写、变更-082 起有标定界面）。
    // 这里带上它是为了「编辑弹窗里刚标完就保存」这条路径；没标定的行是空串，
    // 提交时转成 null，后端的默认更新策略会跳过这一列 —— 普通保存不会清掉已有标定。
    imageBounds: source.imageBounds ?? '',
  })
  message.value = ''
}

function openEdit(row) {
  isNew.value = false
  resetDraft(row)
  dialogVisible.value = true
}

function openCreate() {
  isNew.value = true
  resetDraft()
  dialogVisible.value = true
}

// 几何/数值列只做「像不像数字」的粗校验：这些值会直接喂给容器体积计算，
// 一旦混进 "350O"（字母 O）这类值，保存时不报错，计算页却算出一个 NaN（变更-033）
const NUMERIC_DRAFT_FIELDS = [
  ['innerDiameter', '内径'],
  ['shellLength', '筒体长度'],
  ['straightFlange', '直边'],
  ['topHeadDepth', '上封头深度'],
  ['bottomHeadDepth', '下封头深度'],
  ['volumePerMm', '每毫米体积'],
  ['density', '介质密度'],
]

/** 返回第一个「填了但不是数字」的字段名，全部合法返回空串；留空一律放行 */
function firstNonNumericField() {
  for (const [key, label] of NUMERIC_DRAFT_FIELDS) {
    const raw = draft[key]
    if (raw === null || raw === undefined) continue
    const text = String(raw).trim()
    if (!text) continue
    if (!Number.isFinite(Number(text))) return label
  }
  return ''
}

async function handleSave() {
  message.value = ''
  messageOk.value = false
  if (!draft.equipmentName?.trim()) {
    message.value = '设备名称不能为空'
    ElMessage.error(message.value)
    return
  }
  const badField = firstNonNumericField()
  if (badField) {
    message.value = `${badField}必须填数字（留空表示未填写）`
    ElMessage.error(message.value)
    return
  }
  try {
    await saveLedger(draft)
    dialogVisible.value = false
    // 成功也要说话（变更-085）：原先保存成功毫无反馈，使用者无法判断到底存进去没有
    ElMessage.success('已保存')
  } catch (e) {
    // ⚠️ 失败**不关弹窗**（变更-085）：后端把业务失败也发成 HTTP 200，
    // 配合 request.js 新加的拦截，这里终于能拿到失败原因了，而不是静默关掉当成功
    message.value = `保存失败：${e?.response?.data?.msg || e?.message || '未知错误'}`
    ElMessage.error(message.value)
  }
}

async function handleToggle(row) {
  // 启用门槛（变更-081/082）：原因由服务端下发（EquipmentLedgerVO.enableBlockReason），
  // 前端不重复实现那套规则。不合规的行连请求都不发 —— 后端也会拒，但那样只有一句报错，
  // 这里顺手把「为什么」摆出来。
  if (row.enabled !== 1 && blockReasonOf(row)) {
    await showBlockReason(row)
    return
  }
  try {
    await setLedgerEnabled(row.id, row.enabled !== 1)
  } catch (e) {
    loadError.value = `切换启停失败：${e?.response?.data?.msg || e?.message || '未知错误'}`
  }
}

/**
 * 「不能启用」的原因；可以启用（或已启用）时返回空串。
 * 文案是服务端拼好的整句（"不能启用：未配置容器底图；…"），直接展示即可。
 */
function blockReasonOf(row) {
  if (row.enabled === 1) return ''
  return row.enableBlockReason || ''
}

async function showBlockReason(row) {
  try {
    await ElMessageBox.alert(blockReasonOf(row), `${row.equipmentName || '该设备'}：不能启用`, {
      confirmButtonText: '知道了',
    })
  } catch {
    // 关掉弹窗即可，不算错误
  }
}

// ===== 底图 =====

/** 底图预览地址：与体积计算页同一个解析（内置底图走打包资源、上传的走 /files） */
function imagePreview(file) {
  return vesselImageUrl(file)
}

function pickDrawing() {
  uploadInput.value?.click()
}

async function handleDrawingPicked(event) {
  const file = event.target.files?.[0]
  event.target.value = '' // 允许连续选同一个文件
  if (!file) return
  message.value = ''
  messageOk.value = false
  uploadingDrawing.value = true
  // 上传要好几秒（几 MB 的图纸），期间必须让使用者看到"在传"（变更-085）
  ElMessage.info(`正在上传底图（${Math.round(file.size / 1024)} KB）…`)
  try {
    draft.imageFile = await uploadVesselDrawing(file)
    // 上传只是把图放进图片服务器；**没点保存就不会写进台账**，这句话必须说出来
    messageOk.value = true
    message.value = '底图已上传 ✓ 记得点右下角【保存】才会写进台账；接着点【标定底图】框出罐体轮廓'
    ElMessage.success('底图已上传')
    // 换了图，旧的坐标一律作废：新图的尺寸/取景与旧图未必一致，
    // 留着旧坐标会让液面画在错误的位置（而且不报错）。清空后再走「标定底图」。
    draft.imageBounds = ''
  } catch (e) {
    message.value = `底图上传失败：${e?.response?.data?.msg || e?.message || '未知错误'}`
    ElMessage.error(message.value)
  } finally {
    uploadingDrawing.value = false
  }
}

// ===== 标定底图（变更-082）=====

const calibrateVisible = ref(false)

function openCalibrate() {
  if (!draft.imageFile) {
    message.value = '先上传底图，再标定'
    return
  }
  message.value = ''
  calibrateVisible.value = true
}

/**
 * 标定结果**只写进 draft**，随编辑弹窗的「保存」一起提交。
 *
 * 为什么不在标定弹窗里直接调接口：后端 save 是**整行覆写**（变更-065 的契约），
 * 单独提交一份只带 id + imageBounds 的载荷会把其余 16 个字段清成 NULL。
 */
function handleCalibrated(boundsJson) {
  draft.imageBounds = boundsJson
  calibrateVisible.value = false
}
</script>

<template>
  <section class="rounded-card border border-line bg-raised shadow-card">
    <div class="flex flex-wrap items-center gap-x-4 gap-y-4 border-b border-line px-6 py-4">
      <p class="text-sm font-medium text-slate-700">设备数据维护</p>
      <p class="text-xs text-slate-500">
        <template v-if="ledgerRefining">查询中…</template>
        <template v-else>逐个设备对着图纸核对参数：本页 {{ rows.length }} / 共 {{ total }} 条</template>
      </p>
      <div class="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
        <!-- 关键字**边打边查**（变更-060）：停 250ms 就发，不用回车；回车/清空 = 立刻发。
             走 watch（输入法组字期间不触发）而不是 @input，选词时的拼音串不会变成一次查询 -->
        <el-input
          v-model="keyword"
          placeholder="位号 / 名称 / 昵称 / 规格 / 车间"
          aria-label="搜索设备"
          clearable
          class="w-64"
          @keyup.enter="flushLedgerQuery"
          @clear="flushLedgerQuery"
        />
        <el-checkbox :model-value="onlyEnabled" label="只看启用的" @change="toggleOnlyEnabled" />
        <el-button @click="loadLedger">刷新</el-button>
        <el-button type="primary" @click="openCreate">新增设备</el-button>
      </div>
    </div>

    <p
      v-if="loadError"
      role="alert"
      class="border-b border-amber-200 bg-amber-50 px-6 py-3 text-xs text-amber-800"
    >
      {{ loadError }}
    </p>

    <!-- 表格自带滚动区 + 吸顶表头（变更-085）：原先整表交给页面滚动，往下翻几行表头就没了，
         根本认不出哪一列是内径、哪一列是筒体长度。给容器一个上限高度后，
         `sticky top-0` 才有参照物，表头会一直停在滚动区顶部 -->
    <div class="max-h-[68vh] overflow-auto">
      <table class="w-full text-sm">
        <thead class="sticky top-0 z-10 bg-region text-xs text-slate-500 shadow-[0_1px_0_0_var(--color-line,#e5e7eb)]">
          <tr>
            <th scope="col" class="px-4 py-2.5 text-right font-medium">序号</th>
            <th scope="col" class="px-4 py-2.5 text-left font-medium">位号</th>
            <th scope="col" class="px-4 py-2.5 text-left font-medium">名称</th>
            <th scope="col" class="px-4 py-2.5 text-left font-medium">昵称</th>
            <th scope="col" class="px-4 py-2.5 text-left font-medium">规格</th>
            <th scope="col" class="px-4 py-2.5 text-left font-medium">容器类型</th>
            <th scope="col" class="px-4 py-2.5 text-right font-medium">内径</th>
            <th scope="col" class="px-4 py-2.5 text-right font-medium">筒体长度</th>
            <th scope="col" class="px-4 py-2.5 text-right font-medium">直边</th>
            <th scope="col" class="px-4 py-2.5 text-right font-medium">封头深度(上/下)</th>
            <th scope="col" class="px-4 py-2.5 text-left font-medium">介质</th>
            <th scope="col" class="px-4 py-2.5 text-right font-medium">介质密度</th>
            <th scope="col" class="px-4 py-2.5 text-left font-medium">底图</th>
            <th scope="col" class="px-4 py-2.5 text-left font-medium">状态</th>
            <th scope="col" class="px-4 py-2.5 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in rows"
            :key="row.id"
            tabindex="0"
            class="cursor-pointer border-t border-line hover:bg-region focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
            :class="{ 'text-slate-500': row.enabled !== 1 }"
            @click="openEdit(row)"
            @keydown.enter.self.prevent="openEdit(row)"
            @keydown.space.self.prevent="openEdit(row)"
          >
            <!-- 序号跨页连续（不是每页从 1 开始）：使用方是照着序号逐个核对，
                 一翻页就重新数会串 -->
            <td class="px-4 py-2.5 text-right text-xs text-slate-500">
              {{ (pageNum - 1) * pageSize + index + 1 }}
            </td>
            <td class="px-4 py-2.5">{{ row.equipmentCode || '—' }}</td>
            <td class="px-4 py-2.5 font-medium">{{ row.equipmentName }}</td>
            <td class="px-4 py-2.5">{{ row.nickname || '—' }}</td>
            <td class="px-4 py-2.5">{{ row.spec || '—' }}</td>
            <td class="px-4 py-2.5">{{ containerTypeLabel(row.containerType) }}</td>
            <td class="px-4 py-2.5 text-right">{{ row.innerDiameter ?? '—' }}</td>
            <td class="px-4 py-2.5 text-right">{{ row.shellLength ?? '—' }}</td>
            <td class="px-4 py-2.5 text-right">{{ row.straightFlange ?? '—' }}</td>
            <td class="px-4 py-2.5 text-right">{{ headDepthText(row) }}</td>
            <td class="px-4 py-2.5">{{ row.medium || '—' }}</td>
            <td class="px-4 py-2.5 text-right">{{ row.density ?? '—' }}</td>
            <td class="px-4 py-2.5">
              <div class="flex items-center gap-2">
                <img
                  v-if="row.imageFile"
                  :src="imagePreview(row.imageFile)"
                  :alt="`${row.equipmentName} 的容器底图`"
                  class="h-8 w-8 rounded-md border border-line object-contain"
                />
                <span v-else class="text-xs text-slate-500">未配</span>
                <!-- 有图但没坐标 = 进不了体积计算页的下拉；这个徽标就是为了让"为什么下拉里没有它"一眼可查 -->
                <span
                  v-if="row.imageFile && !row.imageBounds"
                  class="rounded-full border border-amber-300 bg-amber-50 px-1.5 text-[11px] text-amber-700"
                >
                  未标定
                </span>
              </div>
            </td>
            <td class="px-4 py-2.5 text-xs">{{ row.enabled === 1 ? '启用' : '已停用' }}</td>
            <td class="px-4 py-2.5 text-right whitespace-nowrap">
              <el-button
                size="small"
                :disabled="row.enabled !== 1 && !!blockReasonOf(row)"
                :title="blockReasonOf(row)"
                @click.stop="handleToggle(row)"
              >
                {{ row.enabled === 1 ? '停用' : '启用' }}
              </el-button>
              <button
                v-if="blockReasonOf(row)"
                type="button"
                class="ml-2 text-xs text-amber-700 underline decoration-dotted"
                @click.stop="showBlockReason(row)"
              >
                为何不能启用
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="15" class="px-4 py-10 text-center text-sm text-slate-500">
              {{ loading ? '正在加载…' : '没有符合条件的设备' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="rows.length" class="flex justify-end px-6 py-3">
      <el-pagination
        v-model:current-page="pageNum"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        background
        @current-change="loadLedgerPage"
        @size-change="setLedgerPageSize"
      />
    </div>

    <!-- 编辑弹窗：16 个字段按「台账信息 / 几何参数 / 底图」三组 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isNew ? '新增设备' : `编辑：${draft.equipmentName || ''}`"
      width="720px"
    >
      <div class="space-y-6">
        <div>
          <p class="mb-2 text-xs font-medium text-slate-500">台账信息</p>
          <div class="grid grid-cols-2 gap-x-4 gap-y-4">
            <label class="text-sm">设备位号<el-input v-model="draft.equipmentCode" /></label>
            <label class="text-sm">设备名称<el-input v-model="draft.equipmentName" /></label>
            <label class="text-sm">设备昵称<el-input v-model="draft.nickname" /></label>
            <label class="text-sm">车间装置<el-input v-model="draft.workshop" /></label>
            <label class="text-sm">设备规格<el-input v-model="draft.spec" /></label>
            <label class="text-sm">
              容器类型
              <el-select v-model="draft.containerType" class="w-full">
                <el-option
                  v-for="t in CONTAINER_TYPES"
                  :key="t.value"
                  :label="t.label"
                  :value="t.value"
                />
              </el-select>
            </label>
            <label class="text-sm">介质<el-input v-model="draft.medium" /></label>
            <label class="text-sm">介质密度 (g/cm³)<el-input v-model="draft.density" inputmode="decimal" /></label>
            <label class="text-sm">
              每毫米液位对应的体积 (m³/mm)<el-input v-model="draft.volumePerMm" inputmode="decimal" />
            </label>
            <label class="text-sm col-span-2">备注<el-input v-model="draft.remark" /></label>
          </div>
        </div>

        <div>
          <p class="mb-2 text-xs font-medium text-slate-500">
            几何参数
            <span class="font-normal text-slate-500">
              ｜筒体长度不含两端直边；下封头留空表示平底
            </span>
          </p>
          <div class="grid grid-cols-2 gap-x-4 gap-y-4">
            <label class="text-sm">内径 (mm)<el-input v-model="draft.innerDiameter" inputmode="decimal" /></label>
            <label class="text-sm">筒体长度 (mm)<el-input v-model="draft.shellLength" inputmode="decimal" /></label>
            <label class="text-sm">直边 (mm)<el-input v-model="draft.straightFlange" inputmode="decimal" /></label>
            <label class="text-sm">上封头深度 (mm)<el-input v-model="draft.topHeadDepth" inputmode="decimal" /></label>
            <label class="text-sm">下封头深度 (mm)<el-input v-model="draft.bottomHeadDepth" inputmode="decimal" /></label>
          </div>
        </div>

        <div>
          <p class="mb-2 text-xs font-medium text-slate-500">容器底图</p>
          <div class="flex items-center gap-3">
            <img
              v-if="draft.imageFile"
              :src="imagePreview(draft.imageFile)"
              alt="容器底图预览"
              class="h-24 w-24 rounded-card border border-line object-contain"
            />
            <div class="text-xs text-slate-500">
              <p class="mb-1">
                {{ draft.imageFile || '未配置' }}
                <span v-if="draft.imageFile" class="ml-1">
                  · {{ draft.imageBounds ? '已标定' : '未标定（该设备不能被启用）' }}
                </span>
              </p>
              <el-button size="small" :loading="uploadingDrawing" @click="pickDrawing">
                {{ uploadingDrawing ? '上传中…' : '上传底图' }}
              </el-button>
              <el-button
                v-if="draft.imageFile"
                size="small"
                type="primary"
                plain
                @click="openCalibrate"
              >
                {{ draft.imageBounds ? '重新标定' : '标定底图' }}
              </el-button>
              <el-button v-if="draft.imageFile" size="small" @click="draft.imageFile = ''">
                清除
              </el-button>
              <p class="mt-1 text-slate-500">上传后自动生成深色主题用的亮线版</p>
              <p class="mt-1 text-slate-500">
                标定 = 框出罐体外轮廓 + 对准上下切线；体积计算页只收「已启用 + 已标定 + 几何齐全」的设备
              </p>
            </div>
          </div>
          <input
            ref="uploadInput"
            type="file"
            accept="image/png,image/jpeg"
            class="hidden"
            @change="handleDrawingPicked"
          />
        </div>

        <p
          v-if="message"
          :role="messageOk ? 'status' : 'alert'"
          class="text-xs"
          :class="messageOk ? STATUS_TEXT.success : STATUS_TEXT.error"
        >
          {{ message }}
        </p>
      </div>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 标定底图（变更-082）：只产出坐标 JSON，随上面的「保存」一起提交（后端 save 是整行覆写） -->
    <VesselCalibrateDialog
      v-model="calibrateVisible"
      :image-url="imagePreview(draft.imageFile)"
      :image-file="draft.imageFile"
      :container-type="Number(draft.containerType) || null"
      :geometry="{
        topHeadDepth: draft.topHeadDepth,
        shellLength: draft.shellLength,
        bottomHeadDepth: draft.bottomHeadDepth,
      }"
      :bounds="draft.imageBounds"
      @save="handleCalibrated"
    />
  </section>
</template>
