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

const CLEANING_TYPES_PT = {
  basic: { label: 'Limpeza básica', suffix: 'Basic Cleaning', short: 'Básica', color: '#60a5fa' },
  deep: { label: 'Limpeza pesada', suffix: 'Deep Clean', short: 'Pesada', color: '#fbbf24' },
}

/** Componentes do deep clean OTP */
export const DEEP_CLEAN_COMPONENTS = [
  { id: 'range_hood', label: 'Range Hood', labelJa: 'レンジフード', labelPt: 'Coifa' },
  { id: 'ac', label: 'AC Cleaning', labelJa: 'エアコン清掃', labelPt: 'Limpeza de ar-condicionado' },
  { id: 'grating', label: 'Grating', labelJa: 'グレーティング', labelPt: 'Grelhas de piso' },
  { id: 'grease_trap', label: 'Grease Trap', labelJa: 'グリストラップ', labelPt: 'Caixa de gordura' },
  { id: 'other', label: 'Other', labelJa: 'その他', labelPt: 'Outro' },
]

/**
 * Specific deep-clean tasks the admin can pick when creating a job.
 * `label` is the English name written in the job title ("Loc — Deep Clean (Range Hood, Fryer)");
 * `check` is the checklist line the employee ticks (display text in jobChecklist.js).
 */
export const DEEP_TASKS = [
  { id: 'range_hood', icon: '🌀', label: 'Range Hood', ja: 'レンジフード', pt: 'Coifa', check: 'Range Hood — limpeza completa (filtros, duto, superficie)' },
  { id: 'grease_trap', icon: '🛢️', label: 'Grease Trap', ja: 'グリストラップ', pt: 'Caixa de gordura', check: 'Grease Trap — esvaziado e higienizado' },
  { id: 'grating', icon: '🔲', label: 'Grating', ja: 'グレーティング', pt: 'Grelhas de piso', check: 'Grating — grelha limpa sem gordura' },
  { id: 'stove', icon: '🔥', label: 'Stove', ja: 'コンロ', pt: 'Fogão', check: 'Stove — fogões limpos e sem gordura' },
  { id: 'ac', icon: '❄️', label: 'AC Cleaning', ja: 'エアコン', pt: 'Ar-condicionado', check: 'AC Cleaning — filtros e unidade interna' },
  { id: 'fryer', icon: '🍟', label: 'Fryer', ja: 'フライヤー', pt: 'Fritadeira', check: 'Fryer — oleo retirado, cesto e cuba limpos' },
  { id: 'kitchen_equipment', icon: '🍳', label: 'Kitchen Equipment', ja: '厨房機器', pt: 'Equipamentos da cozinha', check: 'Kitchen Equipment — mesas, prateleiras e equipamentos sem gordura' },
  { id: 'fridge', icon: '🧊', label: 'Fridge', ja: '冷蔵庫', pt: 'Geladeira', check: 'Fridge — por dentro e por fora, borrachas limpas' },
  { id: 'walls', icon: '🧱', label: 'Walls & Tiles', ja: '壁・タイル', pt: 'Paredes e azulejos', check: 'Walls & Tiles — gordura removida, rejunte limpo' },
  { id: 'floor_scrub', icon: '🧽', label: 'Floor Scrub', ja: '床の洗浄', pt: 'Lavar piso', check: 'Floor Scrub — piso esfregado, cantos e debaixo dos equipamentos' },
  { id: 'drains', icon: '🚰', label: 'Drains', ja: '排水溝', pt: 'Ralos', check: 'Drains — ralos abertos, limpos e sem cheiro' },
  { id: 'restroom', icon: '🚽', label: 'Restroom', ja: 'トイレ', pt: 'Banheiro completo', check: 'Restroom — vaso, pia, piso e paredes' },
  { id: 'windows', icon: '🪟', label: 'Windows', ja: '窓ガラス', pt: 'Vidros e janelas', check: 'Windows — vidros por dentro e por fora, sem marcas' },
  { id: 'ceiling', icon: '💡', label: 'Ceiling & Lights', ja: '天井・照明', pt: 'Teto e luminárias', check: 'Ceiling & Lights — teto, luminarias e saidas de ar' },
  { id: 'seats', icon: '🪑', label: 'Seats & Sofas', ja: '椅子・ソファ', pt: 'Cadeiras e sofás', check: 'Seats & Sofas — assentos limpos, sem manchas' },
  { id: 'floor_wax', icon: '✨', label: 'Floor Wax', ja: '床ワックス', pt: 'Cera no piso', check: 'Floor Wax — piso limpo e encerado' },
]

export function deepTaskName(task, lang = 'en') {
  return lang === 'ja' ? task.ja : lang === 'pt' ? task.pt : task.label
}

