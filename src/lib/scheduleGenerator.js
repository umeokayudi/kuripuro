// Contratos de escala — atualize aqui quando o admin enviar mudanças.
// Só gera jobs para funcionários ATIVOS (is_active=true) cujo ID está listado abaixo.

import {
  SCHEDULE_CLIENTS,
  OTP_BASIC_LOCATIONS,
  otpBasicScheduleLocations,
  otpDeepOnlyLocations,
  ATOMIC_LOCATION,
  DUSKIN_SITES,
  SEVEN_DAY_MONDAY_MORNING,
  isOtpDeepOnlyLocation,
} from './serviceCatalog.js'
import { checklistTemplateForJob } from './jobChecklist.js'
import { buildDeepCleanProgress } from './cleaningType.js'

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

function normName(value) {
  return String(value || '').trim().toLowerCase()
}

function firstName(value) {
  return normName(value).split(/\s+/)[0]
}

/**
 * Templates de escala. `assignTo` é a fila de operadores (nome completo ou primeiro nome).
 * O primeiro funcionário ATIVO na fila recebe o contrato — André inativo não mata a geração.
 */
export const SCHEDULE_TEMPLATES = [
  {
    template: 'otp_basic',
    mondayAtomic: true,
    assignTo: ['Alexandre Umeoka', 'Sasaki Kazuma', 'Guilherme Henrique'],
    label: 'OTP · limpeza básica diária',
    detail: 'Todos os restaurantes OTP nos dias do contrato. Segunda: Atomic até 21:00.',
  },
  {
    template: 'otp_deep_only',
    assignTo: ['Sasaki Kazuma', 'Alexandre Umeoka', 'Guilherme Henrique'],
    label: 'OTP · deep-only seg+qua + manutenção folga',
    detail: 'Ibushio, Nyu Ibushio, Horumon, Manmosu — deep seg+qua; grease trap 2x/mês; fogão, range hood, grelha e ar 1x/mês no dia de folga.',
  },
  {
    template: 'duskin_sunday',
    assignTo: ['Guilherme Henrique', 'Pedro Bacana', 'Alexandre Umeoka'],
    label: 'Duskin · domingos do mês',
    detail: '1º dom (cera/polidora/banheiros/prédios), 3º dom (prédios + Sugita Restaurant), penúltimo dom (limpeza geral).',
  },
]

/** @deprecated use SCHEDULE_TEMPLATES — kept so old seeds still import a list */
export const EMPLOYEE_SCHEDULE_CONTRACTS = SCHEDULE_TEMPLATES

export function pickEmployeeForTemplate(activeEmployees, assignTo = []) {
  const active = (activeEmployees || []).filter(e => e && e.is_active !== false)
  for (const name of assignTo || []) {
    const key = normName(name)
    const hit = active.find(e => {
      const full = normName(e.full_name)
      return full === key || firstName(e.full_name) === firstName(name)
    })
    if (hit) return hit
  }
  return active[0] || null
}

