// v1.0.109 · ONE source for money facts: the monthly value of a contract / client, invoice month and
// "billed", and the real team cost of a client. Contracts, Clients, Dashboard, Cashflow, Invoices and the
// charts all read these functions, so the same fact shows the same value everywhere.
import { payrollMonth, jobMinutes, spotExtra, yenAmount } from './salaryCalc.js'

const pct = v => Math.min(100, Math.max(0, Number(v) || 0))

/** Monthly value of one contract BEFORE discount: fixed amount, else visits × price per visit. */
export function contractGross(c) {
  if (!c) return 0
  if (c.billing_type === 'fixed_monthly') return yenAmount(c.fixed_monthly)
  return Math.round(Number(c.visits_per_month || 0) * yenAmount(c.price_per_visit))
}

/** Monthly value of one contract AFTER its discount — what is billed and what every screen shows. */
export function contractMonthly(c) {
  const gross = contractGross(c)
  return Math.round(gross * (1 - pct(c?.discount_percent) / 100))
}

/** Problems that inflate visits / hours or make the monthly value wrong. */
export function contractIssues(c) {
  const issues = []
  const gross = contractGross(c)
  const visits = Number(c?.visits_per_month || 0)
  if (c?.billing_type !== 'fixed_monthly' && visits === 0) issues.push('zero_visits')
  else if (gross === 0) issues.push('zero_value')
  if (/^deep\s*clean(ing)?$/i.test(String(c?.service_type || '').trim()) && yenAmount(c?.price_per_visit) === 5000 && !c?.billing_notes) issues.push('generic_deep')
  const stored = c?.monthly_revenue
  if (stored != null && stored !== '' && Math.round(Number(stored)) !== gross) issues.push('stored_mismatch')
  return issues
}

/** Store name of a contract location: "Kodama Yurakucho — Deep" → "Kodama Yurakucho". */
export const storeOf = name => String(name || '').split(/\s+[-—–]\s+/)[0].trim() || '—'

/** Contracts grouped by store, each store with its sub-items and one monthly total. */
export function groupByStore(contracts) {
  const map = new Map()
  for (const c of contracts || []) {
    const key = storeOf(c.location_name)
    const s = map.get(key) || { store: key, items: [], monthly: 0, visits: 0, hours: 0 }
    s.items.push(c)
    if (c.is_active !== false) {
      s.monthly += contractMonthly(c)
      s.visits += Number(c.visits_per_month || 0)
      s.hours += Number(c.visits_per_month || 0) * Number(c.hours_per_visit || 0)
    }
    map.set(key, s)
  }
  return [...map.values()].sort((a, b) => a.store.localeCompare(b.store))
}

/** clientId → monthly value of its active contracts. */
export function monthlyByClient(contracts) {
  const out = {}
  for (const c of contracts || []) {
    if (c.is_active === false || !c.client_id) continue
    out[c.client_id] = (out[c.client_id] || 0) + contractMonthly(c)
  }
  return out
}

// ── Invoices ────────────────────────────────────────────────────────────────
/** Month an invoice belongs to: the billed period, else its issue date. */
export const invoiceMonth = f => String(f?.period_start || f?.issue_date || '').slice(0, 7)
/** A draft or cancelled invoice is not billing. */
export const isBilled = f => !!f && f.status !== 'draft' && f.status !== 'cancelled'
export const isReceivable = f => !!f && ['sent', 'pending', 'overdue'].includes(f.status)
export const billedInMonth = (faturas, month) => (faturas || []).filter(f => isBilled(f) && invoiceMonth(f) === month).reduce((s, f) => s + Number(f.total || 0), 0)

// ── Team cost ───────────────────────────────────────────────────────────────
/**
 * Real team cost per client for one month: each person's month pay (payrollMonth base) is spread over
 * the completed jobs of that month by minutes, plus the spot extra of each job.
 * `jobs`: completed jobs of the month (all clients). Returns { [clientId]: yen }.
 */
export function teamCostByClient({ jobs = [], employees = [], month }) {
  const out = {}
  const byEmp = new Map()
  for (const j of jobs) {
    if (j.status !== 'completed' || !j.employee_id) continue
    if (!byEmp.has(j.employee_id)) byEmp.set(j.employee_id, [])
    byEmp.get(j.employee_id).push(j)
  }
  for (const [empId, list] of byEmp) {
    const emp = employees.find(e => e.id === empId)
    if (!emp) continue
    const { base } = payrollMonth({ emp, jobs: list, month })
    const minutes = list.reduce((s, j) => s + jobMinutes(j), 0) || 1
    for (const j of list) {
      if (!j.client_id) continue
      const share = Math.round(base * jobMinutes(j) / minutes) + spotExtra(j)
      out[j.client_id] = (out[j.client_id] || 0) + share
    }
  }
  return out
}

/** Margin in %, or null when the cost is unknown (never "100%" because the cost is missing). */
export function marginPct(revenue, cost) {
  if (cost == null || !revenue) return null
  return Math.round((revenue - cost) / revenue * 100)
}
