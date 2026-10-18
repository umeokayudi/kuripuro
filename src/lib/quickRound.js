// "Rodada rápida": a simplified shift for selected accounts only (today: Alexandre).
// One Start button saves the start time; then each restaurant is ticked as done.
// No checklist, photo, GPS or signature. Each job gets started_at = previous tick
// (or the round start) and completed_at = the tick, so durations add up.
// Keyed only by employees.id, like employeeTheme.js, so nobody else can match it.
import { manualAddLocations, employeeAddService } from './employeeAddJob'
import { jobMatchesLocationAndType, locationNameFromTitle } from './cleaningType'
import { syncServiceReport } from './jobReport'
import { tokyoToday } from './dates'

export const ALEXANDRE_EMPLOYEE_ID = '4c064fb5-e39d-4086-a798-f6e670730bac' // Alexandre Umeoka

const QUICK_ROUND_IDS = new Set([ALEXANDRE_EMPLOYEE_ID])

export const QUICK_ROUND_NOTE = '⚡ Rodada rápida (sem checklist, foto ou GPS)'

export function quickRoundEnabledFor(user) {
  return !!user && user.role === 'employee' && typeof user.id === 'string' && QUICK_ROUND_IDS.has(user.id)
}

const storageKey = (employeeId) => `kp_quick_round_${employeeId}`

// { date, startedAt, endedAt, done: [{ key, name, jobId, at }] }
export function loadRound(employeeId) {
  try {
    const raw = localStorage.getItem(storageKey(employeeId))
    const round = raw ? JSON.parse(raw) : null
    if (!round?.startedAt || !Array.isArray(round.done)) return null
    return round
  } catch { return null }
}

export function saveRound(employeeId, round) {
  try {
    if (round) localStorage.setItem(storageKey(employeeId), JSON.stringify(round))
    else localStorage.removeItem(storageKey(employeeId))
  } catch { /* private mode: round lives only in memory */ }
}

export function newRound() {
  return { date: tokyoToday(), startedAt: new Date().toISOString(), endedAt: null, done: [] }
}

// Where the next job's time starts: the last tick, or the round start.
export function segmentStart(round) {
  const last = round.done[round.done.length - 1]
  return last?.at || round.startedAt
}

/**
 * Rows to show: the employee's own jobs for today first (any client/type),
 * then every restaurant from the catalog that has basic cleaning.
 */
export function quickRoundRows(todayJobs, employeeId) {
  const mine = (todayJobs || []).filter(j =>
    j.employee_id === employeeId && j.status !== 'cancelled')
  const rows = mine.map(job => ({
    key: `job:${job.id}`,
    name: locationNameFromTitle(job.title) || job.title,
    title: job.title,
    job,
    location: null,
    scheduled: true,
  }))
  for (const loc of manualAddLocations()) {
    if (loc.group === 'Spot' || loc.deepOnly) continue
    if (mine.some(j => jobMatchesLocationAndType(j, loc.name, 'basic'))) continue
    rows.push({ key: `loc:${loc.name}`, name: loc.name, title: loc.name, job: null, location: loc, scheduled: false })
  }
  return rows
}

async function findMyJobAtLocation(supabase, employeeId, locationName, date) {
  const { data } = await supabase.from('jobs').select('*')
    .eq('employee_id', employeeId).eq('scheduled_date', date).neq('status', 'cancelled')
  return (data || []).find(j => jobMatchesLocationAndType(j, locationName, 'basic')) || null
}

/**
 * Marks one row as done. Returns { ok, job } or { ok:false, error, detail }.
 */
export async function completeQuickRow(supabase, { employee, row, startedAt }) {
  const date = tokyoToday()
  let job = row.job
  if (!job) {
    const added = await employeeAddService(supabase, {
      employee, location: row.location, date, cleaningType: 'basic', deepComponents: [],
    })
    if (added.ok) job = added.job
    else if (added.error === 'already_yours') job = await findMyJobAtLocation(supabase, employee.id, row.location.name, date)
    else return { ok: false, error: added.error, detail: added.detail }
    if (!job) return { ok: false, error: 'not_found' }
  }
  if (job.status === 'completed') return { ok: true, job, already: true }

  const now = new Date().toISOString()
  const start = job.started_at && job.started_at < now ? job.started_at : startedAt
  const { data, error } = await supabase.from('jobs').update({
    status: 'completed',
    started_at: start,
    completed_at: now,
    notes_employee: [job.notes_employee, QUICK_ROUND_NOTE].filter(Boolean).join('\n'),
  }).eq('id', job.id).select().maybeSingle()
  if (error || !data) return { ok: false, error: 'update_failed', detail: error?.message }
  try { await syncServiceReport(supabase, data) } catch (ex) { console.log('service_report sync skipped', ex?.message) }
  return { ok: true, job: data }
}

/** Undo a tick made in this round: the job goes back to pending. */
export async function undoQuickRow(supabase, jobId) {
  const { data: job } = await supabase.from('jobs').select('id,notes_employee').eq('id', jobId).maybeSingle()
  const notes = (job?.notes_employee || '').split('\n').filter(l => l !== QUICK_ROUND_NOTE).join('\n') || null
  const { error } = await supabase.from('jobs').update({
    status: 'assigned', started_at: null, completed_at: null, notes_employee: notes,
  }).eq('id', jobId)
  return { ok: !error, detail: error?.message }
}
