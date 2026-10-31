// v1.0.97 · Schedule Generator in 3 steps: period → editable preview → generate.
// Pure helpers (no database) for the preview: who can work each day, which contract visits are
// due, which already exist (never duplicated) and the coverage per client ("12 of 12 places").
import { roleCan } from './employeeRoles.js'

const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
export const dowOf = date => new Date(date + 'T12:00:00Z').getUTCDay()

export function addDays(date, n) {
  const x = new Date(date + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10)
}
export function monthDays(month) {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}
/** Dates of the period: one day, the Mon–Sun week holding `anchor`, or the month. */
export function periodDays(kind, anchor, month) {
  if (kind === 'day') return [anchor]
  if (kind === 'week') {
    const mon = addDays(anchor, -((dowOf(anchor) + 6) % 7))
    return Array.from({ length: 7 }, (_, i) => addDays(mon, i))
  }
  return monthDays(month)
}

/** employees.work_days ('["Mon","Tue"]') → Set of weekday numbers; null = no fixed days. */
export function workDaysOf(emp) {
  let list = emp?.work_days
  if (typeof list === 'string') { try { list = JSON.parse(list) } catch { list = null } }
  if (!Array.isArray(list) || !list.length) return null
  const set = new Set(list.map(d => DOW[d]).filter(d => d != null))
  return set.size ? set : null
}

export const isTestAccount = emp => /^teste\b/i.test(emp?.full_name || '')

/**
 * Can this person get cleaning work on `date`? Order of reasons: inactive, test account, role,
 * day off (employee_availability 'off', pending or approved), weekday outside employees.work_days.
 * An "extra" mark beats the weekday rule. `forced` people skip the role / test / inactive checks.
 */
export function canWork(emp, date, availability = {}, forced = new Set()) {
  if (!emp) return { ok: false, reason: 'unknown' }
  const isForced = forced.has(emp.id)
  if (!isForced) {
    if (emp.is_active === false) return { ok: false, reason: 'inactive' }
    if (isTestAccount(emp)) return { ok: false, reason: 'test' }
    if (!roleCan(emp.job_role, 'routes')) return { ok: false, reason: 'role' }
  }
  const mark = availability[`${emp.id}|${date}`]?.kind
  if (mark === 'off') return { ok: false, reason: 'off' }
  if (mark === 'extra') return { ok: true, reason: isForced ? 'forced' : 'extra' }
  const wd = workDaysOf(emp)
  if (wd && !wd.has(dowOf(date))) return { ok: false, reason: 'weekday' }
  return { ok: true, reason: isForced ? 'forced' : 'ok' }
}

/** People outside the schedule for the whole period, with the reason (shown with "include anyway"). */
export function outOfSchedule(employees, days, availability = {}, forced = new Set()) {
  return (employees || []).flatMap(e => {
    if (forced.has(e.id)) return []
    const first = canWork(e, days[0], availability, forced)
    if (['inactive', 'test', 'role'].includes(first.reason)) return [{ emp: e, reason: first.reason }]
    const free = days.filter(d => canWork(e, d, availability, forced).ok)
    return free.length ? [] : [{ emp: e, reason: 'unavailable' }]
  })
}

// ---- jobs ↔ contracts ----

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
/** "Ibushio — Range Hood" / "Ibushio - Deep Clean" → { base: 'Ibushio', rest: 'Range Hood' } */
export function splitName(name) {
  const m = /^(.*?)\s+[—–-]\s+(.*)$/.exec(String(name || '').trim())
  return m ? { base: m[1].trim(), rest: m[2].trim() } : { base: String(name || '').trim(), rest: '' }
}
const isBasic = text => /basic/i.test(text || '')

/**
 * What an active contract asks for. Weekly = Basic Cleaning on its days_of_week (checked per day).
 * Periodic = deep / maintenance items (checked once per month). No days = not schedulable.
 */
