// v1.0.154 · Morning route × deep of the day, predicted hours and "rota impossível".
// Pure helpers (no database), shared by the Painel do Dia, the bell and the Schedule Generator.
//
//   bucket  'morning' = On The Planet night route (planned 00:30, NOT deep) → must be finished by 10:00
//           'deep'    = deep cleaning / maintenance of that same route → its OWN window: it does not
//                       share the 10:00 time budget of the basic route. Window = route opens (00:30) +
//                       the predicted hours of the deep, never earlier than 10:00.
//           'other'   = every other job (normal start time).
//   hours   predicted hours of a job = service_contracts.hours_per_visit of the contract it fulfils
//           (same match as the Generator: place + service). No contract → 2h basic / 4h deep.
//   impossible = the predicted hours of ONE person in ONE bucket are more than the time from the
//           route opening to the deadline. Only a warning: nothing is blocked or reassigned.
import { jobFulfils, splitName } from './schedulePlan.js'
import { isDeadlineJob, OTP_ROUTE_TIME, OTP_DEADLINE } from './jobDeadline.js'

const toMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null }
export const hm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
export const ROUTE_OPEN_MIN = toMin(OTP_ROUTE_TIME)
export const MORNING_DEADLINE_MIN = toMin(OTP_DEADLINE)
export const DEFAULT_MINUTES = { basic: 120, deep: 240 }

const norm = s => String(s || '').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim()
/** Deep cleaning / maintenance by the title ("Kodama — Deep Clean (Range Hood)", "— Grease Trap"…). */
export function isDeepJob(job) {
  if (!job) return false
  if (job.job_category === 'maintenance') return true
  const rest = splitName(job.title).rest
  if (!rest || /basic|básic/i.test(rest)) return false
  return job.job_category !== 'spot'
}

export function bucketOf(job) {
  if (!isDeadlineJob(job)) return 'other'
  return isDeepJob(job) ? 'deep' : 'morning'
}

/**
 * Predicted minutes of a job: the contract it fulfils (a contract naming the item wins over a generic
 * "Deep Clean" one), else the default for its kind. `targets` = schedulePlan.contractTargets().
 */
export function jobMinutes(job, targets = []) {
  const title = job?.title || ''
  const base = norm(splitName(title).base)
  const hits = (targets || []).filter(t => t.hours && norm(t.base) === base && jobFulfils(title, t))
  const best = hits.find(t => t.keyword) || hits[0]
  if (best) return Math.round(best.hours * 60)
  return DEFAULT_MINUTES[isDeepJob(job) ? 'deep' : 'basic']
}

/** Deadline (minutes of the day) of a deep of the route: 00:30 + its hours, never before 10:00. */
export const deepDeadlineMin = minutes => Math.max(MORNING_DEADLINE_MIN, ROUTE_OPEN_MIN + (Number(minutes) || 0))

/** 'HH:MM' the job must be finished by in its bucket (null for normal start-time jobs). */
export function bucketDeadline(job, minutes) {
  const b = bucketOf(job)
  if (b === 'morning') return OTP_DEADLINE
  if (b === 'deep') return hm(deepDeadlineMin(minutes))
  return null
}

/**
 * Load per person and bucket for ONE day. items: [{ employeeId, employeeName, bucket, minutes, done? }]
 * (done ones count too: the plan is about the day as planned). Returns rows
 * { employeeId, name, bucket, minutes, n, available, deadline, impossible } — only people with jobs.
 */
export function routeLoads(items = []) {
  const map = new Map()
  for (const it of items) {
    if (!it || it.bucket === 'other' || !it.employeeId) continue
    const k = `${it.employeeId}|${it.bucket}`
    if (!map.has(k)) map.set(k, { employeeId: it.employeeId, name: it.employeeName || '—', bucket: it.bucket, minutes: 0, n: 0, deadlineMin: 0 })
    const r = map.get(k)
    r.minutes += Number(it.minutes) || 0
    r.n += 1
    r.deadlineMin = Math.max(r.deadlineMin, it.bucket === 'morning' ? MORNING_DEADLINE_MIN : deepDeadlineMin(it.minutes))
  }
  return [...map.values()].map(r => {
    const available = r.deadlineMin - ROUTE_OPEN_MIN
    return { ...r, available, deadline: hm(r.deadlineMin), impossible: r.minutes > available }
  }).sort((a, b) => (a.bucket === b.bucket ? 0 : a.bucket === 'morning' ? -1 : 1) || b.minutes - a.minutes || a.name.localeCompare(b.name))
}

/** "16h" / "9h30" */
export const hoursText = m => { const h = Math.floor(m / 60), r = m % 60; return r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h` }

/** "rota impossível para Guilherme: 16h previstas até às 10:00" */
export function impossibleText(r, L = (en, ja, pt) => pt) {
  const who = r.name
  const h = hoursText(r.minutes)
  if (r.bucket === 'deep') return L(`Impossible deep for ${who}: ${h} planned by ${r.deadline}`, `${who}のディープは不可能: ${r.deadline}までに${h}予定`, `deep impossível para ${who}: ${h} previstas até às ${r.deadline}`)
  return L(`Impossible route for ${who}: ${h} planned by ${r.deadline}`, `${who}のルートは不可能: ${r.deadline}までに${h}予定`, `rota impossível para ${who}: ${h} previstas até às ${r.deadline}`)
}
