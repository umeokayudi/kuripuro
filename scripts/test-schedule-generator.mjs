import assert from 'node:assert/strict'
import { buildMonthSchedule, assignEmployees, availabilityIndex, defaultScheduleEmployees, jobsToRows } from '../src/lib/scheduleGenerator.js'

const MONTH = '2026-11'
const base = buildMonthSchedule(MONTH)
assert.ok(base.length > 0, 'gera jobs')
assert.ok(base.every(j => j.routeKey), 'todo job tem rota')
assert.ok(!base.some(j => j.category === 'duskin'), 'Duskin saiu da escala (v1.0.121)')
assert.ok(base.every(j => !j.employeeId), 'rotas não têm funcionário fixo')

const ana = { id: 'a', full_name: 'Ana Silva', is_active: true }
const bia = { id: 'b', full_name: 'Bia Souza', is_active: true }
const teste = { id: 't', full_name: 'TESTE Funcionario', is_active: true }
assert.deepEqual(defaultScheduleEmployees([ana, bia, teste]).map(e => e.id), ['a', 'b'])

const rows = [
  { employee_id: 'a', date: '2026-11-02', kind: 'off', status: 'approved' },
  { employee_id: 'a', date: '2026-11-03', kind: 'off', status: 'pending' },
  { employee_id: 'a', date: '2026-11-04', kind: 'off', status: 'rejected' },
  { employee_id: 'b', date: '2026-11-05', kind: 'off', status: 'approved' },
  { employee_id: 'b', date: '2026-11-06', kind: 'extra', status: 'pending' },
]
const availability = availabilityIndex(rows)
const jobs = assignEmployees(base, { employees: [ana, bia], availability, owners: { otp_basic: 'a' } })
const on = (date, route) => jobs.filter(j => j.date === date && j.routeKey === route)

// Ninguém trabalha em dia de folga marcado (aprovado ou pendente)
for (const r of rows.filter(r => r.kind === 'off' && r.status !== 'rejected')) {
  assert.ok(!jobs.some(j => j.date === r.date && j.employeeId === r.employee_id), `${r.employee_id} de folga em ${r.date}`)
}
// Responsável fica com a rota quando pode; folga recusada não conta
assert.ok(on('2026-11-01', 'otp_basic').every(j => j.employeeId === 'a' && j.assignReason === 'owner'))
assert.ok(on('2026-11-04', 'otp_basic').every(j => j.employeeId === 'a'))
// Responsável de folga -> outra pessoa cobre
assert.ok(on('2026-11-02', 'otp_basic').every(j => j.employeeId === 'b' && j.assignReason === 'ownerOff' && j.coveringFor === 'Ana'))
// Quem marcou extra é preferido nas rotas sem responsável
const extraIdx = availabilityIndex([{ employee_id: 'b', date: '2026-11-10', kind: 'extra', status: 'pending' }])
const auto = assignEmployees(base, { employees: [ana, bia], availability: extraIdx })
assert.ok(auto.filter(j => j.date === '2026-11-10' && j.routeKey === 'otp_basic').every(j => j.employeeId === 'b'), 'quem marcou extra é preferido')
const deep = jobs.filter(j => j.routeKey === 'otp_deep_only' && j.date === '2026-11-04')
assert.ok(deep.length && deep.every(j => j.employeeId === 'b'), 'quarta: deep vai para quem não tem rota no dia')
// Ninguém disponível -> sem funcionário
const nobody = assignEmployees(base, { employees: [ana], availability, owners: {} })
assert.ok(nobody.filter(j => j.date === '2026-11-02').every(j => j.employeeId === null && j.assignReason === 'nobody'))
// Escolha manual do admin
const key = on('2026-11-01', 'otp_basic')[0].groupKey
const manual = assignEmployees(base, { employees: [ana, bia], availability, owners: { otp_basic: 'a' }, overrides: { [key]: 'b' } })
assert.ok(manual.filter(j => j.groupKey === key).every(j => j.employeeId === 'b' && j.assignReason === 'manual'))

