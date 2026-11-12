// v1.0.217 · Canal da Equipe — node scripts/test-team-channel.mjs
import assert from 'node:assert/strict'
import { messagePath, isChannelPath, requestPath, buildMessage, buildCoverCards, cantGoCandidates, requestStillOpen, jobBrief, takeCantGoPatch, coverPushText, prevMonth, cleanText, sortMessages } from '../src/lib/teamChannel.js'

const today = '2026-11-12'
const J = (id, extra = {}) => ({ id: `${id}`.padEnd(8, '0') + '-0000-4000-8000-000000000000', title: 'Kodama Kinshicho — Deep Clean (Range Hood)', client_name: 'OTP', scheduled_date: today, scheduled_time: '01:00:00', status: 'assigned', employee_id: null, spot_status: 'pending', value: 30000, ...extra })

// paths: sortable by time, only channel paths accepted by the push route
const p = messagePath(new Date('2026-11-12T03:00:00Z'), 'ab12cd')
assert.equal(p, 'team-channel/msgs/2026-11/1794452400000_ab12cd.json')
assert.equal(messagePath(new Date('2026-11-30T16:00:00Z'), 'x').split('/')[2], '2026-12') // Tokyo month
assert.ok(isChannelPath(p))
assert.ok(isChannelPath(requestPath('11111111-1111-4111-8111-111111111111')))
assert.ok(!isChannelPath('jobs/abc/ja_fiz.json'))
assert.ok(!isChannelPath('team-channel/../employee-faces/x.json'))
assert.equal(prevMonth('2026-01'), '2025-12')
assert.equal(cleanText('  oi\r\n\n\n\nok  '), 'oi\n\nok')

// a message never carries money: only store/service/day/time of the job
const m = buildMessage({ kind: 'cover', author: { role: 'admin', id: 'a1', name: 'Umeoka' }, job: J(1), now: '2026-11-12T03:00:00Z' })
assert.deepEqual(Object.keys(m.job).sort(), ['date', 'id', 'service', 'store', 'time'])
assert.equal(m.job.store, 'Kodama Kinshicho')
assert.equal(m.job.time, '01:00')
assert.ok(!JSON.stringify(m).includes('30000'))
assert.throws(() => buildMessage({ kind: 'text', text: '  ', author: { role: 'employee', id: 'e1' } }))
assert.throws(() => buildMessage({ kind: 'text', text: 'x', author: { role: 'client', id: 'c1' } }))
assert.deepEqual(sortMessages([{ at: '2', author: {}, kind: 't' }, { at: '1', author: {}, kind: 't' }, null]).map(x => x.at), ['1', '2'])

// cover cards: open offers + "não posso ir" still with the requester
const gui = { id: 'gui', name: 'Guilherme' }
const reqOpen = { job_id: J(2).id, from: gui, status: 'open', reason: 'doente', at: '2026-11-12T01:00:00Z' }
const jobs = { [J(2).id]: J(2, { employee_id: 'gui', employee_name: 'Guilherme', spot_status: null, scheduled_time: '00:30' }) }
const cards = buildCoverCards({
  openJobs: [J(1), J(3, { scheduled_date: '2026-11-11' }), J(4, { employee_id: 'x' })],
  requests: [reqOpen], jobsById: jobs, today, me: { role: 'employee', id: 'gab' }, fitOf: () => ({ ok: true, reason: 'ok' }),
})
assert.deepEqual(cards.map(c => c.kind), ['cant_go', 'free']) // 00:30 before 01:00; past day + taken job left out
assert.ok(cards.every(c => c.canTake))
// the requester cannot take own card; sees it as mine
const own = buildCoverCards({ requests: [reqOpen], jobsById: jobs, today, me: { role: 'employee', id: 'gui' }, fitOf: () => ({ ok: true, reason: 'ok' }) })
assert.equal(own[0].mine, true); assert.equal(own[0].canTake, false)
// admin never takes (only sees / decides)
assert.ok(buildCoverCards({ openJobs: [J(1)], today, me: { role: 'admin', id: 'a1' } }).every(c => !c.canTake))
// role does not fit → no button; day off → button (confirm in the UI)
assert.equal(buildCoverCards({ openJobs: [J(1)], today, me: { role: 'employee', id: 'gab' }, fitOf: () => ({ ok: false, reason: 'role' }) })[0].canTake, false)
assert.equal(buildCoverCards({ openJobs: [J(1)], today, me: { role: 'employee', id: 'gab' }, fitOf: () => ({ ok: false, reason: 'off' }) })[0].canTake, true)

// a request stops being a card when the job moved, started or passed
assert.equal(requestStillOpen(reqOpen, { ...jobs[J(2).id], employee_id: 'gab' }, today), false)
assert.equal(requestStillOpen(reqOpen, { ...jobs[J(2).id], status: 'in_progress' }, today), false)
assert.equal(requestStillOpen(reqOpen, { ...jobs[J(2).id], scheduled_date: '2026-11-11' }, today), false)
assert.equal(requestStillOpen({ ...reqOpen, status: 'taken' }, jobs[J(2).id], today), false)

// own jobs that can ask for cover: assigned, not started, today+, not already asked
const mine = cantGoCandidates([J(2, { employee_id: 'gui' }), J(5, { employee_id: 'gui', status: 'in_progress' }), J(6, { employee_id: 'gui', scheduled_date: '2026-11-13' })], 'gui', today, [reqOpen])
assert.deepEqual(mine.map(j => j.id), [J(6).id])

// take patch changes only who does it (never value, pay, date)
assert.deepEqual(Object.keys(takeCantGoPatch(J(2), { id: 'gab', name: 'Gabriel' })).sort(), ['employee_id', 'employee_name'])
assert.ok('spot_status' in takeCantGoPatch(J(2, { job_category: 'spot' }), { id: 'gab', name: 'Gabriel' }))

// push text
assert.match(coverPushText({ kind: 'cant_go', author: gui, job: jobBrief(J(2)) }, 'pt').title, /Guilherme precisa de cobertura/)
assert.match(coverPushText({ kind: 'cover', job: jobBrief(J(1)) }, 'pt').body, /Kodama Kinshicho · Deep Clean \(Range Hood\) · 12\/11 · 01:00/)
console.log('team-channel ok')
