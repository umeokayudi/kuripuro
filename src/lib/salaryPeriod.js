import { tokyoToday, tokyoYearMonth, monthBounds } from './dates'

export function getPeriodDates(period) {
  const { to } = monthBounds(period)
  const [y, m] = String(period || '').split('-').map(Number)
  const nextM = m === 12 ? 1 : m + 1
  const nextY = m === 12 ? y + 1 : y
  const confirmDeadline = `${nextY}-${String(nextM).padStart(2, '0')}-05`
  const payDate = `${nextY}-${String(nextM).padStart(2, '0')}-15`
  return { period, closeDate: to, confirmDeadline, payDate }
}

export function getCurrentPeriod() {
  return tokyoYearMonth()
}

export function shiftYearMonth(period, deltaMonths) {
  const [y, m] = String(period || tokyoYearMonth()).split('-').map(Number)
  const d = new Date(y, m - 1 + deltaMonths, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function recentYearMonths(count = 6) {
  const out = []
  const current = tokyoYearMonth()
  for (let i = 0; i < count; i++) out.push(shiftYearMonth(current, -i))
  return out
}

/** Period awaiting employee confirmation (previous month until day 5) */
export function getConfirmablePeriod() {
  const today = tokyoToday()
  const day = parseInt(today.slice(8, 10), 10)
  const current = today.slice(0, 7)
  if (day <= 5) return shiftYearMonth(current, -1)
  return current
}

export function canConfirmPeriod(period) {
  const { confirmDeadline } = getPeriodDates(period)
  return tokyoToday() <= confirmDeadline
}

export function fmtPeriod(period, lang = 'en') {
  const [y, m] = String(period || '').split('-')
  const monthNum = parseInt(m, 10)
  if (!y || !monthNum) return period || ''
  if (lang === 'ja') return `${y}年${monthNum}月`
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[monthNum - 1]} ${y}`
}
