import {
  OTP_BASIC_LOCATIONS,
  ATOMIC_LOCATION,
  DUSKIN_SITES,
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
  DEFAULT_DEEP_CLEAN_PRICE,
  ALL_DEEP_COMPONENT_IDS,
} from './cleaningType'
import { checklistTemplateForJob } from './jobChecklist'

export { titleMatchesLocation }

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
  }]
  const duskin = Object.values(DUSKIN_SITES).map(site => ({
    name: site.name,
    address: '',
    notes: site.notes || '',
    clientId: SCHEDULE_CLIENTS.duskin.id,
    clientName: SCHEDULE_CLIENTS.duskin.name,
    pricePerVisit: 0,
    deepCleanPrice: 0,
    scheduledTime: '09:00',
    group: 'Duskin',
  }))
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
  }]
  return [...otp, ...atomic, ...duskin, ...matsunaga]
}

/** Build UI rows — respects basic vs deep as separate services */
export function buildAddServiceOptions(locations, todayJobs, currentEmployeeId, cleaningType = 'basic') {
  const jobs = todayJobs || []
  const active = jobs.filter(j => j.status === 'assigned' || j.status === 'in_progress')
  const completed = jobs.filter(j => j.status === 'completed')
  const matchLoc = (j, locName) => jobMatchesLocationAndType(j, locName, cleaningType)

  return locations.map(loc => {
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

    return { location: loc, state: 'available' }
  })
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
  }).select().single()

  if (insErr) return { ok: false, error: 'create_failed', detail: insErr.message }
  return { ok: true, action: 'created', job: created }
}

export { ALL_DEEP_COMPONENT_IDS }
