<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElDatePicker, ElInput, ElOption, ElPagination, ElSelect } from 'element-plus'
import request from '../../api/request'

/*
 * 管控日志（2026-11-02，变更-178）。
 *
 * 使用方要求：「做一个管控，只有管理员能看到：注册时间、登录 IP、设备信息（风控）、
 * 每次上下线时间、做了哪些动作等等」，并选了「全按推荐」。
 *
 * ## 这一页回答三个问题
 * ① 谁在什么时候登录过、从哪台设备来（风险：换设备、异地）
 * ② 谁也退出过（上下线时间）
 * ③ 谁做了什么写操作（做了什么、成功还是被拒）
 *
 * ## 两个设计决定
 * · **只读**：没有任何删除按钮。日志能删就等于没有；过期由后端每天自动清 180 天前的。
 * · **账号视图 / 日志视图** 分两片：先看"人"（最近登录、次数），再下钻到"这个人干了什么"。
 *
 * 视觉上沿用本仓的暖纸 + 发丝线卡片配方，不用彩色区分事件类型 —— 事件用文字徽章，
 * 彩色只在"写操作被拒"这一处（真正的异常信号）。
 */
const loading = ref(false)
const errorMessage = ref('')

const view = ref('timeline') // timeline | accounts
const rows = ref([])
const total = ref(0)
const pageNum = ref(1)
const pageSize = ref(50)

const accounts = ref([])
const accountsLoading = ref(false)

const filters = ref({ username: '', event: '', keyword: '', from: '', to: '' })
const eventOptions = ref([
  { value: 'login', label: '登录' },
  { value: 'logout', label: '退出' },
  { value: 'register', label: '注册' },
  { value: 'write_ok', label: '写操作成功' },
  { value: 'write_denied', label: '写操作被拒' },
  { value: 'locked_clicked', label: '点锁定功能' },
])

const EVENT_LABEL = {
  login: '登录',
  logout: '退出',
  register: '注册',
  write_ok: '写操作',
  write_denied: '写操作被拒',
  locked_clicked: '点锁定功能',
}

/** 徽章配色：只有"被拒"用警示色，其余走中性 —— 满屏彩色等于没有重点 */
function eventClass(event) {
  if (event === 'write_denied') return 'audit__badge audit__badge--danger'
  if (event === 'login') return 'audit__badge audit__badge--calm'
  return 'audit__badge'
}

function eventLabel(event) {
  return EVENT_LABEL[event] || event
}

/** 时间只显示到分钟：审计看的是"什么时候"，秒没有意义还占宽 */
function fmtTime(value) {
  if (!value) return '—'
  return String(value).replace('T', ' ').slice(0, 16)
}

/** 设备：空就显示"—"（早期记录没有这一列，别让它看起来像坏了） */
function fmtDevice(row) {
  return row.device || ''
}

/** 把 /api/xxx/yyy 翻成人话一点；翻不出来就原样显示 */
function fmtPath(path) {
  if (!path) return ''
  const map = [
    ['/api/tank-level', '储罐液位'],
    ['/api/attendance', '考勤'],
    ['/api/material-master', '物料主数据'],
    ['/api/movement', '领料 / 投料'],
    ['/api/work-order', '工单'],
    ['/api/equipment', '设备'],
    ['/api/archive', '资料归档'],
    ['/api/purchase', '采购'],
    ['/api/user', '账号'],
    ['/api/audit', '管控'],
  ]
  for (const [prefix, label] of map) {
    if (path.startsWith(prefix)) return label + path.slice(prefix.length)
  }
  return path
}

async function fetchPage() {
  loading.value = true
  errorMessage.value = ''
  try {
    const params = { pageNum: pageNum.value, pageSize: pageSize.value }
    for (const [key, value] of Object.entries(filters.value)) {
      if (value) params[key] = value
    }
    const res = await request.get('/api/audit/page', { params })
    const data = res.data?.data || {}
    rows.value = data.rows || []
    total.value = Number(data.total || 0)
  } catch (error) {
    rows.value = []
    total.value = 0
    errorMessage.value = error?.response?.data?.msg || error.message || '加载失败'
  } finally {
    loading.value = false
  }
}

