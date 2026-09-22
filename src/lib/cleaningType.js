import {
  OTP_BASIC_LOCATIONS,
  SCHEDULE_CLIENTS,
  isOtpDeepOnlyLocation,
  otpDeepOnlyLocations,
  otpDeepOnlyLocation,
} from './serviceCatalog'
import { isOverdueAssignedJob } from './jobOverdue'
import { tokyoToday } from './dates'

export const CLEANING_TYPES = {
  basic: { label: 'Basic cleaning', suffix: 'Basic Cleaning', short: 'Basic', color: '#60a5fa' },
  deep: { label: 'Deep cleaning', suffix: 'Deep Clean', short: 'Deep', color: '#fbbf24' },
}

const CLEANING_TYPES_JA = {
  basic: { label: '基本清掃', suffix: 'Basic Cleaning', short: '基本', color: '#60a5fa' },
  deep: { label: '深層清掃', suffix: 'Deep Clean', short: '深層', color: '#fbbf24' },
}

/** Componentes do deep clean OTP */
export const DEEP_CLEAN_COMPONENTS = [
  { id: 'range_hood', label: 'Range Hood', labelJa: 'レンジフード' },
  { id: 'ac', label: 'AC Cleaning', labelJa: 'エアコン清掃' },
  { id: 'grating', label: 'Grating', labelJa: 'グレーティング' },
  { id: 'grease_trap', label: 'Grease Trap', labelJa: 'グリストラップ' },
  { id: 'other', label: 'Other', labelJa: 'その他' },
]

/** Manutenção no dia de folga (deep-only OTP) */
export const REST_DAY_MAINTENANCE_COMPONENTS = [
  { id: 'grease_trap', label: 'Grease Trap', timesPerMonth: 2 },
  { id: 'stove', label: 'Stove', timesPerMonth: 1 },
  { id: 'range_hood', label: 'Range Hood', timesPerMonth: 1 },
  { id: 'grating', label: 'Grating', timesPerMonth: 1 },
  { id: 'ac', label: 'AC Cleaning', timesPerMonth: 1 },
]

export const ALL_DEEP_COMPONENT_IDS = DEEP_CLEAN_COMPONENTS.map(c => c.id)

export function cleaningTypesForLang(lang) {
  return lang === 'ja' ? CLEANING_TYPES_JA : CLEANING_TYPES
}

export function deepComponentLabel(id, lang = 'en') {
  const item = DEEP_CLEAN_COMPONENTS.find(c => c.id === id)
  if (!item) return id
  return lang === 'ja' ? item.labelJa : item.label
}

export const DEEP_CLEAN_LOCATIONS = OTP_BASIC_LOCATIONS.map(l => l.name)

/** OTP com deep clean às terças (restaurantes com limpeza básica) */
export const OTP_TUESDAY_DEEP_LOCATIONS = OTP_BASIC_LOCATIONS
  .filter(l => !l.deepOnly)
  .map(l => l.name)

/** OTP deep-only — deep clean seg+qua */
export const OTP_DEEP_ONLY_LOCATION_NAMES = otpDeepOnlyLocations().map(l => l.name)

export const OTP_DEEP_CLEAN_DAYS = {
  tuesday: [2],
  monWed: [1, 3],
}

export function allowedDeepCleanDaysForLocation(locName) {
  if (isOtpDeepOnlyLocation(locName)) {
    const cfg = otpDeepOnlyLocation(locName)
    return cfg?.deepCleanDays || OTP_DEEP_CLEAN_DAYS.monWed
  }
  return OTP_DEEP_CLEAN_DAYS.tuesday
}

export function isDeepCleanAllowedOnDate(locName, dateStr) {
  const dow = new Date(`${dateStr}T12:00:00`).getDay()
  return allowedDeepCleanDaysForLocation(locName).includes(dow)
}

export const ONTHEPLANET_CLIENT_ID = SCHEDULE_CLIENTS.ontheplanet.id

export const DEFAULT_DEEP_CLEAN_PRICE = 5000

