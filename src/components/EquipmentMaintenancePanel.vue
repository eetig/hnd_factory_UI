<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  ElButton,
  ElCheckbox,
  ElDialog,
  ElInput,
  ElOption,
  ElPagination,
  ElSelect,
} from 'element-plus'
import { CONTAINER_TYPES, containerTypeLabel, useEquipmentLedgerData } from '../composables/useEquipmentLedgerData'
import { vesselImageUrl } from '../composables/useVesselList'

// ===== 设备数据维护（2026-10-06）=====
//
// 为什么是「列表 + 点行弹窗」而不是全字段行内编辑：使用方要**逐个设备对着图纸核对参数**，
// 16 个字段横着排一屏放不下，行内编辑要在横向滚动的表格里拖着填，极易改错行；
// 弹窗一次把字段按「台账信息 / 几何参数 / 底图」三组铺开，比对着图纸改顺手得多。
// （手机端同理，见 uni-app 的 EquipmentFormDialog。）

const { rows, loading, saving, loadLedger, saveLedger, setLedgerEnabled, uploadVesselDrawing } =
  useEquipmentLedgerData()

/** 关键字筛选：与 /api/equipment/search 的口径一致（位号/名称/昵称/规格/车间） */
const keyword = ref('')
const onlyEnabled = ref(false)

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return rows.value.filter((row) => {
    if (onlyEnabled.value && row.enabled !== 1) return false
    if (!kw) return true
    return [row.equipmentCode, row.equipmentName, row.nickname, row.spec, row.workshop]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(kw))
  })
})

/**
 * 分页。接口一次给全表（92 行，不分页），这里只做**前端分页** ——
 * 维护的场景是「在同一页里比对同类设备」，后端分页会让人翻着翻着看不全。
 */
const currentPage = ref(1)
const pageSize = ref(20)
const paged = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

// 筛选条件一变就回第一页 —— 否则会停在一个已经空掉的页上，看着像「筛出来没数据」
watch([keyword, onlyEnabled], () => {
  currentPage.value = 1
})
watch(pageSize, () => {
  currentPage.value = 1
})

/**
 * 封头深度一列显示「上 / 下」。用一个列而不是两列：表格已经 14 列了，
 * 而下封头为空只可能是平底这一种情况，并排写反而占地方。
 */
function headDepthText(row) {
  const top = row.topHeadDepth ?? '—'
  const bottom = row.bottomHeadDepth > 0 ? row.bottomHeadDepth : '平底'
  return `${top} / ${bottom}`
}

const loadError = ref('')
async function refresh() {
  loadError.value = ''
  try {
    await loadLedger(true)
  } catch {
    loadError.value = '取不到设备台账（接口不可用）。列表里是上一次取到的数据。'
  }
}
onMounted(refresh)

// ===== 编辑弹窗 =====

const dialogVisible = ref(false)
const isNew = ref(false)
const draft = reactive({})
const message = ref('')
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

async function handleSave() {
  message.value = ''
  if (!draft.equipmentName?.trim()) {
    message.value = '设备名称不能为空'
    return
  }
  try {
    await saveLedger(draft)
    dialogVisible.value = false
  } catch (e) {
    message.value = `保存失败：${e?.response?.data?.msg || e?.message || '未知错误'}`
  }
}

