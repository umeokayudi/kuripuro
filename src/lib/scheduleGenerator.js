// Contratos de escala — atualize aqui quando o admin enviar mudanças.
// Só gera jobs para funcionários ATIVOS (is_active=true) cujo ID está listado abaixo.

import {
  SCHEDULE_CLIENTS,
  OTP_BASIC_LOCATIONS,
  otpBasicScheduleLocations,
  ATOMIC_LOCATION,
  DUSKIN_SITES,
  SEVEN_DAY_MONDAY_MORNING,
  isOtpDeepOnlyLocation,
} from './serviceCatalog.js'
import { checklistTemplateForJob } from './jobChecklist.js'

export { SCHEDULE_CLIENTS } from './serviceCatalog.js'
export { OTP_BASIC_LOCATIONS, ATOMIC_LOCATION } from './serviceCatalog.js'

/** @deprecated use OTP_BASIC_LOCATIONS — mantido para compat */
export const DEFAULT_LOCATIONS = [
  ...otpBasicScheduleLocations().map(l => ({
    name: l.name,
    address: l.address,
    notes: l.notes,
    days: l.days,
    deepClean: 5000,
    serviceType: 'Basic Cleaning',
  })),
  {
    name: ATOMIC_LOCATION.name,
    address: ATOMIC_LOCATION.address,
    notes: ATOMIC_LOCATION.notes,
    days: ATOMIC_LOCATION.days,
    deepClean: 0,
    serviceType: 'Basic Cleaning',
    client: 'Atomic Bar',
  },
]

const DAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const PALETTE = ['#60a5fa', '#4ade80', '#fbbf24', '#c084fc', '#f472b6', '#38bdf8']
export const DOW_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
export const DOW_JA = ['日', '月', '火', '水', '木', '金', '土']
export const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Contrato de escala por funcionário (employee_id do Supabase).
 * Deep clean e manutenção mensal: inserir manualmente no admin.
 */
export const EMPLOYEE_SCHEDULE_CONTRACTS = [
  {
    employeeId: '583d1ad6-1046-41db-8944-8f69120be41d',
    label: 'OTP · limpeza básica diária',
    detail: 'Todos os restaurantes OTP nos dias do contrato. Segunda: Atomic até 21:00.',
    template: 'otp_basic',
    mondayAtomic: true,
  },
  {
    employeeId: '583d1ad6-1046-41db-8944-8f69120be41d',
    label: 'Duskin · domingos do mês',
    detail: '1º dom (cera/polidora/banheiros/prédios), 3º dom (prédios + Sugita Restaurant), penúltimo dom (limpeza geral).',
    template: 'duskin_sunday',
  },
]

export function contractsForActiveEmployees(activeEmployees) {
  const activeIds = new Set((activeEmployees || []).filter(e => e.is_active !== false).map(e => e.id))
  return EMPLOYEE_SCHEDULE_CONTRACTS
    .filter(c => activeIds.has(c.employeeId))
    .map((c, i) => {
      const emp = activeEmployees.find(e => e.id === c.employeeId)
      return {
        ...c,
        employeeName: emp?.full_name || 'Funcionário',
        shortName: (emp?.full_name || '?').split(' ')[0],
        color: PALETTE[i % PALETTE.length],
      }
    })
}

export function locationsFromContracts(serviceContracts) {
  if (!serviceContracts?.length) return DEFAULT_LOCATIONS
  const defaultByName = Object.fromEntries(DEFAULT_LOCATIONS.map(l => [l.name, l]))
  return serviceContracts
    .filter(sc => sc.service_type === 'Basic Cleaning')
    .map(sc => ({
      name: sc.location_name,
      address: sc.location_address || defaultByName[sc.location_name]?.address || '',
      notes: sc.notes || defaultByName[sc.location_name]?.notes || '',
      days: (sc.days_of_week || []).map(d => DAY_MAP[d]).filter(d => d != null),
      deepClean: 5000,
      serviceType: sc.service_type || 'Basic Cleaning',
      price: sc.price_per_visit,
    }))
    .filter(l => l.days.length > 0)
}

