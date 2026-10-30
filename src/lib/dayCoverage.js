// v1.0.103 · Live Track "today by contract": how many contract places of the day are done and
// which ones are missing, with who should do it and why (not started, nobody, no job created).
// Same contract rules as the Schedule Generator (weekly Basic Cleaning on its days_of_week).
import { supabase } from './supabase'
import { contractTargets, jobFulfils, dowOf, addDays, splitName } from './schedulePlan.js'
import { pendingReason } from './assignFlow.js'

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
const LATE_AFTER_MIN = 5
const toMin = t => { if (!t) return null; const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0) }

/** Who did each place most in `history` (jobs with employee_id) → { 'kodama oimachi': employeeId }. */
export function usualOwners(history, empById = {}) {
  const counts = {}
  for (const j of history || []) {
    const emp = empById[j.employee_id]
    if (!emp || emp.is_active === false) continue
    const p = norm(splitName(j.title).base)
    counts[p] = counts[p] || {}
    counts[p][j.employee_id] = (counts[p][j.employee_id] || 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).map(([p, c]) => [p, Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]]))
}

/**
 * Pure. One line per weekly contract place due on `date`.
 * state: done | working | late | waiting | noPerson | noJob.
 * `nowMin` = Tokyo minutes since midnight (for "late"). Missing = everything not done.
 */
export function dayCoverage(targets, date, jobs, { empById = {}, availability = {}, owners = {}, nowMin = null } = {}) {
  const live = (jobs || []).filter(j => j.scheduled_date === date && j.status !== 'cancelled')
  const rank = { completed: 0, in_progress: 1, assigned: 2 }
  const seen = new Set()
  const items = []
  for (const t of targets || []) {
    if (t.kind !== 'weekly' || !t.days.includes(dowOf(date))) continue
    const key = norm(t.base)
    if (seen.has(key)) continue
    seen.add(key)
    const job = live.filter(j => jobFulfils(j.title, t)).sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9))[0] || null
    let state
    let personId = job?.employee_id || null
    if (!job) { state = 'noJob'; personId = owners[key] || null }
    else if (job.status === 'completed') state = 'done'
    else if (job.status === 'in_progress') state = 'working'
    else if (pendingReason(job, { empById, availability })) state = 'noPerson'
    else {
      const at = toMin(job.scheduled_time)
      state = at != null && nowMin != null && nowMin - at >= LATE_AFTER_MIN ? 'late' : 'waiting'
    }
    const emp = personId ? empById[personId] : null
    items.push({
      place: t.base, clientName: t.clientName, job, state,
      personId, personName: emp?.full_name || job?.employee_name || '',
      usual: !job && !!emp,
    })
  }
  const order = { noJob: 0, noPerson: 1, late: 2, waiting: 3, working: 4, done: 5 }
  items.sort((a, b) => order[a.state] - order[b.state] || a.personName.localeCompare(b.personName) || a.place.localeCompare(b.place))
  const done = items.filter(i => i.state === 'done').length
  return { total: items.length, done, missing: items.filter(i => i.state !== 'done'), items }
}

/** Needs the admin now: no job, nobody, or past its time and not started. */
export const needsAction = item => ['noJob', 'noPerson', 'late'].includes(item.state)

/** Load everything for `date` and return dayCoverage(). */
export async function fetchDayCoverage(date, { nowMin = null } = {}) {
  const [c, cl, e, j, h, av] = await Promise.all([
    supabase.from('service_contracts').select('*').eq('is_active', true),
    supabase.from('clients').select('id,company_name,is_active'),
    supabase.from('employees').select('id,full_name,is_active,job_role'),
    supabase.from('jobs').select('id,title,scheduled_date,scheduled_time,status,employee_id,employee_name,job_category,spot_status').eq('scheduled_date', date),
    supabase.from('jobs').select('title,employee_id').gte('scheduled_date', addDays(date, -28)).lt('scheduled_date', date)
      .not('employee_id', 'is', null).neq('status', 'cancelled').limit(3000),
    supabase.from('employee_availability').select('employee_id,date,kind,status').eq('date', date),
  ])
  if (c.error) throw c.error
  if (j.error) throw j.error
  const empById = Object.fromEntries((e.data || []).map(x => [x.id, x]))
  const availability = {}
  for (const r of av.data || []) if (r.status !== 'rejected') availability[`${r.employee_id}|${r.date}`] = r
  const targets = contractTargets(c.data || [], cl.data || [])
  return dayCoverage(targets, date, j.data || [], { empById, availability, owners: usualOwners(h.data || [], empById), nowMin })
}
