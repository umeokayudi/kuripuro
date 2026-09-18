import { tokyoToday, datesInRange, weekdayOfYmd, monthBounds } from './dates'
import {
  OTP_BASIC_LOCATIONS,
  ATOMIC_LOCATION,
  MATSUNAGA_SPOT,
  SCHEDULE_CLIENTS,
  isOtpDeepOnlyLocation,
} from './serviceCatalog'
import {
  locationNameFromTitle,
  buildJobTitle,
  buildDeepCleanDescription,
  calculateJobValue,
  jobMatchesLocationAndType,
  titleMatchesLocation,
  getCleaningType,
  parseDeepComponents,
  isDeepCleanAllowedOnDate,
  allowedDeepCleanDaysForLocation,
  DEFAULT_DEEP_CLEAN_PRICE,
  ALL_DEEP_COMPONENT_IDS,
} from './cleaningType'
import { checklistTemplateForJob } from './jobChecklist'
import { jobPinFieldsForLocation } from './jobGps'

export { titleMatchesLocation }

export function isManualServiceAllowedOnDate(location, date, cleaningType = 'basic') {
  if (!location || !date) return false
  if (cleaningType === 'deep') {
    if (location.group === 'Atomic' || location.group === 'Spot') return false
    return isDeepCleanAllowedOnDate(location.name, date)
  }
  if (location.deepOnly || isOtpDeepOnlyLocation(location.name)) return false
  const days = location.days
  if (!days || !days.length) return true
  return days.includes(weekdayOfYmd(date))
}

export function manualServiceDateWindow(today = tokyoToday()) {
  const ym = today.slice(0, 7)
  const [y, m] = ym.split('-').map(Number)
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
  const prev2 = m <= 2 ? `${y - 1}-${String(m + 10).padStart(2, '0')}` : `${y}-${String(m - 2).padStart(2, '0')}`
  return { from: monthBounds(prev2).from, to: today, currentMonth: ym, prevMonth: prev }
}

export function possibleManualDates({ cleaningType = 'basic', fromYmd, toYmd, location = null } = {}) {
  const window = manualServiceDateWindow()
  const from = fromYmd || window.from
  const to = toYmd || window.to
  const locs = location ? [location] : manualAddLocations()
  return datesInRange(from, to).filter(d =>
    locs.some(loc => isManualServiceAllowedOnDate(loc, d, cleaningType))
  )
}

export function snapToPossibleDate(date, cleaningType = 'basic', location = null) {
  const dates = possibleManualDates({ cleaningType, location })
  if (dates.includes(date)) return date
  const earlier = dates.filter(d => d <= date)
  return earlier[earlier.length - 1] || dates[0] || tokyoToday()
}

const DAY_NAMES_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_NAMES_JA = ['日', '月', '火', '水', '木', '金', '土']

/** Short operating-day label for the add-service list (e.g. "Mon · Sat" / "月・土"). */
export function formatManualServiceDays(location, cleaningType = 'basic', lang = 'en') {
  if (!location) return ''
  const names = lang === 'ja' ? DAY_NAMES_JA : DAY_NAMES_EN
  const sep = lang === 'ja' ? '・' : ' · '
  if (cleaningType === 'deep') {
    if (location.group === 'Atomic' || location.group === 'Spot') return ''
    return allowedDeepCleanDaysForLocation(location.name).map(d => names[d]).join(sep)
  }
  const days = location.days
  if (!days || !days.length || days.length === 7) return lang === 'ja' ? '毎日' : 'Every day'
  return days.map(d => names[d]).join(sep)
}

function jobsAtLocationAndType(jobs, locationName, cleaningType) {
  return (jobs || []).filter(j => jobMatchesLocationAndType(j, locationName, cleaningType))
}

