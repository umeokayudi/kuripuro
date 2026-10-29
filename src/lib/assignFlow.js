// v1.0.101 · One assignment flow. Pure helpers (no database) shared by the Assign screen (Generator),
// the Agenda do Dia and the redistribute sheet:
//   - pendingReason: why an existing job is in the Pending box (no person, declined spot, person off…)
//   - conflictsFor: warnings for "this job → this person" (day off, role, same time, travel)
//   - suggestPeople / planBatch: who to suggest (role, availability, route of the day, week load)
//   - placeInDay: sequence_order so a new job lands in the right place of the person's day
//   - coverageCounts: PROGRAMMED (created × contract) and ASSIGNED (with person × created)
import { getCleaningType, locationNameFromTitle } from './cleaningType.js'
import { roleCan } from './employeeRoles.js'
import { canWork, coverage, dowOf, isTestAccount, addDays } from './schedulePlan.js'

export const MANUAL_ORDER_BASE = 1000
const DEFAULT_MINUTES = { basic: 120, deep: 240 }
const CHECK_MINUTES = 60
// Minimum gap between two jobs of the same person: same area / other or unknown area.
export const TRAVEL_MINUTES = { sameArea: 10, otherArea: 30 }

export const hhmm = t => (t ? String(t).slice(0, 5) : '')
export const toMin = t => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
const norm = s => String(s || '').toLowerCase().trim()

/**
 * One shape for DB jobs and generator preview rows:
 * { key, id?, date, time, title, place, employeeId, area, minutes, deep, category, status, source }
 */
export function asItem(x) {
  if (!x) return null
  const isRow = x.date !== undefined && x.scheduled_date === undefined
  const title = x.title || ''
  const deep = getCleaningType({ title, description: x.description }) === 'deep' || x.category === 'maintenance' || x.job_category === 'maintenance'
  return {
    key: isRow ? x.key : x.id,
    id: isRow ? null : x.id,
    date: isRow ? x.date : x.scheduled_date,
    time: hhmm(isRow ? x.time : x.scheduled_time),
    title,
    place: locationNameFromTitle(title),
    employeeId: (isRow ? x.employeeId : x.employee_id) || null,
    area: x.area || null,
    minutes: Number(x.expected_minutes || x.minutes) || DEFAULT_MINUTES[deep ? 'deep' : 'basic'],
    // For same-time / travel checks: the planned minutes when the job has them, else a short block
    // (generator templates space visits ~1h apart; a long default would flag every Sunday as a clash).
    span: Number(x.expected_minutes || x.minutes) || CHECK_MINUTES,
    deep,
    category: x.job_category || x.category || 'regular',
    status: x.status || 'assigned',
    source: isRow ? 'preview' : 'job',
  }
}

/** Role the job asks for: 'deep' (deep clean / maintenance) or 'cleaning'. */
export const requiredRole = item => (item?.deep ? 'deep' : 'cleaning')

/** Can this role do this kind of job? Desk roles never; trainees not alone on deep work. */
export function roleFits(emp, required) {
  if (!roleCan(emp?.job_role, 'routes')) return false
  if (required === 'deep' && String(emp?.job_role || '').trim() === 'trainee') return false
  return true
}

/**
 * Why an existing job is waiting for a person (null = it has a valid owner).
 * Completed / running jobs never come back to the box.
 */
export function pendingReason(job, { empById = {}, availability = {} } = {}) {
  if (!job || job.status === 'completed' || job.status === 'in_progress') return null
  if (job.status === 'cancelled') {
    // A spot the only person declined is cancelled: it still needs someone.
    return job.job_category === 'spot' && job.spot_status === 'declined' ? 'spotDeclined' : null
  }
  if (!job.employee_id) return job.job_category === 'spot' && job.spot_status === 'pending' ? 'offerOpen' : 'noPerson'
  const emp = empById[job.employee_id]
  if (!emp || emp.is_active === false) return 'personGone'
  if (availability[`${emp.id}|${job.scheduled_date}`]?.kind === 'off') return 'personOff'
  return null
}

const overlaps = (a, b) => {
  const as = toMin(a.time), bs = toMin(b.time)
  if (as == null || bs == null) return false
  return as < bs + b.span && bs < as + a.span
}

