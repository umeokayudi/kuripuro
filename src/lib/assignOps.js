// v1.0.101 · Database writes of the assignment flow. Every way of assigning (suggestion, board,
// offer, redistribute) ends here, so the job always lands in the person's Agenda do Dia in the
// right place and the people involved get a notice.
import { supabase } from './supabase'
import { placeInDay } from './assignFlow'
import { notifyChanges, saveNotices, noticesForChange } from './assignNotices'

const shortJob = 'id,title,scheduled_date,scheduled_time,employee_id,employee_name,status,sequence_order,job_category,spot_status'

async function dayOf(employeeId, date) {
  const { data } = await supabase.from('jobs').select(shortJob).eq('employee_id', employeeId).eq('scheduled_date', date).neq('status', 'cancelled')
  return data || []
}

/** Fields that make a job belong to `emp` again (a declined spot comes back as a spot for that person). */
function ownerFields(job, emp) {
  const f = { employee_id: emp?.id || null, employee_name: emp?.full_name || null }
  if (job.status === 'cancelled') f.status = 'assigned'
  if (job.job_category === 'spot' && emp && job.spot_status !== 'accepted') { f.spot_status = 'pending'; f.spot_responded_at = null }
  // v1.0.120 · a routine job that was an open offer: given to someone, it is just their job again.
  if (job.job_category !== 'spot' && job.spot_status === 'pending') { f.spot_status = null; f.spot_responded_at = null }
  return f
}

/**
 * Give one existing job to `emp` (null = back to the Pending box).
 * @returns {{ notices: { saved, missing } }}
 */
export async function assignJob(job, emp) {
  const fields = ownerFields(job, emp)
  const ups = []
  if (emp) {
    const day = await dayOf(emp.id, job.scheduled_date)
    const order = placeInDay(day, { ...job, ...fields })
    const mine = order.find(u => u.id === job.id)
    if (mine) fields.sequence_order = mine.sequence_order
    ups.push(...order.filter(u => u.id !== job.id))
  }
  const { error } = await supabase.from('jobs').update(fields).eq('id', job.id)
  if (error) throw error
  if (ups.length) await Promise.all(ups.map(({ id, ...p }) => supabase.from('jobs').update(p).eq('id', id)))
  return { notices: await notifyChanges([[job, fields]]) }
}

/** Many at once (accept all / redistribute). Runs one by one so each day order sees the previous. */
export async function assignMany(pairs) {
  let done = 0
  let notices = { saved: 0, missing: false }
  const errors = []
  for (const { job, emp } of pairs) {
    try {
      const r = await assignJob(job, emp)
      done++
      notices = { saved: notices.saved + r.notices.saved, missing: notices.missing || r.notices.missing }
    } catch (err) { errors.push(err.message) }
  }
  return { done, errors, notices }
}

/** Notices for jobs just created by the generator (one per person: "N new jobs"). */
export async function notifyCreated(rows) {
  return saveNotices(rows.filter(r => r.employee_id).flatMap(r => noticesForChange(null, r)))
}

/**
 * Urgent job as an offer to everyone with the role: no person, spot_status pending. The first who
 * accepts in the portal keeps it (the accept only works while employee_id is still empty).
 * v1.0.120 · the offer only changes WHO does it, never the kind of job: a routine (contract) visit
 * stays a routine job with the place's normal pay; only a job that already is a spot carries a value.
 */
export async function offerJob(job, { value } = {}) {
  const spot = job.job_category === 'spot'
  const fields = {
    employee_id: null, employee_name: null, status: 'assigned', spot_status: 'pending', spot_responded_at: null,
    ...(spot && value != null ? { spot_value: Number(value) || 0 } : {}),
  }
  const { error } = await supabase.from('jobs').update(fields).eq('id', job.id)
  if (error) throw error
  return { notices: await notifyChanges([[job, fields]]) }
}

/**
 * Portal side: take an open offer. Atomic "first wins": the update only matches while nobody has it.
 * @returns 'ok' | 'taken'
 */
export async function takeOffer(job, user) {
  const { data, error } = await supabase.from('jobs')
    .update({ employee_id: user.id, employee_name: user.name, spot_status: 'accepted', spot_responded_at: new Date().toISOString() })
    .eq('id', job.id).is('employee_id', null).eq('spot_status', 'pending').select('id')
  if (error) throw error
  if (!data?.length) return 'taken'
  const day = await dayOf(user.id, job.scheduled_date)
  const order = placeInDay(day, { ...job, employee_id: user.id })
  await Promise.all(order.map(({ id, ...p }) => supabase.from('jobs').update(p).eq('id', id)))
  return 'ok'
}
