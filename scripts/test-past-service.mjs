#!/usr/bin/env node
import { checklistCompleteForRetro, isJobFullyRegistered, isManualServiceAllowedOnDate, possibleManualDates, snapToPossibleDate, manualAddLocations, formatManualServiceDays } from '../src/lib/employeeAddJob.js'
import { resolveChecklistForJob, initChecklistState } from '../src/lib/jobChecklist.js'
import { weekdayOfYmd } from '../src/lib/dates.js'

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

const atomic = manualAddLocations().find(l => l.name === 'Atomic Bar')
const oimachi = manualAddLocations().find(l => l.name === 'Kodama Oimachi')
const ibushio = manualAddLocations().find(l => l.name === 'Ibushio')
const kinshicho = manualAddLocations().find(l => l.name === 'Kodama Kinshicho')
const matsunaga = manualAddLocations().find(l => l.name === 'Matsunaga')
assert(atomic && oimachi && ibushio && kinshicho && matsunaga, 'catalog locations loaded')

assert(isManualServiceAllowedOnDate(atomic, '2026-09-14', 'basic') === true, 'Atomic Monday')
assert(isManualServiceAllowedOnDate(atomic, '2026-09-16', 'basic') === false, 'Atomic not Wednesday')
assert(isManualServiceAllowedOnDate(oimachi, '2026-09-14', 'basic') === false, 'Oimachi rest Monday')
assert(isManualServiceAllowedOnDate(oimachi, '2026-09-15', 'basic') === true, 'Oimachi Tuesday')
assert(isManualServiceAllowedOnDate(ibushio, '2026-09-16', 'basic') === false, 'deep-only has no basic')
assert(isManualServiceAllowedOnDate(ibushio, '2026-09-16', 'deep') === true, 'Ibushio deep Wednesday')
assert(isManualServiceAllowedOnDate(ibushio, '2026-09-15', 'deep') === false, 'Ibushio not Tuesday')
assert(isManualServiceAllowedOnDate(kinshicho, '2026-09-15', 'deep') === true, 'Kinshicho deep Tuesday')
assert(isManualServiceAllowedOnDate(kinshicho, '2026-09-16', 'deep') === false, 'Kinshicho deep not Wednesday')
assert(isManualServiceAllowedOnDate(matsunaga, '2026-09-17', 'basic') === true, 'Matsunaga any day')

const mondays = possibleManualDates({ cleaningType: 'basic', fromYmd: '2026-09-14', toYmd: '2026-09-14', location: atomic })
assert(mondays[0] === '2026-09-14', `atomic possible monday ${mondays}`)

const deepWeek = possibleManualDates({ cleaningType: 'deep', fromYmd: '2026-09-14', toYmd: '2026-09-17' })
assert(deepWeek.includes('2026-09-14') && deepWeek.includes('2026-09-15') && deepWeek.includes('2026-09-16'), `deep week ${deepWeek}`)
assert(!deepWeek.includes('2026-09-17'), 'deep not Thursday')

assert(snapToPossibleDate('2026-09-17', 'deep') === '2026-09-16', 'snap Thursday deep to Wednesday')
assert(weekdayOfYmd('2026-09-17') === 4, 'Thu=4')

assert(formatManualServiceDays(atomic, 'basic', 'en') === 'Mon', 'Atomic days label')
assert(formatManualServiceDays(oimachi, 'basic', 'en') === 'Sun · Tue · Wed · Thu · Fri · Sat', 'Oimachi rest Monday')
assert(formatManualServiceDays(ibushio, 'deep', 'en') === 'Mon · Wed', 'Ibushio deep days')
assert(formatManualServiceDays(kinshicho, 'deep', 'en') === 'Tue', 'Kinshicho deep Tuesday')
assert(formatManualServiceDays(kinshicho, 'basic', 'en') === 'Every day', 'Kinshicho every day')
assert(formatManualServiceDays(matsunaga, 'basic', 'ja') === '毎日', 'Matsunaga any day JA')

const job = { title: 'Kodama Oimachi — Basic Cleaning' }
const full = initChecklistState(job)
assert(full.length === 10, `kodama basic checklist: ${full.length}`)
const partial = full.slice(-3).map(c => ({ ...c, done: true }))
const merged = resolveChecklistForJob(job, partial)
assert(merged.length === 10, `merged checklist length: ${merged.length}`)
assert(merged.filter(c => c.done).length === 3, 'preserved 3 done ticks')

console.log('✅ All past-service unit tests passed')