export function locationNameFromTitle(title) {
  return (title || '').replace(/ — .*/, '').trim()
}

/** Rest-day OTP maintenance (grease trap / stove block) is not a Deep Clean visit. */
export function isMaintenanceJob(job) {
  const title = job?.title || ''
  if (/deep\s*clean/i.test(title)) return false
  if (job?.job_category === 'maintenance' || job?.category === 'maintenance') return true
  return / — (Grease Trap|Stove \+|Range Hood|Grating|AC Cleaning)/i.test(title)
}

export function getCleaningType(job) {
  if (isMaintenanceJob(job)) return 'basic'
  const t = `${job?.title || ''} ${job?.description || ''}`.toLowerCase()
  if (/deep\s*clean|profunda|limpeza profunda/.test(t)) return 'deep'
  if (/range hood|grease trap|grating|ac cleaning|stove|fog[aã]o|レンジフード|グリストラップ|コンロ/.test(t)) return 'deep'
  return 'basic'
}

export function parseDeepComponents(job) {
  const text = `${job?.title || ''}\n${job?.description || ''}`.toLowerCase()
  const found = DEEP_CLEAN_COMPONENTS.filter(c => {
    const label = c.label.toLowerCase()
    return text.includes(label) || text.includes(c.id.replace('_', ' '))
  }).map(c => c.id)
  if (found.length) return found
  if (getCleaningType(job) === 'deep') return [...ALL_DEEP_COMPONENT_IDS]
  return []
}

export function applyCleaningTypeToTitle(locName, type, deepComponents = []) {
  return buildJobTitle(locName, { cleaningType: type, deepComponents })
}

export function buildJobTitle(locName, { cleaningType = 'basic', deepComponents = [] } = {}) {
  if (cleaningType === 'deep') {
    const comps = normalizeDeepComponents(deepComponents)
    if (!comps.length) return `${locName} — Deep Clean`
    const labels = comps.map(id => DEEP_CLEAN_COMPONENTS.find(c => c.id === id)?.label).filter(Boolean)
    if (labels.length === ALL_DEEP_COMPONENT_IDS.length) return `${locName} — Deep Clean`
    return `${locName} — Deep Clean (${labels.join(', ')})`
  }
  const cfg = CLEANING_TYPES.basic
  return `${locName} — ${cfg.suffix}`
}

export function normalizeDeepComponents(deepComponents) {
  const list = Array.isArray(deepComponents) ? deepComponents : []
  const known = ALL_DEEP_COMPONENT_IDS.filter(id => list.includes(id))
  if (known.length) return known
  return list.filter(id => id === 'other')
}

export function buildDeepCleanDescription({ deepComponents = [], baseNotes = '' } = {}) {
  const comps = normalizeDeepComponents(deepComponents)
  const parts = []
  if (baseNotes) parts.push(baseNotes)
  if (comps.length) {
    const labels = comps.map(id => DEEP_CLEAN_COMPONENTS.find(c => c.id === id)?.label).filter(Boolean)
    parts.push(`Deep Clean: ${labels.join(' + ')}`)
  }
  return parts.length ? parts.join('\n') : null
}

export function calculateJobValue({ cleaningType = 'basic', deepComponents = [], basicPrice = 0, deepPrice = DEFAULT_DEEP_CLEAN_PRICE } = {}) {
  if (cleaningType !== 'deep') return basicPrice || 0
  const comps = normalizeDeepComponents(deepComponents)
  if (!comps.length) return deepPrice
  if (comps.length === ALL_DEEP_COMPONENT_IDS.length) return deepPrice
  const unit = Math.round(deepPrice / ALL_DEEP_COMPONENT_IDS.length)
  return unit * comps.length
}

export function jobMatchesLocationAndType(job, locationName, cleaningType = 'basic') {
  if (!titleMatchesLocation(job?.title, locationName)) return false
  return getCleaningType(job) === cleaningType
}

export function titleMatchesLocation(title, locationName) {
  const loc = locationNameFromTitle(title)
  return loc.toLowerCase() === (locationName || '').trim().toLowerCase()
}

