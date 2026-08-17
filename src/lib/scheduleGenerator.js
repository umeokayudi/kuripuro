export const SCHEDULE_EMPLOYEES = {
  bemnet: { id: '417d0c0c-6de0-4f1e-978b-0fca021d7026', name: 'Bemnet Leykun Berhanu', short: 'Bemnet', color: '#60a5fa' },
  gabriel: { id: 'afb5bd34-3b46-4e6c-acf9-ae3feb4dfced', name: 'Gabriel Guerra', short: 'Gabriel', color: '#4ade80' },
  solomon: { id: '0f605ec2-e956-4d6b-8a23-560d103b7c51', name: 'Solomon', short: 'Solomon', color: '#fbbf24' },
}

export const SCHEDULE_CLIENTS = {
  ontheplanet: { id: '7138f082-0d38-43e4-bd77-00c4598690b3', name: 'On The Planet' },
  atomicbar: { id: 'bf3f7ab5-24c4-4ec1-b25f-d91becb166de', name: 'Atomic Bar' },
}

export const RESTAURANTS = [
  { name: 'Ibushio', address: 'https://maps.app.goo.gl/xxDzKRfpJYpk2XtW6', notes: 'Key box: 0315', days: [1, 2, 3, 4, 5, 6], deepClean: 7000 },
  { name: 'Nyu Ibushio', address: 'https://maps.app.goo.gl/ZXqfCc5MNn1aicPHA', notes: 'Key box: 0625', days: [1, 2, 3, 4, 5, 6], deepClean: 5000 },
  { name: 'Horumon no Manmosu', address: 'https://maps.app.goo.gl/r12jwNF7RpEFZTtA8', notes: 'Key box: 4840', days: [1, 2, 3, 4, 5, 6], deepClean: 5000 },
  { name: 'Yakiniku Otoko Manmosu', address: 'https://maps.app.goo.gl/n8YnpXDyQXmuefJK7', notes: 'Key box: 0601', days: [1, 2, 3, 4, 5, 6], deepClean: 5000 },
  { name: 'Nyu Sakana Yakio', address: 'https://maps.app.goo.gl/ig73pcZ4Gxff4kjU6', notes: 'Key box B1: 1209 | Shutter: 549 | Black: 5493', days: [0, 1, 2, 3, 4, 5, 6], deepClean: 5000 },
  { name: 'Kodama Shinbashi', address: 'https://maps.app.goo.gl/SFPkHjrQkJ3ie6x57', notes: 'Key box: 0606', days: [0, 1, 2, 3, 4, 5, 6], deepClean: 5000 },
  { name: 'Kodama Kinshicho', address: 'https://maps.app.goo.gl/HseQiawXKs32KzNz7', notes: 'Key box: 5493', days: [0, 1, 2, 3, 4, 5, 6], deepClean: 5000 },
  { name: 'Kodama Oimachi', address: 'https://maps.app.goo.gl/WZH9grtQtnPBvb9A6', notes: 'Key box: 3110', days: [1, 2, 3, 4, 5, 6], deepClean: 5000 },
  { name: 'Sakana Yakio Honten', address: 'https://maps.app.goo.gl/w9QHq1rX97N4J73d7', notes: 'Key box: 0919', days: [1, 2, 3, 4, 5, 6], deepClean: 5000 },
  { name: 'Sakana Yakio 2', address: 'https://maps.app.goo.gl/Kxrk58ofn6465Yew8', notes: 'Key box: 0808', days: [1, 2, 3, 4, 5, 6], deepClean: 5000 },
  { name: 'Tooda', address: 'https://maps.app.goo.gl/u5WefsYvHS3qi6lZ9', notes: 'Key box: 5493', days: [1, 2, 3, 4, 5, 6], deepClean: 5000 },
]

const MON_MORNING_EXTRA = ['Nyu Sakana Yakio', 'Kodama Shinbashi', 'Kodama Kinshicho']
const DOW_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

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

