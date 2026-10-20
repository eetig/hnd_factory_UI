/**
 * 资料归档的列定义（变更-126）。
 *
 * <p>沿用 `usePurchaseColumns.js` 定下的两条规矩：
 * <ol>
 *   <li><b>只许一列自适应</b>：`table-fixed` + 每列固定宽 + `w-full` 时，浏览器会把
 *       剩余宽度按比例摊给所有列，数字列右对齐、左边一片空白（变更-111 / 112 踩过两次）。</li>
 *   <li><b>宽度预算先算再写</b>：1280 视口下不横滚是硬要求。</li>
 * </ol>
 *
 * <p>宽度预算（9 列）：
 * 序号 56 + 分类 110 + 有效期 132 + 到期 72 + 原件位置 150 + 责任人 84 + 文件 88 + 操作 88
 * = **780px 固定**，剩下的全部给「资料名称」（唯一自适应列）⇒ 1280 视口下名称还有 ~500px，
 * 够看清一份资料叫什么。
 */
export const ARCHIVE_COLUMNS = [
  { key: 'index', label: '序号', width: 'w-[56px]' },
  { key: 'name', label: '资料名称' },
  { key: 'categoryName', label: '分类', width: 'w-[110px]' },
  { key: 'expireDate', label: '有效期至', width: 'w-[132px]' },
  { key: 'daysToExpire', label: '到期', width: 'w-[72px]', align: 'right' },
  { key: 'originPlace', label: '原件在哪', width: 'w-[150px]' },
  { key: 'owner', label: '责任人', width: 'w-[84px]' },
  { key: 'file', label: '文件', width: 'w-[88px]' },
  { key: 'actions', label: '操作', width: 'w-[88px]' },
]

/**
 * 到期文案与色调（`daysToExpire` 由后端算）。
 *
 * <p>三档：已过期（红）/ 30 天内（琥珀）/ 正常（灰）；无有效期显示「—」。
 * ⚠️ 色阶只用 Tailwind 的既有档位，不新增自定义色 —— 护栏会拦（见 visualTokens.spec）。
 */
export function expireBadge(days) {
  if (days === null || days === undefined) {
    return { text: '—', className: 'text-slate-500' }
  }
  if (days < 0) {
    return { text: `已过期 ${Math.abs(days)} 天`, className: 'text-rose-600 font-medium' }
  }
  if (days === 0) {
    return { text: '今天到期', className: 'text-rose-600 font-medium' }
  }
  if (days <= 30) {
    return { text: `${days} 天`, className: 'text-amber-600 font-medium' }
  }
  return { text: `${days} 天`, className: 'text-slate-500' }
}

/** 文件大小：KB/MB 两位有效；0 表示没有电子件 */
export function fileSizeText(bytes) {
  const n = Number(bytes || 0)
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
