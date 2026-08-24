import {
  OTP_BASIC_LOCATIONS,
  ATOMIC_LOCATION,
  DUSKIN_SITES,
  SCHEDULE_CLIENTS,
} from './serviceCatalog'
import { locationNameFromTitle, applyCleaningTypeToTitle } from './cleaningType'
import { checklistTemplateForJob } from './jobChecklist'

export function titleMatchesLocation(title, locationName) {
  const loc = locationNameFromTitle(title)
  return loc.toLowerCase() === (locationName || '').trim().toLowerCase()
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
  return [...otp, ...atomic, ...duskin]
}

/** Build UI rows: mine | transfer | available */
export function buildAddServiceOptions(locations, todayJobs, currentEmployeeId) {
  const active = (todayJobs || []).filter(j =>
    j.status === 'assigned' || j.status === 'in_progress'
  )

  return locations.map(loc => {
    const mine = active.find(j =>
      j.employee_id === currentEmployeeId && titleMatchesLocation(j.title, loc.name)
    )
    if (mine) {
      return { location: loc, state: 'mine', job: mine }
    }

    const other = active.find(j =>
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

/**
 * Employee adds a service for today.
 * If another employee has it assigned (not started), transfer to current user.
 * Otherwise create a new job.
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

  const { data: candidates, error: findErr } = await supabase
    .from('jobs')
    .select('*')
    .eq('scheduled_date', date)
    .eq('status', 'assigned')
    .neq('employee_id', employee.id)
    .is('started_at', null)

  if (findErr) return { ok: false, error: 'fetch_failed', detail: findErr.message }

  const transferJob = (candidates || []).find(j => titleMatchesLocation(j.title, location.name))

  if (transferJob) {
    const nextSeq = await nextSequenceOrder(supabase, employee.id, date)
    const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace('T', ' ')
    const transferNote = `[${stamp}] ${employee.name} assumiu de ${transferJob.employee_name || 'outro'}`

    const { data: updated, error: updErr } = await supabase
      .from('jobs')
      .update({
        employee_id: employee.id,
        employee_name: employee.name,
        sequence_order: nextSeq,
        description: [transferJob.description, transferNote].filter(Boolean).join('\n'),
      })
      .eq('id', transferJob.id)
      .eq('status', 'assigned')
      .is('started_at', null)
      .select()
      .maybeSingle()

    if (updErr) return { ok: false, error: 'transfer_failed', detail: updErr.message }
    if (!updated) {
      return { ok: false, error: 'transfer_race', detail: 'Job was started or reassigned by someone else' }
    }

    await notifyTransfer(supabase, {
      fromEmployeeId: transferJob.employee_id,
      fromEmployeeName: transferJob.employee_name,
      toEmployee: employee,
      locationName: location.name,
      date,
    })

    return { ok: true, action: 'transferred', job: updated, fromEmployee: transferJob.employee_name }
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
