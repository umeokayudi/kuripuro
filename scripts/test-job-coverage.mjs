// v1.0.148 · "Coberto por outro" — node scripts/test-job-coverage.mjs
import assert from 'node:assert/strict'
import { coveredJobs, coverKey, removeCoverPatch, keepCoverPatch, suggestedPayForB, withoutCovered } from '../src/lib/jobCoverage.js'
import { countJobs } from '../src/lib/jobCounts.js'

const A = 'guilherme', B = 'gabriel'
const jobs = [
  { id: 'a1', employee_id: A, employee_name: 'Guilherme', status: 'assigned', scheduled_date: '2026-11-02', title: 'Kodama Shinbashi — Basic Cleaning', employee_pay: 1000 },
  { id: 'b1', employee_id: B, employee_name: 'Gabriel', status: 'completed', scheduled_date: '2026-11-02', title: 'Kodama Shinbashi — Basic Cleaning', employee_pay: null },
  // deep on A vs basic done by B: NOT the same service
  { id: 'a2', employee_id: A, employee_name: 'Guilherme', status: 'assigned', scheduled_date: '2026-11-03', title: 'Nyu Sakana Yakio — Deep Clean (Grease Trap)' },
  { id: 'b2', employee_id: B, employee_name: 'Gabriel', status: 'completed', scheduled_date: '2026-11-03', title: 'Nyu Sakana Yakio — Basic Cleaning' },
  // same person twice is not a cover
  { id: 'a3', employee_id: B, employee_name: 'Gabriel', status: 'assigned', scheduled_date: '2026-11-03', title: 'Nyu Sakana Yakio — Basic Cleaning' },
  // kept by the owner: never flagged again
  { id: 'a4', employee_id: A, employee_name: 'Guilherme', status: 'assigned', scheduled_date: '2026-11-02', title: 'Kodama Shinbashi — Basic Cleaning', description: '⟲ Cobertura: mantido (dono) em 03/11/2026' },
]
const cov = coveredJobs(jobs)
assert.equal(cov.size, 1, 'only a1 is covered')
assert.equal(cov.get('a1').id, 'b1')
assert.notEqual(coverKey(jobs[2]), coverKey(jobs[3]), 'deep ≠ basic')
assert.equal(withoutCovered(jobs).length, jobs.length - 1)

// counters: the covered job is not pending or late, the service counts once
const c = countJobs(jobs.filter(j => j.scheduled_date === '2026-11-02'), { from: '2026-11-02', to: '2026-11-02', today: '2026-11-03', nowMin: 600, keepTests: true })
assert.equal(c.covered, 1)
assert.equal(c.scheduled, 2, 'b1 + a4 (kept) — a1 not counted twice')
assert.equal(c.completed, 1)
assert.equal(c.late, 1, 'only the kept a4 can be late')

// owner decisions
const rm = removeCoverPatch(jobs[0], jobs[1], { owner: 'Yudi', today: '2026-11-05' })
assert.equal(rm.status, 'cancelled')
assert.match(rm.description, /Baixado por autorização do dono \(Yudi\) em 05\/11\/2026 — executado por Gabriel/)
const keep = keepCoverPatch(jobs[0], jobs[1], { owner: 'Yudi', today: '2026-11-05' })
assert.equal(keep.status, undefined, 'keep never changes the status')
assert.equal(coveredJobs([{ ...jobs[0], ...keep }, jobs[1]]).size, 0, 'kept → not asked again')
assert.equal(suggestedPayForB(jobs[0], jobs[1]), 1000)
assert.equal(suggestedPayForB(jobs[0], { ...jobs[1], employee_pay: 900 }), null, 'B already has pay')
console.log('job coverage: all passed')
