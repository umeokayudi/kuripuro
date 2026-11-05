#!/usr/bin/env node
// v1.0.151 · Painel do Dia — real case of 05/11/2026 at 10:05 (Gabriel did not come, did not mark anything;
// Guilherme's route 0/10 after 10:00). One source of numbers by store + one row per field employee.
import { buildDayPanel, teamProgressText, shiftBadge, storeStateText, alertText, serviceLabel, shiftState, plural } from '../src/lib/dayPanel.js'
import { contractTargets } from '../src/lib/schedulePlan.js'

const assert = (c, m) => { if (!c) throw new Error(m) }
const date = '2026-11-05'
const OTP = '7138f082-0d38-43e4-bd77-00c4598690b3'
const G = '8772f25f-7bd2-460d-8818-ad3bad3ab541'
const stores = ['Kodama Yurakucho', 'Sakana Yakio 2', 'Kodama Kinshicho', 'Sakana Yakio Honten', 'Tooda', 'Nyu Sakana Yakio', 'Kodama Shinbashi', 'Kodama Oimachi']
const jobs = [
  ...stores.map((s, i) => ({ id: `b${i}`, title: `${s} — Basic Cleaning`, client_id: OTP, client_name: 'On The Planet', employee_id: G, employee_name: 'Guilherme Henrique', status: 'assigned', scheduled_date: date, scheduled_time: '00:30', job_category: 'regular' })),
  { id: 'd1', title: 'Kodama Kinshicho — Deep Clean (Range Hood)', client_id: OTP, client_name: 'On The Planet', employee_id: G, employee_name: 'Guilherme Henrique', status: 'assigned', scheduled_date: date, scheduled_time: '00:30', job_category: 'regular' },
  { id: 'd2', title: 'Nyu Sakana Yakio — Deep Clean (Range Hood)', client_id: OTP, client_name: 'On The Planet', employee_id: G, employee_name: 'Guilherme Henrique', status: 'assigned', scheduled_date: date, scheduled_time: '00:30', job_category: 'regular' },
]
const all7 = '["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]'
const employees = [
  { id: '4c06', full_name: 'Alexandre Umeoka', is_active: true, job_role: 'cleaner', work_days: all7 },
  { id: 'b62c', full_name: 'Gabriel Santos Petricevich', is_active: true, job_role: 'cleaner', work_days: '["Mon","Tue","Wed","Thu","Fri","Sat"]' },
  { id: G, full_name: 'Guilherme Henrique', is_active: true, job_role: 'cleaner', work_days: all7 },
  { id: '3a39', full_name: 'Leticia Nagaoka', is_active: true, job_role: 'cleaner', work_days: all7 },
  { id: 'c3ad', full_name: 'Matheus Mkt', is_active: true, job_role: 'MKT', work_days: '[]' },
  { id: 'tt', full_name: 'Teste Funcionário', is_active: true, job_role: 'cleaner', work_days: all7 },
]
const availability = [{ employee_id: '4c06', date, kind: 'off', status: 'rejected' }]
const contracts = stores.map(s => ({ id: s, client_id: OTP, location_name: s, service_type: 'Basic Cleaning', is_active: true, days_of_week: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] }))
const targets = contractTargets(contracts, [{ id: OTP, company_name: 'On The Planet', is_active: true }])
const now = new Date('2026-11-05T10:05:00+09:00')
const p = buildDayPanel({ date, jobs, employees, availability, targets, now, nowMin: 10 * 60 + 5, today: date })

