/**
 * Automatic recurring billing rules.
 * Contract is the source of pricing; completed jobs are the source of delivered work.
 */
import { isEmbeddedItem, storeOf } from './money.js'

export function monthBounds(period) {
  const [year, month] = period.split('-').map(Number)
  const start = `${period}-01`
  // Last day as a plain string (a local Date + toISOString gave the day before in Japan time).
  const end = `${period}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`
  return { start, end }
}

export function applyDiscount(amount, discountPercent = 0) {
  const pct = Math.max(0, Math.min(100, Number(discountPercent) || 0))
  const discount = Math.round(Number(amount || 0) * pct / 100)
  return { gross: Math.round(Number(amount || 0)), discount, net: Math.round(Number(amount || 0) - discount) }
}

export function calculateTax(subtotal, taxRate = 10, priceIncludesTax = true) {
  const rate = Math.max(0, Number(taxRate) || 0)
  const base = Math.round(Number(subtotal || 0))
  if (priceIncludesTax) {
    return Math.round(base * rate / (100 + rate))
  }
  return Math.round(base * rate / 100)
}

export function contractBillingAmount(contract, completedJobs = []) {
  // v1.0.256 · operational item (scheduled, saved ¥0/month, e.g. the store's Deep Clean): already inside the
  // store's fixed amount → never billed on its own.
  if (isEmbeddedItem(contract)) return 0
  if (contract.billing_type === 'fixed_monthly') {
    return Math.round(Number(contract.fixed_monthly || 0))
  }

  const locationJobs = completedJobs.filter(job => jobAtLocation(job, contract))

  return locationJobs.reduce((sum, job) => sum + Number(job.value || job.spot_value || contract.price_per_visit || 0), 0)
}

/** Job belongs to this restaurant (title "Loja — serviço" or the job's own location field). */
function jobAtLocation(job, contract) {
  const loc = String(contract.location_name || '').trim()
  if (!loc) return false
  const title = String(job.title || '').split(' — ')[0].trim()
  return title === loc || String(job.location_name || '').trim() === loc
}

/**
 * v1.0.162 · One 請求書 line per restaurant, like the On The Planet invoice:
 *   品名 = restaurant name · 数量 1 · 単価 = that restaurant's value for the month.
 * Fixed monthly → the monthly amount (never sliced per job). Per visit → completed visits × price,
 * still one line (the visit count stays in `visits` for the preview, not on the paper).
 */
export function buildContractLine(contract, completedJobs = []) {
  const amount = contractBillingAmount(contract, completedJobs)
  const pricing = applyDiscount(amount, contract.discount_percent)
  if (!pricing.net && !amount) return null

  const locationJobs = completedJobs.filter(job => jobAtLocation(job, contract))
  const fixed = contract.billing_type === 'fixed_monthly'
  const restaurant = String(contract.location_name || '').trim() || String(contract.service_type || '').trim()

  return {
    description: restaurant,
    restaurant,
    monthly: fixed,
    visits: locationJobs.length,
    price_per_visit: fixed ? null : Number(contract.price_per_visit || 0),
    quantity: 1,
    unit_price: pricing.net,
    total: pricing.net,
    gross: pricing.gross,
    discount_amount: pricing.discount,
    discount_percent: Number(contract.discount_percent || 0),
    contract_id: contract.id,
    job_ids: locationJobs.map(job => job.id),
  }
}

/**
 * v1.0.256 · ONE 請求書 line per STORE (not per item): a store's items ("Kodama Kinshicho", "Kodama Kinshicho -
 * Deep Clean") are summed into one line named after the store. Operational items add ¥0, so the line is the
 * store's fixed amount (¥120.000 / ¥100.000 / …), with no separate deep line.
 */
export function buildStoreLines(contracts = [], completedJobs = []) {
  const byStore = new Map()
  for (const c of contracts) {
    const line = buildContractLine(c, completedJobs)
    if (!line) continue
    const store = storeOf(line.restaurant)
    const cur = byStore.get(store)
    if (!cur) { byStore.set(store, { ...line, description: store, restaurant: store, contract_ids: [line.contract_id] }); continue }
    cur.unit_price += line.unit_price
    cur.total += line.total
    cur.gross += line.gross
    cur.discount_amount += line.discount_amount
    cur.visits += line.visits
    cur.monthly = cur.monthly && line.monthly
    cur.price_per_visit = cur.monthly ? null : cur.price_per_visit
    cur.job_ids = [...new Set([...cur.job_ids, ...line.job_ids])]
    cur.contract_ids.push(line.contract_id)
  }
  return [...byStore.values()]
}

/**
 * Totals of a monthly invoice. taxMode 'excl' = values are 税抜 (小計 + 消費税 = 合計, as in the
 * On The Planet 請求書); 'incl' = values already include tax (合計 = sum, うち消費税).
 */
export function monthlyTotals(lines, taxRate = 10, taxMode = 'excl') {
  const sum = lines.reduce((s, l) => s + Math.round(Number(l.total || 0)), 0)
  const includes = taxMode === 'incl'
  const tax = calculateTax(sum, taxRate, includes)
  return includes
    ? { subtotal: sum - tax, tax, total: sum, includesTax: true }
    : { subtotal: sum, tax, total: sum + tax, includesTax: false }
}

/** "10月分清掃" for a billing period that is one whole month (件名 of the 請求書). */
export function monthlySubject(periodStart, periodEnd, lang = 'ja') {
  const a = String(periodStart || ''), b = String(periodEnd || '')
  if (!/^\d{4}-\d{2}-01$/.test(a)) return ''
  // whole calendar month only (a one-day spot invoice keeps no 件名)
  if (b !== monthBounds(a.slice(0, 7)).end) return ''
  const m = Number(a.slice(5, 7))
  if (lang === 'en') return `Cleaning for ${new Date(Date.UTC(2000, m - 1, 1)).toLocaleString('en', { month: 'long', timeZone: 'UTC' })}`
  return `${m}月分清掃`
}
