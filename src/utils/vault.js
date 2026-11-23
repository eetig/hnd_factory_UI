/*
 * 密码箱数据层（2026-11-21）
 *
 * 使用方原话：「记 MySQL、Redis、U 盘、服务器、云服务器的账号密码，按 PC 分类，
 * 本地开发要用，能查方便就行；泄露无所谓」。
 *
 * ## 2026-11-23 改版：总账搬到服务器
 * 原方案只存本机，用户反馈「电脑上加了密码手机看不到，还得手动导入」。
 * 现在服务器上有一本 vault.json（见 vault-server.mjs），任何一台电脑上的 DSH
 * 说一句就能写进去；手机进页面静默拉取一份副本用于查看。
 *
 * 合并口径：服务器优先（同 分组+名称 以服务器为准），但手机上自己记的、
 * 服务器上没有的条目保留 —— 代价是这些条目只在这台手机，不会上云，已当面说清。
 *
 * ## 本机仍然存一份（uni.setStorage）
 * 车上看、工地看都不用等网络；拉取失败时列表照旧能翻。
 *
 * ## 两级结构
 *   分组（公司电脑 / 腾讯云 / 家里服务器 / U 盘）→ 条目（类型只是条目的一个标签）
 * 分组不单独维护一张表：它是条目上的一个字段，界面上按它归堆。
 * 这样新增条目时直接输一个新名字就自动建组，不用先去别处建组。
 *
 * ## 存两份 key
 *   vaultItems  → 条目数组
 *   vaultGroups → 分组顺序（老组在前）。分组顺序不能从条目里推：
 *                 某个组暂时没条目时，它应该还在列表里等着。
 */
import { getItem, setItem } from '../api/storage'

const ITEMS_KEY = 'vaultItems'
const GROUPS_KEY = 'vaultGroups'

/** 没填分组的条目归到这一堆；组名就叫这个，写进导出文件也是这个 */
export const UNGROUPED = '未分组'

/**
 * 预设的几个「归属」。这几个组永远排在最前面，顺序固定 ——
 * 人找东西是「我在公司 → 要连 MySQL」，先按地点分，再按服务分。
 * 用户自己起的新组名照样能用，排在预设组后面。
 */
export const HOME_GROUPS = ['公司', '项目部', '家里', '个人', '云']

/** 老数据搬家：v1 的组名映射到「归属」口径，只跑一次 */
const GROUP_ALIAS = { 公司本地PC: '公司', 本机: '公司', 部署服务器: '云', 服务器: '云' }

/**
 * 类型与默认端口。
 *
 * 端口只是「选中类型时帮你填一下」，随时能改、能清空 ——
 * 有的人 MySQL 跑在 13306 上，硬编码就没意义了。
 */
export const VAULT_TYPES = [
  { key: 'mysql', label: 'MySQL', port: '3306' },
  { key: 'redis', label: 'Redis', port: '6379' },
  { key: 'sqlserver', label: 'SQL Server', port: '1433' },
  { key: 'ssh', label: 'SSH', port: '22' },
  { key: 'rdp', label: 'RDP', port: '3389' },
  { key: 'web', label: '网站后台', port: '80' },
  { key: 'oss', label: '对象存储', port: '' },
  { key: 'other', label: '其他', port: '' },
]

export function typeLabel(key) {
  const hit = VAULT_TYPES.find((row) => row.key === key)
  return hit ? hit.label : '其他'
}

export function defaultPortOf(key) {
  const hit = VAULT_TYPES.find((row) => row.key === key)
  return hit ? hit.port : ''
}

function readJson(key, fallback) {
  try {
    const raw = getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return parsed ?? fallback
  } catch (e) {
    // 存的内容被改坏时不能让整页白屏：当成空库，用户还能继续记新的
    return fallback
  }
}

function writeJson(key, value) {
  try {
    setItem(key, JSON.stringify(value))
  } catch (e) {
    // setItem 自己已经吞了异常，这里再兜一层：写不进去只影响持久化
  }
}

