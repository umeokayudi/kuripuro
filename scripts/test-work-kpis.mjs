import assert from 'node:assert/strict'
import { jobDurationMin, startDelayMin, gpsCheck, summarizeJobs, summarizeByEmployee, weeklyEvolution, formatMinutes } from '../src/lib/workKpis.js'

const job = (o) => ({ status: 'completed', scheduled_date: '2026-10-05', scheduled_time: '09:00', ...o })

assert.equal(jobDurationMin(job({ started_at: '2026-10-05T00:00:00Z', completed_at: '2026-10-05T00:45:00Z' })), 45)
assert.equal(jobDurationMin(job({ started_at: '2026-10-05T00:00:00Z', completed_at: '2026-10-06T00:45:00Z' })), null, 'over 12h is ignored')
assert.equal(jobDurationMin(job({ started_at: null })), null)

// 09:00 Tokyo = 00:00 UTC
assert.equal(startDelayMin(job({ started_at: '2026-10-05T00:20:00Z' })), 20)
assert.equal(startDelayMin(job({ started_at: '2026-10-04T23:50:00Z' })), -10)
assert.equal(startDelayMin(job({ scheduled_time: '', started_at: '2026-10-05T00:20:00Z' })), null)

assert.equal(gpsCheck(job({ gps_start_distance: 40 })), 'on_site')
assert.equal(gpsCheck(job({ gps_start_distance: 900 })), 'away')
assert.equal(gpsCheck(job({ start_lat: 35.6 })), 'captured')
assert.equal(gpsCheck(job({})), null)

const jobs = [
  job({ employee_id: 1, employee_name: 'Ana', started_at: '2026-10-05T00:05:00Z', completed_at: '2026-10-05T00:45:00Z', gps_start_distance: 30, checklist_total: 10, checklist_done: 10 }),
  job({ employee_id: 1, employee_name: 'Ana', started_at: '2026-10-05T00:30:00Z', completed_at: '2026-10-05T01:30:00Z', gps_start_distance: 500, checklist_total: 10, checklist_done: 5 }),
  job({ employee_id: 2, employee_name: 'Bia', status: 'assigned' }),
]
const s = summarizeJobs(jobs)
assert.equal(s.completed, 2)
assert.equal(s.avgMin, 50)
assert.equal(s.totalMin, 100)
assert.equal(s.onTimePct, 50)
assert.equal(s.gpsPct, 50)
assert.equal(s.gpsAway, 1)
assert.equal(s.checklistPct, 75)

const people = summarizeByEmployee(jobs)
assert.equal(people.length, 1)
assert.equal(people[0].name, 'Ana')

const weeks = weeklyEvolution(jobs, '2026-10-09', 4)
assert.equal(weeks.length, 4)
assert.equal(weeks[3].week, '2026-10-05')
assert.equal(weeks[3].completed, 2)
assert.equal(weeks[0].completed, 0)

assert.equal(formatMinutes(75), '1h 15m')
assert.equal(formatMinutes(null), '—')
console.log('✅ work KPI rules OK')