export function contractsForActiveEmployees(activeEmployees) {
  const used = new Set()
  return SCHEDULE_TEMPLATES
    .map((tmpl, i) => {
      const pool = (activeEmployees || []).filter(e => e && e.is_active !== false && !used.has(e.id))
      const emp = pickEmployeeForTemplate(pool.length ? pool : activeEmployees, tmpl.assignTo)
        || pickEmployeeForTemplate(activeEmployees, tmpl.assignTo)
      if (!emp) return null
      used.add(emp.id)
      return {
        ...tmpl,
        employeeId: emp.id,
        employeeName: emp.full_name || 'Funcionário',
        shortName: (emp.full_name || '?').split(' ')[0],
        color: PALETTE[i % PALETTE.length],
      }
    })
    .filter(Boolean)
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
  const isDeep = /deep/i.test(serviceLabel || '')
  const value = isDeep
    ? (location.deepClean || location.deepCleanPrice || 5000)
    : (location.price || location.pricePerVisit || 0)
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
    type: isDeep ? 'deep' : 'basic',
    category,
    description: jobInstructions(location, serviceLabel),
    value,
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

function restDayDatesInMonth(month, restDow) {
  return getDaysInMonth(month).filter(d => d.getDay() === restDow).map(dateStrLocal)
}

function addOtpDeepOnlyMaintenance(month, contract, jobs, jobIdRef) {
  const emp = contract.shortName
  const empId = contract.employeeId

  otpDeepOnlyLocations().forEach((loc, locIdx) => {
    const restDates = restDayDatesInMonth(month, loc.restDay)
  const greaseSlots = [0, 2]
    greaseSlots.forEach((slot, i) => {
      const date = restDates[slot]
      if (!date) return
      jobs.push(makeJob({
        id: jobIdRef.value++,
        date,
        time: '09:00',
        employee: emp,
        empId,
        location: loc,
        seq: locIdx * 10 + i + 1,
        serviceLabel: 'Grease Trap',
        category: 'maintenance',
      }))
    })

    const monthlyDate = restDates[1]
    if (monthlyDate) {
      jobs.push(makeJob({
        id: jobIdRef.value++,
        date: monthlyDate,
        time: '10:30',
        employee: emp,
        empId,
        location: loc,
        seq: locIdx * 10 + 5,
        serviceLabel: 'Stove + Range Hood + Grating + AC Cleaning',
        category: 'maintenance',
      }))
    }
  })
}

export function buildMonthSchedule(month, {
  contracts = [],
  locations = DEFAULT_LOCATIONS,
  includeDuskin = true,
} = {}) {
  const days = getDaysInMonth(month)
  const jobs = []
  let jobId = 1
  const jobIdRef = { value: jobId }

  contracts.forEach(contract => {
    if (contract.template === 'otp_deep_only') {
      addOtpDeepOnlyMaintenance(month, contract, jobs, jobIdRef)
    }
  })
  jobId = jobIdRef.value

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

        if (dow === 2) {
          basicLocs.forEach((loc, i) => {
            jobs.push(makeJob({
              id: jobId++,
              date: dateStr,
              time: '01:30',
              employee: emp,
              empId,
              location: loc,
              seq: 80 + i,
              serviceLabel: 'Deep Clean',
              category: 'deep',
            }))
          })
        }
      }

      if (contract.template === 'otp_deep_only' && (dow === 1 || dow === 3)) {
        otpDeepOnlyLocations().forEach((loc, i) => {
          jobs.push(makeJob({
            id: jobId++,
            date: dateStr,
            time: '00:30',
            employee: emp,
            empId,
            location: loc,
            seq: i + 1,
            serviceLabel: 'Deep Clean',
            category: 'deep',
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
    value: Number(j.value || j.price || 0) || null,
    ...(j.completed_at ? { completed_at: j.completed_at } : { completed_at: null }),
  }))
}

/** Drafts for expected OTP deep-clean slots that have no job yet. */
export function buildMissingDeepCleanJobs(yearMonth, existingJobs, { contracts = [] } = {}) {
  const normalized = (existingJobs || []).map(j => ({
    ...j,
    scheduled_date: j.scheduled_date || j.date,
    client_name: j.client_name || j.client,
    status: j.status || 'assigned',
  }))
  const progress = buildDeepCleanProgress(normalized, yearMonth)
  const assignee = contracts.find(c => c.template === 'otp_deep_only')
    || contracts.find(c => c.template === 'otp_basic')
    || contracts[0]
  if (!assignee) return []

  const locByName = Object.fromEntries(OTP_BASIC_LOCATIONS.map(l => [l.name, l]))
  const jobs = []
  Object.entries(progress.byLocation || {}).forEach(([name, data]) => {
    const location = locByName[name] || { name, notes: '', address: '', deepCleanPrice: 5000 }
    ;(data.expectedDates || []).forEach(date => {
      if (data.byDate?.[date]) return
      jobs.push(makeJob({
        id: jobs.length + 1,
        date,
        time: isOtpDeepOnlyLocation(name) ? '00:30' : '01:30',
        employee: assignee.shortName || assignee.employeeName,
        empId: assignee.employeeId,
        location,
        seq: 90,
        serviceLabel: 'Deep Clean',
        category: 'deep',
      }))
    })
  })
  return jobs
}
