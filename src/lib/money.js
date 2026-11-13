// v1.0.109 · ONE source for money facts: the monthly value of a contract / client, invoice month and
// "billed", and the real team cost of a client. Contracts, Clients, Dashboard, Cashflow, Invoices and the
// charts all read these functions, so the same fact shows the same value everywhere.
import { payrollMonth, jobMinutes, jobPay, perJobWorkerPay, spotExtra, yenAmount } from './salaryCalc.js'

const pct = v => Math.min(100, Math.max(0, Number(v) || 0))

/**
 * Monthly value of one contract BEFORE discount = the SAVED monthly value of the item, never visits × price.
 * v1.0.256 · fixed monthly → fixed_monthly (else the saved monthly_revenue); per visit → the saved
 * monthly_revenue. A per-visit/deep item saved with monthly_revenue ¥0 still generates jobs and is billed per
 * execution (price_per_visit, see invoiceAutomation.js) — it just does not count in the contract's monthly total.
 */
export function contractGross(c) {
  if (!c) return 0
  const saved = c.monthly_revenue == null || c.monthly_revenue === '' ? 0 : yenAmount(c.monthly_revenue)
  if (c.billing_type === 'fixed_monthly') return yenAmount(c.fixed_monthly) || saved
  return saved
}

/**
 * v1.0.256 · a scheduled per-visit item saved with ¥0/month is OPERATIONAL: it generates and records the jobs
 * (e.g. the Deep Clean of a store), but its value is already inside the store's fixed monthly amount — out of the
 * monthly total and never billed on its own. An on-demand item (no visits planned) with ¥0 stays billed per execution.
 */
export function isEmbeddedItem(c) {
  if (!c || c.billing_type === 'fixed_monthly') return false
  const saved = c.monthly_revenue == null || c.monthly_revenue === '' ? null : yenAmount(c.monthly_revenue)
  return saved === 0 && Number(c.visits_per_month || 0) > 0
}

/** v1.0.256 · how many monthly units an item counts as: 1 each; floor cleaning with the POLISHER counts 4 (4×/month). */
export const itemUnits = c => (/polidora|polisher|ポリッシャー/i.test(`${c?.service_type || ''} ${c?.location_name || ''}`) ? 4 : 1)

const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
/**
 * v1.0.256 · visits of one item in a given month ('YYYY-MM'): a weekly item counts its weekdays in that month
 * (a 7-day store has 30 visits in a 30-day month and 31 in a 31-day month); an item done N times a month
 * (fewer visits than weekdays, e.g. deep 2×/month) keeps its N.
 */
export function visitsInMonth(c, month) {
  const planned = Number(c?.visits_per_month || 0)
  const days = (c?.days_of_week || []).map(d => DOW[String(d).slice(0, 3)]).filter(d => d !== undefined)
  if (!days.length || !/^\d{4}-\d{2}$/.test(String(month || ''))) return planned
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  let n = 0
  for (let d = 1; d <= last; d++) if (days.includes(new Date(Date.UTC(y, m - 1, d)).getUTCDay())) n++
  return planned >= 4 * days.length ? n : planned
}

/**
 * v1.0.256 · REFERENCE value of one visit of a store in a month = store fixed ÷ visits of that month. It only
 * serves the adjustment when a service is not done (fixed ÷ planned visits × visits not done); it never changes
 * the fixed amount. Visits come from the store's main item (the one carrying the value).
 */
export function storeVisitReference(group, month) {
  const active = (group?.items || []).filter(c => c.is_active !== false && contractGross(c) > 0)
  const main = active.sort((a, b) => contractGross(b) - contractGross(a))[0]
  const visits = main ? visitsInMonth(main, month) : 0
  const fixed = Number(group?.monthly || 0)
  return { fixed, visits, perVisit: visits > 0 ? Math.round(fixed / visits) : 0 }
}

/** Monthly value of one contract AFTER its discount — what is billed and what every screen shows. */
export function contractMonthly(c) {
  const gross = contractGross(c)
  return Math.round(gross * (1 - pct(c?.discount_percent) / 100))
}

/** Problems that inflate visits / hours or make the monthly value wrong.
 * v1.0.256 · no more 'stored_mismatch' (saved total ≠ visits × price): the saved total IS the monthly value. */
