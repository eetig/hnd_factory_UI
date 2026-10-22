<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import request from '../../api/request'
import { hasPerm } from '../../api/auth'
import EquipmentCard from './EquipmentCard.vue'
import EquipmentDetailDrawer from './EquipmentDetailDrawer.vue'
import { groupLedger } from './ledgerGroups.js'
import { saveLedger, useEquipmentLedgerData } from '../../composables/useEquipmentLedgerData.js'

/*
 * 设备看板（变更-150，2026-10-22）。
 *
 * 与采购看板同一套形态：四列卡片、点卡开抽屉、一次拉满 200 条。
 * 分列依据不是容器类型，而是**缺什么**（缺底图 / 缺标定 / 停用 / 就绪）——
 * 理由写在 ledgerGroups.js 头部。
 *
 * 三条边界：
 * 1. 台账**没有删除接口**（台账是历史依据，只允许启用/停用），所以看板不提供删除，
 *    抽屉里也没有删除按钮。这不是漏做。
 * 2. 「停用/容器类型」这类筛选没有放进来：看板的列本身就是最有用的一次筛选。
 *    要按车间/类型筛，去「设备数据维护」。
 * 3. 列头计数来自当前渲染（不再单请求统计），避免与页面上的数字打架。
 */

const rows = ref([])
const loading = ref(false)
const loadError = ref('')

const canEdit = computed(() => hasPerm('equipment:edit'))

// saving 在 composable 的**返回对象**里，不是模块级具名导出（vitest 放过、rollup 报错）
const { saving } = useEquipmentLedgerData()

let seq = 0

async function loadBoard() {
  const mine = ++seq
  loading.value = true
  loadError.value = ''
  try {
    // 一次拉满（后端 MAX_PAGE_SIZE = 200）；设备台账是几十级，不翻页
    const res = await request.get('/api/equipment/ledger/list', {
      params: { pageNum: 1, pageSize: 200 },
    })
    if (mine !== seq) return
    if (res.data?.success === false) {
      rows.value = []
      loadError.value = res.data?.msg || '设备台账加载失败'
      return
    }
    rows.value = Array.isArray(res.data?.dataList) ? res.data.dataList : []
  } catch (e) {
    if (mine !== seq) return
    rows.value = []
    loadError.value = e?.response?.data?.msg || e?.message || '设备台账加载失败'
  } finally {
    if (mine === seq) loading.value = false
  }
}

const columns = computed(() => groupLedger(rows.value))
const totalShown = computed(() => rows.value.length)

// ===== 抽屉：点卡片进入编辑（与维护页共用同一个抽屉）=====
const drawerOpen = ref(false)
const drawerMode = ref('edit')
const drawerRow = ref(null)

function openCard(row) {
  drawerMode.value = 'edit'
  drawerRow.value = row
  drawerOpen.value = true
}

async function handleSave(payload) {
  if (!payload.equipmentCode?.trim()) return ElMessage.error('设备位号不能为空')
  if (!payload.equipmentName?.trim()) return ElMessage.error('设备名称不能为空')
  try {
    await saveLedger(payload)
    drawerOpen.value = false
    drawerRow.value = null
    ElMessage.success('已保存')
    await loadBoard()
  } catch (e) {
    ElMessage.error(e?.response?.data?.msg || e?.message || '保存失败')
  }
}

onMounted(loadBoard)
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="mb-3 flex shrink-0 flex-wrap items-center gap-3">
      <p class="text-sm text-slate-600">
        共 <span class="font-semibold tabular-nums text-slate-900">{{ totalShown }}</span> 台
        <span class="text-slate-500">（按「还缺什么」分列，不是按容器类型）</span>
      </p>
      <button
        type="button"
        class="rounded-md border border-line bg-raised px-2.5 py-1 text-xs text-slate-700 transition hover:border-slate-400 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
        :disabled="loading"
        @click="loadBoard"
      >
        {{ loading ? '刷新中…' : '刷新' }}
      </button>
      <span class="text-xs text-slate-500">要按车间/类型细筛，去「设备数据维护」</span>
    </div>

    <p
      v-if="loadError"
      class="mb-3 shrink-0 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
    >
      {{ loadError }}
    </p>

    <div class="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      <section
        v-for="col in columns"
        :key="col.key"
        class="flex min-h-0 flex-col rounded-card border border-line bg-region/40"
        :aria-label="`${col.label}（${col.rows.length} 台）`"
      >
        <header class="shrink-0 px-3 py-2">
          <h3 class="text-sm font-semibold text-slate-900">
            {{ col.label }}
            <span class="ml-1 font-normal tabular-nums text-slate-500">{{ col.rows.length }}</span>
          </h3>
          <p class="truncate text-[11px] text-slate-500">{{ col.hint }}</p>
        </header>

        <div class="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
          <EquipmentCard
            v-for="row in col.rows"
            :key="row.id"
            :row="row"
            @click="openCard(row)"
          />
          <p
            v-if="!col.rows.length"
            class="rounded-md border border-dashed border-line px-3 py-6 text-center text-xs text-slate-500"
          >
            {{ loading ? '加载中…' : '这一列是空的' }}
          </p>
        </div>
      </section>
    </div>

    <EquipmentDetailDrawer
      v-model="drawerOpen"
      :mode="drawerMode"
      :row="drawerRow"
      :can-edit="canEdit"
      :saving="saving"
      @save="handleSave"
    />
  </div>
</template>