assert(p.count.stores === 8 && p.count.storesDone === 0, `0 de 8 lojas feitas (got ${p.count.storesDone}/${p.count.stores})`)
assert(p.count.storesWorking === 0, 'nothing in progress')
assert(p.stores.every(s => s.state === 'late'), 'the 8 stores are late after 10:00')
const kin = p.stores.find(s => s.store === 'Kodama Kinshicho')
assert(kin.total === 2, 'Kinshicho counts its 2 services')
const gui = p.team.find(t => t.id === G)
assert(teamProgressText(gui) === '0 de 10 · nada iniciado · 10 atrasados', `Guilherme: ${teamProgressText(gui)}`)
const gab = p.team.find(t => t.id === 'b62c')
assert(gab.expected && gab.state === 'planned', 'Gabriel expected + no mark = shift semanal (v1.0.161)')
assert(shiftBadge(gab).text === '📅 Shift semanal', 'badge text')
assert(teamProgressText(gab) === 'nenhum serviço hoje', `Gabriel: ${teamProgressText(gab)}`)
assert(!p.team.some(t => t.name === 'Matheus Mkt'), 'desk role (MKT) not in the field team')
assert(!p.team.some(t => /Teste/.test(t.name)), 'test account out')
assert(p.team.find(t => t.id === '4c06').state === 'planned', 'rejected day-off request = no mark')
assert(p.team[0].id === G, 'person with late jobs first')
assert(storeStateText(kin) === 'Atrasada · prazo 10:00', storeStateText(kin))
assert(p.alerts[0].kind === 'route_none' && !p.alerts.some(a => a.kind === 'route') && p.alerts.some(a => a.kind === 'late'), 'v1.0.154: route_none (on top, replaces the per-person line) + late alerts')
assert(alertText(p.alerts.find(a => a.kind === 'late')) === '8 lojas atrasadas (10 serviços)', alertText(p.alerts.find(a => a.kind === 'late')))
assert(serviceLabel(jobs[9]) === 'Deep Cleaning — Range Hood' && serviceLabel(jobs[0]) === 'Básica', 'service type')

// before 10:00 the same stores are "não iniciadas", not late
const early = buildDayPanel({ date, jobs, employees, availability, targets, now: new Date('2026-11-05T08:00:00+09:00'), nowMin: 480, today: date })
assert(early.stores.every(s => s.state === 'not_started'), 'before the deadline: not started')

// "Não posso" on a day with services → alert, services stay (sem cobertura), not reassigned
const cant = buildDayPanel({ date, jobs, employees, availability: [{ employee_id: G, date, kind: 'off', status: 'pending', note: 'febre' }], targets, now, nowMin: 605, today: date })
const a = cant.alerts.find(x => x.kind === 'cant')
assert(a && a.n === 8, 'cant alert with 8 stores')
assert(alertText(a) === 'Guilherme Henrique não pode hoje — 8 lojas sem cobertura (“febre”)', alertText(a))
assert(cant.count.services === 10 && cant.stores.every(s => s.uncovered), 'jobs stay, shown as uncovered')

// confirmed / extra marks and the cut-off of 21:00 the day before
assert(shiftState({ emp: employees[1], date: '2026-11-06', mark: null, hasJobs: false, now: new Date('2026-11-05T20:00:00+09:00') }).state === 'planned', 'weekly shift: no daily mark needed (before 21:00)')
assert(shiftState({ emp: employees[1], date: '2026-11-06', mark: null, hasJobs: false, now: new Date('2026-11-05T21:00:00+09:00') }).state === 'planned', 'weekly shift: no daily mark needed (after 21:00)')
assert(shiftState({ emp: employees[1], date, mark: { kind: 'confirmed' }, hasJobs: false, now }).state === 'confirmed', 'confirmed')
assert(shiftState({ emp: employees[1], date: '2026-11-08', mark: null, hasJobs: false, now }).state === 'not_expected', 'Sunday is outside Gabriel\'s pattern')

// covered by another person: the store is done "por B" and counts as covered
const cov = buildDayPanel({ date, jobs: [...jobs, { id: 'x', title: 'Tooda — Basic Cleaning', client_id: OTP, employee_id: 'b62c', employee_name: 'Gabriel Santos Petricevich', status: 'completed', scheduled_date: date, scheduled_time: '00:30', completed_at: '2026-11-05T00:40:00Z' }], employees, availability, targets, now, nowMin: 605, today: date })
const tooda = cov.stores.find(s => s.store === 'Tooda')
assert(tooda.state === 'done' && tooda.covered && storeStateText(tooda) === 'Feita por Gabriel Santos Petricevich · 09:40', storeStateText(tooda))
assert(cov.count.storesDone === 1 && cov.count.services === 10, 'covered service counts once')
assert(teamProgressText(cov.team.find(t => t.id === G)) === '0 de 9 · nada iniciado · 9 atrasados · 1 coberto por Gabriel Santos Petricevich', teamProgressText(cov.team.find(t => t.id === G)))

assert(plural(1, 'item', 'itens') === '1 item' && plural(49, 'item', 'itens') === '49 itens', 'plural')
console.log('day panel: ok')