function text(value) {
  return String(value == null ? '' : value).trim()
}

/** id 只要在本机唯一：时间戳 + 随机尾巴，比 uuid 短，也方便看日志 */
function newId() {
  return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** 把外部传进来的字段洗一遍：全是字符串，类型落回 other，分组落回「未分组」 */
function normalize(input = {}) {
  const type = VAULT_TYPES.some((row) => row.key === input.type) ? input.type : 'other'
  return {
    id: text(input.id),
    name: text(input.name),
    type,
    host: text(input.host),
    port: text(input.port),
    username: text(input.username),
    password: String(input.password == null ? '' : input.password).trim(),
    group: text(input.group) || UNGROUPED,
    note: String(input.note == null ? '' : input.note).trim(),
    createdAt: text(input.createdAt),
    updatedAt: text(input.updatedAt),
    lastUsedAt: text(input.lastUsedAt),
  }
}

export function readItems() {
  const rows = readJson(ITEMS_KEY, [])
  if (!Array.isArray(rows)) return []
  return rows.map((row) => normalize(row)).filter((row) => row.name)
}

function writeItems(rows) {
  writeJson(ITEMS_KEY, rows)
}

export function readGroups() {
  const rows = readJson(GROUPS_KEY, [])
  return Array.isArray(rows) ? rows.map((row) => text(row)).filter(Boolean) : []
}

function writeGroups(rows) {
  writeJson(GROUPS_KEY, rows)
}

/** 条目里出现过的组名，按「先老组、后新组」排好，没条目的老组也留着 */
export function listGroups(items = readItems()) {
  const stored = readGroups()
  const seen = new Set()
  const out = []

  stored.forEach((name) => {
    if (name === UNGROUPED || seen.has(name)) return
    seen.add(name)
    out.push(name)
  })

  items.forEach((item) => {
    if (item.group === UNGROUPED || seen.has(item.group)) return
    seen.add(item.group)
    out.push(item.group)
  })

  // 预设归属提到最前面，顺序写死，别让它们跟着录入先后乱飘
  const head = HOME_GROUPS.filter((name) => out.includes(name))
  const rest = out.filter((name) => !HOME_GROUPS.includes(name))
  const ordered = [...head, ...rest]

  if (items.some((item) => item.group === UNGROUPED)) ordered.push(UNGROUPED)
  return ordered
}

/** 组里出现了新名字就记进顺序表，删条目不删组（组还可以再用） */
function rememberGroup(name) {
  const clean = text(name)
  if (!clean || clean === UNGROUPED) return
  const stored = readGroups()
  if (stored.includes(clean)) return
  writeGroups([...stored, clean])
}

export function findItem(id) {
  return readItems().find((row) => row.id === id) || null
}

/* ===== 自动猜：类型 / 归属 ===== */

const PORT_TYPE = {
  3306: 'mysql',
  6379: 'redis',
  1433: 'sqlserver',
  22: 'ssh',
  3389: 'rdp',
  80: 'web',
  443: 'web',
  8080: 'web',
  9000: 'oss',
  9005: 'oss',
  9025: 'oss',
}

/**
 * 按地址里的端口猜类型，端口没线索再看名字里的关键词。
 *
 * 只在新条目、且用户没选过类型时才用；猜错了改一下就行，
 * 所以这里宁可给一个「差不多」的答案，也不要留空让人自己点。
 */
export function inferType(address = '', name = '') {
  const addr = String(address || '')
  const port = (addr.match(/:(\d{2,5})\s*$/) || [])[1]
  if (port && PORT_TYPE[Number(port)]) return PORT_TYPE[Number(port)]

  const s = `${addr} ${name}`.toLowerCase()
  if (s.includes('redis')) return 'redis'
  if (s.includes('mysql') || s.includes('maria')) return 'mysql'
  if (s.includes('sqlserver') || s.includes('mssql')) return 'sqlserver'
  if (s.includes('minio') || s.includes('oss') || s.includes('存储')) return 'oss'
  if (s.includes('nacos') || s.includes('后台') || s.includes('控制台') || s.includes('面板')) return 'web'
  if (s.includes('ssh') || s.includes('终端')) return 'ssh'
  if (s.includes('远程桌面') || s.includes('rdp')) return 'rdp'
  return 'other'
}

/** 云上的机器认得出来就归「云」：IP / 域名 / 关键词都算线索 */
const CLOUD_HINT = /(124\.220\.60\.154|hbhnd\.cloud|腾讯云|阿里云|华为云|云服务器|云主机)/i

/** 猜这条属于哪个「归属」。猜不出返回空串，交给调用方兜底成未分组 */
export function inferGroup(name = '', address = '') {
  const s = `${name} ${address}`.toLowerCase()
  if (CLOUD_HINT.test(s)) return '云'
  if (/公司|办公室|工位|厂里|车间/.test(s)) return '公司'
  if (/项目部|项目组|工地/.test(s)) return '项目部'
  if (/家里|家中|自宅|客厅/.test(s)) return '家里'
  if (/个人|自己|自用|私人/.test(s)) return '个人'
  return ''
}

/**
 * 老数据搬家（幂等）：把 v1 的「公司本地PC / 部署服务器」换成「公司 / 云」。
 * 每次进页面都扫一遍 —— 服务器上可能还留着老组名，同步下来会被带回来，
 * 一次性标记会让这些条目一直挂在老组里。改名本身是幂等的，扫一遍很便宜。
 */
export function migrateGrouping() {
  const items = readItems()
  let changed = 0
  const next = items.map((item) => {
    const alias = GROUP_ALIAS[item.group]
    if (!alias) return item
    changed += 1
    return { ...item, group: alias }
  })

  if (changed) writeItems(next)
  return changed
}

/**
 * 新增或更新一条，返回它的 id。
 *
 * @param {object} input 字段见 normalize；带 id 就是更新
 */
export function saveItem(input = {}) {
  const payload = normalize(input)
  if (!payload.name) throw new Error('名称不能为空')

  const items = readItems()
  const now = new Date().toISOString()
  const index = payload.id ? items.findIndex((row) => row.id === payload.id) : -1

  if (index >= 0) {
    // 编辑不动 createdAt，也不动 lastUsedAt：改个备注不该把它顶到最上面
    items[index] = { ...items[index], ...payload, updatedAt: now }
  } else {
    const id = payload.id || newId()
    items.push({ ...payload, id, createdAt: now, updatedAt: now, lastUsedAt: '' })
    payload.id = id
  }

  writeItems(items)
  rememberGroup(payload.group)
  return payload.id || items[items.length - 1].id
}

export function removeItem(id) {
  const items = readItems().filter((row) => row.id !== id)
  writeItems(items)
}

/**
 * 记一次「用过」。
 *
 * 组内按最近使用倒序排 —— 天天用的那几个自己浮上来，
 * 这正是「手机查一下」最省事的形态，不做收藏置顶也够。
 */
export function touchItem(id) {
  const items = readItems()
  const index = items.findIndex((row) => row.id === id)
  if (index < 0) return
  items[index] = { ...items[index], lastUsedAt: new Date().toISOString() }
  writeItems(items)
}

/** 主机:端口，两个都没填就不显示这一行 */
export function addressOf(item) {
  const host = text(item && item.host)
  const port = text(item && item.port)
  if (!host) return ''
  return port ? `${host}:${port}` : host
}

/**
 * 按分组归堆并排序。
 *
 * 组内：最近用过的在前，其次是最近改过的，最后按名字；
 * 空组不显示（组名留在顺序表里下次还能用）。
 */
export function groupItems(items = readItems()) {
  const order = listGroups(items)
  const buckets = new Map()
  order.forEach((name) => buckets.set(name, []))

  items.forEach((item) => {
    const name = item.group || UNGROUPED
    if (!buckets.has(name)) buckets.set(name, [])
    buckets.get(name).push(item)
  })

  return order
    .map((name) => ({
      name,
      items: sortGroupItems(buckets.get(name) || []),
    }))
    .filter((group) => group.items.length)
}

/**
 * 组内排序。列表页搜索后也要按同一口径排，
 * 所以这里导出：排序规则只写一处，不然两边迟早会不一致。
 */
export function sortGroupItems(list = []) {
  return list.slice().sort(compareItem)
}

function compareItem(a, b) {
  const usedA = a.lastUsedAt || ''
  const usedB = b.lastUsedAt || ''
  if (usedA !== usedB) return usedA < usedB ? 1 : -1
  const editedA = a.updatedAt || ''
  const editedB = b.updatedAt || ''
  if (editedA !== editedB) return editedA < editedB ? 1 : -1
  return String(a.name).localeCompare(String(b.name), 'zh')
}

/* ===== 备份与恢复 ===== */

export const BACKUP_APP = 'hnd-vault'
export const BACKUP_VERSION = 1

export function buildBackup(items = readItems()) {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    groups: listGroups(items),
    items,
  }
}