function dateStrLocal(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getDaysInMonth(yearMonth) {
  const [year, mon] = yearMonth.split('-').map(Number)
  const days = []
  const d = new Date(year, mon - 1, 1)
  while (d.getMonth() === mon - 1) {
    days.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }
  return days
}

function sundaysInMonth(yearMonth) {
  return getDaysInMonth(yearMonth).filter(d => d.getDay() === 0)
}

function jobInstructions(location, serviceLabel) {
  const parts = []
  if (location.notes) parts.push(location.notes)
  if (serviceLabel) parts.push(serviceLabel)
  return parts.length ? parts.join('\n') : null
}

function makeJob({ id, date, time, employee, empId, client, location, seq, serviceLabel, category = 'regular' }) {
  const title = `${location.name} — ${serviceLabel || 'Basic Cleaning'}`
  return {
    id,
    date,
    time,
    employee,
    employeeId: empId,
    client: client || 'On The Planet',
    title,
    address: location.address || null,
    notes: location.notes,
    seq,
    type: /deep/i.test(serviceLabel || '') ? 'deep' : 'basic',
    category,
    description: jobInstructions(location, serviceLabel),
  }
}

function duskinJobsForSunday(dateStr, emp, empId, jobIdStart) {
  const jobs = []
  let jobId = jobIdStart
  const b = DUSKIN_SITES
  const add = (site, time, label, seq) => {
    jobs.push(makeJob({
      id: jobId++,
      date: dateStr,
      time,
      employee: emp,
      empId,
      client: 'Duskin',
      location: { name: site.name, address: '', notes: site.notes },
      seq,
      serviceLabel: label,
      category: 'duskin',
    }))
  }

  return { jobs, nextId: jobId, add }
}

export function buildMonthSchedule(month, {
  contracts = [],
  locations = DEFAULT_LOCATIONS,
  includeDuskin = true,
} = {}) {
  const days = getDaysInMonth(month)
  const jobs = []
  let jobId = 1

  const basicLocs = locations.filter(l =>
    l.name !== 'Atomic Bar' &&
    !/deep/i.test(l.serviceType || '') &&
    !isOtpDeepOnlyLocation(l.name)
  )
  const atomicLoc = locations.find(l => l.name === 'Atomic Bar') || {
    ...ATOMIC_LOCATION,
    days: ATOMIC_LOCATION.days,
  }

  const sundays = sundaysInMonth(month)
  const firstSun = sundays[0] ? dateStrLocal(sundays[0]) : null
  const thirdSun = sundays[2] ? dateStrLocal(sundays[2]) : null
  const penultimateSun = sundays.length >= 2 ? dateStrLocal(sundays[sundays.length - 2]) : null

  days.forEach(date => {
    const dow = date.getDay()
    const dateStr = dateStrLocal(date)
    const isMon = dow === 1

    contracts.forEach(contract => {
      const emp = contract.shortName
      const empId = contract.employeeId

      if (contract.template === 'otp_basic') {
        if (isMon && contract.mondayAtomic && atomicLoc) {
          jobs.push(makeJob({
            id: jobId++,
            date: dateStr,
            time: ATOMIC_LOCATION.scheduledTime || '21:00',
            employee: emp,
            empId,
            client: 'Atomic Bar',
            location: atomicLoc,
            seq: 1,
            serviceLabel: 'Basic Cleaning',
          }))
        }

        basicLocs.forEach((loc, i) => {
          if (!loc.days.includes(dow)) return
          const isMonMorning = isMon && SEVEN_DAY_MONDAY_MORNING.includes(loc.name)
          const time = isMonMorning ? '06:00' : '00:30'
          jobs.push(makeJob({
            id: jobId++,
            date: dateStr,
            time,
            employee: emp,
            empId,
            location: loc,
            seq: isMon ? i + 2 : i + 1,
            serviceLabel: 'Basic Cleaning',
          }))
        })
      }

      if (contract.template === 'duskin_sunday' && includeDuskin && dow === 0) {
        const b = DUSKIN_SITES

        if (dateStr === firstSun) {
          addDuskin(jobs, () => jobId++, dateStr, emp, empId, b.sugitaTeiLamen, '09:00', 'Floor Wax + Range Hood', 1)
          addDuskin(jobs, () => jobId++, dateStr, emp, empId, b.sugitaRestaurant, '10:30', 'Floor Polisher + Bathroom', 2)
          addDuskin(jobs, () => jobId++, dateStr, emp, empId, b.sugitaTeiLamen, '11:30', 'Bathroom Cleaning', 3)
          addDuskin(jobs, () => jobId++, dateStr, emp, empId, b.building1, '13:00', 'Common Area + Garbage', 4)
          addDuskin(jobs, () => jobId++, dateStr, emp, empId, b.building2, '14:00', 'Common Area + Garbage', 5)
          addDuskin(jobs, () => jobId++, dateStr, emp, empId, b.building3, '15:00', 'Common Area + Garbage', 6)
        }

        if (dateStr === thirdSun) {
          addDuskin(jobs, () => jobId++, dateStr, emp, empId, b.building1, '09:00', 'Common Area + Garbage', 1)
          addDuskin(jobs, () => jobId++, dateStr, emp, empId, b.building2, '10:00', 'Common Area + Garbage', 2)
          addDuskin(jobs, () => jobId++, dateStr, emp, empId, b.building3, '11:00', 'Common Area + Garbage', 3)
          addDuskin(jobs, () => jobId++, dateStr, emp, empId, b.sugitaRestaurant, '13:00', 'Floor Polisher + Range Hood + Bathroom', 4)
        }

        if (dateStr === penultimateSun && dateStr !== firstSun) {
          addDuskin(jobs, () => jobId++, dateStr, emp, empId, b.sugitaTeiLamen, '09:00', 'Monthly Cleaning', 1)
          addDuskin(jobs, () => jobId++, dateStr, emp, empId, b.sugitaRestaurant, '11:00', 'Monthly Cleaning', 2)
          addDuskin(jobs, () => jobId++, dateStr, emp, empId, b.building1, '13:00', 'Monthly Cleaning', 3)
          addDuskin(jobs, () => jobId++, dateStr, emp, empId, b.building2, '14:00', 'Monthly Cleaning', 4)
          addDuskin(jobs, () => jobId++, dateStr, emp, empId, b.building3, '15:00', 'Monthly Cleaning', 5)
        }
      }
    })
  })

  return jobs
}

function addDuskin(jobs, nextId, dateStr, emp, empId, site, time, label, seq) {
  const id = nextId()
  jobs.push(makeJob({
    id,
    date: dateStr,
    time,
    employee: emp,
    empId,
    client: 'Duskin',
    location: { name: site.name, address: '', notes: site.notes },
    seq,
    serviceLabel: label,
    category: 'duskin',
  }))
}

export function scheduleStats(jobs) {
  const byEmployee = {}
  const byDow = [0, 0, 0, 0, 0, 0, 0]
  jobs.forEach(j => {
    byEmployee[j.employee] = (byEmployee[j.employee] || 0) + 1
    byDow[new Date(j.date + 'T12:00:00').getDay()]++
  })
  return { total: jobs.length, byEmployee, byDow, days: new Set(jobs.map(j => j.date)).size }
}

export function keyboxForJob(job) {
  if (job?.description) return job.description
  const name = (job?.title || '').replace(/ — .*/, '')
  const loc = DEFAULT_LOCATIONS.find(l => name.startsWith(l.name) || l.name === name)
  return loc?.notes || ''
}

export function jobsToRows(jobs, contracts) {
  const empById = Object.fromEntries(contracts.map(c => [c.employeeId, c]))
  const clientMap = {
    'On The Planet': SCHEDULE_CLIENTS.ontheplanet,
    'Atomic Bar': SCHEDULE_CLIENTS.atomicbar,
    Duskin: SCHEDULE_CLIENTS.duskin,
    Matsunaga: SCHEDULE_CLIENTS.matsunaga,
  }

  return jobs.map(j => ({
    title: j.title,
    employee_id: j.employeeId,
    employee_name: empById[j.employeeId]?.employeeName || j.employee,
    client_id: clientMap[j.client]?.id || SCHEDULE_CLIENTS.ontheplanet.id,
    client_name: j.client,
    scheduled_date: j.date,
    scheduled_time: j.time,
    status: j.status || 'assigned',
    job_category: j.category === 'duskin' ? 'regular' : (j.category || 'regular'),
    sequence_order: j.seq,
    address: j.address || null,
    description: [j.notes, j.description].filter(Boolean).join('\n') || null,
    checklist_template: checklistTemplateForJob({ title: j.title }) || null,
    ...(j.completed_at ? { completed_at: j.completed_at } : { completed_at: null }),
  }))
}