async function fetchAccounts() {
  accountsLoading.value = true
  errorMessage.value = ''
  try {
    const res = await request.get('/api/audit/accounts')
    accounts.value = res.data?.data || []
  } catch (error) {
    accounts.value = []
    errorMessage.value = error?.response?.data?.msg || error.message || '加载失败'
  } finally {
    accountsLoading.value = false
  }
}

function applyFilters() {
  pageNum.value = 1
  fetchPage()
}

function resetFilters() {
  filters.value = { username: '', event: '', keyword: '', from: '', to: '' }
  pageNum.value = 1
  fetchPage()
}

/** 从账号列表点进某个人的日志 */
function drillInto(username) {
  filters.value.username = username
  view.value = 'timeline'
  pageNum.value = 1
  fetchPage()
}

const activeAccounts = computed(() => accounts.value.length)

onMounted(async () => {
  await Promise.all([fetchPage(), fetchAccounts()])
})
</script>

<template>
  <div class="audit flex h-full flex-col">
    <section class="flex min-h-0 flex-1 flex-col rounded-card border border-line bg-raised shadow-card">
      <!-- 头部：标题 + 两片切换 -->
      <div class="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-6 py-3">
        <h1 class="text-base font-semibold text-slate-900">管控日志</h1>
        <p class="text-xs text-slate-500">只读 · 自动保留 180 天 · 只有管理员可见</p>

        <div class="ml-auto flex items-center gap-1 rounded-lg border border-line p-0.5">
          <button
            type="button"
            class="rounded-md px-3 py-1 text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
            :class="view === 'timeline' ? 'bg-brand text-on-brand' : 'text-slate-600 hover:bg-region'"
            @click="view = 'timeline'"
          >
            日志
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-1 text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
            :class="view === 'accounts' ? 'bg-brand text-on-brand' : 'text-slate-600 hover:bg-region'"
            @click="view = 'accounts'"
          >
            账号（{{ activeAccounts }}）
          </button>
        </div>
      </div>

      <!-- 筛选 -->
      <div v-if="view === 'timeline'" class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-6 py-3">
        <el-input v-model="filters.username" placeholder="账号" clearable class="w-[130px]" @keyup.enter="applyFilters" />
        <el-select v-model="filters.event" placeholder="事件" clearable class="w-[130px]">
          <el-option v-for="opt in eventOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
        <el-date-picker
          v-model="filters.from"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="从"
          aria-label="起始日期"
          :first-day-of-week="1"
          class="!w-[140px]"
        />
        <el-date-picker
          v-model="filters.to"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="到"
          aria-label="结束日期"
          :first-day-of-week="1"
          class="!w-[140px]"
        />
        <el-input
          v-model="filters.keyword"
          placeholder="路径 / IP / 设备 关键字"
          clearable
          class="w-[210px]"
          @keyup.enter="applyFilters"
        />
        <button
          type="button"
          class="rounded-md border border-line px-3 py-1.5 text-xs text-slate-700 transition hover:bg-region focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
          @click="applyFilters"
        >
          查询
        </button>
        <button
          type="button"
          class="rounded-md px-3 py-1.5 text-xs text-slate-500 transition hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
          @click="resetFilters"
        >
          重置
        </button>
        <span class="ml-auto text-xs text-slate-500">共 {{ total }} 条</span>
      </div>

      <!-- 错误 -->
      <div v-if="errorMessage" role="alert" class="mx-6 mt-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {{ errorMessage }}
      </div>

      <!-- 日志视图 -->
      <div v-if="view === 'timeline'" class="min-h-0 flex-1 overflow-auto">
        <table class="audit__table">
          <thead>
            <tr>
              <th class="w-[140px]">时间</th>
              <th class="w-[120px]">账号</th>
              <th class="w-[110px]">事件</th>
              <th class="w-[120px]">IP</th>
              <th class="w-[160px]">设备</th>
              <th>动作 / 路径</th>
              <th class="w-[90px]">结果</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id">
              <td class="tabular-nums text-slate-600">{{ fmtTime(row.createdAt) }}</td>
              <td class="font-medium text-slate-800">{{ row.username || '—' }}</td>
              <td>
                <span :class="eventClass(row.event)">{{ eventLabel(row.event) }}</span>
              </td>
              <td class="tabular-nums text-slate-600">{{ row.ip || '—' }}</td>
              <td class="text-slate-600">
                <template v-if="fmtDevice(row)">{{ fmtDevice(row) }}</template>
                <span v-else class="text-slate-500">—</span>
              </td>
              <td class="min-w-0">
                <p class="truncate text-slate-800" :title="row.path">{{ fmtPath(row.path) }}</p>
                <p v-if="row.target" class="truncate text-xs text-slate-500">{{ row.target }}</p>
              </td>
              <td>
                <span class="text-xs" :class="row.result === 'denied' ? 'text-rose-600' : 'text-slate-500'">
                  {{ row.result === 'denied' ? '被拒' : '成功' }}
                </span>
              </td>
            </tr>
            <tr v-if="!loading && !rows.length">
              <td colspan="7" class="px-4 py-10 text-center text-sm text-slate-500">
                这段时间没有记录
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 账号视图 -->
      <div v-else class="min-h-0 flex-1 overflow-auto">
        <table class="audit__table">
          <thead>
            <tr>
              <th class="w-[130px]">账号</th>
              <th class="w-[110px]">姓名</th>
              <th class="w-[150px]">注册时间</th>
              <th class="w-[80px]">登录次数</th>
              <th class="w-[150px]">最近登录</th>
              <th class="w-[130px]">最近 IP</th>
              <th>最近设备</th>
              <th class="w-[80px]">明细</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in accounts" :key="row.id">
              <td class="font-medium text-slate-800">{{ row.username }}</td>
              <td class="text-slate-600">{{ row.realName || '—' }}</td>
              <td class="tabular-nums text-slate-600">{{ fmtTime(row.registerTime) }}</td>
              <td class="text-right tabular-nums text-slate-700">{{ row.loginCount ?? 0 }}</td>
              <td class="tabular-nums text-slate-600">{{ fmtTime(row.lastLoginAt) }}</td>
              <td class="tabular-nums text-slate-600">{{ row.lastLoginIp || '—' }}</td>
              <td class="text-slate-600">
                <template v-if="row.lastLoginDevice">{{ row.lastLoginDevice }}</template>
                <span v-else class="text-slate-500">—</span>
              </td>
              <td>
                <button
                  type="button"
                  class="rounded-md px-2 py-1 text-xs text-slate-600 underline decoration-dotted transition hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
                  @click="drillInto(row.username)"
                >
                  查看
                </button>
              </td>
            </tr>
            <tr v-if="!accountsLoading && !accounts.length">
              <td colspan="8" class="px-4 py-10 text-center text-sm text-slate-500">还没有账号</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 分页（只在日志视图） -->
      <div v-if="view === 'timeline'" class="flex shrink-0 items-center justify-between border-t border-line px-6 py-3">
        <p class="text-xs text-slate-500">只记写操作与登录/退出；查询类请求不入库（一天几万条，表会爆）</p>
        <el-pagination
          v-model:current-page="pageNum"
          :page-size="pageSize"
          :total="total"
          layout="prev, pager, next"
          background
          @current-change="fetchPage"
        />
      </div>
    </section>
  </div>
</template>

<style scoped>
.audit__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.audit__table th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 8px 12px;
  text-align: left;
  font-weight: 500;
  font-size: 12px;
  color: #6b7280;
  background-color: #f6f3ec;
  border-bottom: 1px solid #e7e2d8;
  white-space: nowrap;
}

.audit__table td {
  padding: 8px 12px;
  border-bottom: 1px solid #f0ece3;
  vertical-align: top;
}

.audit__table tbody tr:hover {
  background-color: #faf8f3;
}

.audit__badge {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid #e7e2d8;
  font-size: 11px;
  color: #4b5563;
  white-space: nowrap;
}

.audit__badge--calm {
  border-color: #d6e3d6;
  background-color: #f2f7f2;
  color: #2f5d3f;
}

.audit__badge--danger {
  border-color: #f0c9c9;
  background-color: #fdf2f2;
  color: #a32424;
}
</style>
