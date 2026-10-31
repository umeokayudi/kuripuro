// v1.0.101 · Employee side of the urgent offer: open jobs (no person yet; routine or spot, v1.0.120) shown to everyone whose
// role fits and who works that day. The first accept wins (assignOps.takeOffer); the others see
// "closed" in the bell the next time the app loads.
import { supabase } from './supabase'
import { tokyoToday } from './dates'
import { availabilityIndex } from './scheduleGenerator'
import { canWork } from './schedulePlan'
import { asItem, requiredRole, roleFits } from './assignFlow'

const key = (kind, uid) => `kp_offers_${kind}_${uid}`
const read = k => { try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')) } catch { return new Set() } }
const write = (k, set) => { try { localStorage.setItem(k, JSON.stringify([...set].slice(-300))) } catch { /* private mode */ } }

/** Can this employee take this open offer? (role fits the job + works that day) */
export function offerFits(job, emp, availability = {}) {
  if (!emp) return false
  const item = asItem(job)
  return roleFits(emp, requiredRole(item)) && canWork(emp, item.date, availability).ok
}

/** Open offers this person can take (hidden ones = "not for me" on this phone). */
export async function fetchOpenOffers(userId) {
  const today = tokyoToday()
  const [jobs, emp, av] = await Promise.all([
    supabase.from('jobs').select('*').is('employee_id', null).eq('spot_status', 'pending')
      .eq('status', 'assigned').gte('scheduled_date', today).order('scheduled_date').order('scheduled_time').limit(50),
    supabase.from('employees').select('id,full_name,job_role,work_days,is_active').eq('id', userId).maybeSingle(),
    supabase.from('employee_availability').select('employee_id,date,kind,status').eq('employee_id', userId).gte('date', today),
  ])
  if (jobs.error || !emp.data) return []
  const availability = availabilityIndex(av.data || [])
  const hidden = read(key('hidden', userId))
  const list = (jobs.data || []).filter(j => !hidden.has(j.id) && offerFits(j, emp.data, availability)).map(j => ({ ...j, _open: true }))
  const seen = read(key('seen', userId))
  list.forEach(j => seen.add(j.id))
  write(key('seen', userId), seen)
  return list
}

export function hideOffer(userId, jobId) {
  const hidden = read(key('hidden', userId)); hidden.add(jobId); write(key('hidden', userId), hidden)
}

/** Offers this person saw that are no longer open: someone else took them, or the office closed them. */
export async function fetchClosedOffers(userId, openIds = []) {
  const seen = read(key('seen', userId))
  const gone = [...seen].filter(id => !openIds.includes(id))
  if (!gone.length) return []
  const { data } = await supabase.from('jobs').select('id,title,scheduled_date,scheduled_time,employee_id,employee_name,spot_status,status').in('id', gone)
  const closed = (data || []).filter(j => j.employee_id !== userId)
  // Taken by me, or no longer existing: forget silently.
  const keep = new Set(closed.map(j => j.id))
  write(key('seen', userId), new Set([...seen].filter(id => openIds.includes(id) || keep.has(id))))
  return closed
}

export function dismissClosedOffers(userId, ids) {
  const seen = read(key('seen', userId))
  ids.forEach(id => seen.delete(id))
  write(key('seen', userId), seen)
}
