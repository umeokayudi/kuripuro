#!/usr/bin/env node
// v1.0.154 · Complemento do pacote 05/11/2026 — rota dividida e "pegou, é meu" (real case of 05/11).
// 8 basics (2h each, deadline 10:00) + 2 deeps (Range Hood, 8h each, own window), all on Guilherme.
import { buildDayPanel, alertText, storeStateText, teamProgressText, teamLoadText } from '../src/lib/dayPanel.js'
import { buildBellQueue } from '../src/lib/bellQueue.js'
import { contractTargets } from '../src/lib/schedulePlan.js'
import { bucketOf, jobMinutes, routeLoads, impossibleText, deepDeadlineMin, hm } from '../src/lib/routePlan.js'

const assert = (c, m) => { if (!c) throw new Error(m) }
const date = '2026-11-05'
const OTP = '7138f082-0d38-43e4-bd77-00c4598690b3'
const G = '8772f25f', GAB = 'b62c'
const stores = ['Kodama Yurakucho', 'Sakana Yakio 2', 'Kodama Kinshicho', 'Sakana Yakio Honten', 'Tooda', 'Nyu Sakana Yakio', 'Kodama Shinbashi', 'Kodama Oimachi']
const job = (id, title, extra = {}) => ({ id, title, client_id: OTP, client_name: 'On The Planet', employee_id: G, employee_name: 'Guilherme Henrique', status: 'assigned', scheduled_date: date, scheduled_time: '00:30', job_category: 'regular', ...extra })
const jobs = [
  ...stores.map((s, i) => job(`b${i}`, `${s} — Basic Cleaning`)),
  job('d1', 'Kodama Kinshicho — Deep Clean (Range Hood)'),
  job('d2', 'Nyu Sakana Yakio — Deep Clean (Range Hood)'),
]
const all7 = '["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]'
const employees = [
  { id: GAB, full_name: 'Gabriel Santos Petricevich', is_active: true, job_role: 'cleaner', work_days: '["Mon","Tue","Wed","Thu","Fri","Sat"]' },
  { id: G, full_name: 'Guilherme Henrique', is_active: true, job_role: 'cleaner', work_days: all7 },
  { id: 'let', full_name: 'Leticia Nagaoka', is_active: true, job_role: 'cleaner', work_days: all7 },
]
// the real contracts: basics 2h on every weekday, "<store> - Deep Clean" 8h
const contracts = [
  ...stores.map(s => ({ id: s, client_id: OTP, location_name: s, service_type: 'Basic Cleaning', hours_per_visit: '2.0', is_active: true, days_of_week: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] })),
  ...stores.map(s => ({ id: `${s}-d`, client_id: OTP, location_name: `${s} - Deep Clean`, service_type: 'Range Hood + AC + Grating + Grease Trap', hours_per_visit: '8.0', is_active: true, days_of_week: ['Mon'] })),
]
const targets = contractTargets(contracts, [{ id: OTP, company_name: 'On The Planet', is_active: true }])

// ---- 7. realistic deadlines: morning route × deep of the day ----
assert(bucketOf(jobs[0]) === 'morning' && bucketOf(jobs[8]) === 'deep', 'buckets')
assert(jobMinutes(jobs[0], targets) === 120 && jobMinutes(jobs[8], targets) === 480, `hours from the contracts (${jobMinutes(jobs[0], targets)}, ${jobMinutes(jobs[8], targets)})`)
assert(hm(deepDeadlineMin(480)) === '10:00' && hm(deepDeadlineMin(720)) === '12:30', 'deep window: 00:30 + hours, at least 10:00')

