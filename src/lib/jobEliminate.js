// v1.0.166 · "Eliminar serviço": the admin takes a job that was registered by mistake (duplicate, wrong
// store, a 0-minute test…) out of salary and billing. It is NEVER a hard delete: the job becomes
// status 'cancelled' (salary, payroll close, Payments and invoices read only 'completed' jobs), its
// times / photos stay, and an audit JSON with who / when / why / the old values is kept in storage
// (service-photos/jobs/<id>/eliminado.json) + job_admin_log when that table exists. "Desfazer" puts it back.
import { supabase } from './supabase'
import { syncServiceReport } from './jobReport'
import { logJobAdmin } from './jobAdminOps'
import { storagePublicUrl } from './workReport'

const BUCKET = 'service-photos'
export const ELIMINATE_AUDIT_FILE = 'eliminado.json'

/** Only a job that still counts (or could count) can be eliminated. */
export const canEliminate = job => !!job && ['assigned', 'in_progress', 'completed'].includes(job.status)

/** Minutes between start and finish (null when one is missing). */
export const jobMinutes = job => (job?.started_at && job?.completed_at)
  ? Math.max(0, Math.round((new Date(job.completed_at) - new Date(job.started_at)) / 60000)) : null

/** Audit record written next to the job's photos. Pure, so it can be tested. */
export function eliminateAudit(job, { reason, adminName, now = new Date() }) {
  return {
    action: 'eliminate',
    job_id: job.id,
    reason: String(reason || '').trim(),
    by: adminName || 'admin',
    at: now.toISOString(),
    old: {
      status: job.status,
      started_at: job.started_at || null,
      completed_at: job.completed_at || null,
      employee_id: job.employee_id || null,
      employee_name: job.employee_name || null,
      scheduled_date: job.scheduled_date || null,
      title: job.title || null,
      employee_pay: job.employee_pay ?? null,
    },
    new: { status: 'cancelled' },
  }
}

function adminName() {
  try { return JSON.parse(localStorage.getItem('kp_user') || '{}').name || 'admin' } catch { return 'admin' }
}

async function putAudit(jobId, audit) {
  const body = new Blob([JSON.stringify(audit)], { type: 'application/json' })
  const { error } = await supabase.storage.from(BUCKET)
    .upload(`jobs/${jobId}/${ELIMINATE_AUDIT_FILE}`, body, { upsert: true, contentType: 'application/json', cacheControl: '0' })
  return !error
}

export async function loadEliminateAudit(jobId) {
  if (!jobId) return null
  try {
    const r = await fetch(`${storagePublicUrl(`jobs/${jobId}/${ELIMINATE_AUDIT_FILE}`)}?t=${Date.now()}`, { cache: 'no-store' })
    return r.ok ? await r.json() : null
  } catch { return null }
}

/**
 * Cancels the job (only from the status the admin saw, so a change made meanwhile is never overwritten),
 * removes its service report (it is rebuilt from the job on "Desfazer") and writes the audit.
 * Throws 'reason' | 'changed'. Returns { audit, saved } (saved = audit file written).
 */
export async function adminEliminateJob(job, { reason }) {
  if (!String(reason || '').trim()) throw new Error('reason')
  if (!canEliminate(job)) throw new Error('changed')
  const audit = eliminateAudit(job, { reason, adminName: adminName() })
  // Audit first: if storage refuses, nothing changes.
  const saved = await putAudit(job.id, audit)
  if (!saved) throw new Error('audit')
  const { data, error } = await supabase.from('jobs').update({ status: 'cancelled' })
    .eq('id', job.id).eq('status', job.status).select('id').maybeSingle()
  if (error) throw error
  if (!data) throw new Error('changed')
  await supabase.from('service_reports').delete().eq('job_id', job.id)
  await logJobAdmin(job.id, 'admin_eliminate', { reason: audit.reason, oldValue: audit.old, newValue: audit.new })
  return { audit, saved }
}

/** "Desfazer": back to the status it had, report rebuilt when it was completed. */
export async function adminRestoreJob(jobId) {
  const audit = await loadEliminateAudit(jobId)
  const status = audit?.old?.status
  if (!status) throw new Error('noaudit')
  const { data, error } = await supabase.from('jobs').update({ status })
    .eq('id', jobId).eq('status', 'cancelled').select('*').maybeSingle()
  if (error) throw error
  if (!data) throw new Error('changed')
  if (status === 'completed') { try { await syncServiceReport(supabase, data) } catch { /* rebuilt at payroll close */ } }
  await putAudit(jobId, { ...audit, restored_at: new Date().toISOString(), restored_by: adminName() })
  await logJobAdmin(jobId, 'admin_restore', { reason: audit.reason, oldValue: { status: 'cancelled' }, newValue: { status } })
  return data
}
