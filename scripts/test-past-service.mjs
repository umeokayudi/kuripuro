#!/usr/bin/env node
import { checklistCompleteForRetro, isJobFullyRegistered } from '../src/lib/employeeAddJob.js'
import { recentTokyoDates, tokyoToday } from '../src/lib/dates.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

console.log('=== Past service unit tests ===\n')

assert(checklistCompleteForRetro([]) === true, 'empty checklist ok')
assert(checklistCompleteForRetro(null) === true, 'null checklist ok')
assert(checklistCompleteForRetro([{ done: true }, { done: true }, { done: false }]) === false, '3 items need all')
assert(checklistCompleteForRetro([{ done: true }, { done: true }, { done: true }]) === true, '3 items all done')

const tenNeed7 = Array.from({ length: 10 }, (_, i) => ({ done: i < 7 }))
assert(checklistCompleteForRetro(tenNeed7) === true, '10 items 7/10 ok')
const tenNeed6 = Array.from({ length: 10 }, (_, i) => ({ done: i < 6 }))
assert(checklistCompleteForRetro(tenNeed6) === false, '10 items 6/10 fail')

assert(isJobFullyRegistered({ status: 'completed', retro_report: 'done' }) === true, 'retro_report counts')
assert(isJobFullyRegistered({ status: 'completed', photo_end_url: 'x', completed_at: 't' }) === true, 'photo+completed counts')
assert(isJobFullyRegistered({ status: 'completed' }) === false, 'bare completed not registered')
assert(isJobFullyRegistered({ status: 'assigned' }) === false, 'assigned not registered')

const dates = recentTokyoDates(3)
assert(dates[0] === tokyoToday(), 'first date is today')
assert(dates.length === 3, 'returns requested count')

console.log('✅ All past-service unit tests passed')
