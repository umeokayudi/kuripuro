import assert from 'node:assert/strict'
import { periodRange, previousRange, inRange, matchesPeople, summarize, summarizeByPerson, changePct, fmtMinutes } from '../src/lib/jobsPeriod.js'

const today = '2026-10-11'
assert.deepEqual(periodRange('today', today), { from: today, to: today })
assert.deepEqual(periodRange('yesterday', today), { from: '2026-10-10', to: '2026-10-10' })
assert.deepEqual(periodRange('7d', today), { from: '2026-10-05', to: today })
assert.deepEqual(periodRange('30d', today), { from: '2026-09-12', to: today })
assert.equal(periodRange('all', today), null)
assert.deepEqual(periodRange('custom', today, { from: '2026-10-03', to: '2026-10-01' }), { from: '2026-10-03', to: '2026-10-03' }, 'end before start = one day')

assert.deepEqual(previousRange({ from: today, to: today }), { from: '2026-10-10', to: '2026-10-10' })
assert.deepEqual(previousRange({ from: '2026-10-05', to: today }), { from: '2026-09-28', to: '2026-10-04' })
assert.deepEqual(previousRange({ from: '2026-11-01', to: '2026-11-30' }), { from: '2026-10-02', to: '2026-10-31' })
assert.equal(previousRange(null), null)

assert.equal(inRange({ scheduled_date: '2026-10-05' }, { from: '2026-10-05', to: today }), true)
assert.equal(inRange({ scheduled_date: '2026-10-04' }, { from: '2026-10-05', to: today }), false)
assert.equal(matchesPeople({ employee_id: 'a' }, new Set()), true)
assert.equal(matchesPeople({ employee_id: null }, new Set([''])), true)
assert.equal(matchesPeople({ employee_id: 'b' }, new Set(['a'])), false)

const job = (o) => ({ status: 'completed', employee_id: 'a', employee_name: 'Ana', started_at: '2026-10-05T00:00:00Z', completed_at: '2026-10-05T01:30:00Z', ...o })
const cur = [job(), job({ completed_at: '2026-10-05T00:30:00Z' }), job({ status: 'assigned', started_at: null, completed_at: null }), job({ employee_id: 'b', employee_name: 'Bia' }), job({ status: 'cancelled' })]
const s = summarize(cur)
assert.equal(s.total, 4)
assert.equal(s.done, 3)
assert.equal(s.minutes, 210)
assert.equal(s.avgMin, 70)

const rows = summarizeByPerson(cur, [job({ employee_id: 'b', employee_name: 'Bia', completed_at: '2026-10-05T00:45:00Z' })])
assert.equal(rows[0].id, 'a')
assert.equal(rows[0].cur.minutes, 120)
assert.equal(rows[1].prev.minutes, 45)

assert.equal(changePct(120, 100), 20)
assert.equal(changePct(5, 0), null)
assert.equal(fmtMinutes(45), '45min')
assert.equal(fmtMinutes(125), '2h 05min')
assert.equal(fmtMinutes(120), '2h')
console.log('jobs period: ok')

// v1.0.69 — upcoming periods, next job per employee, location frequency
import { nextJobsByEmployee, locationStats, contractDaysByLocation, jobLocationName } from '../src/lib/jobsBoard.js'
assert.deepEqual(periodRange('tomorrow', today), { from: '2026-10-12', to: '2026-10-12' })
assert.deepEqual(periodRange('next7', today), { from: today, to: '2026-10-17' })
{
  const J = (o) => ({ status: 'assigned', title: 'Tooda — Basic Cleaning', scheduled_time: '00:30', ...o })
  const list = [
    J({ id: 1, employee_id: 'a', scheduled_date: '2026-10-10' }), // past: ignored
    J({ id: 2, employee_id: 'a', scheduled_date: '2026-10-13' }),
    J({ id: 3, employee_id: 'a', scheduled_date: today, status: 'completed' }), // done: ignored
    J({ id: 4, employee_id: 'a', scheduled_date: today, scheduled_time: '21:00' }),
    J({ id: 5, employee_id: null, scheduled_date: '2026-10-12' }),
    J({ id: 6, employee_id: 'b', scheduled_date: '2026-10-30' }),
  ]
  const { rows, unassigned } = nextJobsByEmployee(list, [{ id: 'b', full_name: 'Bia' }, { id: 'a', full_name: 'Ana' }, { id: 'c', full_name: 'Caio' }], today)
  assert.equal(rows[0].id, 'a')
  assert.equal(rows[0].next.id, 4)
  assert.equal(rows[0].today, 1)
  assert.equal(rows[0].week, 2)
  assert.equal(rows[1].next.id, 6)
  assert.equal(rows[1].week, 0)
  assert.equal(rows[2].next, null)
  assert.deepEqual(unassigned.map(j => j.id), [5])

  assert.equal(jobLocationName({ title: 'Kodama Shinbashi — Deep Clean' }), 'Kodama Shinbashi')
  const cd = contractDaysByLocation([{ location_name: 'Tooda', days_of_week: ['Mon', 'Wed', 'Fri'] }])
  assert.deepEqual(cd.Tooda, [1, 3, 5])
  const ls = locationStats([...list, J({ title: 'Ibushio — Deep Clean', scheduled_date: '2026-10-12' }), J({ title: 'Ibushio — Deep Clean', scheduled_date: '2026-10-14' })], cd, 7)
  const tooda = ls.find(r => r.name === 'Tooda')
  assert.equal(tooda.perWeek, 3)
  assert.equal(tooda.fromContract, true)
  const ibu = ls.find(r => r.name === 'Ibushio')
  assert.equal(ibu.perWeek, 2)
  assert.deepEqual(ibu.dows, [1, 3])
}
console.log('jobs board ok')