async function handleToggle(row) {
  try {
    await setLedgerEnabled(row.id, row.enabled !== 1)
  } catch (e) {
    loadError.value = `切换启停失败：${e?.response?.data?.msg || e?.message || '未知错误'}`
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
  try {
    draft.imageFile = await uploadVesselDrawing(file)
  } catch (e) {
    message.value = `底图上传失败：${e?.response?.data?.msg || e?.message || '未知错误'}`
  }
}
</script>

<template>
  <section class="rounded-card border border-slate-200 bg-white shadow-card">
    <div class="flex flex-wrap items-center gap-x-4 gap-y-4 border-b border-slate-100 px-6 py-4">
      <p class="text-sm font-medium text-slate-700">设备数据维护</p>
      <p class="text-xs text-slate-500">
        逐个设备对着图纸核对参数：{{ filtered.length }} / {{ rows.length }} 条
      </p>
      <div class="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
        <el-input v-model="keyword" placeholder="位号 / 名称 / 昵称 / 规格 / 车间" clearable class="w-64" />
        <el-checkbox v-model="onlyEnabled" label="只看启用的" />
        <el-button @click="refresh">刷新</el-button>
        <el-button type="primary" @click="openCreate">新增设备</el-button>
      </div>
    </div>

    <p v-if="loadError" class="border-b border-amber-200 bg-amber-50 px-6 py-3 text-xs text-amber-800">
      {{ loadError }}
    </p>

    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th class="px-4 py-2.5 text-right font-medium">序号</th>
            <th class="px-4 py-2.5 text-left font-medium">位号</th>
            <th class="px-4 py-2.5 text-left font-medium">名称</th>
            <th class="px-4 py-2.5 text-left font-medium">昵称</th>
            <th class="px-4 py-2.5 text-left font-medium">规格</th>
            <th class="px-4 py-2.5 text-left font-medium">容器类型</th>
            <th class="px-4 py-2.5 text-right font-medium">内径</th>
            <th class="px-4 py-2.5 text-right font-medium">筒体长度</th>
            <th class="px-4 py-2.5 text-right font-medium">直边</th>
            <th class="px-4 py-2.5 text-right font-medium">封头深度(上/下)</th>
            <th class="px-4 py-2.5 text-left font-medium">介质</th>
            <th class="px-4 py-2.5 text-right font-medium">介质密度</th>
            <th class="px-4 py-2.5 text-left font-medium">底图</th>
            <th class="px-4 py-2.5 text-left font-medium">状态</th>
            <th class="px-4 py-2.5 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in paged"
            :key="row.id"
            class="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
            :class="{ 'text-slate-400': row.enabled !== 1 }"
            @click="openEdit(row)"
          >
            <!-- 序号跨页连续（不是每页从 1 开始）：使用方是照着序号逐个核对，
                 一翻页就重新数会串 -->
            <td class="px-4 py-2.5 text-right text-xs text-slate-400">
              {{ (currentPage - 1) * pageSize + index + 1 }}
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
              <img
                v-if="row.imageFile"
                :src="imagePreview(row.imageFile)"
                alt=""
                class="h-8 w-8 rounded-xl border border-slate-200 object-contain"
              />
              <span v-else class="text-xs text-slate-400">未配</span>
            </td>
            <td class="px-4 py-2.5 text-xs">{{ row.enabled === 1 ? '启用' : '已停用' }}</td>
            <td class="px-4 py-2.5 text-right">
              <el-button size="small" @click.stop="handleToggle(row)">
                {{ row.enabled === 1 ? '停用' : '启用' }}
              </el-button>
            </td>
          </tr>
          <tr v-if="!filtered.length">
            <td colspan="15" class="px-4 py-10 text-center text-sm text-slate-400">
              {{ loading ? '正在加载…' : '没有符合条件的设备' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="filtered.length" class="flex justify-end px-6 py-3">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="filtered.length"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        background
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
            <label class="text-sm">介质密度 (g/cm³)<el-input v-model="draft.density" /></label>
            <label class="text-sm">
              每毫米液位对应的体积 (m³/mm)<el-input v-model="draft.volumePerMm" />
            </label>
            <label class="text-sm col-span-2">备注<el-input v-model="draft.remark" /></label>
          </div>
        </div>

        <div>
          <p class="mb-2 text-xs font-medium text-slate-500">
            几何参数
            <span class="font-normal text-slate-400">
              ｜筒体长度不含两端直边；下封头留空表示平底
            </span>
          </p>
          <div class="grid grid-cols-2 gap-x-4 gap-y-4">
            <label class="text-sm">内径 (mm)<el-input v-model="draft.innerDiameter" /></label>
            <label class="text-sm">筒体长度 (mm)<el-input v-model="draft.shellLength" /></label>
            <label class="text-sm">直边 (mm)<el-input v-model="draft.straightFlange" /></label>
            <label class="text-sm">上封头深度 (mm)<el-input v-model="draft.topHeadDepth" /></label>
            <label class="text-sm">下封头深度 (mm)<el-input v-model="draft.bottomHeadDepth" /></label>
          </div>
        </div>

        <div>
          <p class="mb-2 text-xs font-medium text-slate-500">容器底图</p>
          <div class="flex items-center gap-3">
            <img
              v-if="draft.imageFile"
              :src="imagePreview(draft.imageFile)"
              alt=""
              class="h-24 w-24 rounded-card border border-slate-200 object-contain"
            />
            <div class="text-xs text-slate-500">
              <p class="mb-1">{{ draft.imageFile || '未配置' }}</p>
              <el-button size="small" @click="pickDrawing">上传底图</el-button>
              <el-button v-if="draft.imageFile" size="small" @click="draft.imageFile = ''">
                清除
              </el-button>
              <p class="mt-1 text-slate-400">上传后自动生成深色主题用的亮线版</p>
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

        <p v-if="message" class="text-xs text-red-600">{{ message }}</p>
      </div>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>
