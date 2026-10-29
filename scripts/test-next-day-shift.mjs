#!/usr/bin/env node
/** Pure checks for the next-day shift rules. Run: npx vite-node scripts/test-next-day-shift.mjs */
import { validateShiftWindow, upcomingJobs, addDays } from '../src/lib/nextDayShift.js'
import { buildAddServiceOptions } from '../src/lib/employeeAddJob.js'

let failed = 0
const check = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) failed++ }

check(validateShiftWindow('00:30', '05:00').ok, '00:30–05:00 ok')
check(validateShiftWindow('22:00', '06:00').ok, '22:00–06:00 crosses midnight, ok')
check(validateShiftWindow('03:00', '09:00').ok, 'ends exactly 09:00 ok')
check(validateShiftWindow('05:00', '09:30').error === 'shift_end_after_limit', 'ends 09:30 refused')
check(validateShiftWindow('10:00', '14:00').error === 'shift_end_after_limit', 'day shift refused')
check(validateShiftWindow('05:00', '04:00').error === 'shift_time_invalid', 'end before start (23h) refused')
check(validateShiftWindow('05:00', '05:00').error === 'shift_time_invalid', 'zero length refused')
check(validateShiftWindow('', '05:00').error === 'shift_time_invalid', 'empty start refused')
check(addDays('2026-10-31', 1) === '2026-11-01', 'addDays month turn')

const jobs = [
  { id: 'a', scheduled_date: '2026-10-29', scheduled_time: '00:30', status: 'completed' },
  { id: 'b', scheduled_date: '2026-10-30', scheduled_time: '02:00', status: 'assigned' },
  { id: 'c', scheduled_date: '2026-10-30', scheduled_time: '00:30', status: 'assigned' },
  { id: 'd', scheduled_date: '2026-10-30', status: 'assigned', job_category: 'spot', spot_status: 'pending' },
  { id: 'e', scheduled_date: '2026-10-31', scheduled_time: '00:30', status: 'cancelled' },
]
check(upcomingJobs(jobs, '2026-10-29').map(j => j.id).join() === 'c,b', 'upcoming = tomorrow jobs sorted, no pending spot/cancelled/today')

const loc = [{ name: 'Horumon no Manmosu' }]
const other = [{ id: 'x', title: 'Horumon no Manmosu', employee_id: 'someone', employee_name: 'Sasaki', status: 'assigned' }]
check(buildAddServiceOptions(loc, other, 'me')[0].state === 'transfer', 'today: coworker job can be taken')
check(buildAddServiceOptions(loc, other, 'me', 'basic', { allowTransfer: false })[0].state === 'blocked', 'tomorrow: coworker job is blocked')

if (failed) { console.error(`${failed} failed`); process.exit(1) }
console.log('All next-day shift checks passed')
