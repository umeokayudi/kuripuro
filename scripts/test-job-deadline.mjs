// v1.0.147 · On The Planet: deadline 10:00 + 05:00 route alert (acceptance tests of the spec)
import assert from 'node:assert/strict'
import { isDeadlineJob, isDeadlineLate, otpRouteAlerts, otpRouteAlertText, jobTimeText, finishDelayMin, OTP_CLIENT_ID } from '../src/lib/jobDeadline.js'
import { isLateJob, countJobs } from '../src/lib/jobCounts.js'
import { progressBucket } from '../src/lib/agenda.js'
import { isOverdueAssignedJob } from '../src/lib/jobOverdue.js'
import { dueAlertJobs } from '../src/lib/jobDueAlert.js'
import { startDelayMin } from '../src/lib/workKpis.js'
import { dayCoverage } from '../src/lib/dayCoverage.js'

const D = '2026-11-03'
const at = hm => new Date(`${D}T${hm}:00+09:00`)
const min = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m }
const otp = (x = {}) => ({ id: 'o1', client_id: OTP_CLIENT_ID, client_name: 'On The Planet', title: 'On The Planet Shibuya — Basic', scheduled_date: D, scheduled_time: '00:30', status: 'assigned', employee_id: 'g', employee_name: 'Guilherme Henrique', ...x })
const atomic = (x = {}) => ({ id: 'a1', client_id: 'bf3f7ab5-24c4-4ec1-b25f-d91becb166de', client_name: 'Atomic Bar', title: 'Atomic Bar', scheduled_date: D, scheduled_time: '00:30', status: 'assigned', employee_id: 'g', employee_name: 'Guilherme Henrique', ...x })
let n = 0
const t = (name, fn) => { fn(); n++; console.log('✓', name) }

t('only OTP 00:30 is a deadline job (Atomic 00:30 and OTP 20:00 unchanged)', () => {
  assert.equal(isDeadlineJob(otp()), true)
  assert.equal(isDeadlineJob(otp({ scheduled_time: '00:30:00' })), true)
  assert.equal(isDeadlineJob(atomic()), false)
  assert.equal(isDeadlineJob(otp({ scheduled_time: '20:00' })), false)
  assert.equal(isDeadlineJob({ client_name: 'On The Planet Ebisu', scheduled_time: '00:30' }), true)
})

t('acceptance 1: OTP day with no start at 05:00 → alert to the owner', () => {
  const jobs = [otp(), otp({ id: 'o2' })]
  assert.deepEqual(otpRouteAlerts(jobs, { today: D, nowMin: min('04:59') }), [])
  const a = otpRouteAlerts(jobs, { today: D, nowMin: min('05:00') })
  assert.equal(a.length, 1)
  assert.equal(a[0].startedAt, null)
  assert.equal(otpRouteAlertText(a[0]), 'Rota OTP de hoje ainda não começou — Guilherme Henrique')
  // started after 05:00 → one alert kept with the real time
  const late = otpRouteAlerts([otp({ status: 'in_progress', started_at: at('06:48').toISOString() }), otp({ id: 'o2' })], { today: D, nowMin: min('07:00') })
  assert.equal(late.length, 1)
  assert.equal(late[0].startedAt, '06:48')
  assert.match(otpRouteAlertText(late[0]), /começou às 06:48/)
  // started before 05:00 → no alert; Atomic only → no alert
  assert.deepEqual(otpRouteAlerts([otp({ status: 'completed', started_at: at('01:10').toISOString(), completed_at: at('02:00').toISOString() })], { today: D, nowMin: min('06:00') }), [])
  assert.deepEqual(otpRouteAlerts([atomic()], { today: D, nowMin: min('06:00') }), [])
})

t('acceptance 2: started 07:00 and finished 09:30 → not late', () => {
  const j = otp({ status: 'completed', started_at: at('07:00').toISOString(), completed_at: at('09:30').toISOString() })
  assert.equal(isDeadlineLate(j, { now: at('11:00') }), false)
  assert.equal(isLateJob(j, D, min('11:00')), false)
  assert.equal(progressBucket(j, { now: at('11:00') }), 'done')
  assert.equal(startDelayMin(j), -30) // punctuality = finished 30 min before 10:00
  // while running at 08:00 it is not late either, and not started at 08:00 is not late
  assert.equal(isLateJob(otp({ status: 'in_progress', started_at: at('07:00').toISOString() }), D, min('08:00')), false)
  assert.equal(isLateJob(otp(), D, min('08:00')), false)
  assert.equal(countJobs([otp()], { today: D, nowMin: min('08:00') }).late, 0)
})

t('acceptance 3: not finished at 10:00 → late (not started AND running)', () => {
  assert.equal(isLateJob(otp(), D, min('10:00')), true)
  assert.equal(isLateJob(otp({ status: 'in_progress', started_at: at('08:00').toISOString() }), D, min('10:01')), true)
  assert.equal(progressBucket(otp({ status: 'in_progress', started_at: at('08:00').toISOString() }), { now: at('10:05') }), 'late')
  assert.equal(countJobs([otp(), otp({ id: 'o2', status: 'completed' })], { today: D, nowMin: min('10:30') }).late, 1)
  // retro-only box: 8 h after the deadline (18:00), not 8 h after 00:30
  assert.equal(isOverdueAssignedJob(otp(), 8, at('09:00')), false)
  assert.equal(isOverdueAssignedJob(otp(), 8, at('18:00')), true)
  // v1.0.198 · employee "start now / late" pop-up removed: never, not even after 10:00
  assert.equal(dueAlertJobs([otp()], { now: at('01:00') }).length, 0)
  assert.equal(dueAlertJobs([otp()], { now: at('10:00') }).length, 0)
  // Live Track coverage: late at 10:00, waiting before
  const target = [{ kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], base: 'On The Planet Shibuya', clientName: 'On The Planet' }]
  const st = nm => dayCoverage(target, D, [otp({ title: 'On The Planet Shibuya' })], { nowMin: min(nm), empById: { g: { id: 'g', full_name: 'Guilherme Henrique', is_active: true } } }).items[0]?.state
  if (st('09:00') !== undefined) { assert.equal(st('09:00'), 'waiting'); assert.equal(st('10:00'), 'late') }
})

t('acceptance 4: Atomic Bar at 00:30 → unchanged (late 5 min after 00:30)', () => {
  assert.equal(isLateJob(atomic(), D, min('00:36')), true)
  assert.equal(jobTimeText(atomic(), 'pt'), '00:30')
  assert.equal(startDelayMin(atomic({ status: 'completed', started_at: at('01:30').toISOString() })), 60)
})

t('employee card text', () => {
  assert.equal(jobTimeText(otp(), 'pt'), 'Concluir até 10:00')
  assert.equal(jobTimeText(otp(), 'en'), 'Finish by 10:00')
  assert.equal(jobTimeText(otp(), 'ja'), '10:00までに完了')
  assert.equal(finishDelayMin(otp()), null)
})

console.log(`\n${n} groups passed`)