/** All locations an employee can add manually */
export function manualAddLocations() {
  const otp = OTP_BASIC_LOCATIONS.map(loc => ({
    name: loc.name,
    address: loc.address || '',
    notes: loc.notes || '',
    clientId: SCHEDULE_CLIENTS.ontheplanet.id,
    clientName: SCHEDULE_CLIENTS.ontheplanet.name,
    pricePerVisit: loc.pricePerVisit || 0,
    deepCleanPrice: loc.deepCleanPrice || DEFAULT_DEEP_CLEAN_PRICE,
    scheduledTime: '00:30',
    group: 'OTP',
    deepOnly: !!loc.deepOnly,
    days: loc.days || loc.operatingDays || null,
  }))
  const atomic = [{
    name: ATOMIC_LOCATION.name,
    address: ATOMIC_LOCATION.address || '',
    notes: ATOMIC_LOCATION.notes || '',
    clientId: SCHEDULE_CLIENTS.atomicbar.id,
    clientName: SCHEDULE_CLIENTS.atomicbar.name,
    pricePerVisit: ATOMIC_LOCATION.pricePerVisit || 0,
    deepCleanPrice: 0,
    scheduledTime: ATOMIC_LOCATION.scheduledTime || '21:00',
    group: 'Atomic',
    days: ATOMIC_LOCATION.days || [1],
  }]
  const matsunaga = [{
    name: MATSUNAGA_SPOT.name,
    address: '',
    notes: MATSUNAGA_SPOT.notes || '',
    clientId: SCHEDULE_CLIENTS.matsunaga.id,
    clientName: SCHEDULE_CLIENTS.matsunaga.name,
    pricePerVisit: 0,
    deepCleanPrice: 0,
    scheduledTime: '10:00',
    group: 'Spot',
    days: null,
  }]
  return [...otp, ...atomic, ...matsunaga]
}

export function isDuskinJob(job) {
  if (!job) return false
  if (job.job_category === 'duskin') return true
  if (/duskin/i.test(job.client_name || '')) return true
  if (/duskin/i.test(job.title || '')) return true
  return false
}

/** Prefill past-service modal from a cancelled overdue job */
export function pastServicePrefillFromJob(job) {
  if (!job) return null
  const locName = locationNameFromTitle(job.title)
  const location = manualAddLocations().find(l => l.name.toLowerCase() === locName.toLowerCase())
  if (!location) return null
  const cleaningType = getCleaningType(job)
  const deepComponents = parseDeepComponents(job)
  return {
    location,
    date: job.scheduled_date,
    cleaningType,
    deepComponents: cleaningType === 'deep' ? deepComponents : [],
  }
}

export const ADD_OPTION_SORT = {
  available: 0,
  claim: 1,
  transfer: 2,
  mine: 3,
  done_today: 4,
  blocked: 5,
  wrong_day: 6,
  wrong_type: 7,
}

/** Day/type gate for one catalog location — used by add-service UI every time. */
export function classifyAddServiceLocation(location, date, cleaningType = 'basic') {
  if (!location || !date) return { state: 'wrong_day' }
  if (cleaningType === 'basic' && (location.deepOnly || isOtpDeepOnlyLocation(location.name))) {
    return { state: 'wrong_type', reason: 'deep_only' }
  }
  if (cleaningType === 'deep' && (location.group === 'Atomic' || location.group === 'Spot')) {
    return { state: 'wrong_type', reason: 'deep_not_available' }
  }
  if (!isManualServiceAllowedOnDate(location, date, cleaningType)) {
    return { state: 'wrong_day' }
  }
  return { state: 'eligible' }
}

export function isAddServiceActionable(state) {
  return ['available', 'claim', 'transfer', 'done_today'].includes(state)
}

/** Build UI rows — lists every location, including wrong-day / wrong-type, so nothing is hidden. */
export function buildAddServiceOptions(locations, todayJobs, currentEmployeeId, cleaningType = 'basic', date = null) {
  const jobs = todayJobs || []
  const active = jobs.filter(j => j.status === 'assigned' || j.status === 'in_progress')
  const completed = jobs.filter(j => j.status === 'completed')
  const matchLoc = (j, locName) => jobMatchesLocationAndType(j, locName, cleaningType)

  const rows = (locations || []).map(loc => {
    const mine = active.find(j =>
      j.employee_id === currentEmployeeId && matchLoc(j, loc.name)
    )
    if (mine) {
      return { location: loc, state: 'mine', job: mine }
    }

    const doneToday = completed.find(j => matchLoc(j, loc.name))
    if (doneToday) {
      return { location: loc, state: 'done_today', job: doneToday }
    }

    const unassigned = active.find(j =>
      !j.employee_id &&
      matchLoc(j, loc.name) &&
      j.status === 'assigned' &&
      !j.started_at
    )
    if (unassigned) {
      return { location: loc, state: 'claim', job: unassigned }
    }

    const other = active.find(j =>
      j.employee_id &&
      j.employee_id !== currentEmployeeId &&
      matchLoc(j, loc.name) &&
      j.status === 'assigned' &&
      !j.started_at
    )
    if (other) {
      return {
        location: loc,
        state: 'transfer',
        job: other,
        fromEmployee: other.employee_name || 'outro funcionário',
      }
    }

    const blocked = active.find(j =>
      j.employee_id !== currentEmployeeId &&
      matchLoc(j, loc.name)
    )
    if (blocked) {
      return {
        location: loc,
        state: 'blocked',
        job: blocked,
        reason: blocked.status === 'in_progress' ? 'in_progress' : 'started',
      }
    }

    if (date) {
      const dayClass = classifyAddServiceLocation(loc, date, cleaningType)
      if (dayClass.state !== 'eligible') return { location: loc, ...dayClass }
    }

    return { location: loc, state: 'available' }
  })

  return rows.sort((a, b) => (ADD_OPTION_SORT[a.state] ?? 99) - (ADD_OPTION_SORT[b.state] ?? 99)
    || String(a.location?.name || '').localeCompare(String(b.location?.name || '')))
}

