import assert from 'node:assert/strict'
import { buildMonthSchedule, assignEmployees, availabilityIndex, defaultScheduleEmployees, jobsToRows } from '../src/lib/scheduleGenerator.js'

const MONTH = '2026-11'
const base = buildMonthSchedule(MONTH)
assert.ok(base.length > 0, 'gera jobs')
assert.ok(base.every(j => j.routeKey), 'todo job tem rota')
assert.ok(base.some(j => j.category === 'duskin'), 'Duskin sempre incluído (sem caixa de seleção)')
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

// v1.0.66 — location names per route + date range
{
  const { routeLocations, scheduleInRange, buildMonthSchedule: build } = await import('../src/lib/scheduleGenerator.js')
  const rl = routeLocations()
  const tooda = rl.otp_basic.find(l => l.name === 'Tooda')
  if (!tooda || tooda.perWeek !== 6) throw new Error('Tooda should be 6x/week')
  if (rl.otp_basic[0].name !== 'Atomic Bar') throw new Error('Atomic first')
  if (rl.otp_deep_only.length !== 4) throw new Error('4 deep-only')
  const jobs = build('2026-11')
  const week = scheduleInRange(jobs, '2026-11-02', '2026-11-08')
  if (!week.length || week.some(j => j.date < '2026-11-02' || j.date > '2026-11-08')) throw new Error('range filter')
  console.log('schedule route locations ok')
}
