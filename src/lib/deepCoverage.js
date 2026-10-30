// v1.0.104 · Deep & Spot: "does every restaurant get its deep cleanings?"
// Pure helpers (no database), shared by Jobs → Deep & Spot, World (Items) and the Client Report:
//   - deepTargets: what each active contract asks for (Deep Clean + periodic items such as Grease Trap 2×/month)
//   - expectedSlots: the days a target is expected in a period (contract weekdays, spread over the month)
//   - deepCoverage: expected × scheduled × done per restaurant + the MISSING list (with reason)
//   - deepStatusByPlace: last done / next scheduled / next expected per restaurant
//   - spotOrigin / spotOfferState: where a spot came from and where its offer stands
import { getCleaningType } from './cleaningType.js'
import { contractTargets, splitName, dowOf, monthDays } from './schedulePlan.js'
import { MAINTENANCE_SERVICES } from './serviceCatalog.js'

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
const isBasic = text => /basic/i.test(text || '')

// Item names written in different ways in job titles (EN / PT / JA).
const ITEM_ALIASES = [
  { key: 'grease trap', re: /grease\s*trap|caixa de gordura|グリストラップ/i },
  { key: 'ac', re: /\bac\b|air\s*con|ar-condicionado|エアコン/i },
  { key: 'range hood', re: /range\s*hood|coifa|レンジフード/i },
  { key: 'stove', re: /stove|fog[aã]o|コンロ/i },
  { key: 'grill', re: /grill|grelha(?! de piso)/i },
  { key: 'grating', re: /grating|grelhas de piso|グレーティング/i },
  { key: 'floor wax', re: /floor\s*wax|cera|ワックス/i },
]
const itemKeyOf = keyword => ITEM_ALIASES.find(a => a.re.test(keyword))?.key || norm(keyword)
const itemRe = key => ITEM_ALIASES.find(a => a.key === key)?.re || null

/** Is this job deep / periodic work (not a Basic Cleaning)? Spots are told apart by job_category. */
export function isDeepWork(job) {
  if (!job || job.job_category === 'spot') return false
  if (job.job_category === 'maintenance' || getCleaningType(job) === 'deep') return true
  const { rest } = splitName(job.title)
  return !!rest && !isBasic(rest)
}

/** 'deep' | 'spot' | null — the type shown on every line of the Deep & Spot screen. */
export function deepSpotType(job) {
  if (job?.job_category === 'spot') return 'spot'
  return isDeepWork(job) ? 'deep' : null
}

/** "2x por mês" → { perMonth: 2 }, "3x por ano" → { perYear: 3 }, otherwise null. */
export function parsePeriodicity(text) {
  const m = /(\d+)\s*x\s*(?:por|\/|per|a)?\s*(m[eê]s|month|mo|ano|year|yr)/i.exec(String(text || ''))
  if (!m) return null
  const n = Number(m[1])
  return /ano|year|yr/i.test(m[2]) ? { perYear: n } : { perMonth: n }
}

/** Periodicity of an item from the service catalog (Grease Trap 2×/month, Floor Wax 3×/year …). */
export function catalogPeriodicity(keyword) {
  const key = itemKeyOf(keyword)
  const row = MAINTENANCE_SERVICES.find(s => itemKeyOf(s.serviceType) === key)
  return row ? parsePeriodicity(row.frequency) : null
}

/**
 * Deep targets of the active contracts: one per restaurant + item ("deep" = the Deep Clean itself).
 * Frequency = visits_per_month of the contract, else the catalog periodicity of the item, else 1×/month.
 * Generic rows without days and without visits (the "OTP — Grease Trap" price list) are skipped.
 * Two contracts for the same restaurant + item are merged (the one with the highest frequency wins).
 */
