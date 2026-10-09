import assert from 'node:assert/strict'
import { addDaysIso, alertCounts, followupQueue, followupStatus, goalProgress, lastContactDate, monthElapsedPercent, monthResults } from '../src/lib/salesFollowup.js'

const today = '2026-10-09'
const lead = (id, extra) => ({ id, company_name: id, stage: 'followup', first_contact_date: '2026-09-01', ...extra })

assert.equal(followupStatus(lead('a', { next_followup_date: '2026-10-05' }), today).status, 'overdue')
assert.equal(followupStatus(lead('a', { next_followup_date: '2026-10-05' }), today).days, 4)
assert.equal(followupStatus(lead('b', { next_followup_date: today }), today).status, 'today')
assert.equal(followupStatus(lead('c', { next_followup_date: '2026-10-11' }), today).status, 'soon')
assert.equal(followupStatus(lead('d', { next_followup_date: '2026-10-30' }), today).status, 'scheduled')
assert.equal(followupStatus(lead('e', { last_contact_date: '2026-09-20' }), today).status, 'stale')
assert.equal(followupStatus(lead('f', { last_contact_date: '2026-10-08' }), today).status, 'missing')
assert.equal(followupStatus(lead('g', { stage: 'won', next_followup_date: '2026-10-01' }), today), null)

// a logged contact is newer than the lead's stored date
const touch = [{ lead_id: 'e', happened_at: '2026-10-07' }]
assert.equal(lastContactDate(lead('e', { last_contact_date: '2026-09-20' }), touch), '2026-10-07')
assert.equal(followupStatus(lead('e', { last_contact_date: '2026-09-20' }), today, touch).status, 'missing')

const queue = followupQueue([
  lead('late2', { next_followup_date: '2026-10-08' }),
  lead('late9', { next_followup_date: '2026-09-30' }),
  lead('sched', { next_followup_date: '2026-11-01' }),
  lead('now', { next_followup_date: today }),
], today)
assert.deepEqual(queue.map(r => r.lead.id), ['late9', 'late2', 'now', 'sched'])
const counts = alertCounts(queue)
assert.equal(counts.overdue, 2)
assert.equal(counts.needsAction, 3)

assert.equal(addDaysIso('2026-10-30', 3), '2026-11-02')
assert.deepEqual(goalProgress(3, 4), { goal: 4, value: 3, percent: 75, done: false })
assert.equal(goalProgress(5, 4).done, true)
assert.equal(goalProgress(5, 0).percent, 0)
assert.equal(monthElapsedPercent('2026-10-31'), 100)

const data = {
  approaches: [{ salesperson_id: 's1', work_date: '2026-10-02' }, { salesperson_id: 's1', work_date: '2026-09-28' }],
  touchpoints: [{ salesperson_id: 's1', happened_at: '2026-10-03' }, { salesperson_id: 's2', happened_at: '2026-10-03' }],
  leads: [{ salesperson_id: 's1', first_contact_date: '2026-10-01' }],
  quotes: [{ salesperson_id: 's1', created_at: '2026-10-04T01:00:00Z' }],
  contracts: [{ salesperson_id: 's1', status: 'active', reviewed_at: '2026-10-05T00:00:00Z', client_monthly_total: 80000 }, { salesperson_id: 's1', status: 'pending_review', created_at: '2026-10-05' }],
}
assert.deepEqual(monthResults(data, 's1', '2026-10'), { approaches: 1, contacts: 1, leads: 1, quotes: 1, contracts: 1, revenue: 80000 })

console.log('✅ sales follow-up and goals rules OK')