/** Free-text task typed by the admin, made safe for the "(a, b, c)" title list. */
export function cleanCustomTask(text) {
  return String(text || '').replace(/[(),\n]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** "Loc — Deep Clean (Range Hood, Fryer, wash the back door)" from task ids + free-text tasks. */
export function buildDeepTaskTitle(locName, taskIds = [], customTasks = []) {
  const labels = [
    ...DEEP_TASKS.filter(t => taskIds.includes(t.id)).map(t => t.label),
    ...customTasks.map(cleanCustomTask).filter(Boolean),
  ]
  return labels.length ? `${locName} — Deep Clean (${labels.join(', ')})` : `${locName} — Deep Clean`
}

/** Task labels written in a deep-clean title, or null when the title has no explicit list. */
export function parseDeepTaskList(title) {
  const m = String(title || '').match(/deep clean \(([^)]*)\)\s*$/i)
  if (!m) return null
  return m[1].split(',').map(s => s.trim()).filter(Boolean)
}

/** Split title labels back into known task ids + free-text tasks. */
export function deepTasksFromTitle(title) {
  const labels = parseDeepTaskList(title) || []
  const ids = []
  const custom = []
  for (const l of labels) {
    const task = DEEP_TASKS.find(t => t.label.toLowerCase() === l.toLowerCase())
    if (task) ids.push(task.id)
    else custom.push(l)
  }
  return { ids, custom }
}

/** Checklist lines for the tasks listed in a deep-clean title. */
export function deepTaskChecklistLines(title) {
  const labels = parseDeepTaskList(title) || []
  return labels.filter(l => l.toLowerCase() !== 'other').map(l => DEEP_TASKS.find(t => t.label.toLowerCase() === l.toLowerCase())?.check || l)
}

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
  return lang === 'ja' ? CLEANING_TYPES_JA : lang === 'pt' ? CLEANING_TYPES_PT : CLEANING_TYPES
}

export function deepComponentLabel(id, lang = 'en') {
  const item = DEEP_CLEAN_COMPONENTS.find(c => c.id === id)
  if (!item) return id
  return lang === 'ja' ? item.labelJa : lang === 'pt' ? (item.labelPt || item.label) : item.label
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
    return text.includes(label) || new RegExp(`\\b${c.id.replace('_', ' ')}\\b`).test(text)
  }).map(c => c.id)
  // An explicit task list in the title ("Deep Clean (Fryer)") means only those tasks.
  if (found.length || parseDeepTaskList(job?.title)) return found
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

function recalcDeepProgressTotals(byLocation, tuesdaySummary) {
  let totalExpected = 0
  let totalCompleted = 0
  let totalPending = 0
  let totalScheduled = 0

  Object.values(byLocation).forEach(data => {
    totalExpected += data.expected
    totalCompleted += data.completed
    totalPending += data.pending
    totalScheduled += data.jobs.length
  })

  const notDone = Math.max(0, totalExpected - totalCompleted)

  return {
    expected: totalExpected,
    completed: totalCompleted,
    pending: totalPending,
    scheduled: totalScheduled,
    notDone,
    donePct: totalExpected ? Math.round((totalCompleted / totalExpected) * 100) : 0,
    notDonePct: totalExpected ? Math.round((notDone / totalExpected) * 100) : 0,
    pct: totalExpected ? Math.round((totalCompleted / totalExpected) * 100) : 0,
  }
}

/** Deep clean progress scoped to a client portal user (OTP only) */
export function buildDeepCleanProgressForUser(jobs, yearMonth, user) {
  const full = buildDeepCleanProgress(jobs, yearMonth)
  const locName = (user?.location_name || '').trim()

  if (!locName) {
    return { ...full, scope: 'all', totals: recalcDeepProgressTotals(full.byLocation, full.tuesdaySummary) }
  }

  const locKey = DEEP_CLEAN_LOCATIONS.find(loc =>
    loc.toLowerCase() === locName.toLowerCase()
  )
  if (!locKey) {
    return {
      yearMonth,
      scope: 'none',
      location: locName,
      byLocation: {},
      tuesdaySummary: [],
      totals: recalcDeepProgressTotals({}, []),
    }
  }

  const data = full.byLocation[locKey]
  const byLocation = { [locKey]: data }
  const expectedDates = new Set(data.expectedDates || [])
  const tuesdaySummary = full.tuesdaySummary.filter(row => expectedDates.has(row.date))

  return {
    yearMonth,
    scope: 'location',
    location: locKey,
    tuesdays: full.tuesdays,
    byLocation,
    tuesdaySummary,
    totals: recalcDeepProgressTotals(byLocation, tuesdaySummary),
  }
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
  const locale = lang === 'ja' ? 'ja-JP' : lang === 'pt' ? 'pt-BR' : 'en-GB'
  return new Date(date + 'T12:00:00').toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
}

/** @deprecated use formatScheduleDate */
export function formatTuesday(date, lang = 'en') {
  return formatScheduleDate(date, lang)
}
