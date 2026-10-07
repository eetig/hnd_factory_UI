<script setup>
import { computed, onUnmounted, ref } from 'vue'
import {
  ElAutocomplete,
  ElDatePicker,
  ElInput,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElPagination,
  ElSelect,
} from 'element-plus'
import { hasPerm } from '../api/auth'
import LoadingMask from './LoadingMask.vue'
import PanelState from './PanelState.vue'
import TankLevelImageDialog from './TankLevelImageDialog.vue'
import { useEquipmentLedger } from '../composables/useEquipmentLedger'
import {
  TANK_LEVEL_CATEGORIES,
  TANK_LEVEL_LOCATIONS,
  buildTankLevelDraft,
  useTankLevelData,
} from '../composables/useTankLevelData'
import { useTankLevelImages } from '../composables/useTankLevelImages'

// 月底储罐液位记录（变更-004 只读落地 → 变更-008 加行内编辑 → 变更-011 图据改多张）
//
// 数据层是模块级单例（项目约定 4），所以本组件不需要 props：
// 「首次进 Tab 才加载」交给 WorkOrderList 的 watch(activeTab) —— 面板是 v-show 常驻的，
// 挂载时机和 Tab 切换不是一回事。
const {
  tankLevelTableData,
  tankLevelPageNum,
  tankLevelPageSize,
  tankLevelTotal,
  tankLevelLoading,
  tankLevelError,
  tankLevelStartDate,
  tankLevelEndDate,
  tankLevelLocation,
  tankLevelCategory,
  tankLevelKeyword,
  tankLevelLocationOptions,
  getTankLevelPageData,
  fetchTankLevelRecords,
  resetTankLevelFilters,
  saveTankLevelRecord,
  deleteTankLevelRecord,
} = useTankLevelData()

// 图据（可多张）的弹窗状态与请求都在这个 composable 里，本组件只负责触发与渲染
const { openImageDialog, uploadImagesForRecord } = useTankLevelImages()

// 容器名称的候选来自设备台账（GET /api/equipment/search —— 变更-005 就有的接口）：
// 台账里 91 台设备，靠关键字检索比手打全名可靠，名称长得像的太多了。
// 变更-012 起接口允许空关键字（返回前 limit 条、按名称拼音排序），所以点开下拉就列出全部候选，
// 顺带也就有了「首字母顺序」，见 trigger-on-focus。
//
// 防抖在这一层做（有单测），所以 el-autocomplete 那边要 :debounce="0" ——
// 它自己默认也有 300ms，不关掉就是两道叠加、敲完字要等 600ms 才出候选。
const { fetchEquipmentSuggestions, cancelEquipmentSearch } = useEquipmentLedger()

// 行内编辑的权限：后端每个写接口各自鉴权，这里只管按钮显隐（不是安全边界）
const canEdit = computed(() => hasPerm('tank_level:edit'))
const canDelete = computed(() => hasPerm('tank_level:delete'))
const canOperate = computed(() => canEdit.value || canDelete.value)

// 列与线下台账（月底车间各储罐液位记录表）对应；「序号」由前端按分页渲染
// 数值列的表头直接带单位（容器液位 mm / 理论质量 kg）：线下台账没标单位，
// 页面上标清楚，免得与「压力容器体积计算」里的 m³ 混读
//
// 「所属(产品/原料)」「物料」「容器编号」三列已按使用方要求从界面撤掉。
// 字段本身没删：draft / payload 仍原样带上（见 useTankLevelData），
// 否则编辑一条老记录会把库里这三列清成 NULL —— 容器编号还是唯一键的一半。
const baseColumns = [
  { key: 'index', label: '序号', width: 'w-14' },
  { key: 'recordDate', label: '记录日期', width: 'w-32' },
  { key: 'location', label: '属地', width: 'w-24' },
  { key: 'tankName', label: '容器名称', width: 'w-32' },
  { key: 'levelValue', label: '容器液位 (mm)', width: 'w-28', align: 'right' },
  { key: 'theoreticalWeight', label: '理论质量 (kg)', width: 'w-28', align: 'right' },
  { key: 'imageUrl', label: '图据', width: 'w-36' },
]

