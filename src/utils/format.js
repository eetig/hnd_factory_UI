// 通用格式化与取值工具

export function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getToday() {
  return formatDate(new Date())
}

export function getFirstDayOfCurrentMonth() {
  const date = new Date()
  date.setDate(1)
  return formatDate(date)
}

// 上周一（周统计默认起始）
export function getLastWeekMonday() {
  const date = new Date()
  const dayOfWeek = (date.getDay() + 6) % 7 // 周一=0 ... 周日=6
  date.setDate(date.getDate() - dayOfWeek - 7)
  return formatDate(date)
}

// 上周日（周统计默认截止）
export function getLastWeekSunday() {
  const date = new Date()
  const dayOfWeek = (date.getDay() + 6) % 7 // 周一=0 ... 周日=6
  date.setDate(date.getDate() - dayOfWeek - 1)
  return formatDate(date)
}

// yyyy-MM-dd → M月D日
export function formatMonthDay(dateString) {
  const [, month, day] = String(dateString ?? '').split('-')
  if (!month || !day) return dateString ?? ''
  return `${Number(month)}月${Number(day)}日`
}

// 数量求和后去掉浮点误差（保留至多 3 位小数）
export function formatQty(value) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : 0
}

// 物料名称归一化：忽略空格/下划线差异，用于跨系统（如入库数据与工单数据）名称匹配
export function normalizeMaterialName(name) {
  return String(name ?? '').replace(/[\s_]/g, '').toLowerCase()
}

// 让用户直观看到文件大小 —— 内嵌单据图片的 Excel 可达十几 MB，是上传慢的主因
export function formatFileSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// 按别名顺序取第一个存在的字段值（后端字段名有出入时容错）
export function pickField(item, aliases) {
  for (const alias of aliases) {
    const value = item?.[alias]
    if (value !== undefined && value !== null) {
      return value
    }
  }
  return ''
}