/** 导出给用户看的那段文本：开头带一行提醒，别一坨 JSON 让人以为是什么配置 */
export function buildBackupText(items = readItems()) {
  const payload = buildBackup(items)
  return `# 密码备份，别乱发。导出于 ${payload.exportedAt}\n${JSON.stringify(payload, null, 2)}`
}

/**
 * 从一段文本里解析条目。
 *
 * 认三种输入（手滑粘多粘少都不至于全废）：
 *   ① 带 # 开头的提醒行 —— 跳过
 *   ② { app, items } 整包
 *   ③ 裸数组 [{ name, ... }]
 */
export function parseBackup(textValue) {
  const raw = String(textValue || '').trim()
  if (!raw) return { items: [], error: '还没粘内容' }

  const firstBrace = raw.search(/[[{]/)
  if (firstBrace < 0) return { items: [], error: '没找到 JSON：把整段内容都粘进来' }

  let parsed
  try {
    parsed = JSON.parse(raw.slice(firstBrace))
  } catch (e) {
    return { items: [], error: '内容不完整或格式不对，重新复制一次' }
  }

  const rows = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.items) ? parsed.items : null
  if (!rows) return { items: [], error: '这份内容里没有条目' }

  return { items: rows.map((row) => normalize(row)).filter((row) => row.name), error: '' }
}

/**
 * 合并导入：同「分组 + 名称」的算同一条，跳过、不覆盖。
 *
 * 为什么是合并而不是覆盖：导出常常是从旧手机导的，
 * 直接清库再写会把新手机上新记的那些一起抹掉。
 */
export function importBackup(textValue) {
  const { items: incoming, error } = parseBackup(textValue)
  if (error) return { added: 0, skipped: 0, error }

  const existing = readItems()
  const keys = new Set(existing.map((row) => `${row.group}|${row.name}`))
  const merged = existing.slice()
  let added = 0
  let skipped = 0

  incoming.forEach((row) => {
    const key = `${row.group}|${row.name}`
    if (keys.has(key)) {
      skipped += 1
      return
    }
    keys.add(key)
    const now = new Date().toISOString()
    merged.push({
      ...row,
      id: newId(),
      createdAt: row.createdAt || now,
      updatedAt: row.updatedAt || now,
    })
    added += 1
  })

  if (added) {
    writeItems(merged)
    incoming.forEach((row) => rememberGroup(row.group))
  }

  return { added, skipped, error: '' }
}

/* ===== 服务器总账：拉取与合并 ===== */

/** 总账地址。路径里的随机串是唯一的"门牌"，token 是钥匙，两个都对才拿得到 */
export const VAULT_BASE = 'https://hbhnd.cloud/k7f2q9'
export const VAULT_TOKEN = '95fefd933d868d949dfcb56b0312c8bd'

const SYNC_KEY = 'vaultSyncedAt'
const SEEDED_KEY = 'vaultSeeded'
const SNIPPETS_KEY = 'vaultSnippets'

export function lastSyncedAt() {
  return text(getItem(SYNC_KEY))
}

function markSynced(at) {
  try {
    setItem(SYNC_KEY, at)
  } catch (e) {
    // 记不上时间只影响那行小字，不影响数据
  }
}

function httpGet(path) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: `${VAULT_BASE}${path}`,
      method: 'GET',
      timeout: 8000,
      header: { Authorization: `Bearer ${VAULT_TOKEN}` },
      success: (res) => {
        if (res.statusCode === 200 && res.data && typeof res.data === 'object') {
          resolve(res.data)
          return
        }
        reject(new Error(`HTTP ${res.statusCode}`))
      },
      fail: (err) => reject(new Error((err && err.errMsg) || '网络不通')),
    })
  })
}

