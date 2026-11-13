// v1.0.220 · planned duration + finish for any job (jobs.expected_minutes). Pure, no DB.
import assert from 'node:assert/strict'
import { endTime, minutesBetween, slotText, ownMinutes, insertJobWithMinutes, saveJobMinutes } from '../src/lib/jobDuration.js'
import { buildDayPanel } from '../src/lib/dayPanel.js'

assert.equal(endTime('09:30', 60), '10:30')
assert.equal(endTime('23:30', 90), '01:00')
assert.equal(endTime('', 60), '')
assert.equal(minutesBetween('09:30', '10:30'), 60)
assert.equal(minutesBetween('23:00', '01:00'), 120)
assert.equal(slotText('09:30', 60), '09:30 · ⏱1h · até 10:30')
assert.equal(slotText('09:30:00', 90), '09:30 · ⏱1h30 · até 11:00')
assert.equal(ownMinutes({ expected_minutes: 0 }), null)
assert.equal(ownMinutes({}), null)
assert.equal(ownMinutes({ expected_minutes: 60 }), 60)

// Painel do dia: spot with its own 1h → minutes 60; OTP deadline job unchanged (contract 0.7h → 0h42 · até 10:00)
const OTP = '7138f082-0d38-43e4-bd77-00c4598690b3'
const targets = [{ id: 1, base: 'Kodama Oimachi', service: 'Basic Cleaning', keyword: '', kind: 'weekly', days: [5], hours: 0.7 }]
const jobs = [
  { id: 'a', title: 'Air Mobility — Spot', scheduled_date: '2026-11-13', scheduled_time: '09:30', status: 'assigned', job_category: 'spot', employee_id: 'e1', employee_name: 'A', expected_minutes: 60 },
  { id: 'b', title: 'Kodama Oimachi — Basic Cleaning', client_id: OTP, scheduled_date: '2026-11-13', scheduled_time: '00:30', status: 'assigned', employee_id: 'e1', employee_name: 'A' },
  { id: 'c', title: 'Nissyoku — Spot', scheduled_date: '2026-11-13', scheduled_time: '13:00', status: 'assigned', job_category: 'spot', employee_id: 'e1', employee_name: 'A' },
]
const p = buildDayPanel({ date: '2026-11-13', jobs, employees: [{ id: 'e1', full_name: 'A', is_active: true }], targets, today: '2026-11-13', nowMin: 8 * 60 })
const svc = Object.fromEntries(p.stores.flatMap(st => st.services).map(s => [s.id, s]))
assert.equal(svc.a.minutes, 60)
assert.equal(slotText(svc.a.time, svc.a.minutes), '09:30 · ⏱1h · até 10:30')
assert.equal(svc.b.minutes, 42)
assert.equal(svc.b.deadline, '10:00')
assert.equal(svc.c.minutes, 120) // old jobs with no duration keep today's default (not changed in the DB)

// Saving without the SQL: readable error; insert falls back without the column (job never lost)
const missing = { message: "Could not find the 'expected_minutes' column of 'jobs' in the schema cache" }
const fake = (failFirst) => {
  const calls = []
  return { calls, from: () => ({
    update: row => ({ eq: async () => (calls.push(['update', row]), { error: failFirst ? missing : null }) }),
    insert: row => ({ select: () => ({ single: async () => { calls.push(['insert', row]); return 'expected_minutes' in row && failFirst ? { error: missing } : { data: { id: 'x', ...row }, error: null } } }) }),
  }) }
}
await assert.rejects(saveJobMinutes(fake(true), 'x', 60), /SQL/)
assert.equal(await saveJobMinutes(fake(false), 'x', 60), 60)
const db = fake(true)
const r = await insertJobWithMinutes(db, { title: 't', expected_minutes: 60 })
assert.equal(r.durationSaved, false)
assert.equal(r.data.title, 't')
assert.equal(db.calls.length, 2)
const ok = await insertJobWithMinutes(fake(false), { title: 't', expected_minutes: 60 })
assert.equal(ok.durationSaved, true)
console.log('job duration: ok')