async function nextSequenceOrder(supabase, employeeId, date) {
  const { data } = await supabase
    .from('jobs')
    .select('sequence_order')
    .eq('employee_id', employeeId)
    .eq('scheduled_date', date)
    .order('sequence_order', { ascending: false })
    .limit(1)
  return ((data?.[0]?.sequence_order || 0) + 1)
}

async function notifyTransfer(supabase, { fromEmployeeId, fromEmployeeName, toEmployee, locationName, date }) {
  if (!fromEmployeeId) return
  await supabase.from('messages').insert({
    employee_id: fromEmployeeId,
    employee_name: fromEmployeeName || '',
    sender: 'admin',
    content: `${locationName} foi removido do seu roteiro em ${date} — ${toEmployee.name} assumiu o serviço.`,
    read: false,
  })
}

function buildJobPayload(location, { cleaningType, deepComponents }) {
  const title = buildJobTitle(location.name, { cleaningType, deepComponents })
  const description = buildDeepCleanDescription({
    deepComponents: cleaningType === 'deep' ? deepComponents : [],
    baseNotes: location.notes || '',
  })
  const value = calculateJobValue({
    cleaningType,
    deepComponents,
    basicPrice: location.pricePerVisit || 0,
    deepPrice: location.deepCleanPrice || DEFAULT_DEEP_CLEAN_PRICE,
  })
  const checklist = checklistTemplateForJob({ title, description }, deepComponents)
  return { title, description, value, checklist }
}

async function reassignJob(supabase, {
  job,
  employee,
  date,
  title,
  description,
  value,
  checklist,
  fromEmployeeId,
  fromEmployeeName,
  actionLabel,
}) {
  const nextSeq = await nextSequenceOrder(supabase, employee.id, date)
  const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace('T', ' ')
  const transferNote = `[${stamp}] ${employee.name} ${actionLabel}${fromEmployeeName ? ` de ${fromEmployeeName}` : ''}`

  const { data: updated, error: updErr } = await supabase
    .from('jobs')
    .update({
      employee_id: employee.id,
      employee_name: employee.name,
      title,
      description: [description, job.description, transferNote].filter(Boolean).join('\n'),
      value,
      checklist_template: checklist || job.checklist_template,
      sequence_order: nextSeq,
    })
    .eq('id', job.id)
    .eq('status', 'assigned')
    .is('started_at', null)
    .select()
    .maybeSingle()

  if (updErr) return { ok: false, error: 'transfer_failed', detail: updErr.message }
  if (!updated) {
    return { ok: false, error: 'transfer_race', detail: 'Job was started or reassigned by someone else' }
  }

  if (fromEmployeeId) {
    await notifyTransfer(supabase, {
      fromEmployeeId,
      fromEmployeeName,
      toEmployee: employee,
      locationName: locationNameFromTitle(title),
      date,
    })
  }

  return { ok: true, job: updated }
}

/**
 * Employee adds a service for today.
 * basic and deep are separate services at the same location.
 */
