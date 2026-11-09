<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElButton, ElDialog, ElInput, ElMessage, ElMessageBox, ElOption, ElSelect } from 'element-plus'
import request from '../../api/request'
import { deleteTank, listTanks, saveTank, setTankEnabled } from '../../api/equipmentTank'

/*
 * 储罐（容器实例）维护 —— 2026-11-09
 *
 * 使用方的模型（原话）：
 *   「设备维护的信息，就相当于图纸。储罐就是车间按图纸买回来的容器，
 *     容器的图纸可能一样，但是容器的个数可能不一样，作用也不一样」
 *   「图纸我自行编辑，容器我来指定哪张图纸」
 *
 * 所以这一页只做一件事：**给每个真实存在的罐指定一张图纸**。
 * · 图纸下拉里显示 名称 + 规格 + 缺不缺几何，选错一眼能看出来
 * · 几何（内径/筒长/封头）只读地从图纸带出，页面上不允许改 —— 唯一来源是图纸
 * · 密度放在罐上，因为同图纸不同罐装的料不一样
 */
const rows = ref([])
const blueprints = ref([])
const loading = ref(false)
const saving = ref(false)
const errorText = ref('')
const keyword = ref('')

const drawerOpen = ref(false)
const form = reactive(blank())

function blank(row = null) {
  return {
    id: row?.id ?? null,
    tankCode: row?.tankCode ?? '',
    tankName: row?.tankName ?? '',
    blueprintId: row?.blueprintId ?? null,
    workshop: row?.workshop ?? '',
    location: row?.location ?? '',
    category: row?.category ?? '',
    materialCode: row?.materialCode ?? '',
    materialName: row?.materialName ?? '',
    density: row?.density ?? '',
    remark: row?.remark ?? '',
    enabled: row?.enabled ?? 1,
  }
}

function fill(row) {
  Object.assign(form, blank(row))
}

/** 选中图纸后用于只读展示的那一条 */
const pickedBlueprint = computed(() => blueprints.value.find((b) => b.id === form.blueprintId) || null)

const geometryReady = computed(() => {
  const b = pickedBlueprint.value
  return Boolean(b && b.innerDiameter != null && b.shellLength != null)
})

