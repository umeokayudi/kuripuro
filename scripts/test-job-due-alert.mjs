import { dueAlertJobs, dueAlertSlot, acceptSpotUpdate, isBrokenRunningJob } from '../src/lib/jobDueAlert.js'

function assert(c, m) { if (!c) { console.error('❌', m); process.exit(1) } }

// 2026-10-25 23:10 JST
const now = new Date('2026-10-25T14:10:00Z')
const spot = { id: 's', job_category: 'spot', spot_status: 'pending', status: 'assigned', scheduled_date: '2026-10-25', scheduled_time: '23:00' }
const regular = { id: 'r', job_category: 'regular', status: 'assigned', scheduled_date: '2026-10-25', scheduled_time: '22:30' }
const later = { id: 'l', job_category: 'regular', status: 'assigned', scheduled_date: '2026-10-25', scheduled_time: '23:50' }

let list = dueAlertJobs([spot, regular, later], { now })
assert(list.length === 2, 'spot + due regular')
assert(list[0].job.id === 's' && list[0].kind === 'accept' && list[0].past === 10, 'spot first, 10 min past')
assert(list[1].job.id === 'r' && list[1].past === 40, 'regular 40 min past')
assert(dueAlertJobs([spot], { now: new Date('2026-10-25T13:20:00Z') }).length === 0, 'spot 40 min ahead: not yet')
assert(dueAlertJobs([spot], { now: new Date('2026-10-25T13:35:00Z') }).length === 1, 'spot 25 min ahead: announced')
assert(dueAlertJobs([spot, regular], { now, hasActiveJob: true }).map(x => x.job.id).join() === 's', 'while working only the spot offer')
assert(dueAlertJobs([{ ...spot, started_at: '2026-10-25T13:51:45Z' }], { now }).length === 0, 'started spot: no alert')
assert(dueAlertJobs([{ ...spot, spot_status: 'accepted' }], { now }).map(x => x.kind).join() === 'start', 'accepted spot becomes a start alert')
// after midnight the pending 23:00 spot is still announced
assert(dueAlertJobs([spot], { now: new Date('2026-10-25T15:40:00Z') }).length === 1, 'still pending after midnight')

assert(dueAlertSlot(4) === 0 && dueAlertSlot(5) === 1 && dueAlertSlot(-3) === -1, 'slots every 5 min')

// The bug: accepting a running spot reset it to 'assigned'
const running = { ...spot, status: 'in_progress', started_at: '2026-10-25T13:51:45Z' }
assert(!('status' in acceptSpotUpdate(running)), 'accept keeps a running job running')
assert(acceptSpotUpdate(running).spot_status === 'accepted', 'accept marks accepted')
assert(acceptSpotUpdate(spot).status === 'assigned', 'accept before start schedules it')
assert(!('status' in acceptSpotUpdate({ ...spot, status: 'completed' })), 'accept never reopens done job')

// The record left by the old bug is reopened
const broken = { id: '74da', status: 'assigned', started_at: '2026-10-25T13:51:45Z', completed_at: null }
assert(isBrokenRunningJob(broken, new Date('2026-10-25T15:45:00Z')), 'broken job detected')
assert(!isBrokenRunningJob({ ...broken, started_at: null }, now), 'not started')
assert(!isBrokenRunningJob({ ...broken, retro_report: {} }, now), 'retro job')
assert(!isBrokenRunningJob(broken, new Date('2026-10-27T15:45:00Z')), 'older than a day left alone')

console.log('✅ job due alert + accept spot')
