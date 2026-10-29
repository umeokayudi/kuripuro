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
export const SCHEDULE_COLORS = ['#60a5fa', '#4ade80', '#fbbf24', '#c084fc', '#f472b6', '#38bdf8']
export const DOW_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
export const DOW_JA = ['日', '月', '火', '水', '木', '金', '土']
export const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Rotas da escala (o trabalho fixo do mês). Não têm funcionário fixo: quem faz
 * cada dia é decidido por assignEmployees(), conforme a disponibilidade marcada
 * por cada um (employee_availability) e o responsável escolhido pelo admin.
 * Deep clean e manutenção mensal avulsos: inserir manualmente no admin.
 */
export const SCHEDULE_ROUTES = [
  {
    key: 'otp_basic',
    label: 'OTP · limpeza básica diária',
    detail: 'Todos os restaurantes OTP nos dias do contrato. Segunda: Atomic até 21:00.',
    template: 'otp_basic',
    mondayAtomic: true,
  },
  {
    key: 'otp_deep_only',
    label: 'OTP · deep-only seg+qua + manutenção folga',
    detail: 'Ibushio, Nyu Ibushio, Horumon, Manmosu — deep seg+qua; grease trap 2x/mês; fogão, range hood, grelha e ar 1x/mês no dia de folga.',
    template: 'otp_deep_only',
  },
  {
    key: 'duskin_sunday',
    label: 'Duskin · domingos do mês',
    detail: '1º dom (cera/polidora/banheiros/prédios), 3º dom (prédios + Sugita Restaurant), penúltimo dom (limpeza geral).',
    template: 'duskin_sunday',
  },
]

/** Funcionários que entram na escala por padrão (logins de teste ficam de fora). */
export function defaultScheduleEmployees(employees) {
  return (employees || []).filter(e => e.is_active !== false && !/^teste\b/i.test(e.full_name || ''))
}

/** Uma marcação conta enquanto não foi recusada pelo admin (pendente também conta). */
function counts(row) {
  return row && row.status !== 'rejected'
}

/** Mapa `${employee_id}|${date}` -> 'off' | 'extra' a partir das linhas de employee_availability. */
export function availabilityIndex(rows) {
  const idx = {}
  ;(rows || []).forEach(r => {
    if (!counts(r) || (r.kind !== 'off' && r.kind !== 'extra')) return
    idx[`${r.employee_id}|${r.date}`] = { kind: r.kind, status: r.status }
  })
  return idx
}

const shortNameOf = (emp) => (emp?.full_name || '?').split(' ')[0]

/**
 * Decide quem faz cada rota em cada dia.
 * - Ninguém recebe trabalho num dia que marcou folga (pendente ou aprovada).
 * - Se a rota tem responsável e ele pode, fica com ele.
 * - Senão: quem marcou "trabalho extra" no dia, depois quem ainda não tem rota
 *   naquele dia, depois quem trabalhou menos dias no mês.
 * - Se ninguém pode, os jobs ficam sem funcionário (aparecem como "Sem funcionário").
 * `overrides['date|routeKey']` força uma escolha do admin ('' = sem funcionário).
 */
export function assignEmployees(jobs, { employees = [], availability = {}, owners = {}, overrides = {} } = {}) {
  const empById = Object.fromEntries(employees.map(e => [e.id, e]))
  const routeOrder = Object.fromEntries(SCHEDULE_ROUTES.map((r, i) => [r.key, i]))
  const groups = {}
  jobs.forEach(j => { (groups[`${j.date}|${j.routeKey}`] = groups[`${j.date}|${j.routeKey}`] || []).push(j) })
  const keys = Object.keys(groups).sort((a, b) => {
    const [da, ra] = a.split('|'); const [db, rb] = b.split('|')
    return da === db ? (routeOrder[ra] ?? 9) - (routeOrder[rb] ?? 9) : da.localeCompare(db)
  })

  const daysWorked = Object.fromEntries(employees.map(e => [e.id, new Set()]))
  const busy = {} // date -> Set(employeeId)
  const result = []

  keys.forEach(key => {
    const [date, routeKey] = key.split('|')
    const mark = (id) => availability[`${id}|${date}`]?.kind
    const canWork = (id) => !!empById[id] && mark(id) !== 'off'
    const busyToday = busy[date] || (busy[date] = new Set())

    let chosen = null
    let reason = 'auto'
    const owner = owners[routeKey]
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      chosen = overrides[key] && empById[overrides[key]] ? overrides[key] : null
      reason = 'manual'
    } else if (owner && canWork(owner)) {
      chosen = owner
      reason = 'owner'
    } else {
      const candidates = employees.filter(e => canWork(e.id)).sort((a, b) =>
        (mark(b.id) === 'extra') - (mark(a.id) === 'extra') ||
        busyToday.has(a.id) - busyToday.has(b.id) ||
        daysWorked[a.id].size - daysWorked[b.id].size ||
        (a.full_name || '').localeCompare(b.full_name || ''))
      chosen = candidates[0]?.id || null
      if (owner && empById[owner]) reason = 'ownerOff'
      if (!chosen) reason = 'nobody'
    }

    if (chosen) { busyToday.add(chosen); daysWorked[chosen].add(date) }
    const emp = chosen ? empById[chosen] : null
    groups[key].forEach(j => result.push({
      ...j,
      employeeId: chosen,
      employee: emp ? shortNameOf(emp) : '',
      employeeName: emp?.full_name || null,
      groupKey: key,
      assignReason: reason,
      coveringFor: reason === 'ownerOff' ? shortNameOf(empById[owner]) : null,
    }))
  })

  return result.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.id - b.id)
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
  const emp = ''
  const empId = null

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
  routes = SCHEDULE_ROUTES,
  locations = DEFAULT_LOCATIONS,
} = {}) {
  const contracts = routes
  const days = getDaysInMonth(month)
  const jobs = []
  let jobId = 1
  const jobIdRef = { value: jobId }

  const tagRoute = (from, contract) => {
    for (let i = from; i < jobs.length; i++) jobs[i].routeKey = contract.key || contract.template
  }

  contracts.forEach(contract => {
    if (contract.template === 'otp_deep_only') {
      const from = jobs.length
      addOtpDeepOnlyMaintenance(month, contract, jobs, jobIdRef)
      tagRoute(from, contract)
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
      const emp = ''
      const empId = null
      const from = jobs.length

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

      if (contract.template === 'duskin_sunday' && dow === 0) {
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
      tagRoute(from, contract)
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
    const k = j.employeeId || ''
    byEmployee[k] = (byEmployee[k] || 0) + 1
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

export function jobsToRows(jobs) {
  const clientMap = {
    'On The Planet': SCHEDULE_CLIENTS.ontheplanet,
    'Atomic Bar': SCHEDULE_CLIENTS.atomicbar,
    Duskin: SCHEDULE_CLIENTS.duskin,
    Matsunaga: SCHEDULE_CLIENTS.matsunaga,
  }

  return jobs.map(j => ({
    title: j.title,
    employee_id: j.employeeId || null,
    employee_name: j.employeeName || j.employee || null,
    client_id: j.clientId || clientMap[j.client]?.id || SCHEDULE_CLIENTS.ontheplanet.id,
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
