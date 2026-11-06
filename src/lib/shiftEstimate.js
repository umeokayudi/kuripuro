// v1.0.174 · "Próximo turno": how long the whole shift will probably take and the ideal time to start.
//
// Each job's minutes come from the worker's own history (median of the last finished visits of the
// same service at the same store, then of the same store), else the planned minutes of the job /
// contract / type (agenda.expectedMinutes). Between two different stores we add the travel time.
// Deadline shift (On The Planet, "Concluir até 10:00"): ideal start = deadline − total − margin.
// Start-time shift: start = earliest planned time, probable end = start + total.

import { jobDurationMin } from './workKpis.js'
import { expectedMinutes, storeName } from './agenda.js'
import { deadlineOf, isDeadlineJob, OTP_ROUTE_TIME } from './jobDeadline.js'

export const TRAVEL_MIN = 15
export const MARGIN_MIN = 30
const RECENT = 8

const toMin = t => {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
export const fmtClock = min => {
  const v = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`
}
/** 220 → "3h40", 50 → "50 min", 120 → "2h". */
export const fmtDur = min => {
  const m = Math.max(0, Math.round(min / 5) * 5) // "provável": 5-minute steps
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60), r = m % 60
  return r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`
}

const median = list => {
  const s = [...list].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}
const norm = s => String(s || '').trim().toLowerCase()

/** Past finished durations (newest first) of jobs matching `same`. */
function pastDurations(history, job, same) {
  return (history || [])
    .filter(h => h.id !== job.id && h.status === 'completed' && same(h))
    .sort((a, b) => String(b.completed_at || '').localeCompare(String(a.completed_at || '')))
    .map(jobDurationMin).filter(v => v != null)
    .slice(0, RECENT)
}

/** { minutes, source: 'service'|'store'|'planned', samples } for one job. */
export function estimateJobMinutes(job, history = [], contract = null) {
  const title = norm(job?.title)
  const bySvc = pastDurations(history, job, h => norm(h.title) === title)
  if (bySvc.length) return { minutes: median(bySvc), source: 'service', samples: bySvc.length }
  const store = norm(storeName(job?.title))
  const byStore = store ? pastDurations(history, job, h => norm(storeName(h.title)) === store) : []
  if (byStore.length) return { minutes: median(byStore), source: 'store', samples: byStore.length }
  return { minutes: expectedMinutes(job, contract), source: 'planned', samples: 0 }
}

/**
 * Estimate for the jobs of one day (already in the order they will be done).
 * Returns null for an empty list.
 *   { totalMin, workMin, travelMin, perJob: Map(id → est), deadline, idealStart, tight,
 *     start, end, fromHistory }
 */
export function estimateShift(jobs, history = [], { contractFor = () => null, travelMin = TRAVEL_MIN, marginMin = MARGIN_MIN } = {}) {
  const list = (jobs || []).filter(j => j && j.status !== 'cancelled')
  if (!list.length) return null
  const perJob = new Map()
  let workMin = 0
  for (const j of list) {
    const est = estimateJobMinutes(j, history, contractFor(j))
    perJob.set(j.id, est)
    workMin += est.minutes
  }
  let moves = 0
  for (let i = 1; i < list.length; i++) if (norm(storeName(list[i].title)) !== norm(storeName(list[i - 1].title))) moves++
  const travel = moves * travelMin
  const totalMin = workMin + travel
  const fromHistory = list.filter(j => perJob.get(j.id).source !== 'planned').length

  const deadline = list.map(deadlineOf).find(Boolean) || null
  if (deadline && list.every(isDeadlineJob)) {
    const dl = toMin(deadline)
    const open = toMin(OTP_ROUTE_TIME)
    let ideal = Math.floor((dl - totalMin - marginMin) / 5) * 5
    const tight = ideal < open
    if (tight) ideal = open
    return { totalMin, workMin, travelMin: travel, perJob, deadline, idealStart: fmtClock(ideal), tight, start: null, end: null, fromHistory, count: list.length }
  }
  const starts = list.map(j => toMin(j.scheduled_time)).filter(v => v != null)
  const start = starts.length ? Math.min(...starts) : null
  return {
    totalMin, workMin, travelMin: travel, perJob, deadline: null, idealStart: null, tight: false,
    start: start == null ? null : fmtClock(start),
    end: start == null ? null : fmtClock(Math.ceil((start + totalMin) / 5) * 5),
    fromHistory, count: list.length,
  }
}
