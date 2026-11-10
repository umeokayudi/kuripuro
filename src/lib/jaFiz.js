// v1.0.156 · "Já fiz": the employee did the service but never opened it in the app (forgot).
// One popup registers it afterwards: start/finish (planned time pre-filled), checklist, before/after
// photos, note → COMPLETED with the "Retroativo" badge (jobs.retro_report not null) and an audit
// (who registered, when, the hours given).
//
// Not the same as "Fechar manualmente" (job IN PROGRESS left open). This is only for a job that is
// still pending/late and was never started: status 'assigned' and no started_at.
//
// Audit is kept in three places, each one optional so nothing breaks without SQL:
//   1. jobs.retro_registered_by / _role / _at   (sql/2026-11-05_ja_fiz_auditoria.sql — needs OK)
//   2. storage service-photos/jobs/<id>/ja_fiz.json  (always; read by the report sheet)
//   3. job_admin_log action 'ja_fiz'                 (when that table exists)
import { tokyoDateString } from './jobOverdue.js'
import { suggestedWindow } from './manualClose.js'

export const JA_FIZ_COLUMNS = ['retro_registered_by', 'retro_registered_role', 'retro_registered_at']
export const JA_FIZ_AUDIT_FILE = 'ja_fiz.json'
export const JA_FIZ_DEFAULT_MIN = 60

const TZ = 'Asia/Tokyo'
const hm = iso => (iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }) : '')

/** Pending or late and never opened in the app. */
export const isJaFizCandidate = job => !!job && job.status === 'assigned' && !job.started_at

/**
 * Who may register it now. Employee: only own job and only until the end of its own day (Tokyo).
 * Admin: any day. Returns { ok, reason: null | 'not_pending' | 'not_mine' | 'day_closed' | 'future' }.
 */
export function jaFizPermission(job, { role, userId }, now = new Date()) {
  if (!isJaFizCandidate(job)) return { ok: false, reason: 'not_pending' }
  const today = tokyoDateString(now)
  if (job.scheduled_date && job.scheduled_date > today) return { ok: false, reason: 'future' }
  if (role === 'admin') return { ok: true, reason: null }
  if (job.employee_id && userId && job.employee_id !== userId) return { ok: false, reason: 'not_mine' }
  if (job.scheduled_date !== today) return { ok: false, reason: 'day_closed' }
  return { ok: true, reason: null }
}

/** Planned start/finish as "HH:MM" (Tokyo), never ending in the future. */
export function jaFizDefaults(job, expectedMin, now = new Date()) {
  const w = suggestedWindow(job, expectedMin > 0 ? expectedMin : JA_FIZ_DEFAULT_MIN, null, now)
  return { start: hm(w.startedAt), end: hm(w.completedAt) }
}

/**
 * Turns the two "HH:MM" of the popup into ISO times on the job's day (Tokyo).
 * A finish earlier than the start is the next morning (night jobs).
 */
export function jaFizTimes(job, start, end) {
  const day = job?.scheduled_date || tokyoDateString()
  if (!/^\d{1,2}:\d{2}$/.test(start || '') || !/^\d{1,2}:\d{2}$/.test(end || '')) return null
  const at = t => new Date(`${day}T${t.padStart(5, '0')}:00+09:00`)
  const s = at(start)
  let e = at(end)
  if (e <= s) e = new Date(e.getTime() + 864e5)
  return { startedAt: s.toISOString(), completedAt: e.toISOString(), minutes: Math.round((e - s) / 60000) }
}

/** 'times' | 'future' | 'long' | 'checklist' | 'photo' | null */
export function jaFizError({ times, checklist = [], photos = { before: 0, after: 0 }, role, signature, requireSignature = false }, now = new Date()) {
  if (!times) return 'times'
  if (new Date(times.completedAt).getTime() > now.getTime() + 60000) return 'future'
  if (times.minutes > 16 * 60) return 'long'
  if (checklist.length && !checklist.every(c => c.done) && role !== 'admin') {
    const done = checklist.filter(c => c.done).length
    const need = checklist.length <= 3 ? checklist.length : Math.ceil(checklist.length * 0.7)
    if (done < need) return 'checklist'
  }
  // Employee: at least one photo (same rule as the old late report). Admin may close without
  // one; the job then waits for the After photo like the manual close.
  if (role !== 'admin' && !(photos.before + photos.after)) return 'photo'
  // v1.0.207 · "Já fiz" is signed like Concluir
  if (requireSignature && !signature) return 'signature'
  return null
}