function keyOf(row) {
  return `${row.group}|${row.name}`
}

function normalizeSnippet(input = {}) {
  return {
    id: text(input.id) || newId(),
    name: text(input.name),
    desc: text(input.desc),
    text: String(input.text == null ? '' : input.text).trim(),
    createdAt: text(input.createdAt),
    updatedAt: text(input.updatedAt),
  }
}

/**
 * 拉一次总账并合并进本机。
 *
 * 合并规则：服务器有、本机也有 → 用服务器的字段，但保留本机的 id 和 lastUsedAt
 * （不然每次同步，用户刚点过的那条就被顶下去）；本机独有的 → 留着不上云。
 */
export async function pullAndMerge() {
  const payload = await httpGet('/vault.json')
  const serverItems = (Array.isArray(payload.items) ? payload.items : []).map((row) => normalize(row)).filter((row) => row.name)
  const serverSnippets = (Array.isArray(payload.snippets) ? payload.snippets : [])
    .map((row) => normalizeSnippet(row))
    .filter((row) => row.name)

  const local = readItems()
  const localByKey = new Map(local.map((row) => [keyOf(row), row]))
  const merged = serverItems.map((row) => {
    const mine = localByKey.get(keyOf(row))
    return {
      ...row,
      id: (mine && mine.id) || row.id || newId(),
      lastUsedAt: (mine && mine.lastUsedAt) || row.lastUsedAt || '',
    }
  })
  const serverKeys = new Set(serverItems.map((row) => keyOf(row)))
  local.forEach((row) => {
    if (!serverKeys.has(keyOf(row))) merged.push(row)
  })

  writeItems(merged)
  merged.forEach((row) => rememberGroup(row.group))

  const localSnippets = readSnippets()
  const localSnipByName = new Map(localSnippets.map((row) => [row.name, row]))
  const nextSnippets = serverSnippets.map((row) => ({
    ...row,
    id: (localSnipByName.get(row.name) || {}).id || row.id,
  }))
  const serverNames = new Set(serverSnippets.map((row) => row.name))
  localSnippets.forEach((row) => {
    if (!serverNames.has(row.name)) nextSnippets.push(row)
  })
  writeSnippets(nextSnippets)

  const at = new Date().toISOString()
  markSynced(at)
  return { items: merged, snippets: nextSnippets, at }
}

