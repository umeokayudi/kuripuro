import { tokyoToday } from './dates'

export const PERIOD_PRESETS = ['thisMonth', 'lastMonth', 'm3', 'm6', 'm9', 'm12', 'custom']

export function addTokyoDays(iso, days) {
  const [y, m, d] = String(iso).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

export function monthStart(iso) {
  return `${String(iso).slice(0, 7)}-01`
}

export function monthEnd(iso) {
  const [y, m] = String(iso).slice(0, 7).split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${String(iso).slice(0, 7)}-${String(last).padStart(2, '0')}`
}

export function shiftMonth(iso, delta) {
  const [y, m] = String(iso).slice(0, 7).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-01`
}

export function dateInRange(value, start, end) {
  const d = String(value || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
  return d >= start && d <= end
}

export function pickDate(row, fields) {
  for (const f of fields) {
    const v = String(row?.[f] || '').slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  }
  return ''
}

export function filterByPeriod(rows, start, end, fields) {
  return (rows || []).filter(row => dateInRange(pickDate(row, fields), start, end))
}

/** Keep open/pending rows even if they fall outside the selected window. */
export function filterByPeriodKeepOpen(rows, start, end, fields, isOpen) {
  return (rows || []).filter(row => {
    if (typeof isOpen === 'function' && isOpen(row)) return true
    return dateInRange(pickDate(row, fields), start, end)
  })
}

export function invoiceDate(row) {
  return pickDate(row, ['issue_date', 'period_start', 'created_at'])
}

/** Monday of the ISO week containing `iso` (Tokyo calendar date). */
export function isoWeekStart(iso) {
  const [y, m, d] = String(iso).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const dow = dt.getUTCDay()
  const back = dow === 0 ? 6 : dow - 1
  return addTokyoDays(iso, -back)
}

export const REPORT_PRESETS = ['today', 'thisWeek', 'thisMonth', 'lastMonth', 'm3', 'm6', 'm12', 'custom']

export function rangeForPreset(preset, today = tokyoToday()) {
  if (preset === 'today') return { preset, start: today, end: today }
  if (preset === 'thisWeek') return { preset, start: isoWeekStart(today), end: today }
  if (preset === 'lastMonth') {
    const prev = shiftMonth(today, -1)
    return { preset, start: monthStart(prev), end: monthEnd(prev) }
  }
  if (preset === 'm3' || preset === 'm6' || preset === 'm9' || preset === 'm12') {
    const n = Number(preset.slice(1))
    return { preset, start: monthStart(shiftMonth(today, -(n - 1))), end: today }
  }
  return { preset: 'thisMonth', start: monthStart(today), end: today }
}

export function previousEqualRange({ start, end }) {
  const days = Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000) + 1
  const prevEnd = addTokyoDays(start, -1)
  const prevStart = addTokyoDays(start, -days)
  return { start: prevStart, end: prevEnd }
}

export function rollingWindow(months, today = tokyoToday()) {
  const current = { start: monthStart(shiftMonth(today, -(months - 1))), end: today }
  const prevEnd = addTokyoDays(current.start, -1)
  const prevStart = monthStart(shiftMonth(current.start, -months))
  return { months, current, previous: { start: prevStart, end: prevEnd } }
}

export function growthPct(current, previous) {
  const c = Number(current) || 0
  const p = Number(previous) || 0
  if (p === 0) return c === 0 ? 0 : 100
  return Math.round(((c - p) / p) * 1000) / 10
}

export function sumInvoices(rows, start, end, statuses) {
  return (rows || []).reduce((s, row) => {
    if (statuses && !statuses.includes(row.status)) return s
    if (!dateInRange(invoiceDate(row), start, end)) return s
    return s + Number(row.total || 0)
  }, 0)
}

export function monthBuckets(rows, months = 12, today = tokyoToday()) {
  const out = []
  for (let i = months - 1; i >= 0; i--) {
    const start = monthStart(shiftMonth(today, -i))
    const end = i === 0 ? today : monthEnd(start)
    const ym = start.slice(0, 7)
    const billed = sumInvoices(rows, start, end, ['sent', 'paid'])
    const received = sumInvoices(rows, start, end, ['paid'])
    out.push({ ym, start, end, billed, received })
  }
  return out
}

export function growthWindows(rows, today = tokyoToday()) {
  return [3, 6, 9, 12].map(months => {
    const w = rollingWindow(months, today)
    const billed = sumInvoices(rows, w.current.start, w.current.end, ['sent', 'paid'])
    const billedPrev = sumInvoices(rows, w.previous.start, w.previous.end, ['sent', 'paid'])
    const received = sumInvoices(rows, w.current.start, w.current.end, ['paid'])
    const receivedPrev = sumInvoices(rows, w.previous.start, w.previous.end, ['paid'])
    return {
      months,
      ...w,
      billed,
      billedPrev,
      billedGrowth: growthPct(billed, billedPrev),
      received,
      receivedPrev,
      receivedGrowth: growthPct(received, receivedPrev),
    }
  })
}
