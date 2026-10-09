import assert from 'node:assert/strict'
import { weekStartOf, isLocked, plannerWeeks, targetPlanWeek, planningAlert, diffWeek, nextKind, unplannedEmployees } from '../src/lib/availability.js'

// 2026-10-09 is a Friday
assert.equal(weekStartOf('2026-10-09'), '2026-10-05')
assert.equal(weekStartOf('2026-10-11'), '2026-10-05') // Sunday
assert.equal(weekStartOf('2026-10-12'), '2026-10-12')

const today = '2026-10-09'
assert.equal(isLocked('2026-10-15', today), true)
assert.equal(isLocked('2026-10-16', today), false)
assert.deepEqual(plannerWeeks(today, 2), ['2026-10-12', '2026-10-19'])
assert.equal(targetPlanWeek(today), '2026-10-19')
assert.equal(targetPlanWeek('2026-10-05'), '2026-10-12') // Monday + 7 is itself a Monday

const alert = planningAlert([], today)
assert.equal(alert.week, '2026-10-19')
assert.equal(alert.deadline, '2026-10-12')
assert.equal(alert.daysLeft, 3)
assert.equal(alert.level, 'reminder')
assert.equal(planningAlert([], '2026-10-11').level, 'urgent')
assert.equal(planningAlert([{ week_start: '2026-10-19' }], today), null)

const saved = [
  { date: '2026-10-20', kind: 'off', status: 'approved' },
  { date: '2026-10-21', kind: 'extra', status: 'pending' },
]
const { upserts, deletes } = diffWeek({
  draft: { '2026-10-14': 'off', '2026-10-20': 'off', '2026-10-21': 'available', '2026-10-22': 'extra' },
  saved, today, employee: { id: 'e1', name: 'Ana' },
})
assert.deepEqual(upserts.map(u => [u.date, u.kind]), [['2026-10-22', 'extra']]) // 10-14 locked, 10-20 unchanged
assert.deepEqual(deletes, ['2026-10-21'])

assert.equal(nextKind('available'), 'off')
assert.equal(nextKind('extra'), 'available')
assert.deepEqual(unplannedEmployees([{ id: 'a' }, { id: 'b' }], [{ employee_id: 'a', week_start: '2026-10-19' }], today).map(e => e.id), ['b'])

console.log('✅ availability rules OK')