const now = new Date('2026-11-05T10:05:00+09:00')
const p = buildDayPanel({ date, jobs, employees, targets, now, nowMin: 605, today: date })
assert(p.count.stores === 8, 'still 8 stores in the counter')
assert(p.routes.morning.stores.length === 8 && p.routes.morning.count.services === 8, 'morning route = the 8 basics')
assert(p.routes.deep.count.services === 2 && p.routes.deep.stores.length === 2, 'deep of the day = the 2 deeps, apart')
assert(p.routes.morning.deadline === '10:00', 'morning deadline 10:00')
assert(p.routes.morning.stores.every(s => s.services.every(x => x.service.kind === 'basic')), 'no deep inside the morning route')
const gm = p.loads.find(l => l.employeeId === G && l.bucket === 'morning')
const gd = p.loads.find(l => l.employeeId === G && l.bucket === 'deep')
assert(gm.minutes === 960 && gd.minutes === 960, `16h + 16h kept apart (got ${gm.minutes}, ${gd.minutes})`)
assert(!p.loads.some(l => l.minutes === 1920), 'never 32h on one line')
assert(impossibleText(gm) === 'rota impossível para Guilherme Henrique: 16h previstas até às 10:00', impossibleText(gm))
assert(p.alerts.some(a => a.kind === 'impossible' && a.bucket === 'morning'), 'impossible alert on the panel')
const gt = p.team.find(t => t.id === G)
assert(teamLoadText(gt) === 'rota da manhã 16h até 10:00 · deep 16h', teamLoadText(gt))
// split the route: 4 basics each → 8h ≤ 9h30 → possible
const split = routeLoads(stores.map((s, i) => ({ employeeId: i < 4 ? G : GAB, employeeName: i < 4 ? 'Guilherme' : 'Gabriel', bucket: 'morning', minutes: 120 })))
assert(split.every(r => !r.impossible) && split[0].minutes === 480, 'split route is possible')

// ---- 6. free services and "pegou, é meu" (the route split officially, 06/11) ----
const d6 = '2026-11-06'
const free = (id, s) => ({ ...job(id, `${s} — Basic Cleaning`), scheduled_date: d6, employee_id: null, employee_name: null, spot_status: 'pending' })
const jobs6 = [
  ...stores.slice(0, 4).map((s, i) => ({ ...job(`g${i}`, `${s} — Basic Cleaning`), scheduled_date: d6 })),
  ...stores.slice(4).map((s, i) => free(`f${i}`, s)),
]
const eve20 = buildDayPanel({ date: d6, jobs: jobs6, employees, targets, now: new Date('2026-11-05T20:00:00+09:00'), today: date })
const freeStore = eve20.stores.find(s => s.store === 'Tooda')
assert(freeStore.free && freeStore.freeOpen && !freeStore.uncovered, 'before 21:00 the free job is "livre", not uncovered')
assert(storeStateText(freeStore) === 'Livre · disponível para a equipe pegar', storeStateText(freeStore))
assert(eve20.alerts.some(a => a.kind === 'free_open' && a.n === 4), 'free_open alert')
assert(!eve20.pastCutoff, 'not past the cut-off yet')

const eve21 = buildDayPanel({ date: d6, jobs: jobs6, employees, targets, now: new Date('2026-11-05T21:00:00+09:00'), today: date })
const fs21 = eve21.stores.find(s => s.store === 'Tooda')
assert(fs21.uncovered && !fs21.freeOpen && storeStateText(fs21) === 'SEM COBERTURA · serviço livre que ninguém pegou', storeStateText(fs21))
const fa = eve21.alerts.find(a => a.kind === 'free_uncovered')
assert(fa && alertText(fa) === 'SEM COBERTURA — 4 serviços livres que ninguém pegou', fa && alertText(fa))
assert(eve21.team.find(t => t.id === GAB).state === 'unconfirmed', 'Gabriel expected on Friday, no mark at 21:00 → SEM CONFIRMAÇÃO')

// ---- 9. the bell that same night (21:00 of 05/11, for 06/11) ----
const bell = buildBellQueue({ panel: null, nextPanel: eve21, today: date })
const unc = bell.groups.find(g => g.key === 'uncovered')
assert(unc && unc.items.filter(i => i.kind === 'free_uncovered').length === 4, 'the 4 free services nobody took are in the bell')
assert(unc.items.some(i => i.kind === 'eve_unconfirmed' && i.who === 'Gabriel Santos Petricevich'), 'Gabriel SEM CONFIRMAÇÃO in the bell the evening before')
assert(new Set(unc.items.filter(i => i.kind === 'free_uncovered').map(i => i.place)).size === 4, 'told apart by store')
const bell20 = buildBellQueue({ panel: null, nextPanel: eve20, today: date })
assert(!bell20.groups.length, 'at 20:00 nothing yet (still time to take / confirm)')

