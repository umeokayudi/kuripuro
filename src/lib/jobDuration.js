// v1.0.220 · Planned duration of ANY job (with or without contract) and its finish time.
// Saved in jobs.expected_minutes (sql/2026-10-29_agenda_do_dia.sql, item 3). Empty = the old rule
// (contract hours per visit, else the default by type). The finish ("até 10:30") is never stored:
// it is start + duration, the same way the route deadline of the contract deeps is built
// (route open + hours). On The Planet deadline jobs keep "até 10:00" and are not touched here.
import { hoursText } from './routePlan.js'

const toMin = t => {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
const hhmm = min => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/** The job's own planned minutes (> 0), else null. */
export const ownMinutes = job => (Number(job?.expected_minutes) > 0 ? Math.round(Number(job.expected_minutes)) : null)

/** 'HH:MM' start + minutes (wraps after midnight), or '' when either is missing. */
export function endTime(start, minutes) {
  const s = toMin(start)
  const m = Number(minutes)
  if (s == null || !(m > 0)) return ''
  return hhmm(s + Math.round(m))
}

/** Minutes from start to end 'HH:MM' (end before start = next day), or null. */
export function minutesBetween(start, end) {
  const s = toMin(start), e = toMin(end)
  if (s == null || e == null) return null
  const d = e - s
  return d > 0 ? d : d + 24 * 60
}

/** "09:30 · ⏱1h · até 10:30" (pieces left out when missing). */
export function slotText(time, minutes, L = (en, ja, pt) => pt) {
  const t = String(time || '').slice(0, 5)
  const parts = []
  if (t) parts.push(t)
  if (Number(minutes) > 0) parts.push(`⏱${hoursText(Math.round(Number(minutes)))}`)
  const end = endTime(t, minutes)
  if (end) parts.push(L(`by ${end}`, `${end}まで`, `até ${end}`))
  return parts.join(' · ')
}

/** Quick picks for the duration field (minutes). */
export const DURATION_PICKS = [30, 45, 60, 90, 120, 180, 240]

const missingColumn = err => /expected_minutes/i.test(String(err?.message || '')) && /column|schema|does not exist|could not find/i.test(String(err?.message || ''))
export const DURATION_SQL_HINT = 'Falta rodar o SQL da duração (jobs.expected_minutes).'

/** Save the planned minutes of a job (null clears it). Throws a readable error when the SQL is missing. */
export async function saveJobMinutes(supabase, jobId, minutes) {
  const value = Number(minutes) > 0 ? Math.round(Number(minutes)) : null
  const { error } = await supabase.from('jobs').update({ expected_minutes: value }).eq('id', jobId)
  if (error) throw new Error(missingColumn(error) ? DURATION_SQL_HINT : error.message)
  return value
}

/**
 * Insert a job with expected_minutes; when the column does not exist yet, insert it without the
 * duration (the job is never lost) and report `durationSaved: false`.
 */
export async function insertJobWithMinutes(supabase, row, select = '*') {
  const first = await supabase.from('jobs').insert(row).select(select).single()
  if (!first.error || !('expected_minutes' in row) || !missingColumn(first.error)) return { ...first, durationSaved: !first.error }
  const { expected_minutes, ...rest } = row // eslint-disable-line no-unused-vars
  const second = await supabase.from('jobs').insert(rest).select(select).single()
  return { ...second, durationSaved: false }
}

let probe = null
/** Does jobs.expected_minutes exist? (probed once per tab; used by screens that list columns). */
export function hasJobMinutesColumn(supabase) {
  if (!probe) probe = supabase.from('jobs').select('expected_minutes').limit(1).then(r => !r.error, () => false)
  return probe
}
