import {
  OTP_BASIC_LOCATIONS,
  SCHEDULE_CLIENTS,
  isOtpDeepOnlyLocation,
  otpDeepOnlyLocations,
  otpDeepOnlyLocation,
} from './serviceCatalog'

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

export const ONTHEPLANET_CLIENT_ID = SCHEDULE_CLIENTS.ontheplanet.id

export const DEFAULT_DEEP_CLEAN_PRICE = 5000

export function locationNameFromTitle(title) {
  return (title || '').replace(/ — .*/, '').trim()
}

export function getCleaningType(job) {
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
  return ALL_DEEP_COMPONENT_IDS.filter(id => list.includes(id))
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

export function weekdaysInMonth(yearMonth, dows = []) {
  const [year, mon] = yearMonth.split('-').map(Number)
  const want = new Set(dows)
  const dates = []
  const d = new Date(year, mon - 1, 1)
  while (d.getMonth() === mon - 1) {
    if (want.has(d.getDay())) dates.push(d.toISOString().slice(0, 10))
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

export function deepCleanScheduleLabel(locName) {
  if (isOtpDeepOnlyLocation(locName)) return 'Mon + Wed'
  return 'Tue'
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

  DEEP_CLEAN_LOCATIONS.forEach(loc => {
    const expectedDates = expectedDeepCleanDatesForLocation(loc, yearMonth)
    const locJobs = monthJobs.filter(j => matchLocation(j.title) === loc)
    const byDate = {}
    expectedDates.forEach(d => { byDate[d] = locJobs.find(j => j.scheduled_date === d) || null })

    const completed = locJobs.filter(j => j.status === 'completed').length
    const pending = locJobs.filter(j => j.status === 'assigned' || j.status === 'in_progress').length
    const expectedPerLocation = expectedDates.length

    byLocation[loc] = {
      expected: expectedPerLocation,
      completed,
      pending,
      missing: Math.max(0, expectedPerLocation - locJobs.length),
      byDate,
      jobs: locJobs,
      schedule: deepCleanScheduleLabel(loc),
      expectedDates,
    }
    totalExpected += expectedPerLocation
    totalCompleted += completed
    totalPending += pending
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

export function formatScheduleDate(date, lang = 'en') {
  const locale = lang === 'ja' ? 'ja-JP' : 'en-GB'
  return new Date(date + 'T12:00:00').toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
}

/** @deprecated use formatScheduleDate */
export function formatTuesday(date, lang = 'en') {
  return formatScheduleDate(date, lang)
}
