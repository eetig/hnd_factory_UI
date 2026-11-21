/*
 * 密码箱数据层（2026-11-21）
 *
 * 使用方原话：「记 MySQL、Redis、U 盘、服务器、云服务器的账号密码，按 PC 分类，
 * 本地开发要用，能查方便就行；泄露无所谓」。
 *
 * ## 为什么不走接口
 * 这些是他自己账号的密码，走后端等于把它们搬到服务器上，多一处可能泄露的地方，
 * 而且工地网络查密码还得等接口。所以整包只存在这台手机里（uni.setStorage），
 * 换手机/重装前用「备份」导出一次。代价说清楚了：缓存清掉就没了。
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

  if (items.some((item) => item.group === UNGROUPED)) out.push(UNGROUPED)
  return out
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
