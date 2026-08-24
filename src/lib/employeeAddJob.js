import {
  OTP_BASIC_LOCATIONS,
  ATOMIC_LOCATION,
  DUSKIN_SITES,
  MATSUNAGA_SPOT,
  SCHEDULE_CLIENTS,
} from './serviceCatalog'
import { locationNameFromTitle, applyCleaningTypeToTitle } from './cleaningType'
import { checklistTemplateForJob } from './jobChecklist'

export function titleMatchesLocation(title, locationName) {
  const loc = locationNameFromTitle(title)
  return loc.toLowerCase() === (locationName || '').trim().toLowerCase()
}

function jobsAtLocation(jobs, locationName) {
  return (jobs || []).filter(j => titleMatchesLocation(j.title, locationName))
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
    scheduledTime: '00:30',
    group: 'OTP',
  }))
  const atomic = [{
    name: ATOMIC_LOCATION.name,
    address: ATOMIC_LOCATION.address || '',
    notes: ATOMIC_LOCATION.notes || '',
    clientId: SCHEDULE_CLIENTS.atomicbar.id,
    clientName: SCHEDULE_CLIENTS.atomicbar.name,
    pricePerVisit: ATOMIC_LOCATION.pricePerVisit || 0,
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
    scheduledTime: '10:00',
    group: 'Spot',
  }]
  return [...otp, ...atomic, ...duskin, ...matsunaga]
}

/** Build UI rows: mine | transfer | claim | done_today | blocked | available */
export function buildAddServiceOptions(locations, todayJobs, currentEmployeeId) {
  const jobs = todayJobs || []
  const active = jobs.filter(j => j.status === 'assigned' || j.status === 'in_progress')
  const completed = jobs.filter(j => j.status === 'completed')

  return locations.map(loc => {
    const mine = active.find(j =>
      j.employee_id === currentEmployeeId && titleMatchesLocation(j.title, loc.name)
    )
    if (mine) {
      return { location: loc, state: 'mine', job: mine }
    }

    const doneToday = completed.find(j => titleMatchesLocation(j.title, loc.name))
    if (doneToday) {
      return { location: loc, state: 'done_today', job: doneToday }
    }

    const unassigned = active.find(j =>
      !j.employee_id &&
      titleMatchesLocation(j.title, loc.name) &&
      j.status === 'assigned' &&
      !j.started_at
    )
    if (unassigned) {
      return { location: loc, state: 'claim', job: unassigned }
    }

    const other = active.find(j =>
      j.employee_id &&
      j.employee_id !== currentEmployeeId &&
      titleMatchesLocation(j.title, loc.name) &&
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
      titleMatchesLocation(j.title, loc.name)
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

async function reassignJob(supabase, {
  job,
  employee,
  date,
  title,
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
      sequence_order: nextSeq,
      description: [job.description, transferNote].filter(Boolean).join('\n'),
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
 * If another employee has it assigned (not started), transfer to current user.
 * If unassigned job exists, claim it.
 * Otherwise create a new job (unless already completed today).
 */
export async function employeeAddService(supabase, {
  employee,
  location,
  date,
  cleaningType = 'basic',
}) {
  if (!employee?.id || !location?.name || !date) {
    return { ok: false, error: 'invalid_input' }
  }

  const title = applyCleaningTypeToTitle(location.name, cleaningType)
  const checklist = checklistTemplateForJob({ title })

  const { data: myActive } = await supabase
    .from('jobs')
    .select('id, title')
    .eq('employee_id', employee.id)
    .eq('scheduled_date', date)
    .in('status', ['assigned', 'in_progress'])

  if ((myActive || []).some(j => titleMatchesLocation(j.title, location.name))) {
    return { ok: false, error: 'already_yours' }
  }

  const { data: dayJobs, error: dayErr } = await supabase
    .from('jobs')
    .select('*')
    .eq('scheduled_date', date)
    .neq('status', 'cancelled')

  if (dayErr) return { ok: false, error: 'fetch_failed', detail: dayErr.message }

  const atLocation = jobsAtLocation(dayJobs, location.name)
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
    description: location.notes || null,
    value: location.pricePerVisit || 0,
    checklist_template: checklist || null,
    status: 'assigned',
    job_category: 'regular',
    sequence_order: nextSeq,
    photo_required: false,
  }).select().single()

  if (insErr) return { ok: false, error: 'create_failed', detail: insErr.message }
  return { ok: true, action: 'created', job: created }
}
