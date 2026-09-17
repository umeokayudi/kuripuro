import { distanceMeters, parseCoordsFromUrl, validCoords } from './geocode'
import { locationNameFromTitle } from './cleaningType'
import { OTP_BASIC_LOCATIONS, ATOMIC_LOCATION, MATSUNAGA_SPOT } from './serviceCatalog'

export const GEOFENCE_M = 100
export const LIVE_LOCATION_FRESH_MS = 5 * 60 * 1000

export const JOB_GPS_SETUP_SQL = `-- KuriPuro job start/end GPS — run once in Supabase SQL Editor
alter table jobs add column if not exists gps_start_lat numeric;
alter table jobs add column if not exists gps_start_lng numeric;
alter table jobs add column if not exists gps_start_acc numeric;
alter table jobs add column if not exists gps_start_distance_m numeric;
alter table jobs add column if not exists gps_end_lat numeric;
alter table jobs add column if not exists gps_end_lng numeric;
alter table jobs add column if not exists gps_end_acc numeric;
alter table jobs add column if not exists gps_end_distance_m numeric;
`

export function catalogLocationHints() {
  const rows = [...OTP_BASIC_LOCATIONS, ATOMIC_LOCATION]
  if (MATSUNAGA_SPOT) rows.push(MATSUNAGA_SPOT)
  return rows.map(l => ({
    id: null,
    name: l.name,
    address: l.address || '',
    gps_lat: l.gps_lat ?? null,
    gps_lng: l.gps_lng ?? null,
  }))
}

export function mergeLocationHints(dbLocations = [], extra = catalogLocationHints()) {
  const byName = new Map()
  for (const row of [...extra, ...dbLocations]) {
    if (!row) continue
    const name = String(row.name || '').trim().toLowerCase()
    if (!name) continue
    const prev = byName.get(name) || {}
    byName.set(name, {
      id: row.id || prev.id || null,
      name: row.name || prev.name,
      address: row.address || prev.address || '',
      gps_lat: row.gps_lat ?? prev.gps_lat ?? null,
      gps_lng: row.gps_lng ?? prev.gps_lng ?? null,
    })
  }
  return [...byName.values()]
}

function locationForJob(job, locations = []) {
  if (!job) return null
  if (job.location_id) {
    const byId = locations.find(l => l.id === job.location_id)
    if (byId) return byId
  }
  const name = locationNameFromTitle(job.title || job.client_name || '').toLowerCase()
  if (!name) return null
  return locations.find(l => String(l.name || '').trim().toLowerCase() === name) || null
}

export function resolveJobTargetSync(job, locations = []) {
  if (!job) return null
  const fromJob = validCoords(job.gps_lat, job.gps_lng)
  if (fromJob) return { ...fromJob, source: 'job' }

  const loc = locationForJob(job, locations)
  const fromLoc = validCoords(loc?.gps_lat, loc?.gps_lng)
  if (fromLoc) return { ...fromLoc, source: 'location' }

  const fromJobAddress = parseCoordsFromUrl(job.address)
  if (fromJobAddress) return { ...fromJobAddress, source: 'address' }

  const fromLocAddress = parseCoordsFromUrl(loc?.address)
  if (fromLocAddress) return { ...fromLocAddress, source: 'location_address' }

  return null
}

export async function resolveJobTarget(job, { locations = [], geocode = null } = {}) {
  const sync = resolveJobTargetSync(job, locations)
  if (sync) return sync

  const loc = locationForJob(job, locations)
  const candidates = [job?.address, loc?.address].filter(Boolean)
  if (!geocode) return null

  for (const address of candidates) {
    try {
      const result = await geocode(address)
      const coords = validCoords(result?.lat, result?.lng)
      if (coords) return { ...coords, source: 'geocode' }
    } catch {}
  }
  return null
}

export function evaluateGeofence(position, target, radiusM = GEOFENCE_M) {
  if (!target) {
    return { ok: true, reason: 'no_pin', distanceM: null, target: null, position: position || null }
  }
  if (!position || !validCoords(position.lat, position.lng)) {
    return { ok: false, reason: 'gps_unavailable', distanceM: null, target, position: null }
  }
  const distanceM = distanceMeters(position.lat, position.lng, target.lat, target.lng)
  if (distanceM > radiusM) {
    return { ok: false, reason: 'too_far', distanceM, target, position }
  }
  return { ok: true, reason: 'within', distanceM, target, position }
}