const dbRows = jobsToRows(nobody.slice(0, 3))
assert.ok(dbRows.every(r => 'employee_id' in r && 'employee_name' in r))
console.log(`schedule generator ok · ${base.length} jobs em ${MONTH}`)

// v1.0.97 · preview helpers
{
  const { periodDays, canWork, outOfSchedule, contractTargets, coverage, dupKey, jobFulfils, clockSeq, workDaysOf } = await import('../src/lib/schedulePlan.js')
  assert.deepEqual(periodDays('day', '2026-11-04', '2026-11'), ['2026-11-04'])
  const wk = periodDays('week', '2026-11-04', '2026-11')
  assert.equal(wk[0], '2026-11-02'); assert.equal(wk.length, 7)
  assert.equal(periodDays('month', '2026-11-04', '2026-02').length, 28)

  const gab = { id: 'g', full_name: 'Gabriel', is_active: true, job_role: 'cleaner', work_days: '["Mon","Tue","Wed","Thu","Fri","Sat"]' }
  const mkt = { id: 'm', full_name: 'Matheus Mkt', is_active: true, job_role: 'MKT' }
  const old = { id: 'o', full_name: 'André', is_active: false }
  const tst = { id: 't', full_name: 'TESTE Funcionario', is_active: true, job_role: 'cleaner' }
  assert.equal(workDaysOf(gab).has(0), false)
  assert.equal(canWork(gab, '2026-11-08').reason, 'weekday') // Sunday
  assert.equal(canWork(gab, '2026-11-09').ok, true)
  assert.equal(canWork(gab, '2026-11-09', { 'g|2026-11-09': { kind: 'off' } }).reason, 'off')
  assert.equal(canWork(gab, '2026-11-08', { 'g|2026-11-08': { kind: 'extra' } }).ok, true)
  assert.equal(canWork(mkt, '2026-11-09').reason, 'role')
  assert.equal(canWork(mkt, '2026-11-09', {}, new Set(['m'])).reason, 'forced')
  assert.deepEqual(outOfSchedule([gab, mkt, old, tst], ['2026-11-08']).map(o => `${o.emp.id}:${o.reason}`), ['g:unavailable', 'm:role', 'o:inactive', 't:test'])

  const contracts = [
    { id: 'k1', client_id: 'otp', location_name: 'Kodama Kinshicho', service_type: 'Basic Cleaning', days_of_week: ['Mon', 'Tue'], is_active: true },
    { id: 'k2', client_id: 'otp', location_name: 'Ibushio — Range Hood', service_type: 'Range Hood', days_of_week: ['Sun'], is_active: true },
    { id: 'k3', client_id: 'otp', location_name: 'OTP — Floor Wax', service_type: 'Floor Wax', days_of_week: [], is_active: true },
    { id: 'k4', client_id: 'off', location_name: 'Closed shop', service_type: 'Basic Cleaning', days_of_week: ['Mon'], is_active: true },
  ]
  const targets = contractTargets(contracts, [{ id: 'otp', company_name: 'On The Planet', is_active: true }, { id: 'off', company_name: 'Old', is_active: false }])
  assert.deepEqual(targets.map(t => t.kind), ['weekly', 'periodic', 'nodays'])
  assert.ok(jobFulfils('Ibushio — Stove + Range Hood + Grating + AC Cleaning', targets[1]))
  assert.ok(!jobFulfils('Ibushio — Basic Cleaning', targets[1]))
  assert.ok(jobFulfils('Kodama Kinshicho — Basic Cleaning', targets[0]))
  const nov = periodDays('month', '', '2026-11')
  const rowsOk = nov.filter(d => [1, 2].includes(new Date(d + 'T12:00:00Z').getUTCDay())).map(d => ({ date: d, title: 'Kodama Kinshicho — Basic Cleaning' }))
  const c1 = coverage(targets, nov, rowsOk, { wholeMonth: true })
  assert.equal(c1.clients[0].done, 1); assert.equal(c1.clients[0].total, 2) // Ibushio periodic missing
  assert.equal(c1.missing.length, 1); assert.ok(c1.missing[0].periodic)
  assert.equal(c1.noDays.length, 1)
  const c2 = coverage(targets, nov, rowsOk.slice(1), { wholeMonth: false })
  assert.equal(c2.missing.length, 1); assert.equal(c2.missing[0].date, rowsOk[0].date)
  assert.equal(c2.clients[0].total, 1)
  assert.equal(dupKey('2026-11-02', 'Tooda — Basic Cleaning'), dupKey('2026-11-02', 'tooda  —  basic cleaning'))
  const seq = clockSeq([{ key: 'a', employeeId: 'g', date: 'd', time: '21:00', title: 'A' }, { key: 'b', employeeId: 'g', date: 'd', time: '00:30', title: 'B' }])
  assert.equal(seq.get('b'), 1); assert.equal(seq.get('a'), 2)
  console.log('schedule plan ok')
}

