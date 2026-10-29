// Admin writes on jobs that must follow one rule everywhere:
// a finished job = status completed + service report + (salary and billing read completed jobs).
import { supabase } from './supabase'
import { syncServiceReport } from './jobReport'
import { finishQuoteJob } from './quoteFlow'
import { DEFAULT_AGENDA_SETTINGS } from './agenda'

const LS_SETTINGS = 'kp_agenda_settings'

function adminName() {
  try { return JSON.parse(localStorage.getItem('kp_user') || '{}').name || 'admin' } catch { return 'admin' }
}

/** Tolerance / ceiling: app_settings row 'agenda' when the table exists, else this browser, else defaults. */
export async function loadAgendaSettings() {
  let local = null
  try { local = JSON.parse(localStorage.getItem(LS_SETTINGS) || 'null') } catch { /* private mode */ }
  try {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'agenda').maybeSingle()
    if (!error && data?.value) return { ...DEFAULT_AGENDA_SETTINGS, ...data.value, stored: 'db' }
  } catch { /* table missing */ }
  return { ...DEFAULT_AGENDA_SETTINGS, ...(local || {}), stored: local ? 'local' : 'default' }
}

export async function saveAgendaSettings({ tolerance_min, cap_factor }) {
  const value = { tolerance_min: Math.max(0, Math.round(Number(tolerance_min) || 0)), cap_factor: Math.max(1, Number(cap_factor) || 2) }
  try { localStorage.setItem(LS_SETTINGS, JSON.stringify(value)) } catch { /* ignore */ }
  const { error } = await supabase.from('app_settings')
    .upsert({ key: 'agenda', value, updated_at: new Date().toISOString(), updated_by: adminName() }, { onConflict: 'key' })
  return { value, savedInDb: !error }
}

/** Writes one line in job_admin_log. Returns false when the table is not there yet. */
export async function logJobAdmin(jobId, action, { reason = null, oldValue = null, newValue = null } = {}) {
  const { error } = await supabase.from('job_admin_log').insert({
    job_id: jobId, action, reason, old_value: oldValue, new_value: newValue, admin_name: adminName(),
  })
  return !error
}

export async function loadJobLog(jobId) {
  const { data, error } = await supabase.from('job_admin_log').select('*').eq('job_id', jobId).order('created_at', { ascending: false })
  return error ? null : (data || [])
}

/** Finish a job from the admin side with the same effects as the employee finish. */
export async function adminCompleteJob(job, { reason = null, completedAt = null } = {}) {
  const now = new Date().toISOString()
  const patch = {
    status: 'completed',
    completed_at: completedAt || job.completed_at || now,
    started_at: job.started_at || completedAt || now,
  }
  const { data, error } = await supabase.from('jobs').update(patch).eq('id', job.id).select('*').maybeSingle()
  if (error) throw error
  const done = data || { ...job, ...patch }
  await syncServiceReport(supabase, done)
  finishQuoteJob(job.id, { byAdmin: true })
  await logJobAdmin(job.id, 'admin_complete', { reason, oldValue: { status: job.status }, newValue: patch })
  return done
}

/** Undo a finish (status back to assigned / in progress) and drop the report, so the three stay in step. */
export async function adminReopenJob(job, { reason = null } = {}) {
  const status = job.started_at ? 'in_progress' : 'assigned'
  const { error } = await supabase.from('jobs').update({ status, completed_at: null }).eq('id', job.id)
  if (error) throw error
  await supabase.from('service_reports').delete().eq('job_id', job.id)
  await logJobAdmin(job.id, 'admin_reopen', { reason, oldValue: { status: job.status, completed_at: job.completed_at }, newValue: { status } })
}

/** "Ajustar tempo": new start / finish with a reason. Refuses without a reason. */
export async function adjustJobTime(job, { startedAt, completedAt, reason }) {
  if (!reason?.trim()) throw new Error('reason')
  const patch = {}
  if (startedAt !== undefined) patch.started_at = startedAt
  if (completedAt !== undefined) patch.completed_at = completedAt
  if (patch.started_at && patch.completed_at && new Date(patch.completed_at) <= new Date(patch.started_at)) throw new Error('order')
  const logged = await logJobAdmin(job.id, 'adjust_time', {
    reason: reason.trim(),
    oldValue: { started_at: job.started_at, completed_at: job.completed_at },
    newValue: patch,
  })
  if (!logged) throw new Error('nolog')
  const { data, error } = await supabase.from('jobs').update(patch).eq('id', job.id).select('*').maybeSingle()
  if (error) throw error
  if (data?.status === 'completed') await syncServiceReport(supabase, data)
  return data
}

/** Saves a new execution order: [{ id, sequence_order }, …] (+ employee when moved to another column). */
export async function saveOrder(updates) {
  const results = await Promise.all(updates.map(({ id, ...patch }) => supabase.from('jobs').update(patch).eq('id', id)))
  const failed = results.find(r => r.error)
  if (failed) throw failed.error
}
