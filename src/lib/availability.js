// Employee availability planning: days off (need approval), extra-work wishes,
// and the weekly plan with a 7-day minimum notice.

export const MIN_NOTICE_DAYS = 7
export const KINDS = ['available', 'off', 'extra']

const toUTC = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
const toISO = (dt) => dt.toISOString().slice(0, 10)

export function addDays(iso, n) {
  const dt = toUTC(iso)
  dt.setUTCDate(dt.getUTCDate() + n)
  return toISO(dt)
}

export function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000)
}

/** Monday of the week that contains `iso`. */
export function weekStartOf(iso) {
  const dow = toUTC(iso).getUTCDay() // 0 = Sunday
  return addDays(iso, dow === 0 ? -6 : 1 - dow)
}

export function weekDays(weekStart) {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
}

/** First date the employee may still change (today + 7). */
export function firstEditableDate(today) {
  return addDays(today, MIN_NOTICE_DAYS)
}

export function isLocked(date, today) {
  return date < firstEditableDate(today)
}

/** Weeks shown in the planner: the one holding the first editable day, then the next ones. */
export function plannerWeeks(today, count = 5) {
  const first = weekStartOf(firstEditableDate(today))
  return Array.from({ length: count }, (_, i) => addDays(first, i * 7))
}

/**
 * The week the employee must plan next: the first Monday that is still fully editable.
 * Its deadline is 7 days before that Monday (after it, Monday locks).
 */
export function targetPlanWeek(today) {
  const edit = firstEditableDate(today)
  const ws = weekStartOf(edit)
  return ws === edit ? ws : addDays(ws, 7)
}

/**
 * Planning alert for an employee. `plans` are employee_week_plans rows.
 * Returns null when the target week is already planned.
 */
export function planningAlert(plans, today) {
  const week = targetPlanWeek(today)
  if ((plans || []).some(p => p.week_start === week)) return null
  const deadline = addDays(week, -MIN_NOTICE_DAYS)
  const daysLeft = daysBetween(today, deadline)
  return { week, deadline, daysLeft, level: daysLeft <= 2 ? 'urgent' : 'reminder' }
}

/** Map date -> availability row for quick lookups. */
export function byDate(rows) {
  return Object.fromEntries((rows || []).map(r => [r.date, r]))
}

export function nextKind(kind) {
  const i = KINDS.indexOf(kind || 'available')
  return KINDS[(i + 1) % KINDS.length]
}

/**
 * Diff a draft week (date -> kind) against saved rows.
 * Locked dates are ignored. Returns rows to upsert and dates to delete.
 */
export function diffWeek({ draft, saved, today, employee }) {
  const savedBy = byDate(saved)
  const upserts = []
  const deletes = []
  for (const [date, kind] of Object.entries(draft || {})) {
    if (isLocked(date, today)) continue
    const prev = savedBy[date]
    if (kind === 'available') {
      if (prev) deletes.push(date)
      continue
    }
    if (prev && prev.kind === kind) continue
    upserts.push({
      employee_id: employee.id, employee_name: employee.name, date, kind,
      status: 'pending', admin_note: null, decided_at: null,
      updated_at: new Date().toISOString(),
    })
  }
  return { upserts, deletes }
}

/** Employees with no plan for the target week (admin view). */
export function unplannedEmployees(employees, plans, today) {
  const week = targetPlanWeek(today)
  const done = new Set((plans || []).filter(p => p.week_start === week).map(p => p.employee_id))
  return (employees || []).filter(e => !done.has(e.id))
}