const columns = computed(() =>
  canOperate.value ? [...baseColumns, { key: 'action', label: '操作', width: 'w-32' }] : baseColumns,
)

// 行 key 必须用 id：编辑态下 recordDate / tankCode 会被用户改，
// 拿这两个做 key 的话每敲一个字 key 就变一次，Vue 重建 <tr>，输入框当场失焦
const ROW_KEY_NEW = 'tank-level-new'
const rowKeyOf = (record) => `tank-level-${record?.id ?? ROW_KEY_NEW}`

// 是否处于筛选状态：决定空表提示语是「没查到」还是「本来就没数据」
const hasFilter = computed(() =>
  Boolean(tankLevelLocation.value || tankLevelCategory.value || tankLevelKeyword.value),
)

// ===== 行内编辑状态 =====
// 同一时刻只允许一行在编辑：editingId 为 'new' 表示正在新增（草稿行），
// null 表示没有行处于编辑态。draft 存的是那一行的可编辑副本，
// 保存前的所有输入都只落在这里，不会碰到列表数据。
const ROW_KEY_CREATING = 'new'
const editingId = ref(null)
const draft = ref(null)
const saving = ref(false)

const isCreating = computed(() => editingId.value === ROW_KEY_CREATING)
const isEditing = (record) => editingId.value !== null && editingId.value === String(record.id)

// ===== 新增行里先选好的图 =====
// 记录还没保存就没有 id，而图据接口挂在 record id 上，所以图只能先攥在内存里，
// 等保存拿到新 id 后立刻传上去 —— 用户只点一次「保存」，不用「先存数据再补图」两步。
//
// 编辑已有行不走这条路：那种行本来就有 id，图据弹窗直接可用，不必等保存。
const pendingImages = ref([]) // [{ key, file, url }]
const pendingImageInputRef = ref(null)
let pendingImageKey = 0

// 只收 PNG / JPG，与后端白名单一致（img-service 只认这两种，收了别的也会在那一步失败）
const IMAGE_ACCEPT = 'image/png,image/jpeg'

function isAllowedImage(file) {
  return /^image\/(png|jpeg)$/.test(file.type || '') || /\.(png|jpe?g)$/i.test(file.name || '')
}

function handlePendingImageInput(event) {
  const files = Array.from(event.target.files || [])
  // 清空 value，否则连续两次选同一批文件不会再触发 change
  event.target.value = ''

  const accepted = files.filter(isAllowedImage)
  if (accepted.length < files.length) {
    ElMessage.warning('只收 PNG / JPG，其余文件已忽略。')
  }

  accepted.forEach((file) => {
    // 预览用 objectURL：必须在移除 / 取消 / 保存后 revoke，
    // 否则整个页面生命周期都在占内存（同图片解析页的做法）
    pendingImages.value.push({
      key: ++pendingImageKey,
      file,
      url: URL.createObjectURL(file),
    })
  })
}

function removePendingImage(key) {
  const index = pendingImages.value.findIndex((item) => item.key === key)
  if (index === -1) return

  URL.revokeObjectURL(pendingImages.value[index].url)
  pendingImages.value.splice(index, 1)
}

/** 丢掉所有待传的图（取消编辑、保存完成、离开页面时都要调） */
function clearPendingImages() {
  pendingImages.value.forEach((item) => URL.revokeObjectURL(item.url))
  pendingImages.value = []
}

onUnmounted(() => {
  clearPendingImages()
  cancelEquipmentSearch()
})

/**
 * 表格区有没有内容（含正在新增的草稿行）：决定显示表格还是空态，以及要不要分页器。
 *
 * <p>草稿行也算「有内容」—— 新增时即便库里一条都没有，表格也得出来，不然用户
 * 填的那一行没地方显示。
 */
const tankLevelHasRows = computed(() => tankLevelTableData.value.length > 0 || isCreating.value)

