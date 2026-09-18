#!/usr/bin/env node
/**
 * Unit tests: every catalog location appears in add-service, classified
 * by weekday / type. No production job writes.
 */
import {
  ADD_OPTION_SORT,
  buildAddServiceOptions,
  classifyAddServiceLocation,
  isAddServiceActionable,
  isManualServiceAllowedOnDate,
  manualAddLocations,
} from '../src/lib/employeeAddJob.js'
import { jobPinFieldsForLocation, liveFocusJob } from '../src/lib/jobGps.js'
import { OTP_DEEP_ONLY_NAMES } from '../src/lib/serviceCatalog.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function byName(rows) {
  return Object.fromEntries(rows.map(r => [r.location.name, r]))
}

function namesOf(rows, state) {
  return rows.filter(r => r.state === state).map(r => r.location.name).sort()
}

console.log('=== Add-service options (all locations, no DB writes) ===\n')

const catalog = manualAddLocations()
const catalogNames = catalog.map(l => l.name)
assert(catalog.length === 14, `catalog has 14 locations, got ${catalog.length}: ${catalogNames.join(', ')}`)
for (const name of OTP_DEEP_ONLY_NAMES) {
  assert(catalog.some(l => l.name === name && l.deepOnly), `${name} is deep-only in catalog`)
}
assert(catalog.some(l => l.name === 'Atomic Bar' && l.group === 'Atomic'), 'Atomic Bar in catalog')
assert(catalog.some(l => l.name === 'Matsunaga' && l.group === 'Spot'), 'Matsunaga spot in catalog')
assert(catalog.some(l => l.name === 'Kodama Oimachi'), 'Kodama Oimachi in catalog')

const FRI = '2026-09-18' // Friday
const MON = '2026-09-14' // Monday
const TUE = '2026-09-15' // Tuesday
const WED = '2026-09-16' // Wednesday
const SUN = '2026-09-13' // Sunday
const me = 'emp-me'
const other = 'emp-other'

const emptyFriBasic = buildAddServiceOptions(catalog, [], me, 'basic', FRI)
assert(emptyFriBasic.length === catalog.length, 'Friday basic lists every location')
assert([...new Set(emptyFriBasic.map(r => r.location.name))].length === catalog.length, 'no duplicate locations')

const fri = byName(emptyFriBasic)
assert(fri['Atomic Bar'].state === 'wrong_day', 'Atomic Bar Friday basic = wrong_day')
assert(fri.Ibushio.state === 'wrong_type' && fri.Ibushio.reason === 'deep_only', 'Ibushio Friday basic = deep_only')
assert(fri['Nyu Ibushio'].state === 'wrong_type', 'Nyu Ibushio Friday basic = wrong_type')
assert(fri['Horumon no Manmosu'].state === 'wrong_type', 'Horumon Friday basic = wrong_type')
assert(fri['Yakiniku Otoko Manmosu'].state === 'wrong_type', 'Yakiniku Friday basic = wrong_type')
assert(fri['Kodama Shinbashi'].state === 'available', 'Kodama Shinbashi Friday basic available')
assert(fri['Kodama Oimachi'].state === 'available', 'Kodama Oimachi TUE_SUN includes Friday')
assert(fri['Kodama Yurakucho'].state === 'available', 'Kodama Yurakucho Friday available')
assert(fri.Matsunaga.state === 'available', 'Matsunaga any-day spot available Friday')
assert(fri['Sakana Yakio Honten'].state === 'available', 'Sakana Yakio Honten MON_SAT includes Friday')
assert(isAddServiceActionable(fri['Kodama Shinbashi'].state), 'available is actionable')
assert(!isAddServiceActionable(fri['Atomic Bar'].state), 'wrong_day is not actionable')
assert(!isAddServiceActionable(fri.Ibushio.state), 'wrong_type is not actionable')

const friAvailable = namesOf(emptyFriBasic, 'available')
assert(friAvailable.length === 9, `Friday basic available = 8 OTP + Matsunaga, got ${friAvailable.length}: ${friAvailable.join(', ')}`)