export async function employeeAddService(supabase, {
  employee,
  location,
  date,
  cleaningType = 'basic',
  deepComponents = [],
}) {
  if (!employee?.id || !location?.name || !date) {
    return { ok: false, error: 'invalid_input' }
  }

  if (cleaningType === 'basic' && (location.deepOnly || isOtpDeepOnlyLocation(location.name))) {
    return { ok: false, error: 'basic_not_available' }
  }

  if (cleaningType === 'deep' && (!deepComponents?.length)) {
    return { ok: false, error: 'deep_components_required' }
  }

  if (date > tokyoToday()) {
    return { ok: false, error: 'future_not_allowed' }
  }

  if (!isManualServiceAllowedOnDate(location, date, cleaningType)) {
    return { ok: false, error: cleaningType === 'deep' ? 'wrong_deep_day' : 'not_possible_day' }
  }

  const { title, description, value, checklist } = buildJobPayload(location, { cleaningType, deepComponents })

  const { data: myActive } = await supabase
    .from('jobs')
    .select('id, title')
    .eq('employee_id', employee.id)
    .eq('scheduled_date', date)
    .in('status', ['assigned', 'in_progress'])

  if ((myActive || []).some(j => jobMatchesLocationAndType(j, location.name, cleaningType))) {
    return { ok: false, error: 'already_yours' }
  }

  const { data: dayJobs, error: dayErr } = await supabase
    .from('jobs')
    .select('*')
    .eq('scheduled_date', date)
    .neq('status', 'cancelled')

  if (dayErr) return { ok: false, error: 'fetch_failed', detail: dayErr.message }

  const atLocation = jobsAtLocationAndType(dayJobs, location.name, cleaningType)
  const completed = atLocation.find(j => j.status === 'completed')
  if (completed) {
    return { ok: false, error: 'already_done_today' }
  }

  const unassigned = atLocation.find(j =>
    !j.employee_id && j.status === 'assigned' && !j.started_at
  )
  if (unassigned) {
    const result = await reassignJob(supabase, {
      job: unassigned,
      employee,
      date,
      title,
      description,
      value,
      checklist,
      fromEmployeeId: null,
      fromEmployeeName: null,
      actionLabel: 'assumiu serviço sem atribuição',
    })
    if (!result.ok) return result
    return { ok: true, action: 'claimed', job: result.job }
  }

  const transferJob = atLocation.find(j =>
    j.employee_id &&
    j.employee_id !== employee.id &&
    j.status === 'assigned' &&
    !j.started_at
  )

  if (transferJob) {
    const result = await reassignJob(supabase, {
      job: transferJob,
      employee,
      date,
      title,
      description,
      value,
      checklist,
      fromEmployeeId: transferJob.employee_id,
      fromEmployeeName: transferJob.employee_name,
      actionLabel: 'assumiu',
    })
    if (!result.ok) return result
    return {
      ok: true,
      action: 'transferred',
      job: result.job,
      fromEmployee: transferJob.employee_name,
    }
  }

  const blocking = atLocation.find(j =>
    j.employee_id !== employee.id &&
    (j.status === 'in_progress' || j.started_at)
  )
  if (blocking) {
    return { ok: false, error: 'blocked' }
  }

  const nextSeq = await nextSequenceOrder(supabase, employee.id, date)
  const { data: created, error: insErr } = await supabase.from('jobs').insert({
    title,
    employee_id: employee.id,
    employee_name: employee.name,
    client_id: location.clientId || null,
    client_name: location.clientName || 'On The Planet',
    scheduled_date: date,
    scheduled_time: location.scheduledTime || '00:30',
    address: location.address || '',
    description,
    value,
    checklist_template: checklist || null,
    status: 'assigned',
    job_category: 'regular',
    sequence_order: nextSeq,
    photo_required: false,
    ...jobPinFieldsForLocation(location),
  }).select().single()

  if (insErr) return { ok: false, error: 'create_failed', detail: insErr.message }
  return { ok: true, action: 'created', job: created }
}

export function isJobFullyRegistered(job) {
  if (!job || job.status !== 'completed') return false
  return !!(job.retro_report || (job.photo_end_url && job.completed_at))
}

/**
 * Prepare or create a job for retroactive "already completed" registration.
 * Allows past dates and re-opens incomplete completed jobs.
 */
