// Agenda do Dia: pure helpers shared by the admin Agenda, Live Track, Reports and the employee timer.
import { getCleaningType, locationNameFromTitle } from './cleaningType'
import { checklistTemplateForJob, parseChecklistTemplate } from './jobChecklist'
import { isMissedJob, hoursPastScheduled, tokyoDateString } from './jobOverdue'

export const DEFAULT_AGENDA_SETTINGS = { tolerance_min: 30, cap_factor: 2 }
const DEFAULT_MINUTES = { basic: 120, deep: 240 }

/** Store name of a job or contract: "Ibushio — AC Cleaning" / "Ibushio - Deep Clean" → "Ibushio". */
export function storeName(name) {
  return (name || '').replace(/\s+(—|-)\s+.*$/, '').trim()
}

const sameStore = (a, b) => !!a && !!b && storeName(a).toLowerCase() === storeName(b).toLowerCase()

/** Contract that prices this job: same store, deep-clean contract for deep jobs when there is one. */
export function contractForAgendaJob(job, contracts = []) {
  const loc = locationNameFromTitle(job?.title || '')
  const active = (contracts || []).filter(c => c.is_active !== false && c.location_name)
  const exact = active.find(c => c.location_name.toLowerCase() === loc.toLowerCase())
  const deep = getCleaningType(job) === 'deep'
  const store = active.filter(c => (job?.location_id && c.location_id === job.location_id) || sameStore(c.location_name, loc))
  const isDeepContract = c => /deep/i.test(c.location_name) || /deep/i.test(c.service_type || '')
  if (deep) return store.find(c => /deep clean/i.test(c.location_name)) || exact || store.find(isDeepContract) || store[0] || null
  return exact || store.find(c => !/ — |deep/i.test(c.location_name)) || store[0] || null
}

/** Planned minutes: the job's own value, else the contract's hours per visit, else a default by type. */
export function expectedMinutes(job, contract) {
  const own = Number(job?.expected_minutes)
  if (own > 0) return own
  const hrs = Number(contract?.hours_per_visit)
  if (hrs > 0) return Math.round(hrs * 60)
  return DEFAULT_MINUTES[getCleaningType(job)] || DEFAULT_MINUTES.basic
}

/** Checklist lines for the job: job template / store catalog, else the place's, else the contract's. */
export function agendaChecklistItems(job, { place, contract } = {}) {
  const own = parseChecklistTemplate(checklistTemplateForJob(job))
  if (own.length) return own
  const fromPlace = splitChecklist(place?.checklist)
  if (fromPlace.length) return fromPlace
  return splitChecklist(contract?.training_checklist)
}

/** One item per line; also splits old one-line lists saved as "a; b; c" or "• a • b". */
export function splitChecklist(text) {
  if (!text) return []
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const parts = lines.length === 1 && /[;•]/.test(lines[0]) ? lines[0].split(/[;•]/) : lines
  return parts.map(l => l.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean)
}

/** Which checklist items are done, from the job's saved counters and missed list. */
export function checklistProgress(job, items) {
  const total = items.length
  if (!total) return { total: 0, done: 0, items: [] }
  const missedText = job?.checklist_missed_items || ''
  const savedDone = job?.checklist_done == null ? null : Number(job.checklist_done)
  const matches = missedText ? items.filter(l => missedText.includes(l)).length : 0
  let rows
  if (savedDone == null) rows = items.map(label => ({ label, done: false }))
  else if (!missedText) rows = items.map(label => ({ label, done: savedDone >= total || job.status === 'completed' }))
  else if (matches) rows = items.map(label => ({ label, done: !missedText.includes(label) }))
  else {
    // Saved with another list (old template): only the count is known.
    const n = Math.min(total, savedDone)
    return { total, done: n, items: items.map(label => ({ label, done: false })), countOnly: true }
  }
  return { total, done: rows.filter(r => r.done).length, items: rows }
}

/** Fields to save after ticking items on the card. */
export function checklistUpdate(rows) {
  const missed = rows.filter(r => !r.done).map(r => r.label)
  return {
    checklist_total: rows.length || null,
    checklist_done: rows.length ? rows.length - missed.length : null,
    checklist_missed_items: missed.length ? missed.join(', ') : null,
  }
}

/** Minutes since start for a running job (or start→finish for a finished one). */
export function elapsedMinutes(job, now = new Date()) {
  if (!job?.started_at) return null
  const end = job.completed_at ? new Date(job.completed_at) : now
  return Math.max(0, Math.round((end - new Date(job.started_at)) / 60000))
}

/**
 * Time state of a job against its plan.
 * 'cap' = past the automatic ceiling (count paused, needs confirmation),
 * 'overrun' = open past planned + tolerance, 'running' / 'ok' otherwise.
 */
export function timeState(job, expected, settings = DEFAULT_AGENDA_SETTINGS, now = new Date()) {
  if (job?.status !== 'in_progress' || !job.started_at) return { state: 'ok', elapsed: elapsedMinutes(job, now) }
  const elapsed = elapsedMinutes(job, now)
  const tol = Number(settings?.tolerance_min ?? DEFAULT_AGENDA_SETTINGS.tolerance_min)
  const cap = Math.round(expected * Number(settings?.cap_factor ?? DEFAULT_AGENDA_SETTINGS.cap_factor))
  if (elapsed >= cap) return { state: 'cap', elapsed, cap, limit: expected + tol }
  if (elapsed > expected + tol) return { state: 'overrun', elapsed, cap, limit: expected + tol, over: elapsed - expected }
  return { state: 'running', elapsed, cap, limit: expected + tol }
}

