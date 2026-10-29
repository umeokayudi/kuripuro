// v1.0.101 · Assignment notices for the employee (bell + "Got it") — table job_notices
// (sql/2026-10-29_avisos_atribuicao.sql). Without the table nothing is saved and the app works the same.
import { supabase } from './supabase'
import { tokyoToday } from './dates'

const isMissing = error => error?.code === 'PGRST205' || error?.code === '42P01' || /job_notices/.test(error?.message || '')
const hm = t => (t ? String(t).slice(0, 5) : '')

/**
 * Pure: notices caused by a change of one job. `before` / `after` are job rows (after may be partial).
 * New person → 'assigned'; old person → 'unassigned'; same person with a new day / time → 'changed'.
 * Past days and finished jobs never notify.
 */
export function noticesForChange(before, after, today = tokyoToday()) {
  const b = before || {}
  const a = { ...b, ...(after || {}) }
  if (a.status === 'completed' || (a.scheduled_date && a.scheduled_date < today)) return []
  const detail = { date: a.scheduled_date, time: hm(a.scheduled_time) }
  const out = []
  const from = b.employee_id || null
  const to = a.status === 'cancelled' ? null : (a.employee_id || null)
  if (from !== to) {
    if (from) out.push({ employee_id: from, job_id: a.id || null, kind: 'unassigned', title: a.title, detail: { ...detail, old_date: b.scheduled_date, old_time: hm(b.scheduled_time) } })
    if (to) out.push({ employee_id: to, job_id: a.id || null, kind: 'assigned', title: a.title, detail })
  } else if (to && (b.scheduled_date !== a.scheduled_date || hm(b.scheduled_time) !== hm(a.scheduled_time))) {
    out.push({ employee_id: to, job_id: a.id || null, kind: 'changed', title: a.title, detail: { ...detail, old_date: b.scheduled_date, old_time: hm(b.scheduled_time) } })
  }
  return out
}

/** Save notices; returns { saved, missing } (missing = SQL not applied yet). */
export async function saveNotices(rows) {
  const list = (rows || []).filter(Boolean)
  if (!list.length) return { saved: 0, missing: false }
  const { error } = await supabase.from('job_notices').insert(list)
  if (error) return { saved: 0, missing: isMissing(error), error }
  return { saved: list.length, missing: false }
}

/** Notify every change between `befores` (by id) and the saved `afters`. */
export function notifyChanges(pairs) {
  return saveNotices(pairs.flatMap(([b, a]) => noticesForChange(b, a)))
}

/** Employee: notices not acknowledged yet (last 30 days). */
export async function fetchMyNotices(employeeId) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString()
  const { data, error } = await supabase.from('job_notices').select('*')
    .eq('employee_id', employeeId).is('ack_at', null).gte('created_at', since)
    .order('created_at', { ascending: false }).limit(100)
  return error ? [] : data || []
}

export async function ackNotices(ids) {
  if (!ids?.length) return
  await supabase.from('job_notices').update({ ack_at: new Date().toISOString() }).in('id', ids)
}

/** Admin: for each job id, the latest notice to its current person → 'seen' | 'waiting' (none = no entry). */
export async function fetchAckState(jobs) {
  const ids = (jobs || []).filter(j => j.employee_id).map(j => j.id)
  if (!ids.length) return {}
  const { data, error } = await supabase.from('job_notices').select('job_id,employee_id,kind,ack_at,created_at')
    .in('job_id', ids).in('kind', ['assigned', 'changed']).order('created_at', { ascending: false })
  if (error) return {}
  const owner = Object.fromEntries(jobs.map(j => [j.id, j.employee_id]))
  const out = {}
  for (const n of data || []) {
    if (out[n.job_id] || n.employee_id !== owner[n.job_id]) continue
    out[n.job_id] = n.ack_at ? 'seen' : 'waiting'
  }
  return out
}

/**
 * Admin bell: offers accepted in the last 3 days (who took it) and jobs of today / tomorrow with
 * nobody to do them. Ids are stable so each accepted offer pops only once.
 */
export async function fetchAssignAlerts(today = tokyoToday()) {
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)
  const since = new Date(Date.now() - 3 * 86400000).toISOString()
  const [acc, none] = await Promise.all([
    supabase.from('jobs').select('id,title,scheduled_date,scheduled_time,employee_name,spot_responded_at')
      .eq('job_category', 'spot').eq('spot_status', 'accepted').gte('spot_responded_at', since).order('spot_responded_at', { ascending: false }).limit(20),
    supabase.from('jobs').select('id,title,scheduled_date,scheduled_time')
      .is('employee_id', null).eq('status', 'assigned').gte('scheduled_date', today).lte('scheduled_date', tomorrow).limit(100),
  ])
  const unassigned = none.data || []
  return {
    accepted: (acc.data || []).map(j => ({ ...j, id: `spot-acc-${j.id}`, jobId: j.id })),
    noPerson: unassigned.length ? [{ id: `noperson-${today}-${unassigned.length}`, count: unassigned.length, first: unassigned[0] }] : [],
  }
}