export function isDeepCleanJob(job) {
  if (isMaintenanceJob(job)) return false
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
  return weekdaysInMonth(yearMonth, [2])
}

function localDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function weekdaysInMonth(yearMonth, dows = []) {
  const [year, mon] = yearMonth.split('-').map(Number)
  const want = new Set(dows)
  const dates = []
  const d = new Date(year, mon - 1, 1)
  while (d.getMonth() === mon - 1) {
    if (want.has(d.getDay())) dates.push(localDateStr(d))
    d.setDate(d.getDate() + 1)
  }
  return dates
}

export function restDaysInMonth(yearMonth, restDow) {
  return weekdaysInMonth(yearMonth, [restDow])
}

export function expectedDeepCleanDatesForLocation(locName, yearMonth) {
  if (isOtpDeepOnlyLocation(locName)) {
    const cfg = otpDeepOnlyLocation(locName)
    return weekdaysInMonth(yearMonth, cfg?.deepCleanDays || OTP_DEEP_CLEAN_DAYS.monWed)
  }
  return tuesdaysInMonth(yearMonth)
}

export function deepCleanScheduleLabel(locName, lang = 'en') {
  if (isOtpDeepOnlyLocation(locName)) return lang === 'ja' ? '月・水' : 'Mon + Wed'
  return lang === 'ja' ? '火' : 'Tue'
}

function matchLocation(title) {
  const name = locationNameFromTitle(title)
  return DEEP_CLEAN_LOCATIONS.find(loc => name === loc || name.startsWith(loc)) || null
}

/** Progresso mensal de deep clean On The Planet */
export function buildDeepCleanProgress(jobs, yearMonth) {
  const tuesdays = tuesdaysInMonth(yearMonth)
  const mondays = weekdaysInMonth(yearMonth, [1])
  const wednesdays = weekdaysInMonth(yearMonth, [3])
  const slotDates = [...new Set([...tuesdays, ...mondays, ...wednesdays])].sort()

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
  let totalScheduled = 0

  DEEP_CLEAN_LOCATIONS.forEach(loc => {
    const expectedDates = expectedDeepCleanDatesForLocation(loc, yearMonth)
    const locJobs = monthJobs.filter(j => matchLocation(j.title) === loc)
    const byDate = {}
    expectedDates.forEach(d => { byDate[d] = locJobs.find(j => j.scheduled_date === d) || null })

    const slotJobs = expectedDates.map(d => byDate[d]).filter(Boolean)
    const completed = slotJobs.filter(j => j.status === 'completed').length
    const pending = slotJobs.filter(j => j.status === 'assigned' || j.status === 'in_progress').length
    const expectedPerLocation = expectedDates.length

    byLocation[loc] = {
      expected: expectedPerLocation,
      completed,
      pending,
      missing: Math.max(0, expectedPerLocation - slotJobs.length),
      byDate,
      jobs: locJobs,
      schedule: deepCleanScheduleLabel(loc),
      expectedDates,
    }
    totalExpected += expectedPerLocation
    totalCompleted += completed
    totalPending += pending
    totalScheduled += slotJobs.length
  })

  const tuesdaySummary = slotDates.map(date => {
    const dayJobs = monthJobs.filter(j => j.scheduled_date === date)
    const expected = DEEP_CLEAN_LOCATIONS.filter(loc =>
      expectedDeepCleanDatesForLocation(loc, yearMonth).includes(date)
    ).length
    const done = dayJobs.filter(j => j.status === 'completed').length
    return { date, expected, done, total: dayJobs.length, dow: new Date(date + 'T12:00:00').getDay() }
  }).filter(row => row.expected > 0)

  return {
    yearMonth,
    tuesdays: slotDates,
    byLocation,
    tuesdaySummary,
    totals: {
      expected: totalExpected,
      completed: totalCompleted,
      pending: totalPending,
      scheduled: totalScheduled,
      pct: totalExpected ? Math.round((totalCompleted / totalExpected) * 100) : 0,
    },
  }
}

export function currentYearMonth() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 7)
}

