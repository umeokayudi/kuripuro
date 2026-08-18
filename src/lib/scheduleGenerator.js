// Contratos de escala — atualize aqui quando o admin enviar mudanças.
// Só gera jobs para funcionários ATIVOS (is_active=true) cujo ID está listado abaixo.

export const SCHEDULE_CLIENTS = {
  ontheplanet: { id: '7138f082-0d38-43e4-bd77-00c4598690b3', name: 'On The Planet' },
  atomicbar: { id: 'bf3f7ab5-24c4-4ec1-b25f-d91becb166de', name: 'Atomic Bar' },
}

/** Locais padrão (fallback se service_contracts estiver vazio) */
export const DEFAULT_LOCATIONS = [
  { name: 'Ibushio', address: 'https://maps.app.goo.gl/xxDzKRfpJYpk2XtW6', notes: 'Key box: 0315', days: [1, 2, 3, 4, 5, 6], deepClean: 7000, serviceType: 'Basic Cleaning' },
  { name: 'Nyu Ibushio', address: 'https://maps.app.goo.gl/ZXqfCc5MNn1aicPHA', notes: 'Key box: 0625', days: [1, 2, 3, 4, 5, 6], deepClean: 5000, serviceType: 'Basic Cleaning' },
  { name: 'Horumon no Manmosu', address: 'https://maps.app.goo.gl/r12jwNF7RpEFZTtA8', notes: 'Key box: 4840', days: [1, 2, 3, 4, 5, 6], deepClean: 5000, serviceType: 'Basic Cleaning' },
  { name: 'Yakiniku Otoko Manmosu', address: 'https://maps.app.goo.gl/n8YnpXDyQXmuefJK7', notes: 'Key box: 0601', days: [1, 2, 3, 4, 5, 6], deepClean: 5000, serviceType: 'Basic Cleaning' },
  { name: 'Nyu Sakana Yakio', address: 'https://maps.app.goo.gl/ig73pcZ4Gxff4kjU6', notes: 'Key box B1: 1209', days: [0, 1, 2, 3, 4, 5, 6], deepClean: 5000, serviceType: 'Basic Cleaning' },
  { name: 'Kodama Shinbashi', address: 'https://maps.app.goo.gl/SFPkHjrQkJ3ie6x57', notes: 'Key box: 0606', days: [0, 1, 2, 3, 4, 5, 6], deepClean: 5000, serviceType: 'Basic Cleaning' },
  { name: 'Kodama Kinshicho', address: 'https://maps.app.goo.gl/HseQiawXKs32KzNz7', notes: 'Key box: 5493', days: [0, 1, 2, 3, 4, 5, 6], deepClean: 5000, serviceType: 'Basic Cleaning' },
  { name: 'Kodama Oimachi', address: 'https://maps.app.goo.gl/WZH9grtQtnPBvb9A6', notes: 'Key box: 3110', days: [1, 2, 3, 4, 5, 6], deepClean: 5000, serviceType: 'Basic Cleaning' },
  { name: 'Sakana Yakio Honten', address: 'https://maps.app.goo.gl/w9QHq1rX97N4J73d7', notes: 'Key box: 0919', days: [1, 2, 3, 4, 5, 6], deepClean: 5000, serviceType: 'Basic Cleaning' },
  { name: 'Sakana Yakio 2', address: 'https://maps.app.goo.gl/Kxrk58ofn6465Yew8', notes: 'Key box: 0808', days: [1, 2, 3, 4, 5, 6], deepClean: 5000, serviceType: 'Basic Cleaning' },
  { name: 'Tooda', address: 'https://maps.app.goo.gl/u5WefsYvHS3qi6lZ9', notes: 'Key box: 5493', days: [1, 2, 3, 4, 5, 6], deepClean: 5000, serviceType: 'Basic Cleaning' },
  { name: 'Atomic Bar', address: 'https://share.google/dGNoA7mGwHxRtZtnn', notes: 'Monday night shift', days: [1], deepClean: 0, serviceType: 'Basic Cleaning', client: 'Atomic Bar' },
]

const MON_MORNING_EXTRA = ['Nyu Sakana Yakio', 'Kodama Shinbashi', 'Kodama Kinshicho']
const DAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const PALETTE = ['#60a5fa', '#4ade80', '#fbbf24', '#c084fc', '#f472b6', '#38bdf8']
export const DOW_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
export const DOW_JA = ['日', '月', '火', '水', '木', '金', '土']
export const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Contrato de escala por funcionário (employee_id do Supabase).
 * Remova a linha ou desative o funcionário no sistema para parar de gerar.
 */