export function deepTargets(contracts, clients = []) {
  const byId = Object.fromEntries((contracts || []).map(c => [c.id, c]))
  const out = new Map()
  for (const t of contractTargets(contracts, clients)) {
    if (t.kind === 'weekly' || isBasic(t.keyword) || isBasic(t.service)) continue
    const c = byId[t.id] || {}
    const visits = Number(c.visits_per_month) || 0
    if (t.kind === 'nodays' && !visits) continue
    const item = t.keyword ? itemKeyOf(t.keyword) : 'deep'
    const freq = visits ? { perMonth: visits } : (t.keyword && catalogPeriodicity(t.keyword)) || { perMonth: 1 }
    const key = `${norm(t.base)}|${item}`
    const prev = out.get(key)
    if (prev) {
      // The contract asking for more visits wins (with its weekdays).
      if ((freq.perMonth || 0) > (prev.perMonth || 0)) Object.assign(prev, { perMonth: freq.perMonth, perYear: null, days: [...t.days] })
      prev.contractIds.push(t.id)
      if (prev.price == null && t.price != null) prev.price = t.price
      continue
    }
    out.set(key, {
      key, base: t.base, item, service: item === 'deep' ? 'Deep Clean' : t.keyword,
      clientId: t.clientId, clientName: t.clientName, address: t.address, price: t.price,
      days: [...t.days], perMonth: freq.perMonth || null, perYear: freq.perYear || null, contractIds: [t.id],
    })
  }
  return [...out.values()].sort((a, b) => a.clientName.localeCompare(b.clientName) || a.base.localeCompare(b.base) || (a.item === 'deep' ? -1 : b.item === 'deep' ? 1 : a.item.localeCompare(b.item)))
}

/** Does this job count for this target? Deep target: the "Deep Clean" jobs. Item target: jobs naming the item. */
export function jobCountsFor(job, target) {
  if (!job || job.job_category === 'spot') return false
  const { base, rest } = splitName(job.title)
  if (norm(base) !== norm(target.base)) return false
  if (!rest || isBasic(rest)) return false
  if (target.item === 'deep') return /deep|pesada|profunda|深層/i.test(rest) || job.job_category === 'maintenance' && !ITEM_ALIASES.some(a => a.re.test(rest))
  const re = itemRe(target.item)
  return re ? re.test(rest) : norm(rest).includes(target.item)
}

function monthsBetween(from, to) {
  const out = []
  let m = from.slice(0, 7)
  while (m <= to.slice(0, 7)) {
    out.push(m)
    const [y, mo] = m.split('-').map(Number)
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
  }
  return out
}

/** How many visits a target needs in a month (perYear spreads over the year: 3×/year → Jan, May, Sep). */
export function visitsInMonth(target, month) {
  if (target.perMonth) return target.perMonth
  if (target.perYear) {
    const mo = Number(month.slice(5, 7)) - 1
    const picks = Array.from({ length: target.perYear }, (_, i) => Math.floor((i * 12) / target.perYear))
    return picks.includes(mo) ? 1 : 0
  }
  return 1
}

/**
 * The days a target is expected inside [from, to]: per month, its N visits spread evenly over the
 * contract weekdays (2×/month on Mondays → 1st and 3rd Monday). No weekdays = any day of the month.
 */
export function expectedSlots(target, from, to) {
  const slots = []
  for (const month of monthsBetween(from, to)) {
    const n = visitsInMonth(target, month)
    if (!n) continue
    const all = monthDays(month)
    const cand = target.days?.length ? all.filter(d => target.days.includes(dowOf(d))) : all
    if (!cand.length) continue
    const take = Math.min(n, cand.length)
    const picks = [...new Set(Array.from({ length: take }, (_, i) => cand[Math.floor((i * cand.length) / take)]))]
    for (const d of picks) if (d >= from && d <= to) slots.push(d)
  }
  return slots
}

const dayDiff = (a, b) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000

/**
 * Coverage of the deep targets in [from, to] by `jobs` (cancelled ones ignored).
 * Each job is paired with the nearest expected day of its target; the days left over are MISSING.
 * @returns {{ places: Array, missing: Array, totals: {expected, scheduled, done, missing} }}
 *   places[]: { base, clientId, clientName, expected, scheduled, done, ok, items: [{ target, expected, scheduled, done }] }
 *   missing[]: { target, date, reason: 'notCreated' | 'passed' | 'notDone', job? }
 */