/**
 * Warnings for giving `item` to `emp`. `dayJobs` = the person's other jobs that day (items).
 * Kinds: inactive, test, role, roleDeep, off, weekday, overlap, travel. Never blocks: the admin decides.
 */
export function conflictsFor(item, emp, dayJobs = [], { availability = {} } = {}) {
  if (!emp) return []
  const out = []
  const st = canWork(emp, item.date, availability)
  if (!st.ok) out.push({ kind: st.reason })
  else if (requiredRole(item) === 'deep' && !roleFits(emp, 'deep')) out.push({ kind: 'roleDeep' })
  // Jobs with the very same start time are one route done in sequence (the night route is all
  // "00:30" in order), so they never count as overlapping.
  const others = dayJobs.filter(j => j.key !== item.key && j.status !== 'cancelled' && j.date === item.date && toMin(j.time) !== toMin(item.time))
  const clash = others.find(j => overlaps(item, j))
  if (clash) out.push({ kind: 'overlap', with: clash.place, time: clash.time })
  else {
    const start = toMin(item.time)
    if (start != null) {
      const timed = others.filter(j => toMin(j.time) != null)
      const before = timed.filter(j => toMin(j.time) <= start).sort((a, b) => toMin(b.time) - toMin(a.time))[0]
      const after = timed.filter(j => toMin(j.time) > start).sort((a, b) => toMin(a.time) - toMin(b.time))[0]
      const need = (x, y) => (x.area && y.area && norm(x.area) === norm(y.area) ? TRAVEL_MINUTES.sameArea : TRAVEL_MINUTES.otherArea)
      if (before && start - (toMin(before.time) + before.span) < need(before, item)) out.push({ kind: 'travel', with: before.place, time: before.time })
      else if (after && toMin(after.time) - (start + item.span) < need(item, after)) out.push({ kind: 'travel', with: after.place, time: after.time })
    }
  }
  return out
}

/** Conflicts that take a person out of the suggestion (still selectable by hand, with the warning). */
export const BLOCKING = new Set(['inactive', 'test', 'role', 'roleDeep', 'off', 'weekday', 'unknown', 'overlap'])

/** Mon–Sun week of a date. */
export function weekOf(date) {
  const mon = addDays(date, -((dowOf(date) + 6) % 7))
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i))
}

/**
 * Ranked people for one item.
 * ctx: { employees, availability, jobs (items: everything already planned around, incl. preview rows),
 *        owners: { [place lower-case]: employeeId } — who usually does the place (only a first suggestion) }
 * @returns [{ emp, score, why: [...], conflicts: [...] }] best first; `ok` = no blocking conflict.
 */
export function suggestPeople(item, { employees = [], availability = {}, jobs = [], owners = {}, byEmp = null } = {}) {
  const week = new Set(weekOf(item.date))
  const index = byEmp || indexByEmp(jobs)
  const out = []
  for (const emp of employees) {
    if (emp.is_active === false || isTestAccount(emp)) continue
    const mine = (index.get(emp.id) || []).filter(j => j.key !== item.key && j.status !== 'cancelled')
    const today = mine.filter(j => j.date === item.date)
    const conflicts = conflictsFor(item, emp, today, { availability })
    const why = []
    let score = 0
    if (owners[norm(item.place)] === emp.id) { score += 40; why.push('owner') }
    if (item.area && today.some(j => j.area && norm(j.area) === norm(item.area))) { score += 25; why.push('sameArea') }
    else if (today.length) { score += 8; why.push('onRoute') }
    if (availability[`${emp.id}|${item.date}`]?.kind === 'extra') { score += 15; why.push('extra') }
    const weekMinutes = mine.filter(j => week.has(j.date)).reduce((s, j) => s + j.minutes, 0)
    score -= weekMinutes / 60 // one point per planned hour this week: lighter weeks first
    if (conflicts.some(c => c.kind === 'travel')) score -= 20
    out.push({ emp, score, why, conflicts, weekMinutes, ok: !conflicts.some(c => BLOCKING.has(c.kind)) })
  }
  const minWeek = Math.min(...out.filter(o => o.ok).map(o => o.weekMinutes))
  for (const o of out) if (o.ok && o.weekMinutes === minWeek && !o.why.length) o.why.push('lightWeek')
  return out.sort((a, b) => (b.ok - a.ok) || (b.score - a.score) || String(a.emp.full_name).localeCompare(String(b.emp.full_name)))
}