export async function checkJobGeofence(job, {
  getPosition,
  locations = [],
  geocode = null,
  radiusM = GEOFENCE_M,
} = {}) {
  const target = await resolveJobTarget(job, { locations, geocode })
  let position = null
  try {
    position = getPosition ? await getPosition() : null
  } catch {
    position = null
  }
  return evaluateGeofence(position, target, radiusM)
}

export function jobGpsWriteFields(phase, check, job = null) {
  const prefix = phase === 'end' ? 'gps_end' : 'gps_start'
  const pos = check?.position
  const fields = {
    [`${prefix}_lat`]: pos?.lat ?? null,
    [`${prefix}_lng`]: pos?.lng ?? null,
    [`${prefix}_acc`]: pos?.acc ?? null,
    [`${prefix}_distance_m`]: check?.distanceM != null ? Math.round(check.distanceM) : null,
  }
  if (check?.target && (job?.gps_lat == null || job?.gps_lng == null || job?.gps_lat === '' || job?.gps_lng === '')) {
    fields.gps_lat = check.target.lat
    fields.gps_lng = check.target.lng
  }
  return fields
}

export function employeePresencePatch(position, { sharing = true } = {}) {
  const update = {
    last_seen: new Date().toISOString(),
    is_online: true,
  }
  if (position && validCoords(position.lat, position.lng)) {
    update.last_lat = position.lat
    update.last_lng = position.lng
    update.last_location_at = new Date().toISOString()
    update.location_sharing = sharing
  }
  return update
}

export function isLocationFresh(iso, now = Date.now(), maxMs = LIVE_LOCATION_FRESH_MS) {
  if (!iso) return false
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return false
  return now - t >= 0 && now - t < maxMs
}

export function jobsForEmployeeToday(jobs, employeeId, today) {
  return (jobs || []).filter(j =>
    j.employee_id === employeeId &&
    j.scheduled_date === today &&
    j.status !== 'cancelled'
  )
}

export function staffWorkStatus({ employee, jobs = [], today }) {
  const todayJobs = jobsForEmployeeToday(jobs, employee?.id, today)
  const active = (jobs || []).find(j => j.employee_id === employee?.id && j.status === 'in_progress')
  if (active) return { key: 'working', job: active, todayJobs }
  if (todayJobs.length === 0) return { key: 'folga', job: null, todayJobs }
  return { key: 'idle', job: null, todayJobs }
}

export function summarizeStaffStatus(employees, jobs, today) {
  const rows = (employees || []).map(employee => ({
    employee,
    ...staffWorkStatus({ employee, jobs, today }),
  }))
  const order = { working: 0, idle: 1, folga: 2 }
  rows.sort((a, b) => {
    const d = order[a.key] - order[b.key]
    if (d) return d
    return String(a.employee?.full_name || '').localeCompare(String(b.employee?.full_name || ''))
  })
  return {
    rows,
    working: rows.filter(r => r.key === 'working').length,
    idle: rows.filter(r => r.key === 'idle').length,
    folga: rows.filter(r => r.key === 'folga').length,
  }
}

export function liveDistanceToJob(employee, job, locations = []) {
  if (!employee || !validCoords(employee.last_lat, employee.last_lng)) return null
  const target = resolveJobTargetSync(job, locations)
  if (!target) return null
  return Math.round(distanceMeters(employee.last_lat, employee.last_lng, target.lat, target.lng))
}

export function fenceOk(distanceM, radiusM = GEOFENCE_M) {
  if (distanceM == null || !Number.isFinite(Number(distanceM))) return null
  return Number(distanceM) <= radiusM
}

export function mapsPointUrl(lat, lng) {
  const coords = validCoords(lat, lng)
  if (!coords) return null
  return `https://www.google.com/maps?q=${coords.lat},${coords.lng}`
}