/**
 * 「新增一行」入口是否出现：除了权限，加载中与加载失败时也不给。
 *
 * <p>它是**独立于表格**渲染的 —— 空态提示写着「点下方『新增一行』开始录入」，
 * 早先按钮和表格绑在同一个分支里，于是库里清空后那句话下面什么都没有。
 */
const canCreate = computed(
  () => canEdit.value && !tankLevelLoading.value && !tankLevelError.value,
)

/** 静默单元格：平时看不出是输入框，悬停/聚焦才显形（同图片解析页 inputClass）*/
function inputClass(align) {
  return [
    'w-full rounded-xl border border-transparent bg-transparent px-1.5 py-1 text-sm text-slate-900 outline-none',
    'transition placeholder:text-slate-500 hover:border-slate-300 focus:border-sky-500 focus:bg-white',
    align === 'right' ? 'text-right' : '',
  ]
}

function startEdit(record) {
  editingId.value = String(record.id)
  draft.value = buildTankLevelDraft(record)
}

function cancelEdit() {
  editingId.value = null
  draft.value = null
  // 待传的图一起丢掉：留着会跟着下一次新增跑到别的记录上
  clearPendingImages()
}

function startCreate() {
  if (editingId.value !== null) {
    ElMessage.warning('请先保存或取消正在编辑的那一行。')
    return
  }
  // 草稿行不进 tankLevelTableData —— 它要参与本地分页的切片，混进去会把序号搅乱。
  // 单独用 editingId='new' 控制渲染，保存成功后由刷新带出真行
  editingId.value = ROW_KEY_CREATING
  draft.value = buildTankLevelDraft(null)
  clearPendingImages()
}

async function saveRow() {
  if (saving.value) return

  saving.value = true
  const creating = isCreating.value
  // 图得等保存拿到 id 才能传。先把文件拷出来：保存成功后 cancelEdit 会把 pendingImages 清空
  const filesToUpload = creating ? pendingImages.value.map((item) => item.file) : []

  try {
    const saved = await saveTankLevelRecord(draft.value)
    cancelEdit()

    if (!filesToUpload.length) {
      ElMessage.success(creating ? '新增成功' : '保存成功')
      return
    }

    // 图据这一段单独兜错：数据已经落库了，图没传上不能报成「保存失败」——
    // 记录是好的，图还能在图据弹窗里补。含糊地报失败会让人以为整条没存进去，再存一次就撞唯一键
    try {
      await uploadImagesForRecord(saved?.id, filesToUpload)
      // 保存时刷的那一次还没有图，这里要再刷一次：列表要画首张缩略图与张数角标
      await fetchTankLevelRecords({ keepPage: true })
      ElMessage.success(`新增成功，已上传 ${filesToUpload.length} 张图据`)
    } catch (error) {
      ElMessage.warning(
        `数据已保存，但图据上传失败：${error?.message || '请稍后重试。'}可在该行的图据弹窗里补传。`,
      )
    }
  } catch (error) {
    // 后端校验/唯一键冲突的消息原样展示：它比前端兜底文案具体得多
    ElMessage.error(error?.message || '保存失败，请稍后重试。')
  } finally {
    saving.value = false
  }
}

async function removeRow(record) {
  try {
    await ElMessageBox.confirm(
      `确定删除「${record.recordDate} ${record.tankCode || record.tankName}」这条记录吗？删除后不可恢复。`,
      '确认删除记录',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' },
    )
  } catch {
    return // 用户点了取消
  }

  try {
    await deleteTankLevelRecord(record.id)
    ElMessage.success('删除成功')
    if (isEditing(record)) {
      cancelEdit()
    }
  } catch (error) {
    ElMessage.error(error?.message || '删除失败，请稍后重试。')
  }
}

// ===== 图据 =====
// 可多张，看图/加图/删图全在弹窗里（<TankLevelImageDialog> + useTankLevelImages）。
// 行内编辑只管文字与数值 —— 图据入口在只读态也能点开，不必先进编辑态。