export function contractTargets(contracts, clients = []) {
  const clientById = Object.fromEntries((clients || []).map(c => [c.id, c]))
  return (contracts || [])
    .filter(c => c.is_active !== false && clientById[c.client_id]?.is_active !== false)
    .map(c => {
      const { base, rest } = splitName(c.location_name)
      const days = (c.days_of_week || []).map(d => DOW[d]).filter(d => d != null)
      const weekly = isBasic(c.service_type) && !rest
      const keyword = rest && !/deep/i.test(rest) ? rest : ''
      const service = weekly ? 'Basic Cleaning' : (keyword || (/deep/i.test(c.service_type || '') || /deep/i.test(rest) ? 'Deep Clean' : c.service_type || 'Service'))
      return {
        id: c.id, clientId: c.client_id, clientName: clientById[c.client_id]?.company_name || c.client_name || '—',
        location: c.location_name, base, service, keyword, days, address: c.location_address || '',
        kind: !days.length ? 'nodays' : weekly ? 'weekly' : 'periodic',
        hours: Number(c.hours_per_visit) || null, price: c.price_per_visit ?? null,
      }
    })
}

/** Does a job title ("Ibushio — Stove + Range Hood …") fulfil this contract target? */
export function jobFulfils(title, target) {
  const { base, rest } = splitName(title)
  if (norm(base) !== norm(target.base)) return false
  if (target.kind === 'weekly') return isBasic(rest) || !rest
  if (isBasic(rest)) return false
  return target.keyword ? norm(rest).includes(norm(target.keyword)) : true
}

/** Key used to never create the same visit twice: date + place + service. */
export function dupKey(date, title) {
  const { base, rest } = splitName(title)
  return `${date}|${norm(base)}|${isBasic(rest) || !rest ? 'basic' : norm(rest)}`
}

/**
 * Coverage of the active contracts in the period by `rows` (existing jobs + ticked preview rows,
 * each { date, title }). Weekly contracts: every contract weekday in the period. Periodic ones:
 * at least one visit in the month (only checked when the period is a whole month).
 * @returns {{ clients: Array, missing: Array, noDays: Array }}
 */
export function coverage(targets, days, rows, { wholeMonth = false } = {}) {
  const byDate = {}
  for (const r of rows || []) (byDate[r.date] = byDate[r.date] || []).push(r)
  const missing = []
  const clients = {}
  const noDays = []
  for (const t of targets) {
    if (t.kind === 'nodays') { noDays.push(t); continue }
    if (t.kind === 'periodic' && !wholeMonth) continue
    const c = clients[t.clientName] || (clients[t.clientName] = { name: t.clientName, places: new Map() })
    const placeOk = c.places.get(t.base) ?? true
    let ok = true
    if (t.kind === 'weekly') {
      for (const d of days) {
        if (!t.days.includes(dowOf(d))) continue
        if (!(byDate[d] || []).some(r => jobFulfils(r.title, t))) { ok = false; missing.push({ target: t, date: d }) }
      }
    } else {
      const done = days.some(d => (byDate[d] || []).some(r => jobFulfils(r.title, t)))
      if (!done) {
        ok = false
        const date = days.find(d => t.days.includes(dowOf(d))) || days[0]
        missing.push({ target: t, date, periodic: true })
      }
    }
    c.places.set(t.base, placeOk && ok)
  }
  const list = Object.values(clients).map(c => ({
    name: c.name, total: c.places.size, done: [...c.places.values()].filter(Boolean).length,
  })).sort((a, b) => a.name.localeCompare(b.name))
  missing.sort((a, b) => a.date.localeCompare(b.date) || a.target.location.localeCompare(b.target.location))
  return { clients: list, missing, noDays }
}

/**
 * v1.0.123 · Check per contract (place) for the period: which dates are expected and what exists
 * on each one, so the admin sees "Kodama Kinshicho 3/3 — Mon Wed Fri" instead of checking job by job.
 * `jobs` = live jobs of the period ({ scheduled_date, title, employee_id }), `rows` = preview lines
 * still to create ({ date, title, employeeId }). Weekly contracts: one per contract weekday.
 * Periodic contracts: one visit in the month (only when the period is the whole month).
 * Also returns the extra jobs (no contract) and duplicates (two jobs of the same visit).
 * @returns {{ places: Array<{ target, slots: Array<{ date, jobs, rows, state }>, done, total, state }>, extras: Array, dups: Array, totals }}
 */