export async function preparePastServiceJob(supabase, {
  employee,
  location,
  date,
  cleaningType = 'basic',
  deepComponents = [],
}) {
  if (!employee?.id || !location?.name || !date) {
    return { ok: false, error: 'invalid_input' }
  }

  if (cleaningType === 'basic' && (location.deepOnly || isOtpDeepOnlyLocation(location.name))) {
    return { ok: false, error: 'basic_not_available' }
  }

  if (cleaningType === 'deep' && !deepComponents?.length) {
    return { ok: false, error: 'deep_components_required' }
  }

  if (date > tokyoToday()) {
    return { ok: false, error: 'future_not_allowed' }
  }

  if (!isManualServiceAllowedOnDate(location, date, cleaningType)) {
    return { ok: false, error: cleaningType === 'deep' ? 'wrong_deep_day' : 'not_possible_day' }
  }

  const { title, description, value, checklist } = buildJobPayload(location, { cleaningType, deepComponents })

  const { data: dayJobs, error: dayErr } = await supabase
    .from('jobs')
    .select('*')
    .eq('scheduled_date', date)
    .neq('status', 'cancelled')

  if (dayErr) return { ok: false, error: 'fetch_failed', detail: dayErr.message }

  const atLocation = jobsAtLocationAndType(dayJobs, location.name, cleaningType)
  const mine = atLocation.find(j => j.employee_id === employee.id)

  if (mine) {
    if (isJobFullyRegistered(mine)) {
      return { ok: false, error: 'already_registered', job: mine }
    }
    if (mine.status === 'completed' || mine.status === 'assigned') {
      return { ok: true, action: 'retro_existing', job: mine }
    }
    if (mine.status === 'in_progress') {
      return { ok: true, action: 'finish_existing', job: mine }
    }
  }

  const completedOther = atLocation.find(j => j.status === 'completed' && j.employee_id === employee.id)
  if (completedOther && !isJobFullyRegistered(completedOther)) {
    return { ok: true, action: 'retro_existing', job: completedOther }
  }

  const registered = atLocation.find(j => isJobFullyRegistered(j))
  if (registered) {
    return { ok: false, error: 'already_registered', job: registered }
  }

  const blocking = atLocation.find(j =>
    j.status === 'in_progress' && j.employee_id && j.employee_id !== employee.id,
  )
  if (blocking) {
    return { ok: false, error: 'blocked', job: blocking }
  }

  const transferJob = atLocation.find(j =>
    j.employee_id &&
    j.employee_id !== employee.id &&
    j.status === 'assigned' &&
    !j.started_at,
  )
  if (transferJob) {
    const result = await reassignJob(supabase, {
      job: transferJob,
      employee,
      date,
      title,
      description,
      value,
      checklist,
      fromEmployeeId: transferJob.employee_id,
      fromEmployeeName: transferJob.employee_name,
      actionLabel: 'registrou serviço já realizado',
    })
    if (!result.ok) return result
    return { ok: true, action: 'transferred', job: result.job, fromEmployee: transferJob.employee_name }
  }

  const unassigned = atLocation.find(j => !j.employee_id && j.status === 'assigned' && !j.started_at)
  if (unassigned) {
    const result = await reassignJob(supabase, {
      job: unassigned,
      employee,
      date,
      title,
      description,
      value,
      checklist,
      fromEmployeeId: null,
      fromEmployeeName: null,
      actionLabel: 'registrou serviço sem atribuição',
    })
    if (!result.ok) return result
    return { ok: true, action: 'claimed', job: result.job }
  }

  const nextSeq = await nextSequenceOrder(supabase, employee.id, date)
  const { data: created, error: insErr } = await supabase.from('jobs').insert({
    title,
    employee_id: employee.id,
    employee_name: employee.name,
    client_id: location.clientId || null,
    client_name: location.clientName || 'On The Planet',
    scheduled_date: date,
    scheduled_time: location.scheduledTime || '00:30',
    address: location.address || '',
    description,
    value,
    checklist_template: checklist || null,
    status: 'assigned',
    job_category: 'regular',
    sequence_order: nextSeq,
    photo_required: false,
    ...jobPinFieldsForLocation(location),
  }).select().single()

  if (insErr) return { ok: false, error: 'create_failed', detail: insErr.message }
  return { ok: true, action: 'created', job: created }
}

/** Retro report: at least 70% of checklist items (or all if ≤3 items). */
export function checklistCompleteForRetro(checklist) {
  if (!checklist?.length) return true
  const done = checklist.filter(c => c.done).length
  const required = checklist.length <= 3 ? checklist.length : Math.ceil(checklist.length * 0.7)
  return done >= required
}

export { ALL_DEEP_COMPONENT_IDS }