/** Map employeeId → items (speeds up suggestions on a month with hundreds of lines). */
export function indexByEmp(jobs) {
  const m = new Map()
  for (const j of jobs || []) if (j.employeeId) (m.get(j.employeeId) || m.set(j.employeeId, []).get(j.employeeId)).push(j)
  return m
}

/** Best person for an item, or null when nobody can take it without a blocking conflict. */
export function bestPerson(item, ctx) {
  const top = suggestPeople(item, ctx)[0]
  return top?.ok ? top : null
}

/**
 * Suggestions for many items at once (Pending box "accept all", redistribute): in clock order,
 * each choice is added to the plan before the next one, so loads and same-time checks stay real.
 * @returns Map key → { emp, why, conflicts } | null
 */
export function planBatch(items, ctx) {
  const keys = new Set(items.map(i => i.key))
  const byEmp = indexByEmp((ctx.jobs || []).filter(j => !keys.has(j.key)))
  const result = new Map()
  const ordered = [...items].sort((a, b) => a.date.localeCompare(b.date) || String(a.time || '99').localeCompare(String(b.time || '99')))
  for (const it of ordered) {
    const pick = bestPerson(it, { ...ctx, byEmp })
    result.set(it.key, pick)
    if (pick) (byEmp.get(pick.emp.id) || byEmp.set(pick.emp.id, []).get(pick.emp.id)).push({ ...it, employeeId: pick.emp.id })
  }
  return result
}

/**
 * sequence_order updates that put `job` (item with id) in the right place of the person's day:
 * clock order (1..n) when the day follows the clock, or the manual order kept as it is with the new
 * job slotted before the first later job. Only changed rows are returned (the new one always).
 */
export function placeInDay(dayJobs, item) {
  const others = dayJobs.filter(j => j.id !== item.id && j.status !== 'cancelled')
  const manual = others.some(j => Number(j.sequence_order) >= MANUAL_ORDER_BASE)
  const time = j => toMin(hhmm(j.scheduled_time ?? j.time)) ?? 24 * 60
  let list
  if (manual) {
    list = [...others].sort((a, b) => Number(a.sequence_order || 0) - Number(b.sequence_order || 0))
    const at = list.findIndex(j => time(j) > time(item))
    list.splice(at < 0 ? list.length : at, 0, item)
  } else {
    list = [...others, item].sort((a, b) => time(a) - time(b) || String(a.title).localeCompare(String(b.title)))
  }
  return list.map((j, i) => ({ id: j.id, sequence_order: (manual ? MANUAL_ORDER_BASE : 0) + i + 1, prev: j.sequence_order }))
    .filter(u => u.id === item.id || Number(u.prev) !== u.sequence_order)
    .map(({ id, sequence_order }) => ({ id, sequence_order }))
}

/**
 * The two counts of the Assign screen.
 * PROGRAMMED: contract visits due in the period that already have a job ÷ visits due.
 * ASSIGNED: jobs of the period with a valid person ÷ jobs of the period (cancelled left out).
 * READY = programmed and assigned.
 */
export function coverageCounts(targets, days, jobs, { wholeMonth = false, empById = {}, availability = {} } = {}) {
  const live = (jobs || []).filter(j => j.status !== 'cancelled')
  const cov = coverage(targets, days, live.map(j => ({ date: j.scheduled_date, title: j.title })), { wholeMonth })
  const dueAll = coverage(targets, days, [], { wholeMonth }).missing.length
  const assigned = live.filter(j => !pendingReason(j, { empById, availability })).length
  return {
    programmed: { done: dueAll - cov.missing.length, total: dueAll },
    assigned: { done: assigned, total: live.length },
    missing: cov.missing,
    clients: cov.clients,
    noDays: cov.noDays,
  }
}

/** Remaining jobs of a person on a day (what can still move to someone else). */
export const movableJobs = (jobs, employeeId) =>
  (jobs || []).filter(j => j.employee_id === employeeId && j.status === 'assigned')
