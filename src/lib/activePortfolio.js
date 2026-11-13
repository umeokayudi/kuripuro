// v1.0.226 · "Contratos ativos" for the sales team (read only). One list of every client with an active
// recurring contract: locations, monthly value (same contractMonthly() the admin Contracts screen uses),
// term and the next invoice / due date. Built on the server from an explicit column list, so nothing about
// employees (pay, worker_payment in contract_details, salary) can ever reach the seller.
import { contractMonthly, storeOf, isEmbeddedItem } from './money.js'
import { contractStartDate } from './schedulePlan.js'

/** Columns the server reads from service_contracts — commercial facts only. */
export const PORTFOLIO_CONTRACT_COLUMNS = 'id,client_id,location_name,location_address,service_type,billing_type,fixed_monthly,monthly_revenue,price_per_visit,visits_per_month,discount_percent,tax_rate,price_includes_tax,billing_day,days_of_week,created_at,is_active'

const ymd = v => (v ? String(v).slice(0, 10) : '')
const pad = n => String(n).padStart(2, '0')

function lastDayOfMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate() }

/** Monthly invoice for the current month is issued at its end; it is due on `payDay` of the next month. */
export function nextBilling(today, payDay = 10) {
  const [y, m] = ymd(today).split('-').map(Number)
  const issue = `${y}-${pad(m)}-${pad(lastDayOfMonth(y, m))}`
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1 : m + 1
  const day = Math.min(Math.max(1, Number(payDay) || 10), lastDayOfMonth(ny, nm))
  return { invoice: issue, due: `${ny}-${pad(nm)}-${pad(day)}`, period: `${y}-${pad(m)}` }
}

/** Contracts run 1 year from the start and renew automatically each year: end of the current year of term. */
export function termEnd(start, today) {
  if (!start) return ''
  const [sy, sm, sd] = start.split('-').map(Number)
  let years = 1
  const endFor = n => {
    const d = new Date(Date.UTC(sy + n, sm - 1, sd - 1))
    return d.toISOString().slice(0, 10)
  }
  while (endFor(years) < today && years < 50) years += 1
  return endFor(years)
}

/** Clean, read-only row for one location of a contract. */
function locationRow(c) {
  return {
    id: c.id,
    location: c.location_name || '—',
    store: storeOf(c.location_name),
    address: c.location_address || '',
    service: c.service_type || '',
    billing: c.billing_type === 'fixed_monthly' ? 'fixed' : 'per_visit',
    visits: Number(c.visits_per_month || 0),
    perVisit: c.billing_type === 'fixed_monthly' ? 0 : Math.round(Number(c.price_per_visit || 0)),
    monthly: contractMonthly(c),
    embedded: isEmbeddedItem(c), // v1.0.256 · deep inside the store's fixed
    discount: Number(c.discount_percent || 0),
    taxIncluded: c.price_includes_tax !== false,
    days: Array.isArray(c.days_of_week) ? c.days_of_week : [],
  }
}

/**
 * contracts: active service_contracts rows (PORTFOLIO_CONTRACT_COLUMNS + contract_details start only).
 * clients: [{ id, company_name }]. Returns one entry per client, biggest monthly value first.
 */
export function buildPortfolio(contracts, clients, today) {
  const byId = Object.fromEntries((clients || []).map(c => [c.id, c]))
  const map = new Map()
  for (const c of contracts || []) {
    if (c.is_active === false) continue
    const key = c.client_id || `loc:${c.id}`
    const client = byId[c.client_id] || {}
    const g = map.get(key) || { client_id: c.client_id || null, company: client.company_name || storeOf(c.location_name), locations: [], monthly: 0, start: '', payDay: null }
    const row = locationRow(c)
    g.locations.push(row)
    g.monthly += row.monthly
    const start = contractStartDate(c) || ymd(c.created_at)
    if (start && (!g.start || start < g.start)) g.start = start
    if (c.billing_day && !g.payDay) g.payDay = Number(c.billing_day)
    map.set(key, g)
  }
  return [...map.values()].map(g => {
    g.locations.sort((a, b) => b.monthly - a.monthly || a.location.localeCompare(b.location))
    const stores = [...new Set(g.locations.map(l => l.store))]
    const started = !g.start || g.start <= today
    const bill = nextBilling(started ? today : g.start, g.payDay || 10)
    return { ...g, stores, payDay: g.payDay || 10, started, termEnd: termEnd(g.start, today), nextInvoice: bill.invoice, nextDue: bill.due }
  }).sort((a, b) => b.monthly - a.monthly || a.company.localeCompare(b.company))
}

export const portfolioTotal = list => (list || []).reduce((s, g) => s + g.monthly, 0)
