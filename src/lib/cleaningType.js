import { DEFAULT_LOCATIONS, SCHEDULE_CLIENTS } from './scheduleGenerator'

export const CLEANING_TYPES = {
  basic: { label: 'Basic cleaning', suffix: 'Basic cleaning', short: 'Basic', color: '#60a5fa' },
  deep: { label: 'Deep cleaning', suffix: 'Deep Clean', short: 'Deep', color: '#fbbf24' },
}

const CLEANING_TYPES_JA = {
  basic: { label: '基本清掃', suffix: '基本清掃', short: '基本', color: '#60a5fa' },
  deep: { label: '深層清掃', suffix: 'Deep Clean', short: '深層', color: '#fbbf24' },
}

export function cleaningTypesForLang(lang) {
  return lang === 'ja' ? CLEANING_TYPES_JA : CLEANING_TYPES
}

export const DEEP_CLEAN_LOCATIONS = DEFAULT_LOCATIONS
  .filter(l => l.name !== 'Atomic Bar')
  .map(l => l.name)

export const ONTHEPLANET_CLIENT_ID = SCHEDULE_CLIENTS.ontheplanet.id

export function locationNameFromTitle(title) {
  return (title || '').replace(/ — .*/, '').trim()
}

export function getCleaningType(job) {
  const t = (job?.title || '').toLowerCase()
  if (/deep\s*clean|profunda|limpeza profunda/.test(t)) return 'deep'
  return 'basic'
}

export function applyCleaningTypeToTitle(locName, type) {
  const cfg = CLEANING_TYPES[type] || CLEANING_TYPES.basic
  return `${locName} — ${cfg.suffix}`
}

export function isDeepCleanJob(job) {
  return getCleaningType(job) === 'deep'
}

export function isOnThePlanetJob(job) {
  if (!job) return false
  if (job.client_id === ONTHEPLANET_CLIENT_ID) return true
  if (job.client_name === 'On The Planet') return true
  if (job.client_name === 'Atomic Bar') return false
  return !job.client_id && job.client_name !== 'Atomic Bar'
}

export function tuesdaysInMonth(yearMonth) {
  const [year, mon] = yearMonth.split('-').map(Number)
  const dates = []
  const d = new Date(year, mon - 1, 1)
  while (d.getMonth() === mon - 1) {
    if (d.getDay() === 2) dates.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() + 1)
  }
  return dates
}

function matchLocation(title) {
  const name = locationNameFromTitle(title)
  return DEEP_CLEAN_LOCATIONS.find(loc => name === loc || name.startsWith(loc)) || null
}

/** Progresso mensal de deep clean On The Planet (contrato: toda terça, todos os restaurantes) */
export function buildDeepCleanProgress(jobs, yearMonth) {
  const tuesdays = tuesdaysInMonth(yearMonth)
  const expectedPerLocation = tuesdays.length

  const monthJobs = (jobs || []).filter(j =>
    j.scheduled_date?.startsWith(yearMonth)
    && isDeepCleanJob(j)
    && isOnThePlanetJob(j)
    && j.status !== 'cancelled',
  )

  const byLocation = {}
  let totalExpected = 0
  let totalCompleted = 0
  let totalPending = 0

  DEEP_CLEAN_LOCATIONS.forEach(loc => {
    const locJobs = monthJobs.filter(j => matchLocation(j.title) === loc)
    const byDate = {}
    tuesdays.forEach(d => { byDate[d] = locJobs.find(j => j.scheduled_date === d) || null })

    const completed = locJobs.filter(j => j.status === 'completed').length
    const pending = locJobs.filter(j => j.status === 'assigned' || j.status === 'in_progress').length

    byLocation[loc] = {
      expected: expectedPerLocation,
      completed,
      pending,
      missing: Math.max(0, expectedPerLocation - locJobs.length),
      byDate,
      jobs: locJobs,
    }
    totalExpected += expectedPerLocation
    totalCompleted += completed
    totalPending += pending
  })

  const tuesdaySummary = tuesdays.map(date => {
    const dayJobs = monthJobs.filter(j => j.scheduled_date === date)
    const done = dayJobs.filter(j => j.status === 'completed').length
    return { date, expected: DEEP_CLEAN_LOCATIONS.length, done, total: dayJobs.length }
  })

  return {
    yearMonth,
    tuesdays,
    byLocation,
    tuesdaySummary,
    totals: {
      expected: totalExpected,
      completed: totalCompleted,
      pending: totalPending,
      scheduled: monthJobs.length,
      pct: totalExpected ? Math.round((totalCompleted / totalExpected) * 100) : 0,
    },
  }
}

export function currentYearMonth() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 7)
}

export function jobStatusLabel(status, labels) {
  if (labels?.[status]) return labels[status]
  return { assigned: 'Pending', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' }[status] || status
}

export function tuesdaySlotInfo(job, labels) {
  if (!job) return { state: 'missing', label: labels?.slotMissing || 'Not scheduled', icon: '❌', color: '#f87171' }
  if (job.status === 'completed') return { state: 'done', label: labels?.slotDone || 'Completed', icon: '✅', color: '#4ade80' }
  if (job.status === 'in_progress') return { state: 'progress', label: labels?.slotProgress || 'In progress', icon: '🔄', color: '#fbbf24' }
  if (job.status === 'assigned') return { state: 'pending', label: labels?.slotPending || 'Scheduled', icon: '⏳', color: '#60a5fa' }
  return { state: 'other', label: jobStatusLabel(job.status, labels?.status), icon: '·', color: 'var(--text3)' }
}

export function formatTuesday(date, lang = 'en') {
  const locale = lang === 'ja' ? 'ja-JP' : 'en-GB'
  return new Date(date + 'T12:00:00').toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
}