/**
 * 列表缩略图加载失败时回退到原图，再失败就露出底层的占位图标。
 *
 * <p>用 getAttribute('src') 而不是 img.src 比较：后者会被浏览器补成绝对 URL，
 * 与接口给的相对路径（/thumbs/xxx）永远不相等，回退分支等于没写。
 */
function handleThumbError(event, image) {
  const img = event?.target
  if (!img) return

  if (image?.url && img.getAttribute('src') !== image.url) {
    img.src = image.url
    return
  }
  img.style.display = 'none'
}
</script>

<template>
  <section class="rounded-card border border-slate-200 bg-white shadow-card">
    <div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-6 py-4">
      <h2 class="text-base font-semibold text-slate-900">月底车间各储罐液位记录</h2>
      <span class="text-xs text-slate-500">数据来源：hnd_factory /api/tank-level/list</span>
    </div>

    <!-- 查询条件：记录日期区间 + 属地 + 所属 + 物料/容器关键字，全部走接口查询 -->
    <div class="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-3">
      <span class="shrink-0 text-xs text-slate-500">起始日期</span>
      <el-date-picker
        v-model="tankLevelStartDate"
        type="date"
        value-format="YYYY-MM-DD"
        placeholder="选择日期"
        aria-label="起始日期"
        :first-day-of-week="1"
        @change="fetchTankLevelRecords"
      />
      <span class="shrink-0 text-sm text-slate-500">至</span>
      <span class="shrink-0 text-xs text-slate-500">结束日期</span>
      <el-date-picker
        v-model="tankLevelEndDate"
        type="date"
        value-format="YYYY-MM-DD"
        placeholder="选择日期"
        aria-label="结束日期"
        :first-day-of-week="1"
        @change="fetchTankLevelRecords"
      />
      <span class="shrink-0 text-xs text-slate-500">属地</span>
      <el-select
        v-model="tankLevelLocation"
        style="width: 9.5rem"
        placeholder="全部"
        clearable
        aria-label="属地"
        @change="fetchTankLevelRecords"
      >
        <el-option
          v-for="location in tankLevelLocationOptions"
          :key="location"
          :label="location"
          :value="location"
        />
      </el-select>
      <span class="shrink-0 text-xs text-slate-500">所属</span>
      <el-select
        v-model="tankLevelCategory"
        style="width: 9.5rem"
        placeholder="全部"
        clearable
        aria-label="所属（产品 / 原料）"
        @change="fetchTankLevelRecords"
      >
        <el-option
          v-for="category in TANK_LEVEL_CATEGORIES"
          :key="category"
          :label="category"
          :value="category"
        />
      </el-select>
      <el-input
        v-model="tankLevelKeyword"
        style="width: 13rem"
        placeholder="物料 / 容器名称 / 容器编号"
        aria-label="搜索物料或容器"
        clearable
        @keyup.enter="fetchTankLevelRecords"
        @clear="fetchTankLevelRecords"
      />
      <button
        type="button"
        class="rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-sky-800"
        @click="fetchTankLevelRecords"
      >
        查询
      </button>
      <button
        type="button"
        class="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
        @click="resetTankLevelFilters"
      >
        重置
      </button>
      <span class="ml-auto text-sm text-slate-500">
        共 <span class="font-semibold text-slate-900">{{ tankLevelTotal }}</span> 条记录
      </span>
    </div>

    <div class="relative">
      <LoadingMask v-if="tankLevelLoading" />

      <PanelState
        v-else-if="tankLevelError"
        type="error"
        title="暂时无法获取储罐液位记录"
        :description="tankLevelError"
        action-text="重新加载"
        @action="fetchTankLevelRecords"
      />

      <PanelState
        v-else-if="!tankLevelHasRows"
        :title="hasFilter ? '没有符合筛选条件的记录' : '暂无储罐液位记录'"
        :description="
          hasFilter
            ? '换个日期区间或关键字试试，或点「重置」回到默认范围。'
            : canEdit
              ? '点下方「新增一行」开始录入。'
              : '数据由管理员在「新增一行」中维护。'
        "
      />

      <div v-else>
        <div class="overflow-x-auto">
          <table class="min-w-full table-fixed divide-y divide-slate-200 text-left">
            <colgroup>
              <col v-for="column in columns" :key="column.key" :class="column.width" />
            </colgroup>
            <thead class="bg-slate-50">
              <tr>
                <th
                  v-for="column in columns"
                  :key="column.key"
                  scope="col"
                  class="whitespace-nowrap py-4 text-xs font-semibold uppercase tracking-wide text-slate-500"
                  :class="column.align === 'right' ? 'pl-3 pr-5 text-right' : 'px-3'"
                >
                  {{ column.label }}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 bg-white">
              <!-- 新增草稿行：固定在表格最前，一眼能看到自己正在补的那条 -->
              <tr v-if="isCreating" class="bg-sky-50/60">
                <td class="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-sky-700">新增</td>
                <td class="px-2 py-1.5">
                  <input
                    v-model="draft.recordDate"
                    type="date"
                    :class="inputClass()"
                    aria-label="记录日期"
                  />
                </td>
                <td class="px-2 py-1.5">
                  <!-- 属地就那几个罐组，给下拉省得手打；留 allow-create 是为了新罐组不必改代码 -->
                  <el-select
                    v-model="draft.location"
                    class="w-full"
                    size="small"
                    placeholder="属地"
                    filterable
                    allow-create
                    default-first-option
                    aria-label="属地"
                  >
                    <el-option
                      v-for="location in TANK_LEVEL_LOCATIONS"
                      :key="location"
                      :label="location"
                      :value="location"
                    />
                  </el-select>
                </td>
                <td class="px-2 py-1.5">
                  <!-- 容器名称从设备台账里挑：点开就列出全部候选（后端按名称拼音排序），
                       打字则远程检索。用可自由输入的 autocomplete 而不是 select：
                       台账没有的设备也得能录，否则等于把「填不进去」当成了校验 -->
                  <el-autocomplete
                    v-model="draft.tankName"
                    class="w-full"
                    size="small"
                    value-key="name"
                    :fetch-suggestions="fetchEquipmentSuggestions"
                    :trigger-on-focus="true"
                    :debounce="0"
                    placeholder="输入关键字搜设备台账"
                    aria-label="容器名称"
                  >
                    <template #default="{ item }">
                      <span class="text-sm text-slate-800">{{ item.name }}</span>
                      <span v-if="item.spec" class="ml-2 text-xs text-slate-500">
                        {{ item.spec }}
                      </span>
                    </template>
                  </el-autocomplete>
                </td>
                <td class="px-2 py-1.5">
                  <input
                    v-model="draft.levelValue"
                    type="text"
                    inputmode="decimal"
                    placeholder="—"
                    :class="inputClass('right')"
                    aria-label="容器液位"
                  />
                </td>
                <td class="px-2 py-1.5">
                  <input
                    v-model="draft.theoreticalWeight"
                    type="text"
                    inputmode="decimal"
                    placeholder="—"
                    :class="inputClass('right')"
                    aria-label="理论质量"
                  />
                </td>
                <td class="px-2 py-1.5">
                  <!-- 图据随数据一起存：记录还没有 id，选好的图先存内存，保存成功后立刻传 -->
                  <div class="flex flex-wrap items-center gap-1.5">
                    <input
                      ref="pendingImageInputRef"
                      type="file"
                      :accept="IMAGE_ACCEPT"
                      multiple
                      class="hidden"
                      @change="handlePendingImageInput"
                    />
                    <button
                      type="button"
                      class="rounded-xl border border-dashed border-slate-300 px-2 py-0.5 text-xs text-slate-500 transition hover:border-sky-400 hover:text-sky-700"
                      @click="pendingImageInputRef?.click()"
                    >
                      {{ pendingImages.length ? '再加一张' : '选择图片' }}
                    </button>
                    <span
                      v-for="item in pendingImages"
                      :key="item.key"
                      class="group relative h-5 w-5 shrink-0"
                    >
                      <img
                        :src="item.url"
                        :alt="item.file.name"
                        class="h-5 w-5 rounded-xl border border-slate-300 object-cover"
                      />
                      <button
                        type="button"
                        class="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-slate-900/70 text-xs leading-none text-white opacity-0 transition hover:bg-rose-600 group-hover:opacity-100"
                        :aria-label="`移除 ${item.file.name}`"
                        @click="removePendingImage(item.key)"
                      >
                        ×
                      </button>
                    </span>
                  </div>
                </td>
                <td class="whitespace-nowrap px-3 py-2.5">
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      class="rounded-xl bg-sky-700 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-60"
                      :disabled="saving"
                      @click="saveRow"
                    >
                      {{ saving ? '保存中…' : '保存' }}
                    </button>
                    <button
                      type="button"
                      class="rounded-xl border border-slate-300 px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50"
                      :disabled="saving"
                      @click="cancelEdit"
                    >
                      取消
                    </button>
                  </div>
                </td>
              </tr>

              <tr
                v-for="(record, index) in tankLevelTableData"
                :key="rowKeyOf(record)"
                class="transition"
                :class="isEditing(record) ? 'bg-sky-50/60' : 'hover:bg-slate-50'"
              >
                <td class="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-slate-900">
                  {{ (tankLevelPageNum - 1) * tankLevelPageSize + index + 1 }}
                </td>

                <!-- ===== 编辑态：整行换成输入框 ===== -->
                <template v-if="isEditing(record)">
                  <td class="px-2 py-1.5">
                    <input v-model="draft.recordDate" type="date" :class="inputClass()" aria-label="记录日期" />
                  </td>
                  <td class="px-2 py-1.5">
                    <el-select
                      v-model="draft.location"
                      class="w-full"
                      size="small"
                      placeholder="属地"
                      filterable
                      allow-create
                      default-first-option
                      aria-label="属地"
                    >
                      <el-option
                        v-for="location in TANK_LEVEL_LOCATIONS"
                        :key="location"
                        :label="location"
                        :value="location"
                      />
                    </el-select>
                  </td>
                  <td class="px-2 py-1.5">
                    <el-autocomplete
                      v-model="draft.tankName"
                      class="w-full"
                      size="small"
                      value-key="name"
                      :fetch-suggestions="fetchEquipmentSuggestions"
                      :trigger-on-focus="true"
                      :debounce="0"
                      placeholder="输入关键字搜设备台账"
                      aria-label="容器名称"
                    >
                      <template #default="{ item }">
                        <span class="text-sm text-slate-800">{{ item.name }}</span>
                        <span v-if="item.spec" class="ml-2 text-xs text-slate-500">
                          {{ item.spec }}
                        </span>
                      </template>
                    </el-autocomplete>
                  </td>
                  <td class="px-2 py-1.5">
                    <input
                      v-model="draft.levelValue"
                      type="text"
                      inputmode="decimal"
                      placeholder="—"
                      :class="inputClass('right')"
                      aria-label="容器液位"
                    />
                  </td>
                  <td class="px-2 py-1.5">
                    <input
                      v-model="draft.theoreticalWeight"
                      type="text"
                      inputmode="decimal"
                      placeholder="—"
                      :class="inputClass('right')"
                      aria-label="理论质量"
                    />
                  </td>
                </template>

                <!-- ===== 只读态 ===== -->
                <template v-if="!isEditing(record)">
                  <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                    {{ record.recordDate }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                    {{ record.location }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                    {{ record.tankName }}
                  </td>
                  <td class="whitespace-nowrap py-2.5 pl-3 pr-5 text-right text-sm text-slate-600">
                    {{ record.levelValue }}
                  </td>
                  <td class="whitespace-nowrap py-2.5 pl-3 pr-5 text-right text-sm font-semibold text-sky-700">
                    {{ record.theoreticalWeight }}
                  </td>
                </template>

                <!-- 图据（可多张）：点开弹窗看大图 / 加图 / 删图。
                     编辑态与只读态行为一致，所以不放进上面的两态分支，免得写两份 -->
                <td class="whitespace-nowrap px-3 py-2.5">
                  <span
                    class="relative flex h-5 w-5 cursor-pointer items-center justify-center rounded-xl bg-slate-100 text-slate-500"
                    :aria-label="record.images.length ? `查看图据（共 ${record.images.length} 张）` : '暂无图据'"
                    @click="openImageDialog(record)"
                  >
                    <svg
                      class="h-3 w-3"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                      aria-hidden="true"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="m21 15-5-5L5 21" />
                    </svg>
                    <!-- 首张缩略图；缺失时回退原图，再失败露出底层占位图标 -->
                    <img
                      v-if="record.images.length"
                      :src="record.images[0].thumbnailUrl || record.images[0].url"
                      alt="图据缩略图"
                      loading="lazy"
                      decoding="async"
                      class="absolute inset-0 h-5 w-5 rounded-xl border border-slate-200 bg-white object-cover transition hover:opacity-80"
                      @error="handleThumbError($event, record.images[0])"
                    />
                    <!-- 多张时在角上标出总数，免得点开才知道有几张 -->
                    <span
                      v-if="record.images.length > 1"
                      class="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-sky-700 px-1 text-xs font-medium leading-none text-white"
                    >
                      {{ record.images.length }}
                    </span>
                  </span>
                </td>

                <!-- 操作列：位置固定在最后，同样不必跟着编辑态复制两份 -->
                <td v-if="isEditing(record) || canOperate" class="whitespace-nowrap px-3 py-2.5">
                  <div v-if="isEditing(record)" class="flex items-center gap-2">
                    <button
                      type="button"
                      class="rounded-xl bg-sky-700 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-60"
                      :disabled="saving"
                      @click="saveRow"
                    >
                      {{ saving ? '保存中…' : '保存' }}
                    </button>
                    <button
                      type="button"
                      class="rounded-xl border border-slate-300 px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50"
                      :disabled="saving"
                      @click="cancelEdit"
                    >
                      取消
                    </button>
                  </div>
                  <div v-else class="flex items-center gap-2">
                    <button
                      v-if="canEdit"
                      type="button"
                      class="rounded-xl border border-slate-300 px-2.5 py-1 text-xs text-slate-600 transition hover:border-sky-400 hover:text-sky-700"
                      @click="startEdit(record)"
                    >
                      编辑
                    </button>
                    <button
                      v-if="canDelete"
                      type="button"
                      class="rounded-xl border border-slate-300 px-2.5 py-1 text-xs text-slate-600 transition hover:border-rose-400 hover:text-rose-600"
                      @click="removeRow(record)"
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 录入入口：放在状态分支之外 —— 空表时也要在，否则空态提示里那句
           「点下方『新增一行』开始录入」下面什么都没有 -->
      <div v-if="canCreate" class="flex items-center gap-3 border-t border-slate-100 px-6 py-3">
        <button
          type="button"
          class="flex items-center gap-1 rounded-xl border border-slate-300 px-2.5 py-1 text-xs text-slate-600 transition hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700"
          @click="startCreate"
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          新增一行
        </button>
        <span class="text-xs text-slate-500">
          记录日期 + 容器编号是唯一键，同一天同一容器只能有一条记录
        </span>
      </div>

      <div v-if="tankLevelHasRows" class="flex justify-end border-t border-slate-100 px-6 py-3">
        <el-pagination
          v-model:current-page="tankLevelPageNum"
          :page-size="tankLevelPageSize"
          :total="tankLevelTotal"
          layout="total, prev, pager, next"
          background
          @current-change="getTankLevelPageData"
        />
      </div>
    </div>

    <!-- 记录说明：与线下台账表尾的说明一字不差，避免两处口径不同 -->
    <div class="border-t border-slate-100 px-6 py-3 text-xs leading-relaxed text-slate-500">
      <p>记录说明：</p>
      <p>1. 实际重量与理论计算可能存在差异，以实际测量为准。</p>
      <p>2. 记录时间为每月月底下午3点</p>
    </div>

    <!-- 图据弹窗（可多张）：状态在 useTankLevelImages，渲染在 ImageGalleryDialog -->
    <TankLevelImageDialog />
  </section>
</template>
