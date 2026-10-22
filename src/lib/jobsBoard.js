// Admin Jobs board helpers (v1.0.66): next job per employee and how often each
// location is cleaned. Pure functions so they can be tested without React.
import { addDays } from './jobsPeriod.js'

const DOW_KEYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** Location name from a job title "Name — Service". */
export function jobLocationName(job) {
  return String(job?.title || '').split(' — ')[0].trim() || '—'
}

const isOpen = j => j && j.status !== 'completed' && j.status !== 'cancelled'
const when = j => `${j.scheduled_date || ''} ${j.scheduled_time || '00:00'}`

/**
 * For each employee: the next open job (today onward, earliest first), how many
 * open jobs today and in the next 7 days. Jobs from before today are ignored.
 */
export function nextJobsByEmployee(jobs, employees, today) {
  const weekEnd = addDays(today, 6)
  const upcoming = (jobs || [])
    .filter(j => isOpen(j) && !(j.job_category === 'spot' && j.spot_status === 'declined'))
    .filter(j => j.scheduled_date && j.scheduled_date >= today)
    .sort((a, b) => when(a).localeCompare(when(b)))
  const rows = (employees || []).map(e => {
    const mine = upcoming.filter(j => j.employee_id === e.id)
    return {
      id: e.id,
      name: e.full_name || '',
      next: mine[0] || null,
      today: mine.filter(j => j.scheduled_date === today).length,
      week: mine.filter(j => j.scheduled_date <= weekEnd).length,
    }
  })
  const unassigned = upcoming.filter(j => !j.employee_id && j.scheduled_date <= weekEnd)
  rows.sort((a, b) => (!a.next) - (!b.next) || (a.next && b.next ? when(a.next).localeCompare(when(b.next)) : 0) || a.name.localeCompare(b.name))
  return { rows, unassigned }
}

/** Contract weekdays per location name, from service_contracts.days_of_week. */
export function contractDaysByLocation(contracts) {
  const out = {}
  for (const c of contracts || []) {
    const name = (c.location_name || '').trim()
    if (!name) continue
    const days = (c.days_of_week || []).map(d => (typeof d === 'number' ? d : DOW_KEYS[d])).filter(d => d != null)
    out[name] = [...new Set([...(out[name] || []), ...days])].sort()
  }
  return out
}

/**
 * Locations seen in `jobs`, with how many jobs, the weekdays they happen on and
 * the times per week (from the contract if there is one, otherwise measured
 * over the `days` the jobs cover).
 */
export function locationStats(jobs, contractDays = {}, days = 7) {
  const map = new Map()
  for (const j of jobs || []) {
    const name = jobLocationName(j)
    const row = map.get(name) || { name, count: 0, dows: new Set() }
    row.count++
    if (j.scheduled_date) row.dows.add(new Date(j.scheduled_date + 'T12:00:00').getDay())
    map.set(name, row)
  }
  const weeks = Math.max(1, days / 7)
  return [...map.values()].map(r => {
    const contract = contractDays[r.name]
    const dows = contract?.length ? contract : [...r.dows].sort()
    const perWeek = contract?.length ? contract.length : Math.round((r.count / weeks) * 10) / 10
    return { name: r.name, count: r.count, dows, perWeek, fromContract: !!contract?.length }
  }).sort((a, b) => a.name.localeCompare(b.name))
}
