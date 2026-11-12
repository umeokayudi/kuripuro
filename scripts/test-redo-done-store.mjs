#!/usr/bin/env node
// v1.0.215 · a store a coworker already finished today: right labels, no silent re-add, redo only with a reason.
// Run: npx vite-node scripts/test-redo-done-store.mjs   (fake database, writes nothing)
import { buildAddServiceOptions, employeeAddService, preparePastServiceJob, manualAddLocations, doneTimeText } from '../src/lib/employeeAddJob.js'
import { coveredJobs } from '../src/lib/jobCoverage.js'
import { nextPendingJob } from '../src/lib/agenda.js'
import { tokyoToday } from '../src/lib/dates.js'

const ok = (c, m) => { if (!c) { console.error('❌', m); process.exit(1) } }
const today = tokyoToday()
const ALEX = { id: 'alex', name: 'Alexandre Umeoka' }
const GUI = { id: 'gui', name: 'Guilherme Henrique' }
const shinbashi = manualAddLocations().find(l => l.name === 'Kodama Shinbashi')
ok(shinbashi, 'Kodama Shinbashi in catalog')

// Guilherme's morning job: completed, but no "after" photo URL (what happened on 12/11)
const guiDone = { id: 'a3d0aeff-x', title: 'Kodama Shinbashi — Basic Cleaning', description: 'Key box: 0606', employee_id: GUI.id, employee_name: GUI.name, status: 'completed', scheduled_date: today, started_at: `${today}T21:00:27Z`, completed_at: '2026-11-11T21:19:04Z', photo_end_url: null, retro_report: null, job_category: 'regular' }
const guiPlanned = { id: 'plan-1', title: 'Kodama Oimachi — Basic Cleaning', employee_id: GUI.id, employee_name: GUI.name, status: 'assigned', scheduled_date: today, job_category: 'regular' }
const guiRunning = { id: 'run-1', title: 'Kodama Kinshicho — Basic Cleaning', employee_id: GUI.id, employee_name: GUI.name, status: 'in_progress', started_at: 'x', scheduled_date: today, job_category: 'regular' }

// 1. labels
const opts = buildAddServiceOptions(manualAddLocations(), [guiDone, guiPlanned, guiRunning], ALEX.id, 'basic', { allowTransfer: false })
const by = n => opts.find(o => o.location.name === n)
ok(by('Kodama Shinbashi').state === 'done_today' && by('Kodama Shinbashi').byOther && by('Kodama Shinbashi').doneBy === GUI.name, 'done by coworker flagged')
ok(by('Kodama Oimachi').state === 'blocked' && by('Kodama Oimachi').reason === 'planned' && by('Kodama Oimachi').byName === GUI.name, 'planned for coworker (not "em andamento")')
ok(by('Kodama Kinshicho').reason === 'in_progress' && by('Kodama Kinshicho').byName === GUI.name, 'in progress with name')
ok(doneTimeText(guiDone) === '06:19', `time in Tokyo: ${doneTimeText(guiDone)}`)

// fake supabase: select→ day jobs, insert → record
function fakeDb(rows) {
  const inserted = []
  const q = (table) => {
    const st = { table, op: 'select', filters: [] }
    const api = {
      select() { return api }, eq(k, v) { st.filters.push(r => r[k] === v); return api }, neq(k, v) { st.filters.push(r => r[k] !== v); return api },
      in(k, v) { st.filters.push(r => v.includes(r[k])); return api }, is() { return api }, order() { return api }, limit() { return api },
      insert(row) { st.op = 'insert'; st.row = row; inserted.push({ table, row }); return api },
      update() { return api }, maybeSingle() { return api }, single() { return api },
      then(res, rej) {
        if (st.op === 'insert') return Promise.resolve({ data: { id: 'new', ...st.row }, error: null }).then(res, rej)
        if (table !== 'jobs') return Promise.resolve({ data: [], error: null }).then(res, rej)
        return Promise.resolve({ data: rows.filter(r => st.filters.every(f => f(r))), error: null }).then(res, rej)
      },
    }
    return api
  }
  return { from: q, inserted }
}

// 2. "Já fiz"/Registrar relatório path can no longer put it on Alexandre's route
let db = fakeDb([guiDone])
let r = await preparePastServiceJob(db, { employee: ALEX, location: shinbashi, date: today })
ok(!r.ok && r.error === 'done_by_other' && r.doneBy === GUI.name, `past service blocked: ${JSON.stringify(r)}`)
ok(!db.inserted.length, 'nothing inserted by past service')

// 3. add without reason → refused; short reason → refused
db = fakeDb([guiDone])
r = await employeeAddService(db, { employee: ALEX, location: shinbashi, date: today })
ok(!r.ok && r.error === 'done_by_other', 'no reason refused')
r = await employeeAddService(db, { employee: ALEX, location: shinbashi, date: today, redoReason: 'sujo' })
ok(!r.ok && r.error === 'done_by_other', 'short reason refused')
ok(!db.inserted.length, 'nothing inserted without reason')

// 4. with a reason → new job with audit line + message to the office; never flagged "Coberto por"
r = await employeeAddService(db, { employee: ALEX, location: shinbashi, date: today, redoReason: 'Cliente pediu de novo, cozinha suja' })
ok(r.ok && r.action === 'redo', `redo ok: ${JSON.stringify(r).slice(0, 200)}`)
const job = db.inserted.find(i => i.table === 'jobs').row
ok(job.description.includes('Refeito com justificativa') && job.description.includes('Guilherme Henrique às 06:19') && job.description.includes('Cliente pediu de novo'), 'audit line on job')
ok(db.inserted.some(i => i.table === 'messages' && i.row.sender === 'employee' && i.row.content.includes('Cliente pediu')), 'office message sent')
ok(!coveredJobs([{ ...job, id: 'new', status: 'assigned' }, guiDone]).size, 'redo job not marked covered')

// 5. my own completed job still offers the retro report (not "done by other")
const mine = { ...guiDone, id: 'm', employee_id: ALEX.id, employee_name: ALEX.name }
const o2 = buildAddServiceOptions([shinbashi], [mine], ALEX.id, 'basic')[0]
ok(o2.state === 'done_today' && !o2.byOther, 'own done job not byOther')

// 6. covered job is never the "next place"
ok(nextPendingJob([{ id: 'c', status: 'covered', scheduled_time: '00:30' }]) === null, 'covered not next')

console.log('✅ redo-done-store: all passed')
