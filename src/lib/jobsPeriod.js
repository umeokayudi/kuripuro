// Period filter + time summary for the admin Jobs list (v1.0.26).
// Pure helpers so they can be tested without React or Supabase.
import { jobDurationMin } from './workKpis.js'

export const PERIOD_KEYS = ['today', 'tomorrow', 'next7', 'yesterday', '7d', '30d', 'all', 'custom']

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function daysBetween(from, to) {
  const a = Date.UTC(...from.split('-').map((v, i) => (i === 1 ? v - 1 : +v)))
  const b = Date.UTC(...to.split('-').map((v, i) => (i === 1 ? v - 1 : +v)))
  return Math.round((b - a) / 86400000)
}

/** { from, to } inclusive date strings for a period, or null for "all". */
export function periodRange(key, today, custom = {}) {
  if (key === 'today') return { from: today, to: today }
  if (key === 'tomorrow') { const t = addDays(today, 1); return { from: t, to: t } }
  if (key === 'next7') return { from: today, to: addDays(today, 6) }
  if (key === 'yesterday') { const y = addDays(today, -1); return { from: y, to: y } }
  if (key === '7d') return { from: addDays(today, -6), to: today }
  if (key === '30d') return { from: addDays(today, -29), to: today }
  if (key === 'custom' && custom.from) {
    const to = custom.to && custom.to >= custom.from ? custom.to : custom.from
    return { from: custom.from, to }
  }
  return null
}

/** The equal-length period right before `range` (today → yesterday, 7 days → the 7 before). */
export function previousRange(range) {
  if (!range) return null
  const len = daysBetween(range.from, range.to) + 1
  return { from: addDays(range.from, -len), to: addDays(range.from, -1) }
}

export function inRange(job, range) {
  if (!range) return true
  const d = job?.scheduled_date
  return !!d && d >= range.from && d <= range.to
}

/** people: Set of employee ids; '' stands for "no one assigned". Empty set = everyone. */
export function matchesPeople(job, people) {
  if (!people || people.size === 0) return true
  return people.has(job?.employee_id || '')
}

export function summarize(jobs) {
  const list = jobs || []
  const done = list.filter(j => j.status === 'completed')
  const timed = done.map(jobDurationMin).filter(v => v != null)
  const minutes = timed.reduce((s, v) => s + v, 0)
  return {
    total: list.filter(j => j.status !== 'cancelled').length,
    done: done.length,
    minutes,
    timedCount: timed.length,
    avgMin: timed.length ? Math.round(minutes / timed.length) : null,
  }
}

/** Per-person rows for the current period, with the previous period beside them. */
export function summarizeByPerson(current, previous) {
  const keyOf = j => j.employee_id || ''
  const names = new Map()
  for (const j of [...current, ...previous]) {
    const k = keyOf(j)
    if (!names.has(k) || (!names.get(k) && j.employee_name)) names.set(k, j.employee_name || '')
  }
  const rows = []
  for (const [id, name] of names) {
    const cur = summarize(current.filter(j => keyOf(j) === id))
    if (cur.total === 0 && cur.done === 0) continue
    rows.push({ id, name, cur, prev: summarize(previous.filter(j => keyOf(j) === id)) })
  }
  return rows.sort((a, b) => b.cur.minutes - a.cur.minutes || b.cur.done - a.cur.done || a.name.localeCompare(b.name))
}

/** Percent change, or null when there is nothing to compare against. */
export function changePct(cur, prev) {
  if (prev == null || cur == null || prev === 0) return null
  return Math.round(((cur - prev) / prev) * 100)
}

export function fmtMinutes(min) {
  if (min == null) return '—'
  const m = Math.round(min)
  if (m < 60) return `${m}min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h}h ${String(r).padStart(2, '0')}min` : `${h}h`
}

/** "09:02–10:27" in Tokyo time, from started_at / completed_at. */
export function fmtStartEnd(job) {
  const f = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })
  if (job?.started_at && job?.completed_at) return `${f(job.started_at)}–${f(job.completed_at)}`
  if (job?.started_at) return `${f(job.started_at)}–`
  return null
}
