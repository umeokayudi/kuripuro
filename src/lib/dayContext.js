// What the company has on given days, so a day-off request can be judged in context:
// the jobs scheduled, who is already off, and how many people are still free.
import { supabase } from './supabase'

export async function fetchDayContext(dates) {
  const list = [...new Set((dates || []).filter(Boolean))]
  if (!list.length) return {}
  const [jobs, off, emps] = await Promise.all([
    supabase.from('jobs')
      .select('id,title,client_name,scheduled_date,scheduled_time,employee_id,employee_name,area,status')
      .in('scheduled_date', list).neq('status', 'cancelled')
      .order('scheduled_time', { ascending: true }).limit(1000),
    supabase.from('employee_availability')
      .select('id,employee_id,employee_name,date,status')
      .eq('kind', 'off').in('date', list).in('status', ['approved', 'pending']).limit(1000),
    supabase.from('employees').select('id,full_name,is_active').limit(1000),
  ])
  const active = (emps.data || []).filter(e => e.is_active !== false)
  const nameOf = (id, fallback) => fallback || active.find(e => e.id === id)?.full_name || '—'
  const out = {}
  for (const d of list) {
    const dayJobs = (jobs.data || []).filter(j => j.scheduled_date === d)
    const dayOff = (off.data || []).filter(r => r.date === d)
      .map(r => ({ ...r, employee_name: nameOf(r.employee_id, r.employee_name) }))
    const offIds = new Set(dayOff.filter(r => r.status === 'approved').map(r => r.employee_id))
    out[d] = { jobs: dayJobs, off: dayOff, activeCount: active.length, freeCount: active.filter(e => !offIds.has(e.id)).length }
  }
  return out
}

/** The day's context seen from one request: the requester's own jobs and everyone else's. */
export function contextForRequest(ctx, req) {
  if (!ctx) return null
  const mine = ctx.jobs.filter(j => j.employee_id === req.employee_id)
  const othersOff = ctx.off.filter(r => r.employee_id !== req.employee_id)
  // If this request is approved, the requester is one more person off
  const freeAfter = req.kind === 'off' ? ctx.freeCount - (ctx.off.some(r => r.id === req.id && r.status === 'approved') ? 0 : 1) : ctx.freeCount
  return { ...ctx, mine, othersOff, freeAfter }
}
