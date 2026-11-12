// v1.0.197 · "Serviço em dupla" — node scripts/test-dupla.mjs
import assert from 'node:assert/strict'
import { buildDuplaPlan, canJoinDupla, duplaInfo, isDuplaHelper, areDuplaPartners, splitHalf, undoDuplaPlan, memberWork } from '../src/lib/duplaJob.js'
import { coveredJobs } from '../src/lib/jobCoverage.js'
import { countJobs } from '../src/lib/jobCounts.js'

const MAIN_ID = '11111111-1111-4111-8111-111111111111'
const HELP_ID = '22222222-2222-4222-8222-222222222222'
const today = '2026-11-10'
const main = {
  id: MAIN_ID, title: 'Nyu Ibushio — Deep Clean (Range Hood)', client_id: 'c1', client_name: 'OTP',
  employee_id: 'gui', employee_name: 'Guilherme', scheduled_date: today, scheduled_time: '00:30',
  status: 'in_progress', started_at: '2026-11-09T15:30:00Z', job_category: 'regular',
  description: 'Deep Clean: range hood\nPagamento do funcionário (Guilherme): ¥5.001', employee_pay: null,
  checklist_template: 'Coifa|Filtros',
}

// split: odd yen stays with the person who had the service
assert.deepEqual(splitHalf(5001), [2501, 2500])
assert.deepEqual(splitHalf(1000), [500, 500])
assert.deepEqual(splitHalf(null), [null, null])

// who can join
assert.equal(canJoinDupla(main, 'gab', today).ok, true)
assert.equal(canJoinDupla(main, 'gui', today).error, 'own_job')
assert.equal(canJoinDupla({ ...main, scheduled_date: '2026-11-11' }, 'gab', today).error, 'not_today')
assert.equal(canJoinDupla({ ...main, status: 'completed' }, 'gab', today).error, 'not_open')

const plan = buildDuplaPlan(main, { id: 'gab', name: 'Gabriel' }, { helperJobId: HELP_ID, now: '2026-11-09T16:00:00Z' })
// pay from the description line is split; the main keeps the odd yen
assert.equal(plan.split.originalPay, 5001)
assert.equal(plan.mainPatch.employee_pay, 2501)
assert.equal(plan.helperRow.employee_pay, 2500)
// helper row: same service, running now, no client (billing / portal count one visit), no pay sentence
assert.equal(plan.helperRow.title, main.title)
assert.equal(plan.helperRow.client_id, null)
assert.equal(plan.helperRow.value, 0)
assert.equal(plan.helperRow.status, 'in_progress')
assert.equal(plan.helperRow.started_at, '2026-11-09T16:00:00Z')
assert.ok(!/Pagamento do funcion/.test(plan.helperRow.description))
assert.equal(plan.helperRow.checklist_template, 'Coifa|Filtros')

// both descriptions point at each other
const mainAfter = { ...main, ...plan.mainPatch }
const helper = { ...plan.helperRow }
assert.deepEqual(duplaInfo(mainAfter), { role: 'main', partnerName: 'Gabriel', partnerJobId: HELP_ID })
assert.deepEqual(duplaInfo(helper), { role: 'helper', partnerName: 'Guilherme', partnerJobId: MAIN_ID })
assert.equal(isDuplaHelper(helper), true)
assert.equal(areDuplaPartners(mainAfter, helper), true)
assert.equal(canJoinDupla(mainAfter, 'leti', today).error, 'already_dupla')

// a not-started job of another person: the helper's row waits too
const planned = buildDuplaPlan({ ...main, status: 'assigned', started_at: null }, { id: 'gab', name: 'Gabriel' }, { helperJobId: HELP_ID })
assert.equal(planned.helperRow.status, 'assigned')
assert.equal(planned.helperRow.started_at, null)

// spot: spot_value split too
const spot = buildDuplaPlan({ ...main, job_category: 'spot', spot_value: 8000, employee_pay: 3000, description: '' }, { id: 'gab', name: 'Gabriel' }, { helperJobId: HELP_ID })
assert.equal(spot.mainPatch.spot_value, 4000)
assert.equal(spot.helperRow.spot_value, 4000)
assert.equal(spot.helperRow.spot_status, 'accepted')
assert.equal(spot.mainPatch.employee_pay, 1500)

// pay "a definir": nothing to split, both stay to be defined
const undef = buildDuplaPlan({ ...main, description: 'x' }, { id: 'gab', name: 'Gabriel' }, { helperJobId: HELP_ID })
assert.equal('employee_pay' in undef.mainPatch, false)
assert.equal(undef.helperRow.employee_pay, null)

// the pair is never "Coberto por": main done first, helper still running
const doneMain = { ...mainAfter, status: 'completed' }
assert.equal(coveredJobs([doneMain, helper]).size, 0)
// …but a third person's leftover job of the same service still is
const other = { id: 'x', employee_id: 'leti', employee_name: 'Letícia', status: 'assigned', scheduled_date: today, title: main.title }
assert.equal(coveredJobs([doneMain, helper, other]).get('x').id, MAIN_ID)

// counts: the pair is one service
assert.equal(countJobs([mainAfter, helper], { today }).scheduled, 1)

// undo: main gets its whole pay back, helper row cancelled, pair line neutralised
const audit = { helper_job_id: HELP_ID, split: plan.split }
const undo = undoDuplaPlan(mainAfter, helper, audit, { by: 'Gabriel', now: '2026-11-09T16:10:00Z' })
assert.equal(undo.mainPatch.employee_pay, 5001)
assert.equal(undo.helperPatch.status, 'cancelled')
assert.equal(duplaInfo({ ...mainAfter, ...undo.mainPatch }), null)
assert.equal(duplaInfo({ ...helper, ...undo.helperPatch }), null)
// …and the main job can pair again with someone else afterwards
const again = buildDuplaPlan({ ...mainAfter, ...undo.mainPatch }, { id: 'leti', name: 'Letícia' }, { helperJobId: '33333333-3333-4333-8333-333333333333' })
assert.equal(duplaInfo({ ...mainAfter, ...undo.mainPatch, ...again.mainPatch }).partnerName, 'Letícia')

// what each one did
const w = memberWork({ ...helper, notes_employee: 'Lavei os filtros', completed_at: '2026-11-09T17:00:00Z', status: 'completed' }, [{ label: 'Coifa', done: false }, { label: 'Filtros', done: true }])
assert.deepEqual(w.done, ['Filtros'])
assert.deepEqual(w.not_done, ['Coifa'])
assert.equal(w.note, 'Lavei os filtros')

console.log('dupla (serviço em dupla): all passed')
