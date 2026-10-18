import assert from 'node:assert/strict'
import { maintenanceRows, invoiceState, billingSummary, lastDoneFromJobs, receiptNumber } from '../src/lib/clientCare.js'

const today = '2026-10-10'
const jobs = [
  { status: 'completed', scheduled_date: '2026-08-01', title: 'Ginza — Deep Clean Grease Trap' },
  { status: 'completed', scheduled_date: '2026-09-25', title: 'Ginza — Deep Clean AC Cleaning' },
  { status: 'assigned', scheduled_date: '2026-10-20', title: 'Ginza — Deep Clean Range Hood' },
  { status: 'completed', scheduled_date: '2026-10-01', title: 'Shibuya — Deep Clean Grease Trap' },
]
const last = lastDoneFromJobs(jobs, 'Ginza')
assert.equal(last.grease_trap, '2026-08-01')
assert.equal(last.ac, '2026-09-25')
assert.equal(last.range_hood, undefined)
assert.equal(last.deep_clean, '2026-09-25')

const rows = maintenanceRows({ jobs, locationName: 'Ginza', records: [{ location_name: 'Ginza', item_key: 'range_hood', last_done: '2026-07-20', interval_days: 85 }], today })
const by = Object.fromEntries(rows.map(r => [r.key, r]))
assert.equal(by.grease_trap.state, 'overdue')
assert.equal(by.ac.state, 'ok')
assert.equal(by.range_hood.state, 'soon') // 07-20 + 85 days = 10-13, 3 days left
assert.equal(by.range_hood.daysLeft, 3)
assert.equal(by.stove.state, 'unknown')

assert.equal(invoiceState({ status: 'sent', due_date: '2026-10-09' }, today), 'overdue')
assert.equal(invoiceState({ status: 'sent', due_date: '2026-10-31' }, today), 'open')
assert.equal(invoiceState({ status: 'paid', due_date: '2026-09-01' }, today), 'paid')
const sum = billingSummary([
  { id: 'a', status: 'sent', total: 1000, due_date: '2026-10-05' },
  { id: 'b', status: 'sent', total: 2000, due_date: '2026-10-31' },
  { id: 'c', status: 'sent', total: 500, due_date: '2026-10-20' },
  { id: 'd', status: 'paid', total: 3000, due_date: '2026-09-30', paid_at: '2026-10-02T03:00:00Z' },
], today)
assert.equal(sum.open, 3500)
assert.equal(sum.overdue, 1000)
assert.equal(sum.overdueCount, 1)
assert.equal(sum.nextDue.id, 'c')
assert.equal(sum.paidThisYear, 3000)
assert.equal(sum.recentlyPaid.id, 'd')
assert.equal(receiptNumber({ id: 'abcdef12', paid_at: '2026-10-02T00:00:00Z' }), 'R-202610-ABCDEF')
console.log('✅ client care rules OK')