async function load() {
  loading.value = true
  errorText.value = ''
  try {
    const res = await listTanks({ keyword: keyword.value.trim() || undefined })
    const body = res?.data || {}
    rows.value = body.data || []
  } catch (e) {
    errorText.value = e?.response?.data?.msg || e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

/** 图纸下拉：一次取 200 条（图纸的规模是百级，够用；多了再改成分页搜索） */
async function loadBlueprints() {
  try {
    const res = await request.get('/api/equipment/ledger/list', { params: { pageNum: 1, pageSize: 200 } })
    const body = res?.data || {}
    blueprints.value = (body.dataList || []).map((b) => ({
      id: b.id,
      name: `${b.equipmentName || '未命名'}${b.spec ? ' · ' + b.spec : ''}`,
      innerDiameter: b.innerDiameter,
      shellLength: b.shellLength,
      topHeadDepth: b.topHeadDepth,
      bottomHeadDepth: b.bottomHeadDepth,
      straightFlange: b.straightFlange,
      containerType: b.containerType,
    }))
  } catch {
    blueprints.value = []
  }
}

function openCreate() {
  fill(null)
  drawerOpen.value = true
}

function openEdit(row) {
  fill(row)
  drawerOpen.value = true
}

async function submit() {
  if (saving.value) return
  saving.value = true
  try {
    await saveTank({
      ...form,
      density: form.density === '' ? null : Number(form.density),
      enabled: form.enabled ? 1 : 0,
    })
    ElMessage.success('已保存')
    drawerOpen.value = false
    await load()
  } catch (e) {
    ElMessage.error(e?.response?.data?.msg || e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggle(row) {
  try {
    await setTankEnabled(row.id, row.enabled !== 1)
    await load()
  } catch (e) {
    ElMessage.error(e?.response?.data?.msg || e?.message || '操作失败')
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确定删除「${row.tankCode} ${row.tankName}」？`, '删除储罐', { type: 'warning' })
  } catch {
    return
  }
  try {
    await deleteTank(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    ElMessage.error(e?.response?.data?.msg || e?.message || '删除失败')
  }
}

onMounted(async () => {
  await Promise.all([load(), loadBlueprints()])
})
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex flex-wrap items-center gap-3 border-b border-line px-6 py-3">
      <h2 class="mr-auto text-sm font-medium text-slate-900">储罐（容器）</h2>
      <span class="text-xs text-slate-500">每个罐指定一张图纸，几何从图纸只读带出</span>
      <el-input
        v-model="keyword"
        placeholder="罐号 / 罐名 / 属地 / 物料"
        aria-label="搜索储罐"
        clearable
        class="!w-[240px]"
        @keyup.enter="load"
        @clear="load"
      />
      <el-button @click="load">刷新</el-button>
      <el-button type="primary" @click="openCreate">新增储罐</el-button>
    </header>

    <p v-if="errorText" role="alert" class="border-b border-amber-200 bg-amber-50 px-6 py-3 text-xs text-amber-800">
      {{ errorText }}
    </p>

    <div class="min-h-0 flex-1 overflow-auto">
      <table class="w-full border-collapse text-sm">
        <thead class="sticky top-0 bg-region text-xs text-slate-500">
          <tr>
            <th class="px-3 py-2 text-left font-medium">罐号</th>
            <th class="px-3 py-2 text-left font-medium">罐名</th>
            <th class="px-3 py-2 text-left font-medium">车间</th>
            <th class="px-3 py-2 text-left font-medium">属地</th>
            <th class="px-3 py-2 text-left font-medium">所属</th>
            <th class="px-3 py-2 text-left font-medium">图纸</th>
            <th class="px-3 py-2 text-left font-medium">几何</th>
            <th class="px-3 py-2 text-left font-medium">物料</th>
            <th class="px-3 py-2 text-right font-medium">密度</th>
            <th class="px-3 py-2 text-left font-medium">状态</th>
            <th class="px-3 py-2 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="11" class="px-3 py-10 text-center text-sm text-slate-500">加载中…</td>
          </tr>
          <tr v-else-if="!rows.length">
            <td colspan="11" class="px-3 py-10 text-center text-sm text-slate-500">
              还没有储罐。点「新增储罐」，先选一张图纸，再填罐号与罐名。
            </td>
          </tr>
          <tr v-for="row in rows" v-else :key="row.id" class="border-b border-line hover:bg-region">
            <td class="px-3 py-2 font-medium text-slate-900">{{ row.tankCode }}</td>
            <td class="px-3 py-2 text-slate-700">{{ row.tankName }}</td>
            <td class="px-3 py-2 text-slate-600">{{ row.workshop || '—' }}</td>
            <td class="px-3 py-2 text-slate-600">{{ row.location || '—' }}</td>
            <td class="px-3 py-2 text-slate-600">{{ row.category || '—' }}</td>
            <td class="px-3 py-2 text-slate-700">
              {{ row.blueprintName || '—' }}
              <span v-if="row.blueprintSpec" class="text-xs text-slate-500">· {{ row.blueprintSpec }}</span>
            </td>
            <td class="px-3 py-2">
              <span v-if="row.geometryReady" class="text-xs text-brand-ink">齐全</span>
              <span v-else class="text-xs text-amber-700">图纸缺几何</span>
            </td>
            <td class="px-3 py-2 text-slate-600">{{ row.materialName || '—' }}</td>
            <td class="px-3 py-2 text-right text-slate-600">{{ row.density ?? '—' }}</td>
            <td class="px-3 py-2">
              <span class="rounded-full px-2 py-0.5 text-xs" :class="row.enabled === 1 ? 'bg-brand-soft text-brand-ink' : 'bg-region text-slate-600'">
                {{ row.enabled === 1 ? '启用' : '停用' }}
              </span>
            </td>
            <td class="whitespace-nowrap px-3 py-2 text-right">
              <button type="button" class="rounded-full px-2 py-0.5 text-xs text-slate-600 hover:bg-region hover:text-slate-900" @click="openEdit(row)">编辑</button>
              <button type="button" class="rounded-full px-2 py-0.5 text-xs text-slate-600 hover:bg-region hover:text-slate-900" @click="toggle(row)">
                {{ row.enabled === 1 ? '停用' : '启用' }}
              </button>
              <button type="button" class="rounded-full px-2 py-0.5 text-xs text-rose-700 hover:bg-rose-50" @click="remove(row)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <el-dialog v-model="drawerOpen" :title="form.id ? '编辑储罐' : '新增储罐'" width="640px" append-to-body>
      <div class="space-y-3">
        <div class="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2">
          <label class="text-sm text-slate-600">图纸</label>
          <el-select v-model="form.blueprintId" filterable placeholder="选一张图纸（按名称/规格搜）" class="!w-full">
            <el-option v-for="b in blueprints" :key="b.id" :label="b.name" :value="b.id" />
          </el-select>
        </div>

        <div v-if="pickedBlueprint" class="rounded-md border border-line bg-region px-3 py-2 text-xs text-slate-600">
          图纸几何（只读）：
          内径 {{ pickedBlueprint.innerDiameter ?? '缺' }} mm ·
          筒长 {{ pickedBlueprint.shellLength ?? '缺' }} mm ·
          上封头 {{ pickedBlueprint.topHeadDepth ?? '—' }} ·
          下封头 {{ pickedBlueprint.bottomHeadDepth ?? '平底' }} ·
          直边 {{ pickedBlueprint.straightFlange ?? '—' }}
          <span v-if="!geometryReady" class="ml-1 text-amber-700">· 这张图纸几何不全，罐还参与不了体积计算</span>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
            <label class="text-sm text-slate-600">罐号</label>
            <el-input v-model="form.tankCode" placeholder="如 1#1L" />
          </div>
          <div class="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
            <label class="text-sm text-slate-600">罐名</label>
            <el-input v-model="form.tankName" placeholder="如 150产品罐 A" />
          </div>
          <div class="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
            <label class="text-sm text-slate-600">车间</label>
            <el-input v-model="form.workshop" placeholder="一车间 / 罐区…" />
          </div>
          <div class="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
            <label class="text-sm text-slate-600">属地</label>
            <el-input v-model="form.location" placeholder="如 1#1L" />
          </div>
          <div class="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
            <label class="text-sm text-slate-600">所属</label>
            <el-select v-model="form.category" clearable placeholder="产品 / 原料" class="!w-full">
              <el-option label="产品" value="产品" />
              <el-option label="原料" value="原料" />
            </el-select>
          </div>
          <div class="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
            <label class="text-sm text-slate-600">密度</label>
            <el-input v-model="form.density" inputmode="decimal" placeholder="t/m³，可空" />
          </div>
          <div class="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
            <label class="text-sm text-slate-600">物料编码</label>
            <el-input v-model="form.materialCode" />
          </div>
          <div class="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
            <label class="text-sm text-slate-600">物料名称</label>
            <el-input v-model="form.materialName" />
          </div>
        </div>

        <div class="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2">
          <label class="text-sm text-slate-600">备注</label>
          <el-input v-model="form.remark" />
        </div>
      </div>

      <template #footer>
        <el-button @click="drawerOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