export function contractCheck(targets, days, jobs = [], rows = [], { wholeMonth = false } = {}) {
  const live = (jobs || []).filter(j => j.status !== 'cancelled')
  const byDate = {}
  for (const j of live) (byDate[j.scheduled_date] = byDate[j.scheduled_date] || []).push(j)
  const rowsByDate = {}
  for (const r of rows || []) (rowsByDate[r.date] = rowsByDate[r.date] || []).push(r)
  const used = new Set()
  const places = []
  for (const t of targets || []) {
    if (t.kind === 'nodays') continue
    if (t.kind === 'periodic' && !wholeMonth) continue
    const slotDates = t.kind === 'weekly' ? days.filter(d => t.days.includes(dowOf(d))) : [null]
    const slots = slotDates.map(date => {
      const inDays = date ? [date] : days
      const js = inDays.flatMap(d => (byDate[d] || []).filter(j => jobFulfils(j.title, t)))
      const rs = inDays.flatMap(d => (rowsByDate[d] || []).filter(r => jobFulfils(r.title, t)))
      js.forEach(j => used.add(j))
      const state = js.length ? (js.some(j => j.employee_id) ? 'ok' : 'noPerson') : rs.length ? 'toCreate' : 'missing'
      return { date: date || js[0]?.scheduled_date || rs[0]?.date || null, jobs: js, rows: rs, state }
    })
    const done = slots.filter(s => s.state === 'ok').length
    const state = done === slots.length ? 'ok' : slots.some(s => s.state === 'missing') ? 'missing' : slots.some(s => s.state === 'toCreate') ? 'toCreate' : 'noPerson'
    places.push({ target: t, slots, done, total: slots.length, state })
  }
  // Same visit (date + place + service) created twice.
  const seen = {}
  for (const j of live) (seen[dupKey(j.scheduled_date, j.title)] = seen[dupKey(j.scheduled_date, j.title)] || []).push(j)
  const dups = Object.values(seen).filter(l => l.length > 1)
  const extras = live.filter(j => !used.has(j))
  const order = { missing: 0, toCreate: 1, noPerson: 2, ok: 3 }
  places.sort((a, b) => order[a.state] - order[b.state] || String(a.target.location).localeCompare(String(b.target.location)))
  const totals = {
    expected: places.reduce((s, p) => s + p.total, 0),
    ok: places.reduce((s, p) => s + p.done, 0),
    missing: places.reduce((s, p) => s + p.slots.filter(x => x.state === 'missing').length, 0),
    toCreate: places.reduce((s, p) => s + p.slots.filter(x => x.state === 'toCreate').length, 0),
    noPerson: places.reduce((s, p) => s + p.slots.filter(x => x.state === 'noPerson').length, 0),
  }
  return { places, extras, dups, totals }
}

/** v1.0.123 · Move the period back / forward one step (day, Mon–Sun week, or month). */
export function shiftPeriod(kind, anchor, month, step) {
  if (kind === 'month') {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(Date.UTC(y, m - 1 + step, 1))
    return { anchor, month: d.toISOString().slice(0, 7) }
  }
  return { anchor: addDays(anchor, kind === 'week' ? 7 * step : step), month }
}

/** sequence_order 1..n per person and day, in clock order (the Agenda's canonical order). */
export function clockSeq(rows) {
  const groups = {}
  rows.forEach(r => { (groups[`${r.employeeId || ''}|${r.date}`] = groups[`${r.employeeId || ''}|${r.date}`] || []).push(r) })
  const seq = new Map()
  Object.values(groups).forEach(list => {
    [...list].sort((a, b) => String(a.time || '99:99').localeCompare(String(b.time || '99:99')) || String(a.title).localeCompare(String(b.title)))
      .forEach((r, i) => seq.set(r.key, i + 1))
  })
  return seq
}

/** Problems shown on a preview line (never only after generating). */
export function rowIssues(row, { empById, availability, forced }) {
  const out = []
  if (!row.employeeId) return [{ kind: 'nobody' }]
  const emp = empById[row.employeeId]
  const st = canWork(emp, row.date, availability, forced)
  if (!st.ok) out.push({ kind: st.reason })
  else if (st.reason === 'forced') out.push({ kind: 'forced' })
  return out
}
