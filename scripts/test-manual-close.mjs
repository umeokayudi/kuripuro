// Pure checks for "Fechar manualmente" (v1.0.98, no database).
import assert from 'node:assert/strict'
import { plannedEnd, suggestedEnd, manualCloseError, manualClosePatch, manualCloseStamp, manualCloseMessage, isMissingColumnError, isClosedManually } from '../src/lib/manualClose.js'
import { awaitingAfterPhoto } from '../src/lib/agenda.js'
import { jobDurationMin, jobToReportView } from '../src/lib/jobReport.js'

// The 29/10 case: Kodama Oimachi open 23h46 against 8h planned.
const job = { id: 'j1', title: 'Kodama Oimachi — Deep Clean', employee_id: 'e1', employee_name: 'Guilherme Nakamura', status: 'in_progress', scheduled_date: '2026-10-28', started_at: '2026-10-28T10:00:00.000Z', photo_end_url: null }
const now = new Date('2026-10-29T09:46:00.000Z')

assert.equal(plannedEnd(job, 480), '2026-10-28T18:00:00.000Z')
assert.equal(plannedEnd({ ...job, started_at: null }, 480), null)
assert.equal(suggestedEnd(job, 480, now), '2026-10-28T18:00:00.000Z')
// A plan that ends after "now" is clipped to now.
assert.equal(suggestedEnd(job, 60 * 30, now), now.toISOString())

assert.equal(manualCloseError({ startedAt: job.started_at, completedAt: '2026-10-28T18:00:00.000Z' }, now), null)
assert.equal(manualCloseError({ startedAt: null, completedAt: '2026-10-28T18:00:00.000Z' }, now), 'start')
assert.equal(manualCloseError({ startedAt: job.started_at, completedAt: job.started_at }, now), 'order')
assert.equal(manualCloseError({ startedAt: job.started_at, completedAt: '2026-10-30T00:00:00.000Z' }, now), 'future')

const patch = manualClosePatch({ startedAt: job.started_at, completedAt: '2026-10-28T18:00:00.000Z', adminName: 'Yudi', note: '  ', now })
assert.deepEqual(patch, { status: 'completed', started_at: job.started_at, completed_at: '2026-10-28T18:00:00.000Z', closed_manually_by: 'Yudi', closed_manually_at: now.toISOString(), closed_manually_note: null })
assert.deepEqual(Object.keys(manualClosePatch({ startedAt: 'a', completedAt: 'b', audit: false })), ['status', 'started_at', 'completed_at'])

// Closed job: honest duration, still "waiting for After photo", counts like any finished job.
const closed = { ...job, ...patch }
assert.equal(jobDurationMin(closed), 480)
assert.equal(awaitingAfterPhoto(closed), true)
assert.equal(isClosedManually(closed), true)
assert.equal(isClosedManually(job), false)
const view = jobToReportView(closed)
assert.equal(view.duration_min, 480)
assert.equal(view.closed_manually_by, 'Yudi')

assert.equal(manualCloseStamp(job, 'pt'), null)
assert.match(manualCloseStamp(closed, 'pt'), /^Fechado manualmente por Yudi em 29\/10.*18:46 · motivo: esquecimento de finalizar$/)
assert.match(manualCloseStamp({ ...closed, closed_manually_note: 'saiu às 19h' }, 'en'), /Closed manually by Yudi .* reason: saiu às 19h/)
assert.match(manualCloseStamp(closed, 'ja'), /Yudiが.*手動で終了 · 理由：終了操作の忘れ/)

const msgPt = manualCloseMessage(job, { startedAt: job.started_at, completedAt: patch.completed_at, note: '', adminName: 'Yudi' }, 'pt')
assert.match(msgPt, /Yudi fechou o seu job Kodama Oimachi \(28\/10\): 19:00 → 29\/10 03:00 \(8h00\)\. Motivo: esquecimento de finalizar\./)
assert.match(msgPt, /foto Depois/)
assert.doesNotMatch(msgPt, /closed your job/)
const msgOther = manualCloseMessage({ ...job, photo_end_url: 'x.jpg' }, { startedAt: job.started_at, completedAt: patch.completed_at, note: 'fim às 3h', adminName: 'Yudi' }, 'en')
assert.match(msgOther, /作業「Kodama Oimachi」（10\/28）を終了しました：19:00 → 10\/29 03:00/)
assert.match(msgOther, /Reason: fim às 3h\. If the time is wrong, reply here\./)
assert.doesNotMatch(msgOther, /After photo/)

assert.equal(isMissingColumnError({ code: 'PGRST204', message: "Could not find the 'closed_manually_by' column of 'jobs'" }), true)
assert.equal(isMissingColumnError({ code: '42703', message: 'column jobs.closed_manually_at does not exist' }), true)
assert.equal(isMissingColumnError({ code: '23505', message: 'duplicate key' }), false)

console.log('manual close: ok')