/** Minutes counted for a job: never more than the ceiling unless an admin confirmed it. */
export function cappedMinutes(minutes, expected, settings = DEFAULT_AGENDA_SETTINGS) {
  if (minutes == null || !expected) return minutes
  return Math.min(minutes, Math.round(expected * Number(settings?.cap_factor ?? 2)))
}

/** Finished without the After photo: shown as "waiting for After photo", still counts as done. */
export const awaitingAfterPhoto = job => job?.status === 'completed' && !job.photo_end_url && !job.retro_report

/** Finished with an After photo the AI has not graded yet. */
export const aiPending = job => job?.status === 'completed' && !!job.photo_end_url && job.photo_ai_score == null

/**
 * 'done' | 'late' | 'pending' (null for cancelled).
 * Late = not finished and its time passed (day over, or today past start + tolerance), or running over.
 */
export function progressBucket(job, { expected, settings = DEFAULT_AGENDA_SETTINGS, now = new Date() } = {}) {
  if (!job || job.status === 'cancelled') return null
  if (job.status === 'completed') return 'done'
  if (job.scheduled_date && job.scheduled_date < tokyoDateString(now)) return 'late'
  if (isMissedJob(job, now)) return 'late'
  const tol = Number(settings?.tolerance_min ?? 30)
  if (job.status === 'in_progress' && expected && timeState(job, expected, settings, now).state !== 'running') return 'late'
  if (job.status !== 'in_progress' && job.scheduled_date === tokyoDateString(now) && /^\d{1,2}:\d{2}/.test(job.scheduled_time || '')
    && hoursPastScheduled(job, now) * 60 > tol) return 'late'
  return 'pending'
}

/** Jobs of one person in execution order (sequence_order, then time). */
export function sortByOrder(list) {
  return [...list].sort((a, b) =>
    (a.sequence_order ?? 9999) - (b.sequence_order ?? 9999)
    || (a.scheduled_time || '99:99').localeCompare(b.scheduled_time || '99:99')
    || (a.title || '').localeCompare(b.title || ''))
}

/** Columns for the Agenda: one per person with jobs (or in `people`), plus "no one" when needed. */
export function agendaColumns(jobs, employees, people = null) {
  const visible = (jobs || []).filter(j => j.status !== 'cancelled')
  const cols = []
  for (const e of employees || []) {
    if (people?.size && !people.has(e.id)) continue
    const mine = visible.filter(j => j.employee_id === e.id)
    if (!mine.length && !people?.has(e.id)) continue
    cols.push({ id: e.id, name: e.full_name, jobs: sortByOrder(mine) })
  }
  // People who left the active list but still have jobs that day.
  const known = new Set((employees || []).map(e => e.id))
  const orphans = [...new Set(visible.filter(j => j.employee_id && !known.has(j.employee_id)).map(j => j.employee_id))]
  for (const id of orphans) {
    if (people?.size && !people.has(id)) continue
    const mine = visible.filter(j => j.employee_id === id)
    cols.push({ id, name: mine[0]?.employee_name || '—', jobs: sortByOrder(mine) })
  }
  const none = visible.filter(j => !j.employee_id)
  if (none.length && (!people?.size || people.has(''))) cols.push({ id: '', name: null, jobs: sortByOrder(none) })
  return cols
}

/** Move one job inside / between columns; returns the new id order of the target column. */
export function moveInList(ids, id, toIndex) {
  const rest = ids.filter(x => x !== id)
  const at = Math.max(0, Math.min(toIndex, rest.length))
  return [...rest.slice(0, at), id, ...rest.slice(at)]
}

/** sequence_order updates needed so the list shows in `ids` order (1-based). */
export function orderUpdates(ids, jobsById) {
  return ids.map((id, i) => ({ id, sequence_order: i + 1 }))
    .filter(u => jobsById[u.id]?.sequence_order !== u.sequence_order)
}

/** Buckets per day / ISO week / month for the done × pending × late chart. */
export function bucketKey(dateStr, unit) {
  if (unit === 'month') return dateStr.slice(0, 7)
  if (unit === 'week') {
    const d = new Date(dateStr + 'T12:00:00Z')
    const dow = (d.getUTCDay() + 6) % 7
    d.setUTCDate(d.getUTCDate() - dow)
    return d.toISOString().slice(0, 10)
  }
  return dateStr
}

export function progressSeries(jobs, { unit = 'day', expectedOf = () => null, settings, now = new Date() } = {}) {
  const map = new Map()
  for (const j of jobs || []) {
    if (!j.scheduled_date) continue
    const b = progressBucket(j, { expected: expectedOf(j), settings, now })
    if (!b) continue
    const key = bucketKey(j.scheduled_date, unit)
    const row = map.get(key) || { key, done: 0, pending: 0, late: 0, ids: { done: [], pending: [], late: [] } }
    row[b]++
    row.ids[b].push(j.id)
    map.set(key, row)
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/** "What to fix" lines from the AI issues text. */
export function aiIssueList(text) {
  return String(text || '').split(/\s*[,;\n]\s*/).map(s => s.trim()).filter(Boolean)
}
