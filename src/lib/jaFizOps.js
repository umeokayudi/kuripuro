// v1.0.156 · "Já fiz" save (database + storage). Pure rules live in jaFiz.js.
import { supabase } from './supabase'
import { employeeJobColumns, employeeSafeJob } from './jobEmployeePay'
import { uploadJobPhoto } from './uploadPhoto'
import { syncServiceReport } from './jobReport'
import { finishQuoteJob } from './quoteFlow'
import { askClientRating } from './clientRatingAsk'
import { logJobAdmin } from './jobAdminOps'
import { employeeMessageLang } from './employeeLang'
import { storagePublicUrl } from './workReport'
import { jaFizPatch, jaFizAudit, isMissingJaFizColumn, jaFizPermission, JA_FIZ_COLUMNS, JA_FIZ_AUDIT_FILE } from './jaFiz'

const BUCKET = 'service-photos'

async function putAudit(jobId, audit) {
  const body = new Blob([JSON.stringify(audit)], { type: 'application/json' })
  const { error } = await supabase.storage.from(BUCKET).upload(`jobs/${jobId}/${JA_FIZ_AUDIT_FILE}`, body, { upsert: true, contentType: 'application/json', cacheControl: '0' })
  return !error
}

/** Audit of a job registered with "Já fiz" (null when there is none). */
export async function loadJaFizAudit(jobId) {
  if (!jobId) return null
  try {
    const r = await fetch(`${storagePublicUrl(`jobs/${jobId}/${JA_FIZ_AUDIT_FILE}`)}?t=${Date.now()}`, { cache: 'no-store' })
    return r.ok ? await r.json() : null
  } catch { return null }
}

const hm = iso => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false })

function officeMessage(job, times, actor, lang) {
  const place = String(job.title || '').replace(/ — .*/, '')
  const d = (job.scheduled_date || '').slice(5).split('-').reverse().join('/')
  if (lang === 'ja') return `✓ 事務所が「${place}」（${d}）を完了として事後登録しました: ${hm(times.startedAt)}–${hm(times.completedAt)}。違う場合は返信してください。— ${actor.name}`
  if (lang === 'en') return `✓ The office registered "${place}" (${d}) as done afterwards: ${hm(times.startedAt)}–${hm(times.completedAt)}. Reply if this is wrong. — ${actor.name}`
  return `✓ O escritório registrou "${place}" (${d}) como feito, depois: ${hm(times.startedAt)}–${hm(times.completedAt)}. Responda se estiver errado. — ${actor.name}`
}

/**
 * Saves the "Já fiz" popup. `photos` = { before: File[], after: File[] }.
 * actor = { id, name, role: 'employee' | 'admin' }.
 * Returns { job, audit: { columns, file, log }, notified }. Throws Error('closed' | <permission reason>).
 */
export async function saveJaFiz(job, { times, checklist = [], note = '', photos = { before: [], after: [] }, actor }) {
  const perm = jaFizPermission(job, { role: actor.role, userId: actor.id })
  if (!perm.ok) throw new Error(perm.reason)
  const before = (photos.before || []).slice(0, 10)
  const after = (photos.after || []).slice(0, 10)
  const startPaths = []
  const endPaths = []
  for (let i = 0; i < before.length; i++) startPaths.push(await uploadJobPhoto(`jobs/${job.id}/start_${i}.jpg`, before[i]))
  for (let i = 0; i < after.length; i++) endPaths.push(await uploadJobPhoto(`jobs/${job.id}/end_${i}.jpg`, after[i]))

  const now = new Date()
  const base = { times, checklist, note, actor, photoStart: startPaths[0] || null, photoEnd: endPaths[0] || null, now }
  // Only a job still never opened: if the employee started it meanwhile, nothing is overwritten.
  // v1.0.157 · the row coming back never carries the client value (the employee may be the one saving)
  const cols = await employeeJobColumns(supabase)
  const write = patch => supabase.from('jobs').update(patch).eq('id', job.id).eq('status', 'assigned').is('started_at', null).select(columns ? [cols, ...JA_FIZ_COLUMNS].join(',') : cols).maybeSingle()
  let columns = true
  let { data, error } = await write(jaFizPatch(base))
  if (error && isMissingJaFizColumn(error)) {
    columns = false
    ;({ data, error } = await write(jaFizPatch({ ...base, audit: false })))
  }
  if (error) throw error
  if (!data) throw new Error('closed')
  const done = columns ? data : { ...data, ...Object.fromEntries(JA_FIZ_COLUMNS.map(k => [k, null])) }

  const audit = jaFizAudit({ job, times, checklist, note, actor, photos: { before: startPaths.length, after: endPaths.length }, now })
  const file = await putAudit(job.id, audit).catch(() => false)
  const log = await logJobAdmin(job.id, 'ja_fiz', {
    reason: note?.trim() || null,
    oldValue: { status: job.status, started_at: null, completed_at: null },
    newValue: { status: 'completed', started_at: times.startedAt, completed_at: times.completedAt, by: actor.name, role: actor.role },
  }).catch(() => false)

  try { await syncServiceReport(supabase, done) } catch (e) { console.error('service_report sync failed', e?.message) }
  finishQuoteJob(job.id, { byAdmin: actor.role === 'admin' })
  if (actor.role !== 'admin') askClientRating(done)

  let notified = false
  if (actor.role === 'admin' && job.employee_id) {
    const lang = await employeeMessageLang(job.employee_id).catch(() => 'pt')
    const { error: msgErr } = await supabase.from('messages').insert({
      employee_id: job.employee_id, employee_name: job.employee_name, sender: 'admin', read: false,
      content: officeMessage(job, times, actor, lang),
    })
    notified = !msgErr
  }
  return { job: done, audit: { columns, file, log }, notified }
}