export const EMPLOYEE_SCHEDULE_CONTRACTS = [
  {
    employeeId: '417d0c0c-6de0-4f1e-978b-0fca021d7026',
    label: 'Seg–Sex · limpeza básica',
    detail: 'Restaurantes 00:30. Segunda: Atomic Bar à noite + 3 locais às 06:00.',
    template: 'weekday_basic',
    mondayAtomic: true,
    mondayMorningExtras: MON_MORNING_EXTRA,
  },
  {
    employeeId: 'afb5bd34-3b46-4e6c-acf9-ae3feb4dfced',
    label: 'Sáb–Dom · limpeza básica',
    detail: 'Mesmos restaurantes, fim de semana (00:30).',
    template: 'weekend_basic',
  },
  {
    employeeId: '0f605ec2-e956-4d6b-8a23-560d103b7c51',
    label: 'Toda terça · deep clean',
    detail: 'Deep Clean em todos os restaurantes (capô, AC, grelha, grease trap).',
    template: 'deep_clean_tuesday',
    optionalExtras: [{ name: 'Kodama Yurakucho', address: '', notes: 'Key box: TBD', deepClean: 7000 }],
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
  return serviceContracts.map(sc => ({
    name: sc.location_name,
    address: sc.location_address || defaultByName[sc.location_name]?.address || '',
    notes: sc.notes || defaultByName[sc.location_name]?.notes || '',
    days: (sc.days_of_week || []).map(d => DAY_MAP[d]).filter(d => d != null),
    deepClean: /deep/i.test(sc.service_type || '') ? 5000 : 5000,
    serviceType: sc.service_type || 'Basic Cleaning',
    price: sc.price_per_visit,
  })).filter(l => l.days.length > 0)
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

function jobInstructions(location, isDeep) {
  const parts = []
  if (location.notes) parts.push(location.notes)
  if (isDeep) {
    parts.push(`Range Hood + AC + Grating + Grease Trap | ¥${(location.deepClean || 5000).toLocaleString()}`)
  }
  return parts.length ? parts.join('\n') : null
}

function basicJob({ id, date, time, employee, empId, client, location, seq, type = 'basic' }) {
  const isDeep = /deep/i.test(location.serviceType || '')
  const title = `${location.name} — ${isDeep ? 'Deep Clean' : 'Basic Cleaning'}`
  return {
    id, date, time, employee, employeeId: empId, client: client || 'On The Planet',
    title, address: location.address, notes: location.notes, seq, type: isDeep ? 'deep' : type,
    description: jobInstructions(location, isDeep),
  }
}

export function buildMonthSchedule(month, { contracts = [], locations = DEFAULT_LOCATIONS, includeOptionalExtras = false } = {}) {
  const days = getDaysInMonth(month)
  const jobs = []
  let jobId = 1
  const basicLocs = locations.filter(l => !/deep/i.test(l.serviceType || '') && l.name !== 'Atomic Bar')
  const atomicLoc = locations.find(l => l.name === 'Atomic Bar') || DEFAULT_LOCATIONS.find(l => l.name === 'Atomic Bar')

  days.forEach(date => {
    const dow = date.getDay()
    const dateStr = dateStrLocal(date)

    contracts.forEach(contract => {
      const emp = contract.shortName
      const empId = contract.employeeId

      if (contract.template === 'weekday_basic') {
        const isMon = dow === 1
        const isWeekday = dow >= 1 && dow <= 5

        if (isMon && contract.mondayAtomic && atomicLoc) {
          jobs.push(basicJob({
            id: jobId++, date: dateStr, time: '00:30', employee: emp, empId,
            client: 'Atomic Bar', location: atomicLoc, seq: 1,
          }))
          ;(contract.mondayMorningExtras || []).forEach((name, i) => {
            const loc = locations.find(l => l.name === name) || DEFAULT_LOCATIONS.find(l => l.name === name)
            if (loc) jobs.push(basicJob({ id: jobId++, date: dateStr, time: '06:00', employee: emp, empId, location: loc, seq: i + 2 }))
          })
        }

        if (isWeekday && !isMon) {
          basicLocs.forEach((loc, i) => {
            if (loc.days.includes(dow)) {
              jobs.push(basicJob({ id: jobId++, date: dateStr, time: '00:30', employee: emp, empId, location: loc, seq: i + 1 }))
            }
          })
        }
      }

      if (contract.template === 'weekend_basic' && (dow === 0 || dow === 6)) {
        basicLocs.forEach((loc, i) => {
          if (loc.days.includes(dow)) {
            jobs.push(basicJob({ id: jobId++, date: dateStr, time: '00:30', employee: emp, empId, location: loc, seq: i + 1 }))
          }
        })
      }

      if (contract.template === 'deep_clean_tuesday' && dow === 2) {
        let deepLocs = [...basicLocs]
        if (includeOptionalExtras && contract.optionalExtras?.length) {
          deepLocs = [...deepLocs, ...contract.optionalExtras.map(e => ({ ...e, serviceType: 'Deep Cleaning', days: [2] }))]
        }
        deepLocs.forEach((loc, i) => {
          jobs.push(basicJob({
            id: jobId++, date: dateStr, time: '00:30', employee: emp, empId,
            location: { ...loc, serviceType: 'Deep Cleaning' }, seq: i + 1, type: 'deep',
          }))
        })
      }
    })
  })

  return jobs
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
  const clientMap = { 'On The Planet': SCHEDULE_CLIENTS.ontheplanet, 'Atomic Bar': SCHEDULE_CLIENTS.atomicbar }

  return jobs.map(j => ({
    title: j.title,
    employee_id: j.employeeId,
    employee_name: empById[j.employeeId]?.employeeName || j.employee,
    client_id: clientMap[j.client]?.id || SCHEDULE_CLIENTS.ontheplanet.id,
    client_name: j.client,
    location_name: (j.title || '').replace(/ — .*/, '').trim(),
    scheduled_date: j.date,
    scheduled_time: j.time,
    status: 'assigned',
    job_category: 'regular',
    sequence_order: j.seq,
    address: j.address || null,
    description: [j.notes, j.description].filter(Boolean).join('\n') || null,
  }))
}