// v1.0.123 · conferência por contrato + navegação de período
{
  const { contractCheck, shiftPeriod, contractTargets, periodDays } = await import('../src/lib/schedulePlan.js')
  const targets = contractTargets([
    { id: 'k', client_id: 'c1', location_name: 'Kodama Kinshicho', service_type: 'Basic Cleaning', days_of_week: ['Mon', 'Wed', 'Fri'] },
    { id: 'd', client_id: 'c1', location_name: 'Kodama Kinshicho — Deep Clean', service_type: 'Deep Clean', days_of_week: ['Tue'] },
  ], [{ id: 'c1', company_name: 'Kodama', is_active: true }])
  const week = periodDays('week', '2026-11-04', '2026-11') // Mon 02 → Sun 08
  const jobsW = [
    { scheduled_date: '2026-11-02', title: 'Kodama Kinshicho — Basic Cleaning', employee_id: 'a', status: 'assigned' },
    { scheduled_date: '2026-11-02', title: 'Kodama Kinshicho — Basic Cleaning', employee_id: 'b', status: 'assigned' },
    { scheduled_date: '2026-11-04', title: 'Kodama Kinshicho — Basic Cleaning', employee_id: null, status: 'pending' },
    { scheduled_date: '2026-11-05', title: 'Bacana — Spot', employee_id: 'a', status: 'assigned' },
  ]
  const rowsW = [{ date: '2026-11-06', title: 'Kodama Kinshicho — Basic Cleaning', employeeId: 'a' }]
  const chk = contractCheck(targets, week, jobsW, rowsW)
  assert.equal(chk.places.length, 1, 'periódico só entra no mês')
  const k = chk.places[0]
  assert.equal(k.total, 3); assert.equal(k.done, 1)
  assert.deepEqual(k.slots.map(s => s.state), ['ok', 'noPerson', 'toCreate'])
  assert.equal(chk.dups.length, 1, 'duplicado detectado')
  assert.equal(chk.extras.length, 1, 'job sem contrato aparece como extra')
  const m = contractCheck(targets, periodDays('month', '', '2026-11'), jobsW, [], { wholeMonth: true })
  const deepP = m.places.find(p => p.target.id === 'd')
  assert.equal(deepP.total, 1); assert.equal(deepP.state, 'missing')
  assert.equal(m.places[0].state, 'missing', 'faltando vem primeiro')
  assert.deepEqual(shiftPeriod('week', '2026-10-31', '2026-10', 1), { anchor: '2026-11-07', month: '2026-10' })
  assert.deepEqual(shiftPeriod('day', '2026-10-31', '2026-10', -1), { anchor: '2026-10-30', month: '2026-10' })
  assert.deepEqual(shiftPeriod('month', '2026-10-31', '2026-12', 1), { anchor: '2026-10-31', month: '2027-01' })
  console.log('✓ conferência por contrato + navegação de período')
}
