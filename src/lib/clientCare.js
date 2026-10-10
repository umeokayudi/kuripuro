import { parseDeepComponents, isDeepCleanJob } from './cleaningType'
import { locationFromJob } from './clientPortal'

// Items we track per store, with how often each should be done by default.
export const MAINTENANCE_ITEMS = [
  { key: 'grease_trap', days: 30, en: 'Grease trap', ja: 'グリストラップ', pt: 'Caixa de gordura' },
  { key: 'range_hood', days: 90, en: 'Range hood / exhaust', ja: 'レンジフード・排気', pt: 'Coifa / exaustão' },
  { key: 'ac', days: 180, en: 'AC cleaning', ja: 'エアコン清掃', pt: 'Ar-condicionado' },
  { key: 'grating', days: 60, en: 'Grating', ja: 'グレーティング', pt: 'Grelhas do piso' },
  { key: 'stove', days: 60, en: 'Stove', ja: 'コンロ', pt: 'Fogão' },
  { key: 'deep_clean', days: 90, en: 'Full deep cleaning', ja: '全体の深層清掃', pt: 'Limpeza profunda geral' },
]

export const QUOTE_CATEGORIES = ['deep_clean', 'grease_trap', 'range_hood', 'ac', 'grating', 'floor', 'windows', 'other']

export const LOCATION_FIELDS = [
  { key: 'area_m2', type: 'number', unit: 'm²' },
  { key: 'seats', type: 'number' },
  { key: 'ac_units', type: 'number' },
  { key: 'exhaust_fans', type: 'number' },
  { key: 'range_hoods', type: 'number' },
  { key: 'grease_trap_count', type: 'number' },
  { key: 'grease_trap_size', type: 'text' },
  { key: 'bathrooms', type: 'number' },
  { key: 'opening_hours', type: 'text' },
  { key: 'access_notes', type: 'text' },
]

const DAY = 86400000
export const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / DAY)
export const addDays = (iso, n) => new Date(new Date(iso + 'T12:00:00Z').getTime() + n * DAY).toISOString().slice(0, 10)

// Latest completed date for each item at a store, read from deep-clean jobs.
export function lastDoneFromJobs(jobs, locationName) {
  const out = {}
  for (const j of jobs || []) {
    if (j.status !== 'completed' || !j.scheduled_date) continue
    if (locationName && locationFromJob(j) !== locationName) continue
    if (!isDeepCleanJob(j)) continue
    const items = [...parseDeepComponents(j).filter(k => k !== 'other'), 'deep_clean']
    for (const key of items) if (!out[key] || j.scheduled_date > out[key]) out[key] = j.scheduled_date
  }
  return out
}

// One row per tracked item: when it was last done, when it is due and how urgent it is.
export function maintenanceRows({ jobs, locationName, records, today }) {
  const fromJobs = lastDoneFromJobs(jobs, locationName)
  return MAINTENANCE_ITEMS.map(item => {
    const rec = (records || []).find(r => r.location_name === locationName && r.item_key === item.key)
    const candidates = [fromJobs[item.key], rec?.last_done].filter(Boolean).sort()
    const lastDone = candidates[candidates.length - 1] || null
    const interval = Number(rec?.interval_days) || item.days
    const nextDue = lastDone ? addDays(lastDone, interval) : null
    const daysLeft = nextDue ? daysBetween(today, nextDue) : null
    const state = !lastDone ? 'unknown' : daysLeft < 0 ? 'overdue' : daysLeft <= 14 ? 'soon' : 'ok'
    return { ...item, record: rec || null, lastDone, interval, nextDue, daysLeft, state }
  })
}

// What the client sees on an invoice.
export function invoiceState(inv, today) {
  if (inv.status === 'paid' || inv.paid_at) return 'paid'
  if (inv.due_date && inv.due_date < today) return 'overdue'
  return 'open'
}

export function billingSummary(invoices, today) {
  let open = 0, overdue = 0, paidThisYear = 0, overdueCount = 0
  let nextDue = null
  const year = today.slice(0, 4)
  for (const inv of invoices || []) {
    const state = invoiceState(inv, today)
    const total = Number(inv.total || 0)
    if (state === 'paid') {
      if ((inv.paid_at || inv.issue_date || '').startsWith(year)) paidThisYear += total
    } else {
      open += total
      if (state === 'overdue') { overdue += total; overdueCount += 1 }
      else if (inv.due_date && (!nextDue || inv.due_date < nextDue.due_date)) nextDue = inv
    }
  }
  const recentlyPaid = (invoices || [])
    .filter(inv => invoiceState(inv, today) === 'paid' && inv.paid_at && daysBetween(inv.paid_at.slice(0, 10), today) <= 14)
    .sort((a, b) => (b.paid_at || '').localeCompare(a.paid_at || ''))[0] || null
  return { open, overdue, overdueCount, paidThisYear, nextDue, recentlyPaid }
}

export const receiptNumber = inv => `R-${(inv.paid_at || inv.issue_date || '').slice(0, 7).replace('-', '')}-${String(inv.id).slice(0, 6).toUpperCase()}`