export function contractIssues(c) {
  const issues = []
  const visits = Number(c?.visits_per_month || 0)
  if (c?.billing_type !== 'fixed_monthly' && visits === 0) issues.push('zero_visits')
  else if (c?.billing_type === 'fixed_monthly' ? contractGross(c) === 0 : yenAmount(c?.price_per_visit) === 0) issues.push('zero_value')
  if (/^deep\s*clean(ing)?$/i.test(String(c?.service_type || '').trim()) && yenAmount(c?.price_per_visit) === 5000 && !c?.billing_notes) issues.push('generic_deep')
  return issues
}

/** Store name of a contract location: "Kodama Yurakucho — Deep" → "Kodama Yurakucho". */
export const storeOf = name => String(name || '').split(/\s+[-—–]\s+/)[0].trim() || '—'

/** Contracts grouped by store, each store with its sub-items and one monthly total. */
export function groupByStore(contracts) {
  const map = new Map()
  for (const c of contracts || []) {
    const key = storeOf(c.location_name)
    const s = map.get(key) || { store: key, items: [], monthly: 0, visits: 0, hours: 0, units: 0 }
    s.items.push(c)
    s.units += itemUnits(c)
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
/** v1.0.133 · receivable and past its due date (or marked overdue) — the Cashflow "Vencido" list. */
export const isOverdueInvoice = (f, today) => isReceivable(f) && (f.status === 'overdue' || (!!f.due_date && f.due_date < today))
export const billedInMonth = (faturas, month) => (faturas || []).filter(f => isBilled(f) && invoiceMonth(f) === month).reduce((s, f) => s + Number(f.total || 0), 0)

// ── Team cost ───────────────────────────────────────────────────────────────
/**
 * Real team cost per client for one month. v1.0.133 · each completed job costs what the person who did it
 * earns for THAT job, never a minute-share of someone else's work:
 *  - "Pagamento do funcionário" of the job (employee_pay) when it is set;
 *  - per-job pay: the job's own pay (value × rate);
 *  - hourly: hours × hourly rate;
 *  - fixed salary: the month's fixed salary spread over that person's jobs by minutes;
 *  + the spot extra. A job whose cost cannot be known (no pay rule at all) leaves the client cost unknown
 * (null → margin "—"), so a margin is never 100% because the cost is missing.
 * `jobs`: completed jobs of the month (all clients). Returns { [clientId]: yen | null }.
 */
export function teamCostByClient({ jobs = [], employees = [], month }) {
  const out = {}
  const unknown = new Set()
  const byEmp = new Map()
  for (const j of jobs) {
    if (j.status !== 'completed') continue
    if (!j.employee_id) { if (j.client_id) unknown.add(j.client_id); continue }
    if (!byEmp.has(j.employee_id)) byEmp.set(j.employee_id, [])
    byEmp.get(j.employee_id).push(j)
  }
  for (const [empId, list] of byEmp) {
    const emp = employees.find(e => e.id === empId)
    if (!emp) { list.forEach(j => j.client_id && unknown.add(j.client_id)); continue }
    const calc = payrollMonth({ emp, jobs: list, month })
    const used = calc.basis || calc.autoBasis
    const type = emp.salary_type
    const minutes = list.reduce((s, j) => s + jobMinutes(j), 0) || 1
    for (const j of list) {
      if (!j.client_id) continue
      const own = j.employee_pay === null || j.employee_pay === undefined || j.employee_pay === '' ? null : Number(j.employee_pay)
      let cost
      if (own !== null && Number.isFinite(own)) cost = own
      else if (used === 'fixed' || type === 'fixed' || type === 'mixed') cost = Math.round(calc.base * jobMinutes(j) / minutes)
      // v1.0.214 · no employee_pay → cost unknown ('a definir'), never 100% of the client price
      else if (type === 'per_job') cost = perJobWorkerPay(j, emp.job_bonus_rate)
      else if (type === 'hourly') cost = Math.round(jobMinutes(j) / 60 * yenAmount(emp.hourly_rate))
      else cost = 0
      const extra = spotExtra(j)
      if (!cost && !extra) { unknown.add(j.client_id); continue }
      out[j.client_id] = (out[j.client_id] || 0) + cost + extra
    }
  }
  for (const id of unknown) out[id] = null
  return out
}

/** Margin in %, or null when the cost is unknown (never "100%" because the cost is missing). */
export function marginPct(revenue, cost) {
  if (cost == null || !revenue) return null
  return Math.round((revenue - cost) / revenue * 100)
}