/* ===== 安装配方（MCP & Skills） ===== */

export function readSnippets() {
  const rows = readJson(SNIPPETS_KEY, [])
  if (!Array.isArray(rows)) return []
  return rows.map((row) => normalizeSnippet(row)).filter((row) => row.name)
}

function writeSnippets(rows) {
  writeJson(SNIPPETS_KEY, rows)
}

export function findSnippet(id) {
  return readSnippets().find((row) => row.id === id) || null
}

/** 手动加一条（手机上加的只在这台手机，下次同步不会覆盖服务器上的同名条目） */
export function saveSnippet(input = {}) {
  const payload = normalizeSnippet(input)
  if (!payload.name) throw new Error('名称不能为空')
  if (!payload.text) throw new Error('要复制的那段话不能为空')

  const rows = readSnippets()
  const now = new Date().toISOString()
  const index = payload.id ? rows.findIndex((row) => row.id === payload.id) : -1
  if (index >= 0) {
    rows[index] = { ...rows[index], ...payload, updatedAt: now }
  } else {
    rows.push({ ...payload, createdAt: now, updatedAt: now })
  }
  writeSnippets(rows)
  return payload.id
}

export function removeSnippet(id) {
  writeSnippets(readSnippets().filter((row) => row.id !== id))
}

/* ===== 地址解析 ===== */

