#!/usr/bin/env node
import {
  GEOFENCE_M,
  catalogLocationHints,
  checkJobGeofence,
  employeePresencePatch,
  evaluateGeofence,
  fenceOk,
  isLocationFresh,
  jobGpsWriteFields,
  liveDistanceToJob,
  liveFocusJob,
  mapsPointUrl,
  mergeLocationHints,
  resolveJobTarget,
  resolveJobTargetSync,
  staffWorkStatus,
  summarizeStaffStatus,
  jobPinFieldsForLocation,
} from '../src/lib/jobGps.js'
import { distanceMeters, parseCoordsFromUrl, validCoords } from '../src/lib/geocode.js'
import { isMissingColumnError } from '../src/lib/schemaError.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function almost(a, b, tol = 8) {
  return Math.abs(a - b) <= tol
}

console.log('=== Job GPS / geofence unit tests ===\n')

assert(GEOFENCE_M === 100, 'fence is 100m')
assert(validCoords(35.666, 139.758), 'tokyo ok')
assert(!validCoords(0, 0), '0,0 rejected')
assert(!validCoords(91, 0), 'lat range')
assert(!validCoords('x', 1), 'non numeric')

const fromAt = parseCoordsFromUrl('https://www.google.com/maps/@35.666123,139.758456,17z')
assert(fromAt && fromAt.lat === 35.666123 && fromAt.lng === 139.758456, '@lat,lng')

const fromQ = parseCoordsFromUrl('https://www.google.com/maps?q=35.67,139.76')
assert(fromQ && fromQ.lat === 35.67 && fromQ.lng === 139.76, 'q=lat,lng')

const from3d = parseCoordsFromUrl('https://www.google.com/maps/place/Foo/data=!3d35.665!4d139.757')
assert(from3d && from3d.lat === 35.665 && from3d.lng === 139.757, '!3d!4d')

const store = { lat: 35.666400, lng: 139.758300 }
const onSite = { lat: 35.666410, lng: 139.758310 }
const near = { lat: 35.667100, lng: 139.758300 } // ~78m north
const far = { lat: 35.668500, lng: 139.758300 } // ~233m north

const dNear = distanceMeters(store.lat, store.lng, near.lat, near.lng)
const dFar = distanceMeters(store.lat, store.lng, far.lat, far.lng)
assert(dNear < 100, `near should be under 100m, got ${dNear}`)
assert(dFar > 100, `far should be over 100m, got ${dFar}`)
assert(almost(distanceMeters(store.lat, store.lng, store.lat, store.lng), 0, 1), 'same point is 0')

const within = evaluateGeofence({ ...onSite, acc: 12 }, store)
assert(within.ok && within.reason === 'within', 'on site is ok')

const nearOk = evaluateGeofence(near, store)
assert(nearOk.ok && nearOk.distanceM <= 100, `78m-class is allowed (${nearOk.distanceM})`)

const tooFar = evaluateGeofence(far, store)
assert(!tooFar.ok && tooFar.reason === 'too_far' && tooFar.distanceM > 100, '233m blocked')

const edge = evaluateGeofence(store, store)
assert(edge.ok, '0m allowed')

const noPin = evaluateGeofence(far, null)
assert(noPin.ok && noPin.reason === 'no_pin', 'no pin still saves GPS')

const noGps = evaluateGeofence(null, store)
assert(!noGps.ok && noGps.reason === 'gps_unavailable', 'missing GPS blocked when pin exists')

const noGpsNoPin = evaluateGeofence(null, null)
assert(noGpsNoPin.ok && noGpsNoPin.reason === 'no_pin', 'no pin and no GPS allowed')

const jobPin = { gps_lat: store.lat, gps_lng: store.lng, title: 'Ibushio — Basic Cleaning', address: '' }
assert(resolveJobTargetSync(jobPin).source === 'job', 'job pin wins')

const locRows = mergeLocationHints(
  [{ id: 'loc1', name: 'Ibushio', gps_lat: store.lat, gps_lng: store.lng, address: '' }],
)
const fromLoc = resolveJobTargetSync(
  { title: 'Ibushio — Deep Clean', address: '' },
  locRows,
)
assert(fromLoc && fromLoc.source === 'location', 'falls back to location pin')

const fromAddr = resolveJobTargetSync({
  title: 'Kodama',
  address: 'https://maps.google.com/?q=35.6664,139.7583',
})
assert(fromAddr && fromAddr.source === 'address', 'parses maps URL on the job')

const hints = catalogLocationHints()
assert(hints.some(h => h.name === 'Ibushio' && h.address), 'catalog hints include OTP stores')

const geocoded = await resolveJobTarget(
  { title: 'Mystery Store', address: 'https://maps.google.com/no-coords' },
  { locations: [], geocode: async () => ({ lat: store.lat, lng: store.lng }) },
)
assert(geocoded && geocoded.source === 'geocode', 'async geocode fallback')

const blocked = await checkJobGeofence(jobPin, {
  getPosition: async () => far,
  locations: [],
})
assert(!blocked.ok && blocked.reason === 'too_far', 'checkJobGeofence blocks far start')