const emptyMonBasic = buildAddServiceOptions(catalog, [], me, 'basic', MON)
const mon = byName(emptyMonBasic)
assert(mon['Atomic Bar'].state === 'available', 'Atomic Bar Monday only — available Monday')
assert(mon['Kodama Oimachi'].state === 'wrong_day', 'Kodama Oimachi closed Monday')
assert(mon['Kodama Yurakucho'].state === 'wrong_day', 'Kodama Yurakucho closed Monday')
assert(mon.Ibushio.state === 'wrong_type', 'Ibushio still deep-only on Monday basic')
assert(mon.Matsunaga.state === 'available', 'Matsunaga Monday available')
assert(namesOf(emptyMonBasic, 'available').includes('Atomic Bar'), 'Atomic listed as available Monday')

const emptySunBasic = buildAddServiceOptions(catalog, [], me, 'basic', SUN)
const sun = byName(emptySunBasic)
assert(sun['Atomic Bar'].state === 'wrong_day', 'Atomic closed Sunday')
assert(sun['Kodama Oimachi'].state === 'available', 'Oimachi TUE_SUN includes Sunday')
assert(sun['Sakana Yakio Honten'].state === 'wrong_day', 'Sakana Yakio Honten MON_SAT closed Sunday')
assert(sun.Matsunaga.state === 'available', 'Matsunaga Sunday available')

const friDeep = byName(buildAddServiceOptions(catalog, [], me, 'deep', FRI))
assert(friDeep.Ibushio.state === 'wrong_day', 'deep-only not on Friday')
assert(friDeep['Kodama Shinbashi'].state === 'wrong_day', 'OTP basic deep is Tuesday')
assert(friDeep['Atomic Bar'].state === 'wrong_type' && friDeep['Atomic Bar'].reason === 'deep_not_available', 'Atomic has no deep')
assert(friDeep.Matsunaga.state === 'wrong_type' && friDeep.Matsunaga.reason === 'deep_not_available', 'Matsunaga has no deep')

const monDeep = byName(buildAddServiceOptions(catalog, [], me, 'deep', MON))
assert(monDeep.Ibushio.state === 'available', 'Ibushio deep Mon+Wed')
assert(monDeep['Nyu Ibushio'].state === 'available', 'Nyu Ibushio deep Monday')
assert(monDeep['Kodama Shinbashi'].state === 'wrong_day', 'Kodama Shinbashi deep is Tuesday')
assert(monDeep['Atomic Bar'].state === 'wrong_type', 'Atomic still no deep Monday')

const tueDeep = byName(buildAddServiceOptions(catalog, [], me, 'deep', TUE))
assert(tueDeep['Kodama Shinbashi'].state === 'available', 'Kodama Shinbashi deep Tuesday')
assert(tueDeep['Kodama Oimachi'].state === 'available', 'Kodama Oimachi deep Tuesday')
assert(tueDeep.Ibushio.state === 'wrong_day', 'Ibushio not Tuesday')
assert(tueDeep['Atomic Bar'].state === 'wrong_type', 'Atomic no deep Tuesday')

const wedDeep = byName(buildAddServiceOptions(catalog, [], me, 'deep', WED))
assert(wedDeep.Ibushio.state === 'available', 'Ibushio deep Wednesday')
assert(wedDeep['Horumon no Manmosu'].state === 'available', 'Horumon deep Wednesday')
assert(wedDeep['Kodama Shinbashi'].state === 'wrong_day', 'Kodama Shinbashi not Wednesday deep')

const cls = classifyAddServiceLocation(catalog.find(l => l.name === 'Atomic Bar'), FRI, 'basic')
assert(cls.state === 'wrong_day', 'classify Atomic Friday')
assert(classifyAddServiceLocation(catalog.find(l => l.name === 'Ibushio'), FRI, 'basic').reason === 'deep_only', 'classify Ibushio basic')
assert(isManualServiceAllowedOnDate(catalog.find(l => l.name === 'Atomic Bar'), MON, 'basic'), 'Atomic allowed Monday')
assert(!isManualServiceAllowedOnDate(catalog.find(l => l.name === 'Atomic Bar'), FRI, 'basic'), 'Atomic blocked Friday')