export function buildMonthSchedule(month, { includeYuraku = false, enabled = { bemnet: true, gabriel: true, solomon: true } } = {}) {
  const days = getDaysInMonth(month)
  const jobs = []
  let jobId = 1

  days.forEach(date => {
    const dow = date.getDay()
    const dateStr = dateStrLocal(date)
    const isMon = dow === 1
    const isTue = dow === 2
    const isSatSun = dow === 0 || dow === 6
    const isWeekday = dow >= 1 && dow <= 5

    if (enabled.bemnet && isMon) {
      jobs.push({
        id: jobId++, date: dateStr, time: '00:30', employee: 'Bemnet', client: 'Atomic Bar',
        title: 'Atomic Bar — Basic Cleaning', address: 'https://share.google/dGNoA7mGwHxRtZtnn',
        notes: 'Turno de segunda à noite', seq: 1, type: 'basic',
      })
      MON_MORNING_EXTRA.forEach((name, i) => {
        const r = RESTAURANTS.find(x => x.name === name)
        jobs.push({
          id: jobId++, date: dateStr, time: '06:00', employee: 'Bemnet', client: 'On The Planet',
          title: `${name} — Basic Cleaning`, address: r.address, notes: r.notes, seq: i + 2, type: 'basic',
        })
      })
    }

    if (enabled.bemnet && isWeekday && !isMon) {
      RESTAURANTS.forEach((r, i) => {
        if (r.days.includes(dow)) {
          jobs.push({
            id: jobId++, date: dateStr, time: '00:30', employee: 'Bemnet', client: 'On The Planet',
            title: `${r.name} — Basic Cleaning`, address: r.address, notes: r.notes, seq: i + 1, type: 'basic',
          })
        }
      })
    }

    if (enabled.gabriel && isSatSun) {
      RESTAURANTS.forEach((r, i) => {
        if (r.days.includes(dow)) {
          jobs.push({
            id: jobId++, date: dateStr, time: '00:30', employee: 'Gabriel', client: 'On The Planet',
            title: `${r.name} — Basic Cleaning`, address: r.address, notes: r.notes, seq: i + 1, type: 'basic',
          })
        }
      })
    }

    if (enabled.solomon && isTue) {
      const solomonRests = [...RESTAURANTS]
      if (includeYuraku) {
        solomonRests.push({ name: 'Kodama Yurakucho', address: '', notes: 'Key box: TBD', deepClean: 7000, days: [2] })
      }
      solomonRests.forEach((r, i) => {
        jobs.push({
          id: jobId++, date: dateStr, time: '00:30', employee: 'Solomon', client: 'On The Planet',
          title: `${r.name} — Deep Clean`, address: r.address || '', notes: r.notes || '', seq: i + 1, type: 'deep',
          description: `Range Hood + AC + Grating + Grease Trap${r.deepClean === 7000 ? ' x2' : ''} | ¥${(r.deepClean || 5000).toLocaleString()}`,
        })
      })
    }
  })

  return jobs
}

export function scheduleStats(jobs) {
  const byEmployee = {}
  const byDow = [0, 0, 0, 0, 0, 0, 0]
  jobs.forEach(j => {
    byEmployee[j.employee] = (byEmployee[j.employee] || 0) + 1
    const dow = new Date(j.date + 'T12:00:00').getDay()
    byDow[dow]++
  })
  return { total: jobs.length, byEmployee, byDow, days: new Set(jobs.map(j => j.date)).size }
}

export function jobsToRows(jobs) {
  const empMap = { Bemnet: SCHEDULE_EMPLOYEES.bemnet, Gabriel: SCHEDULE_EMPLOYEES.gabriel, Solomon: SCHEDULE_EMPLOYEES.solomon }
  const clientMap = { 'On The Planet': SCHEDULE_CLIENTS.ontheplanet, 'Atomic Bar': SCHEDULE_CLIENTS.atomicbar }

  return jobs.map(j => ({
    title: j.title,
    employee_id: empMap[j.employee].id,
    employee_name: empMap[j.employee].name,
    client_id: clientMap[j.client].id,
    client_name: j.client,
    scheduled_date: j.date,
    scheduled_time: j.time,
    status: 'assigned',
    job_category: 'regular',
    sequence_order: j.seq,
    address: j.address || null,
    description: j.description || j.notes || null,
  }))
}

export const SCHEDULE_RULES = [
  { who: 'Bemnet', when: 'Seg–Sex', detail: 'Limpeza básica nos restaurantes (00:30). Segunda: Atomic Bar à noite + 3 locais às 06:00.' },
  { who: 'Gabriel', when: 'Sáb–Dom', detail: 'Mesmos restaurantes, fim de semana (00:30).' },
  { who: 'Solomon', when: 'Toda terça', detail: 'Deep Clean em todos os restaurantes (capô, AC, grelha, grease trap).' },
]

export { DOW_PT }