const allowed = await checkJobGeofence(jobPin, {
  getPosition: async () => ({ ...onSite, acc: 8 }),
  locations: [],
})
assert(allowed.ok, 'checkJobGeofence allows on site')

const gpsDown = await checkJobGeofence(jobPin, {
  getPosition: async () => { throw new Error('denied') },
})
assert(!gpsDown.ok && gpsDown.reason === 'gps_unavailable', 'denied GPS blocks when pin exists')

const startFields = jobGpsWriteFields('start', allowed, { gps_lat: null, gps_lng: null })
assert(startFields.gps_start_lat === onSite.lat, 'saves start lat')
assert(startFields.gps_start_lng === onSite.lng, 'saves start lng')
assert(startFields.gps_start_acc === 8, 'saves accuracy')
assert(startFields.gps_lat === store.lat && startFields.gps_lng === store.lng, 'backfills store pin')

const endFields = jobGpsWriteFields('end', tooFar, jobPin)
assert(endFields.gps_end_lat === far.lat, 'saves end lat')
assert(endFields.gps_end_distance_m === Math.round(tooFar.distanceM), 'saves end distance')
assert(endFields.gps_lat == null, 'does not overwrite existing pin')

const presence = employeePresencePatch({ lat: onSite.lat, lng: onSite.lng, acc: 8 })
assert(presence.last_lat === onSite.lat && presence.location_sharing === true, 'presence ping')

assert(isLocationFresh(new Date().toISOString()), 'fresh now')
assert(!isLocationFresh(new Date(Date.now() - 6 * 60 * 1000).toISOString()), 'stale after 5min')
assert(!isLocationFresh(null), 'null not fresh')

const today = '2026-09-17'
const empA = { id: 'a', full_name: 'Ana' }
const empB = { id: 'b', full_name: 'Bruno' }
const empC = { id: 'c', full_name: 'Carla' }
const jobs = [
  { id: 'j1', employee_id: 'a', scheduled_date: today, status: 'in_progress', title: 'Ibushio' },
  { id: 'j2', employee_id: 'b', scheduled_date: today, status: 'assigned', title: 'Kodama' },
  { id: 'j3', employee_id: 'b', scheduled_date: today, status: 'completed', title: 'Tooda' },
  { id: 'j4', employee_id: 'c', scheduled_date: today, status: 'cancelled', title: 'Atomic' },
]
assert(staffWorkStatus({ employee: empA, jobs, today }).key === 'working', 'in_progress = working')
assert(staffWorkStatus({ employee: empB, jobs, today }).key === 'idle', 'has jobs, not started = idle')
assert(staffWorkStatus({ employee: empC, jobs, today }).key === 'folga', 'only cancelled = folga')
assert(staffWorkStatus({ employee: { id: 'd', full_name: 'Dan' }, jobs, today }).key === 'folga', 'no jobs = folga')

const staleActive = staffWorkStatus({
  employee: empC,
  jobs: [...jobs, { id: 'j5', employee_id: 'c', scheduled_date: '2026-09-16', status: 'in_progress' }],
  today,
})
assert(staleActive.key === 'working', 'yesterday in_progress still working now')

const summary = summarizeStaffStatus([empC, empB, empA], jobs, today)
assert(summary.working === 1 && summary.idle === 1 && summary.folga === 1, 'counts')
assert(summary.rows[0].key === 'working' && summary.rows[2].key === 'folga', 'sort working then idle then folga')

const liveM = liveDistanceToJob(
  { last_lat: onSite.lat, last_lng: onSite.lng },
  jobPin,
)
assert(liveM != null && liveM < 20, `live distance on site, got ${liveM}`)

assert(fenceOk(100) === true, '100m is allowed')
assert(fenceOk(101) === false, '101m is blocked')
assert(fenceOk(null) === null, 'unknown fence')
assert(mapsPointUrl(store.lat, store.lng).includes(`${store.lat}`), 'maps url')

const pinFields = jobPinFieldsForLocation({
  name: 'Ibushio',
  address: 'https://www.google.com/maps/@35.666400,139.758300,17z',
})
assert(pinFields.gps_lat === 35.666400 && pinFields.gps_lng === 139.758300, 'jobPinFieldsForLocation from maps URL')

const focusWorking = liveFocusJob([
  { id: 'next', status: 'assigned', sequence_order: 1 },
  { id: 'now', status: 'in_progress', sequence_order: 4 },
])
assert(focusWorking?.id === 'now', 'liveFocusJob prefers in_progress')
assert(liveFocusJob([{ id: 'b', status: 'assigned', sequence_order: 3 }, { id: 'a', status: 'assigned', sequence_order: 1 }])?.id === 'a', 'idle uses next assigned')

assert(isMissingColumnError({ code: '42703', message: 'column jobs.gps_start_lat does not exist' }, 'gps_start_lat'), 'postgres missing column')
assert(!isMissingColumnError({ code: 'PGRST204', message: "Could not find the 'notes' column" }, 'gps_start_lat'), 'other column')
assert(!isMissingColumnError(null), 'null error')

console.log('✅ geofence 100m hard-block')
console.log('✅ start/end GPS field mapping')
console.log('✅ working / idle / folga')
console.log('\n✅ All job GPS tests passed')