/** 「127.0.0.1:3306」→ { host, port }；只填主机也行 */
export function parseAddress(value) {
  const raw = text(value)
  if (!raw) return { host: '', port: '' }
  const hit = raw.match(/^(.*?):(\d{1,5})$/)
  if (hit) return { host: text(hit[1]), port: hit[2] }
  return { host: raw, port: '' }
}

export function addressInput(item) {
  return addressOf(item)
}

/* ===== 内置的那几条（服务器拉不到时也能看） ===== */

/**
 * 这些是第一次改版时从本机文件里查证出来的，打包进 APK 当兜底。
 * 服务器上有同一份，所以正常情况用不到它 —— 断网 + 重装才会显形。
 */
export const BUILTIN_ITEMS = [
  {
    name: '本地 MySQL',
    group: '公司本地PC',
    type: 'mysql',
    host: '127.0.0.1',
    port: '3306',
    username: 'root',
    password: '123eetig',
    note: '取自 config/application.yml，未实测',
  },
  {
    name: '本地 Redis',
    group: '公司本地PC',
    type: 'redis',
    host: '127.0.0.1',
    port: '6379',
    username: '',
    password: '',
    note: '无密码',
  },
  {
    name: '本地 Nacos',
    group: '公司本地PC',
    type: 'web',
    host: '127.0.0.1',
    port: '8848',
    username: '',
    password: '',
    note: '控制台免登录，2.5.4',
  },
  {
    name: '本地 MinIO',
    group: '公司本地PC',
    type: 'oss',
    host: '127.0.0.1',
    port: '9005',
    username: 'minioadmin',
    password: 'minioadmin',
    note: '桶 hndfactory',
  },
  {
    name: '部署 SSH',
    group: '部署服务器',
    type: 'ssh',
    host: '124.220.60.154',
    port: '9002',
    username: 'eetig',
    password: '',
    note: '密钥免密登录',
  },
  {
    name: 'MinIO 备份端（PC2）',
    group: '部署服务器',
    type: 'oss',
    host: '124.220.60.154',
    port: '9025',
    username: 'eetig',
    password: '123eetig',
    note: '走 FRP 到 PC2 的 9000',
  },
]

export const BUILTIN_SNIPPETS = [
  {
    name: '密码箱',
    desc: '任何一台电脑装完，都能让 DSH 存/查账号密码；手机里能看',
    text: `帮我装「密码箱」：读 ${VAULT_BASE}/install.md 并照它做。装完调用 vault_list，确认能列出我密码箱里的条目。以后我说「帮我记一下 XX」，走 vault skill。`,
  },
]

export function seededAlready() {
  return text(getItem(SEEDED_KEY)) === '1'
}

/** 空列表时点「载入我电脑上的这几条」：只补内置的，不动已有的 */
export function seedBuiltin() {
  const items = readItems()
  const keys = new Set(items.map((row) => keyOf(row)))
  const now = new Date().toISOString()
  let added = 0

  BUILTIN_ITEMS.forEach((row) => {
    const payload = normalize(row)
    if (keys.has(keyOf(payload))) return
    keys.add(keyOf(payload))
    items.push({ ...payload, id: newId(), createdAt: now, updatedAt: now, lastUsedAt: '' })
    rememberGroup(payload.group)
    added += 1
  })

  writeItems(items)

  const snippets = readSnippets()
  const names = new Set(snippets.map((row) => row.name))
  BUILTIN_SNIPPETS.forEach((row) => {
    if (names.has(row.name)) return
    snippets.push({ ...normalizeSnippet(row), createdAt: now, updatedAt: now })
  })
  writeSnippets(snippets)

  try {
    setItem(SEEDED_KEY, '1')
  } catch (e) {
    // 无所谓：下次再点一次也是幂等的
  }
  return added
}