export function deepCoverage(targets, jobs, { from, to, today }) {
  const live = (jobs || []).filter(j => j.status !== 'cancelled' && j.scheduled_date >= from && j.scheduled_date <= to)
  const places = new Map()
  const missing = []
  for (const t of targets || []) {
    const slots = expectedSlots(t, from, to)
    const mine = live.filter(j => jobCountsFor(j, t)).sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
    const free = [...slots]
    for (const j of mine) {
      if (!free.length) break
      let best = 0
      for (let i = 1; i < free.length; i++) if (dayDiff(free[i], j.scheduled_date) < dayDiff(free[best], j.scheduled_date)) best = i
      free.splice(best, 1)
    }
    for (const d of free) missing.push({ target: t, date: d, reason: d < today ? 'passed' : 'notCreated' })
    for (const j of mine) if (j.status !== 'completed' && j.scheduled_date < today) missing.push({ target: t, date: j.scheduled_date, reason: 'notDone', job: j })
    const done = mine.filter(j => j.status === 'completed').length
    const pk = norm(t.base)
    const p = places.get(pk) || { base: t.base, clientId: t.clientId, clientName: t.clientName, expected: 0, scheduled: 0, done: 0, items: [] }
    if (!slots.length && !mine.length) { if (!places.has(pk)) places.set(pk, p); continue }
    p.items.push({ target: t, expected: slots.length, scheduled: mine.length, done })
    p.expected += slots.length
    p.scheduled += Math.min(mine.length, slots.length)
    p.done += Math.min(done, slots.length)
    places.set(pk, p)
  }
  const list = [...places.values()]
    .map(p => ({ ...p, ok: p.scheduled >= p.expected }))
    .filter(p => p.expected > 0 || p.items.length)
  const order = { notDone: 0, passed: 1, notCreated: 2 }
  missing.sort((a, b) => order[a.reason] - order[b.reason] || a.date.localeCompare(b.date) || a.target.base.localeCompare(b.target.base))
  const totals = list.reduce((s, p) => ({ expected: s.expected + p.expected, scheduled: s.scheduled + p.scheduled, done: s.done + p.done }), { expected: 0, scheduled: 0, done: 0 })
  totals.missing = missing.length
  return { places: list.sort((a, b) => (a.ok - b.ok) || a.clientName.localeCompare(b.clientName) || a.base.localeCompare(b.base)), missing, totals }
}

/**
 * Deep state per restaurant, for World (Items) and the Client Report:
 * { [placeKey]: { base, clientId, clientName, lastDone: job|null, nextScheduled: job|null, nextExpected: date|null } }
 * `jobs` = deep history + upcoming jobs; placeKey = lowercased restaurant name.
 */
export function deepStatusByPlace(targets, jobs, { today, horizonDays = 62 } = {}) {
  const out = {}
  const end = new Date(`${today}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + horizonDays)
  const until = end.toISOString().slice(0, 10)
  const live = (jobs || []).filter(j => j.status !== 'cancelled')
  for (const t of targets || []) {
    const k = norm(t.base)
    const s = out[k] || (out[k] = { base: t.base, clientId: t.clientId, clientName: t.clientName, lastDone: null, nextScheduled: null, nextExpected: null })
    const mine = live.filter(j => jobCountsFor(j, t))
    for (const j of mine) {
      if (j.status === 'completed' && (!s.lastDone || j.scheduled_date > s.lastDone.scheduled_date)) s.lastDone = j
      if (j.status !== 'completed' && j.scheduled_date >= today && (!s.nextScheduled || j.scheduled_date < s.nextScheduled.scheduled_date)) s.nextScheduled = j
    }
    // Next expected day that no job covers yet.
    const cov = deepCoverage([t], mine, { from: today, to: until, today })
    const next = cov.missing.find(m => m.reason === 'notCreated')?.date || null
    if (next && (!s.nextExpected || next < s.nextExpected)) s.nextExpected = next
  }
  return out
}

export const placeKey = name => norm(splitName(name).base)

/** Where a spot came from: 'client' (asked in the client portal) or 'internal'. */
export function spotOrigin(job, spotContract) {
  const ref = spotContract?.contract_details?.quote_ref || ''
  return ref.startsWith('req:') ? 'client' : 'internal'
}

/**
 * Where a spot offer stands:
 * open (offered to everyone) | waiting (offered to one person) | accepted | declined | assigned | done | cancelled
 */
export function spotOfferState(job) {
  if (!job) return null
  if (job.status === 'completed') return 'done'
  if (job.status === 'cancelled') return job.spot_status === 'declined' ? 'declined' : 'cancelled'
  if (!job.employee_id) return 'open'
  if (job.spot_status === 'pending') return 'waiting'
  if (job.spot_status === 'accepted') return 'accepted'
  if (job.spot_status === 'declined') return 'declined'
  return 'assigned'
}

/** Line state for the Deep & Spot filters: scheduled (no person) | assigned | done | missing. */
export function lineState(job, today) {
  if (job.status === 'completed') return 'done'
  if (job.status === 'cancelled') return 'cancelled'
  if (job.scheduled_date < today) return 'missing'
  return job.employee_id ? 'assigned' : 'scheduled'
}
