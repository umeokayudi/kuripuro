// v1.0.178 · Conferir o dia: verdict per service + rows per person/store
import assert from 'node:assert/strict'
import { serviceCheck, checkRows, filterRows, checkCounts } from '../src/lib/dayCheck.js'
const job = (o = {}) => ({ id: 'j', title: 'Kodama Kinshicho — Basic', photo_start_url: 'a', photo_end_url: 'b', checklist_total: 5, checklist_done: 5, started_at: '2026-11-06T15:30:00Z', completed_at: '2026-11-06T16:30:00Z', gps_start_distance: 20, ...o })
const svc = (o = {}, j = {}) => ({ id: 'j', status: 'done', minutes: 60, assignedId: 'e1', assigned: 'Gui', store: 'Kodama Kinshicho', job: job(j), ...o })
assert.equal(serviceCheck(svc()).verdict, 'ok')
assert.equal(serviceCheck(svc({}, { photo_end_url: null })).verdict, 'warn')
assert.equal(serviceCheck(svc({}, { checklist_done: 3 })).verdict, 'warn')
assert.equal(serviceCheck(svc({}, { gps_start_distance: 900 })).verdict, 'warn')
const fast = serviceCheck(svc({ minutes: 120 }, { completed_at: '2026-11-06T15:30:27Z' }))
assert.equal(fast.verdict, 'warn'); assert.ok(fast.issues[0].includes('27 s'))
assert.equal(serviceCheck(svc({}, { photo_end_url: null, admin_reviewed: true })).verdict, 'ok')
assert.equal(serviceCheck(svc({ status: 'not_started' })).verdict, 'todo')
assert.equal(serviceCheck(svc({ coveredBy: 'Ale' })).verdict, 'ok')
assert.equal(serviceCheck(svc({ retro: true }, { photo_start_url: null, started_at: null, completed_at: null })).verdict, 'ok')
const panel = { date: '2026-11-06', team: [{ id: 'e1', name: 'Gui' }, { id: 'e2', name: 'Leti' }], stores: [
  { key: 'a', store: 'A', services: [svc({ id: 1 }), svc({ id: 2, status: 'late' })] },
  { key: 'b', store: 'B', services: [svc({ id: 3 }, { photo_end_url: null })] },
  { key: 'c', store: 'C', services: [], noJob: true },
] }
const people = checkRows(panel, 'person')
assert.deepEqual(people.map(r => [r.title, r.level, r.ok, r.warn, r.todo]), [['Gui', 'todo', 1, 1, 1], ['Leti', 'none', 0, 0, 0]])
const stores = checkRows(panel, 'store')
assert.deepEqual(stores.map(r => [r.title, r.level]), [['A', 'todo'], ['C', 'todo'], ['B', 'warn']])
assert.deepEqual(filterRows(stores, 'warn').map(r => r.title), ['B'])
assert.deepEqual(checkCounts(people), { total: 3, ok: 1, warn: 1, todo: 1 })
console.log('day-check ok')