const jobs = [
  { id: 'm1', title: 'Kodama Shinbashi — Basic Cleaning', employee_id: me, employee_name: 'Me', status: 'assigned', scheduled_date: FRI },
  { id: 'c1', title: 'Tooda — Basic Cleaning', employee_id: null, status: 'assigned', scheduled_date: FRI },
  { id: 't1', title: 'Sakana Yakio 2 — Basic Cleaning', employee_id: other, employee_name: 'Alex', status: 'assigned', scheduled_date: FRI, started_at: null },
  { id: 'b1', title: 'Nyu Sakana Yakio — Basic Cleaning', employee_id: other, employee_name: 'Alex', status: 'in_progress', scheduled_date: FRI, started_at: '2026-09-18T00:10:00Z' },
  { id: 'd1', title: 'Kodama Kinshicho — Basic Cleaning', employee_id: other, employee_name: 'Alex', status: 'completed', scheduled_date: FRI },
]
const withJobs = byName(buildAddServiceOptions(catalog, jobs, me, 'basic', FRI))
assert(withJobs['Kodama Shinbashi'].state === 'mine', 'mine wins over available')
assert(withJobs.Tooda.state === 'claim', 'unassigned = claim')
assert(withJobs['Sakana Yakio 2'].state === 'transfer' && withJobs['Sakana Yakio 2'].fromEmployee === 'Alex', 'assigned to other = transfer')
assert(withJobs['Nyu Sakana Yakio'].state === 'blocked', 'in_progress = blocked')
assert(withJobs['Kodama Kinshicho'].state === 'done_today', 'completed = done_today')
assert(withJobs['Atomic Bar'].state === 'wrong_day', 'job-less Atomic still wrong_day Friday')
assert(isAddServiceActionable('claim') && isAddServiceActionable('transfer') && isAddServiceActionable('done_today'), 'claim/transfer/done_today actionable')
assert(!isAddServiceActionable('mine') && !isAddServiceActionable('blocked'), 'mine/blocked not addable')

const sorted = buildAddServiceOptions(catalog, jobs, me, 'basic', FRI)
assert(ADD_OPTION_SORT[sorted[0].state] <= ADD_OPTION_SORT[sorted[sorted.length - 1].state], 'rows sorted by ADD_OPTION_SORT')

const pinFromUrl = jobPinFieldsForLocation({
  name: 'Pin Store',
  address: 'https://www.google.com/maps/@35.666123,139.758456,17z',
})
assert(pinFromUrl.gps_lat === 35.666123 && pinFromUrl.gps_lng === 139.758456, 'pin from maps @url')

const pinFromFields = jobPinFieldsForLocation({ name: 'Pinned', gps_lat: 35.67, gps_lng: 139.76 })
assert(pinFromFields.gps_lat === 35.67 && pinFromFields.gps_lng === 139.76, 'pin from gps_lat/lng')

assert(Object.keys(jobPinFieldsForLocation({ name: 'Matsunaga', address: '' })).length === 0, 'empty address yields no pin')
assert(Object.keys(jobPinFieldsForLocation(null)).length === 0, 'null location yields no pin')

const focus = liveFocusJob([
  { id: 'a', status: 'assigned', sequence_order: 2, title: 'Second' },
  { id: 'b', status: 'in_progress', sequence_order: 9, title: 'Working' },
  { id: 'c', status: 'assigned', sequence_order: 1, title: 'First' },
])
assert(focus?.id === 'b', 'in_progress is live focus')

const idleFocus = liveFocusJob([
  { id: 'a', status: 'assigned', sequence_order: 2, title: 'Second' },
  { id: 'c', status: 'assigned', sequence_order: 1, title: 'First' },
  { id: 'd', status: 'completed', sequence_order: 0, title: 'Done' },
])
assert(idleFocus?.id === 'c', 'next assigned by sequence_order')
assert(liveFocusJob([]) == null, 'no jobs = no focus')
assert(liveFocusJob([{ id: 'x', status: 'cancelled' }]) == null, 'cancelled only = no focus')

console.log(`✅ ${catalog.length} locations listed every time`)
console.log(`✅ Friday basic: ${namesOf(emptyFriBasic, 'available').length} addable, Atomic wrong_day, 4 deep-only`)
console.log('✅ Monday: Atomic available, Oimachi/Yurakucho closed, deep-only on deep days')
console.log('✅ job/claim/transfer/blocked/done_today + GPS pin + live focus')
console.log('\n✅ All add-service option tests passed')