function recalcDeepProgressTotals(byLocation) {
  let totalExpected = 0
  let totalCompleted = 0
  let totalPending = 0
  let totalScheduled = 0

  Object.values(byLocation || {}).forEach(data => {
    totalExpected += data.expected
    totalCompleted += data.completed
    totalPending += data.pending
    totalScheduled += Math.max(0, (data.expected || 0) - (data.missing ?? 0))
  })

  const notDone = Math.max(0, totalExpected - totalCompleted)
  const missing = Math.max(0, totalExpected - totalScheduled)
  const donePct = totalExpected ? Math.round((totalCompleted / totalExpected) * 100) : 0

  return {
    expected: totalExpected,
    completed: totalCompleted,
    pending: totalPending,
    scheduled: totalScheduled,
    missing,
    notDone,
    donePct,
    pendingPct: totalExpected ? Math.round((totalPending / totalExpected) * 100) : 0,
    missingPct: totalExpected ? Math.round((missing / totalExpected) * 100) : 0,
    notDonePct: totalExpected ? Math.round((notDone / totalExpected) * 100) : 0,
    pct: donePct,
    doneShare: totalExpected ? (totalCompleted / totalExpected) * 100 : 0,
    pendingShare: totalExpected ? (totalPending / totalExpected) * 100 : 0,
  }
}

