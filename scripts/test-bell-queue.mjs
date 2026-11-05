#!/usr/bin/env node
// v1.0.151 · bell "Aguardando você": badge = real queue size, fixed order, retroactive review in the queue.
import { buildBellQueue, badgeText } from '../src/lib/bellQueue.js'
import { buildExceptions } from '../src/lib/exceptionQueue.js'
import { buildDayPanel } from '../src/lib/dayPanel.js'

const assert = (c, m) => { if (!c) throw new Error(m) }
const today = '2026-11-05'
const OTP = '7138f082-0d38-43e4-bd77-00c4598690b3'
const G = 'g1'
const stores = ['Kodama Yurakucho', 'Sakana Yakio 2', 'Kodama Kinshicho', 'Sakana Yakio Honten', 'Tooda', 'Nyu Sakana Yakio', 'Kodama Shinbashi', 'Kodama Oimachi']
const jobs = [
  ...stores.map((s, i) => ({ id: `b${i}`, title: `${s} — Basic Cleaning`, client_id: OTP, employee_id: G, employee_name: 'Guilherme Henrique', status: 'assigned', scheduled_date: today, scheduled_time: '00:30' })),
  { id: 'd1', title: 'Kodama Kinshicho — Deep Clean (Range Hood)', client_id: OTP, employee_id: G, employee_name: 'Guilherme Henrique', status: 'assigned', scheduled_date: today, scheduled_time: '00:30' },
  { id: 'd2', title: 'Nyu Sakana Yakio — Deep Clean (Range Hood)', client_id: OTP, employee_id: G, employee_name: 'Guilherme Henrique', status: 'assigned', scheduled_date: today, scheduled_time: '00:30' },
  // retroactive registration of 04/11 (Gabriel, Nyu Sakana Yakio) waiting for review — was only in Ao vivo
  { id: 'r1', title: 'Nyu Sakana Yakio — Deep Clean (AC Cleaning, Grating, Other)', client_id: OTP, employee_id: 'gab', employee_name: 'Gabriel Santos Petricevich', status: 'completed', scheduled_date: '2026-11-04', scheduled_time: '00:30', retro_report: '', admin_reviewed: false, completed_at: '2026-11-04T00:17:28Z' },
]
const now = new Date('2026-11-05T10:05:00+09:00')
const exceptions = buildExceptions({ jobs, today, now })
const late = exceptions.filter(x => x.kind === 'late')
assert(late.length === 10, `10 late today (got ${late.length})`)
assert(exceptions.some(x => x.kind === 'retro_review' && x.jobId === 'r1'), 'retro review in the queue')
const panel = buildDayPanel({ date: today, jobs, employees: [{ id: G, full_name: 'Guilherme Henrique', job_role: 'cleaner', work_days: '["Thu"]' }], now, nowMin: 605, today })
const routeAlerts = [{ id: 'otp-route:2026-11-05:g1', employeeId: G, employeeName: 'Guilherme Henrique', date: today, startedAt: null, jobs: 10 }]
const timeOff = [{ id: 't1', employee_name: 'Leticia', date: '2026-11-20', kind: 'off' }]
const q = buildBellQueue({ exceptions, panel, routeAlerts, timeOff, today })
const keys = q.groups.map(g => g.key)
assert(keys[0] === 'late' && keys.indexOf('exceptions') > 0 && keys.indexOf('dayoff') > keys.indexOf('exceptions'), `fixed group order: ${keys}`)
const lateG = q.groups[0]
assert(lateG.items[0].kind === 'route' && lateG.items.length === 11, 'route alert first, then the 10 late services')
// the 10 late cards are told apart by store + service type
const sig = new Set(lateG.items.filter(x => x.kind === 'late').map(x => `${x.place}|${x.title}`))
assert(sig.size === 10, 'each late card has a distinct store + service')
assert(q.groups.find(g => g.key === 'exceptions').items.some(x => x.kind === 'retro_review'), 'retro review listed')
assert(!q.groups.find(g => g.key === 'exceptions').items.some(x => x.jobId === 'r1' && x.kind === 'no_photo'), 'no duplicate card for the retro job')
const total = q.groups.filter(g => !g.notCounted).reduce((s, g) => s + g.items.length, 0)
assert(q.count === total && badgeText(q.count) === String(total), 'badge = real number of items (never 9+)')
// stable: same input in another order → same order out
const q2 = buildBellQueue({ exceptions: [...exceptions].reverse(), panel, routeAlerts, timeOff, today })
assert(JSON.stringify(q2.groups.map(g => g.items.map(i => i.id))) === JSON.stringify(q.groups.map(g => g.items.map(i => i.id))), 'order does not depend on load order')
// resolving an item takes it out at once → badge goes down
const q3 = buildBellQueue({ exceptions, panel, routeAlerts, timeOff, today, hidden: new Set([late[0].id]) })
assert(q3.count === q.count - 1, 'badge goes down when an item is resolved')
// empty queue
assert(buildBellQueue({ today }).count === 0 && buildBellQueue({ today }).groups.length === 0, 'empty queue')
// paid without confirmation waits on the employee: listed, not counted
const w = buildBellQueue({ exceptions: [{ id: 'p', kind: 'paid_unconfirmed', waiting: true, date: '2026-10' }], today })
assert(w.count === 0 && w.groups[0].key === 'waiting', 'waiting item not counted')
console.log('bell queue: ok')