// Gabriel takes 2 free jobs → they are his: "com Gabriel (pegou)", counted in his total
const took = jobs6.map(j => (j.id === 'f0' || j.id === 'f1') ? { ...j, employee_id: GAB, employee_name: 'Gabriel Santos Petricevich', spot_status: 'accepted' } : j)
const after = buildDayPanel({ date: d6, jobs: took, employees, targets, now: new Date('2026-11-05T21:30:00+09:00'), today: date })
const gab = after.team.find(t => t.id === GAB)
assert(gab.total === 2 && gab.taken === 2, 'his total = his fixed + the free ones he took')
assert(teamProgressText(gab) === '0 de 2 · nada iniciado · 2 livres que pegou', teamProgressText(gab))
const taken = after.stores.find(s => s.store === stores[4])
assert(!taken.uncovered && taken.takenBy[0] === 'Gabriel Santos Petricevich' && taken.services[0].taken, 'store covered by who took it')
assert(after.alerts.find(a => a.kind === 'free_uncovered').n === 2, 'only the 2 not taken stay without cover')

// ---- 8. plan B (display only) ----
const withB = buildDayPanel({ date: d6, jobs: jobs6, employees, targets, planB: { tooda: ['let', GAB] }, now: new Date('2026-11-05T21:00:00+09:00'), today: date })
const tb = withB.stores.find(s => s.store === 'Tooda')
assert(tb.showPlanB && tb.planB.join(' → ') === 'Leticia Nagaoka → Gabriel Santos Petricevich', 'plan B shown next to the store without cover')
assert(tb.services[0].assignedId === null, 'plan B never reassigns')
const okStore = withB.stores.find(s => s.store === stores[0])
assert(!okStore.showPlanB, 'no plan B shown on a covered store')
const bellB = buildBellQueue({ nextPanel: withB, today: date })
assert(bellB.groups[0].items.find(i => i.place === 'Tooda').planB.length === 2, 'plan B in the bell card too')

// ---- 9. 05:00: nothing of today's route started → urgent, on top ----
const at5 = buildDayPanel({ date, jobs, employees, targets, now: new Date('2026-11-05T05:00:00+09:00'), nowMin: 300, today: date })
assert(at5.alerts[0].kind === 'route_none' && alertText(at5.alerts[0]) === 'Rota de hoje ainda não começou (10 serviços)', alertText(at5.alerts[0]))
const b5 = buildBellQueue({ panel: at5, today: date })
assert(b5.groups[0].key === 'late' && b5.groups[0].items[0].kind === 'route_none', 'route_none first in the bell')
const at459 = buildDayPanel({ date, jobs, employees, targets, now: new Date('2026-11-05T04:59:00+09:00'), nowMin: 299, today: date })
assert(!at459.alerts.some(a => a.kind === 'route_none'), 'not before 05:00')
const started = buildDayPanel({ date, jobs: jobs.map((j, i) => i === 0 ? { ...j, status: 'in_progress', started_at: '2026-11-04T19:40:00Z' } : j), employees, targets, nowMin: 300, now: new Date('2026-11-05T05:00:00+09:00'), today: date })
assert(!started.alerts.some(a => a.kind === 'route_none'), 'one service started → no route_none')

// ---- cut-off is configurable ----
const c22 = buildDayPanel({ date: d6, jobs: jobs6, employees, targets, cutoff: '22:00', now: new Date('2026-11-05T21:30:00+09:00'), today: date })
assert(!c22.pastCutoff && c22.stores.find(s => s.store === 'Tooda').freeOpen, 'cut-off 22:00 → still free at 21:30')
console.log('route split: ok')