/** Sunday-start month cells for the client calendar (`YYYY-MM-DD` or null pad). */
export function monthCalendarCells(yearMonth) {
  const [y, m] = String(yearMonth || '').split('-').map(Number)
  if (!y || !m) return []
  const first = new Date(y, m - 1, 1)
  const daysInMonth = new Date(y, m, 0).getDate()
  const cells = []
  for (let i = 0; i < first.getDay(); i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${yearMonth}-${String(d).padStart(2, '0')}`)
  }
  return cells
}

/** Unique service days from a progress snapshot (one row per date with deep clean). */
export function buildDaySummaries(byLocation, today = tokyoToday()) {
  const byDate = {}
  Object.entries(byLocation || {}).forEach(([name, data]) => {
    (data.expectedDates || []).forEach(date => {
      if (!byDate[date]) {
        byDate[date] = {
          date,
          expected: 0,
          done: 0,
          pending: 0,
          missing: 0,
          overdueCount: 0,
          past: date < today,
          stores: [],
        }
      }
      const job = data.byDate?.[date]
        || (data.jobs || []).find(j => j.scheduled_date === date)
        || null
      const status = job?.status
      const overdue = job ? isOverdueAssignedJob(job) : date < today
      byDate[date].expected += 1
      if (status === 'completed') byDate[date].done += 1
      else if (status === 'assigned' || status === 'in_progress') byDate[date].pending += 1
      else byDate[date].missing += 1
      if (overdue) byDate[date].overdueCount += 1
      byDate[date].stores.push({
        name,
        job,
        schedule: data.schedule || '',
        overdue,
        past: date < today,
      })
    })
  })

  return Object.values(byDate)
    .map(day => ({
      ...day,
      stores: day.stores.sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.name.localeCompare(b.name)),
      pct: day.expected ? Math.round((day.done / day.expected) * 100) : 0,
      state: daySummaryState(day),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function daySummaryState(day) {
  if (!day?.expected) return 'empty'
  if (day.done >= day.expected) return 'done'
  if (day.done > 0) return 'partial'
  if (day.pending > 0) return 'partial'
  if (day.past) return 'missing'
  return 'missing'
}

/** Per-store rows for the HQ dashboard (lowest completion first) */
export function storeProgressRows(byLocation, _today = tokyoToday(), lang = 'en') {
  return Object.entries(byLocation || {}).map(([name, data]) => {
    const expected = data.expected || 0
    const completed = data.completed || 0
    const pending = data.pending || 0
    const missing = data.missing ?? Math.max(0, expected - (data.jobs?.length || 0))
    let late = 0
    ;(data.expectedDates || []).forEach(date => {
      const job = data.byDate?.[date] || (data.jobs || []).find(j => j.scheduled_date === date)
      if (job?.status === 'completed') return
      if (job && isOverdueAssignedJob(job)) late += 1
    })
    return {
      name,
      expected,
      completed,
      pending,
      missing,
      late,
      pct: expected ? Math.round((completed / expected) * 100) : 0,
      schedule: deepCleanScheduleLabel(name, lang),
    }
  }).sort((a, b) => a.pct - b.pct || a.name.localeCompare(b.name))
}

/** Narrow an OTP progress snapshot to one store (or back to all stores) */
export function filterDeepCleanProgressByLocation(progress, locationName) {
  if (!progress) return progress
  const locName = (locationName || '').trim()
  if (!locName) {
    return {
      ...progress,
      scope: 'all',
      location: undefined,
      totals: recalcDeepProgressTotals(progress.byLocation),
    }
  }

  const locKey = Object.keys(progress.byLocation || {}).find(loc => loc.toLowerCase() === locName.toLowerCase())
    || DEEP_CLEAN_LOCATIONS.find(loc => loc.toLowerCase() === locName.toLowerCase())

  if (!locKey || !progress.byLocation?.[locKey]) {
    return {
      yearMonth: progress.yearMonth,
      scope: 'none',
      location: locName,
      tuesdays: progress.tuesdays || [],
      byLocation: {},
      tuesdaySummary: [],
      totals: recalcDeepProgressTotals({}),
    }
  }

  const data = progress.byLocation[locKey]
  const byLocation = { [locKey]: data }
  const expectedDates = new Set(data.expectedDates || [])
  const tuesdaySummary = (progress.tuesdaySummary || []).filter(row => expectedDates.has(row.date))

  return {
    ...progress,
    scope: 'location',
    location: locKey,
    byLocation,
    tuesdaySummary,
    totals: recalcDeepProgressTotals(byLocation),
  }
}

/** Deep clean progress scoped to a client portal user (OTP only) */
export function buildDeepCleanProgressForUser(jobs, yearMonth, user) {
  const full = {
    ...buildDeepCleanProgress(jobs, yearMonth),
    scope: 'all',
  }
  full.totals = recalcDeepProgressTotals(full.byLocation)
  const locName = (user?.location_name || '').trim()
  if (!locName) return full
  return filterDeepCleanProgressByLocation(full, locName)
}

export function jobStatusLabel(status, labels) {
  if (labels?.[status]) return labels[status]
  return { assigned: 'Pending', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' }[status] || status
}

export function tuesdaySlotInfo(job, labels, date) {
  const today = tokyoToday()
  const dateStr = date || job?.scheduled_date
  const past = !!dateStr && dateStr < today
  if (!job) {
    if (past) return { state: 'missing', label: labels?.slotUnscheduled || labels?.slotMissing || 'Not scheduled', icon: '❌', color: '#fbbf24' }
    return { state: 'missing', label: labels?.slotMissing || 'Not scheduled', icon: '❌', color: '#f87171' }
  }
  if (job.status === 'completed') return { state: 'done', label: labels?.slotDone || 'Completed', icon: '✅', color: '#4ade80' }
  if (job.status === 'in_progress') return { state: 'progress', label: labels?.slotProgress || 'In progress', icon: '🔄', color: '#fbbf24' }
  if (job.status === 'assigned') {
    if (isOverdueAssignedJob(job) || past) {
      return { state: 'late', label: labels?.slotLate || 'Late', icon: '⚠️', color: '#f87171' }
    }
    return { state: 'pending', label: labels?.slotPending || 'Scheduled', icon: '⏳', color: '#60a5fa' }
  }
  return { state: 'other', label: jobStatusLabel(job.status, labels?.status), icon: '·', color: 'var(--text3)' }
}

export function formatScheduleDate(date, lang = 'en') {
  const locale = lang === 'ja' ? 'ja-JP' : 'en-GB'
  return new Date(date + 'T12:00:00').toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
}

/** @deprecated use formatScheduleDate */
export function formatTuesday(date, lang = 'en') {
  return formatScheduleDate(date, lang)
}
