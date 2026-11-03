import assert from 'node:assert/strict'
import { dismissKey } from '../src/lib/scheduleDismissals.js'
import { countJobs } from '../src/lib/jobCounts.js'
import { teamCostByClient } from '../src/lib/money.js'

// v1.0.133 · a discarded suggestion is keyed by date / store / type (any person, any time)
const a = { date: '2026-11-04', title: 'Ibushio — Deep Clean', key: 't1', employeeId: 'g' }
const b = { date: '2026-11-04', title: 'Ibushio — Deep Clean', key: 'c9', employeeId: null, time: '02:00' }
assert.equal(dismissKey(a), dismissKey(b))
assert.notEqual(dismissKey(a), dismissKey({ ...a, date: '2026-11-08' }))
assert.notEqual(dismissKey(a), dismissKey({ ...a, title: 'Ibushio — Basic Cleaning' }))

// one job counter: assigned ≤ scheduled, cancelled / test out, not started counts late ones too
const jobs = [
  { id: 1, status: 'assigned', employee_id: 'x', scheduled_date: '2026-11-03', scheduled_time: '01:00' },
  { id: 2, status: 'assigned', employee_id: null, scheduled_date: '2026-11-03', scheduled_time: '23:00' },
  { id: 3, status: 'completed', employee_id: 'x', scheduled_date: '2026-11-03' },
  { id: 4, status: 'cancelled', employee_id: 'x', scheduled_date: '2026-11-03' },
  { id: 5, status: 'in_progress', employee_id: 'x', scheduled_date: '2026-11-03', started_at: 'x' },
  { id: 6, status: 'assigned', employee_id: 'x', scheduled_date: '2026-11-03', employee_name: 'TESTE Funcionario' },
]
const c = countJobs(jobs, { from: '2026-11-03', to: '2026-11-03', today: '2026-11-03', nowMin: 600 })
assert.deepEqual([c.scheduled, c.assigned, c.completed, c.pending, c.notStarted, c.late, c.inProgress], [4, 3, 1, 3, 2, 1, 1])

// client cost = the job's own pay for a per-job person (not a minute share), unknown → null
const emp = [{ id: 'g', salary_type: 'per_job', fixed_salary: 0, job_bonus_rate: 0 }, { id: 'z', salary_type: 'fixed', fixed_salary: 0 }]
const done = [
  { id: 'a', status: 'completed', employee_id: 'g', client_id: 'atomic', scheduled_date: '2026-10-26', value: 6000, retro_time_min: 10 },
  { id: 'b', status: 'completed', employee_id: 'g', client_id: 'otp', scheduled_date: '2026-10-27', value: 4000, retro_time_min: 300 },
  { id: 'c', status: 'completed', employee_id: 'z', client_id: 'none', scheduled_date: '2026-10-27', value: 4000 },
]
const cost = teamCostByClient({ jobs: done, employees: emp, month: '2026-10' })
assert.equal(cost.atomic, 6000)
assert.equal(cost.otp, 4000)
assert.equal(cost.none, null)
console.log('schedule dismiss + job counts + client cost: ok')
