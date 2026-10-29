// v1.0.100 · Service report = the full record of the job. Pure helpers used by the Reports detail
// (ReportSheet) and the Reports list (notes counter). Nothing here touches the database.

// Lines the system and the admin add to jobs.description: "[2026-10-29 07:30:27] text"
const STAMPED_LINE = /^\[(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?\]\s*(.+)$/

/** "2026-10-29 07:30:27" in Tokyo time (the format already used in jobs.description). */
export function tokyoStamp(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`
}

/** Description with one more stamped note at the end: "[time] Author: text". */
export function appendJobNote(description, author, text, date = new Date()) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return description || ''
  const line = `[${tokyoStamp(date)}] ${author ? `${String(author).trim()}: ` : ''}${clean}`
  return description ? `${String(description).replace(/\s+$/, '')}\n${line}` : line
}

// "[t] Gabriel assumiu de Guilherme" is a hand-over, not a note: it goes to the audit footer.
// Times come as "...+09:00" and "...Z": compare real instants, not text
const byTime = (a, b) => (Date.parse(a.at || '') || 0) - (Date.parse(b.at || '') || 0)

const HANDOVER = /\b(assumiu de|took over from|から引き継ぎ)\b/i

function stampedLines(description) {
  return String(description || '').split('\n').map(l => l.trim()).map(l => {
    const m = l.match(STAMPED_LINE)
    if (!m) return null
    const body = m[3]
    const colon = body.match(/^([^:]{2,60}):\s+(.+)$/)
    return {
      at: `${m[1]}T${m[2]}:00+09:00`,
      author: colon ? colon[1].trim() : null,
      text: colon ? colon[2].trim() : body.trim(),
      raw: body,
      handover: HANDOVER.test(body),
    }
  }).filter(Boolean)
}

/**
 * Notes timeline of a job, oldest first: { at, author, role: 'admin'|'employee'|'system', text, kind }.
 * Sources: stamped lines in jobs.description (admin notes), jobs.notes_employee (employee note
 * at finish), jobs.retro_report (late report) and admin log reasons (adjust time, manual close).
 */
export function jobNotes(job, logs = []) {
  if (!job) return []
  const out = []
  for (const l of stampedLines(job.description)) {
    if (l.handover) continue
    out.push({ at: l.at, author: l.author, role: 'admin', text: l.text, kind: 'note' })
  }
  const emp = String(job.notes_employee || '').trim()
  if (emp) out.push({ at: job.completed_at || null, author: job.employee_name || null, role: 'employee', text: emp, kind: 'finish' })
  const retro = String(job.retro_report || '').trim()
  if (retro && retro !== emp) out.push({ at: job.completed_at || null, author: job.employee_name || null, role: 'employee', text: retro, kind: 'retro' })
  if (job.closed_manually_note) out.push({ at: job.closed_manually_at || null, author: job.closed_manually_by || null, role: 'admin', text: job.closed_manually_note, kind: 'manual_close' })
  for (const g of logs || []) {
    if (!g?.reason || (g.action === 'manual_close' && job.closed_manually_note)) continue
    out.push({ at: g.created_at || null, author: g.admin_name || null, role: 'admin', text: g.reason, kind: g.action || 'log' })
  }
  return out.sort(byTime)
}

/** Notes counter for the Reports list (without the admin log, which needs one query per job). */
export function jobNoteCount(job) {
  return jobNotes(job).length
}

/** How the job was done: 'manual' (closed by the admin), 'retro' (reported late) or 'live'. */
export function executionMode(job, logs = []) {
  if (!job) return 'live'
  if (job.closed_manually_at || (logs || []).some(g => g.action === 'manual_close' || g.action === 'admin_complete')) return 'manual'
  if (job.retro_report != null) return 'retro'
  return 'live'
}

/** Who closed it by hand and when (null when the employee finished it). */
export function manualClose(job, logs = []) {
  if (job?.closed_manually_at) return { at: job.closed_manually_at, by: job.closed_manually_by || null, note: job.closed_manually_note || null }
  const g = (logs || []).find(x => x.action === 'manual_close' || x.action === 'admin_complete')
  return g ? { at: g.created_at, by: g.admin_name || null, note: g.reason || null } : null
}

/**
 * Audit footer, oldest first: { at, who, what } where `what` is a key the screen translates:
 * created, started, finished_app, finished_retro, closed_manual, handover, admin:<action>.
 */
export function jobAudit(job, logs = []) {
  if (!job) return []
  const rows = []
  if (job.created_at) rows.push({ at: job.created_at, who: null, what: 'created' })
  if (job.started_at) rows.push({ at: job.started_at, who: job.employee_name || null, what: 'started' })
  const manual = manualClose(job, logs)
  if (manual) rows.push({ at: manual.at, who: manual.by, what: 'closed_manual', note: manual.note })
  else if (job.completed_at) rows.push({ at: job.completed_at, who: job.employee_name || null, what: job.retro_report != null ? 'finished_retro' : 'finished_app' })
  for (const l of stampedLines(job.description)) {
    if (l.handover) rows.push({ at: l.at, who: null, what: 'handover', note: l.raw })
  }
  for (const g of logs || []) {
    if (g.action === 'manual_close' || g.action === 'admin_complete') continue
    rows.push({ at: g.created_at, who: g.admin_name || null, what: `admin:${g.action}`, note: g.reason || null })
  }
  return rows.sort(byTime)
}
