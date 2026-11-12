// v1.0.227 · Painel do Dia: ONE count (done / in progress / not started) in the header, the filters
// and the person's line; contract with a future start date gives no "sem serviço criado". Pure, no DB.
import assert from 'node:assert/strict'
import { buildDayPanel, teamProgressText } from '../src/lib/dayPanel.js'
import { checkRows, checkCounts, filterRows } from '../src/lib/dayCheck.js'

const D = '2026-11-13'
const job = (i, extra) => ({ id: `j${i}`, title: `Loja ${i} — Basic Cleaning`, scheduled_date: D, scheduled_time: '09:00', employee_id: 'e1', employee_name: 'Ana', photo_required: false, ...extra })
const done = i => job(i, { status: 'completed', started_at: `${D}T00:${10 + i}:00Z`, completed_at: `${D}T00:${20 + i}:00Z` })
const jobs = [1, 2, 3, 4, 5].map(done)
jobs.push(job(6, { status: 'in_progress', started_at: `${D}T01:00:00Z` }))
for (let i = 7; i <= 11; i++) jobs.push(job(i, { status: 'assigned' }))
// someone else completed the same service as the running one (Loja 6): it must NOT turn Ana's into "done"
jobs.push({ id: 'b6', title: 'Loja 6 — Basic Cleaning', scheduled_date: D, scheduled_time: '07:00', employee_id: 'e2', employee_name: 'Bia', status: 'completed', started_at: `${D}T00:00:00Z`, completed_at: `${D}T00:30:00Z`, photo_required: false })

const employees = [{ id: 'e1', full_name: 'Ana', is_active: true, job_role: 'cleaner' }, { id: 'e2', full_name: 'Bia', is_active: true, job_role: 'cleaner' }]
const targets = [{ id: 't', base: 'Artis', clientName: 'Artis', kind: 'weekly', days: [5], hours: 1, startDate: '2026-11-16' }]
const p = buildDayPanel({ date: D, jobs, employees, targets, today: D, nowMin: 8 * 60 })

const ana = p.team.find(x => x.id === 'e1')
assert.deepEqual([ana.done, ana.working, ana.notStarted, ana.total], [5, 1, 5, 11])
assert.match(teamProgressText(ana), /^5 de 11 · 1 em andamento/)

const rows = checkRows(p, 'person')
const r = rows.find(x => x.key === 'p:e1')
assert.deepEqual([r.ok + r.warn, r.working, r.todo, r.total], [5, 1, 5, 11])
const c = checkCounts(rows)
assert.equal(c.total, c.ok + c.warn + c.working + c.todo)

// header = same numbers, summed over everybody (Bia's own completed Loja 6 counts for Bia)
assert.equal(p.count.services, 12)
assert.equal(p.count.servicesDone, 6)
assert.equal(p.count.inProgress, 1)
assert.equal(p.count.toStart, 5)
assert.equal(p.count.servicesDone + p.count.inProgress + p.count.toStart, p.count.services)
assert.deepEqual([c.ok + c.warn, c.working, c.todo, c.total], [p.count.servicesDone, p.count.inProgress, p.count.toStart, p.count.services])
// filters list the right rows
assert.ok(filterRows(rows, 'working').some(x => x.key === 'p:e1'))
// stores: done only when all services done; Loja 6 has Ana running → not done
assert.equal(p.count.storesDone, 5)
assert.equal(p.count.stores, 11)

// contract that starts 16/11: no "sem serviço criado" store / alert on 13/11, back on 16/11 (Mon)
assert.equal(p.stores.some(s => s.noJob), false)
assert.equal(p.alerts.some(a => a.kind === 'no_job'), false)
const t16 = [{ ...targets[0], days: [1] }]
const p16 = buildDayPanel({ date: '2026-11-16', jobs: [], employees, targets: t16, today: '2026-11-16', nowMin: 8 * 60 })
assert.equal(p16.alerts.some(a => a.kind === 'no_job'), true)
// a contract with no start date keeps showing as before
const p13 = buildDayPanel({ date: D, jobs: [], employees, targets: [{ ...targets[0], startDate: null }], today: D, nowMin: 8 * 60 })
assert.equal(p13.alerts.some(a => a.kind === 'no_job'), true)
console.log('day count: ok')