/** Fields written on the job. `audit` false = the SQL columns are not there yet. */
export function jaFizPatch({ times, checklist = [], note = '', actor, photoStart = null, photoEnd = null, signature = null, now = new Date(), audit = true }) {
  const total = checklist.length
  const done = checklist.filter(c => c.done).length
  const missed = checklist.filter(c => !c.done).map(c => c.label)
  const patch = {
    status: 'completed',
    started_at: times.startedAt,
    completed_at: times.completedAt,
    retro_report: (note || '').trim(), // not null = "Retroativo" everywhere (badge, reports, bell)
    retro_time_min: times.minutes,
    checklist_total: total || null,
    checklist_done: total ? done : null,
    checklist_missed_items: missed.length ? missed.join(', ') : null,
    // the office registered it itself → nothing left to review; an employee's goes to the bell
    admin_reviewed: actor?.role === 'admin',
  }
  if ((note || '').trim()) patch.notes_employee = note.trim()
  if (photoStart) patch.photo_start_url = photoStart
  if (photoEnd) patch.photo_end_url = photoEnd
  // v1.0.207 · signed like a normal finish (same column the report and PDF read)
  if (signature) patch.signature_url = signature
  if (audit) {
    patch.retro_registered_by = actor?.name || null
    patch.retro_registered_role = actor?.role || null
    patch.retro_registered_at = now.toISOString()
  }
  return patch
}

export const isMissingJaFizColumn = err => {
  const msg = `${err?.code || ''} ${err?.message || ''}`
  return /PGRST204|42703/.test(msg) || /retro_registered_\w+/.test(msg)
}

/** Audit record kept next to the job's photos. */
export function jaFizAudit({ job, times, checklist = [], note = '', actor, photos, signature = null, now = new Date() }) {
  return {
    kind: 'ja_fiz',
    job_id: job.id,
    scheduled_date: job.scheduled_date || null,
    scheduled_time: job.scheduled_time || null,
    employee_id: job.employee_id || null,
    employee_name: job.employee_name || null,
    registered_by: actor?.name || null,
    registered_by_id: actor?.id || null,
    registered_role: actor?.role || null,
    registered_at: now.toISOString(),
    started_at: times.startedAt,
    completed_at: times.completedAt,
    minutes: times.minutes,
    checklist_done: checklist.filter(c => c.done).length,
    checklist_total: checklist.length,
    note: (note || '').trim() || null,
    photos_before: photos?.before || 0,
    photos_after: photos?.after || 0,
    signed: !!signature,
  }
}

/** Short audit line: "Registrado depois por Gabriel (funcionário) em 05/11 10:12 · informado 09:00–12:30". */
export function jaFizStamp(a, lang = 'pt') {
  if (!a) return ''
  const when = a.registered_at ? new Date(a.registered_at).toLocaleString(lang === 'ja' ? 'ja-JP' : lang === 'pt' ? 'pt-BR' : 'en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
  const who = a.registered_by || '—'
  const span = a.started_at && a.completed_at ? `${hm(a.started_at)}–${hm(a.completed_at)}` : ''
  if (lang === 'ja') return `${who}（${a.registered_role === 'admin' ? '管理者' : 'スタッフ'}）が${when}に事後登録${span ? ` · 申告 ${span}` : ''}`
  if (lang === 'en') return `Registered later by ${who} (${a.registered_role === 'admin' ? 'admin' : 'employee'}) on ${when}${span ? ` · reported ${span}` : ''}`
  return `Registrado depois por ${who} (${a.registered_role === 'admin' ? 'admin' : 'funcionário'}) em ${when}${span ? ` · informado ${span}` : ''}`
}

/** Audit from the job columns, when the SQL is applied. */
export function jaFizAuditFromJob(job) {
  if (!job?.retro_registered_at) return null
  return { registered_by: job.retro_registered_by, registered_role: job.retro_registered_role, registered_at: job.retro_registered_at, started_at: job.started_at, completed_at: job.completed_at }
}
