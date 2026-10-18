// Employee home map: business name on the map and "service nearby" detection.
import { distanceMeters, geocodeAddress } from './geocode.js'
import { isNavigableAddress } from './mapsLink.js'

export const NEARBY_RADIUS_M = 400

/** Business (store/restaurant) name of a job: the location part of the title, else the client. */
export function businessName(job) {
  const place = String(job?.title || '').split(' —')[0].trim()
  return place || job?.client_name || ''
}

/** Place text inside a Google Maps link (/maps/place/<text>/ or ?query=<text>). */
export function placeFromMapsUrl(url) {
  try {
    const u = new URL(url)
    const m = u.pathname.match(/\/maps\/place\/([^/]+)/)
    const raw = m ? m[1] : (u.searchParams.get('query') || u.searchParams.get('q') || '')
    const text = decodeURIComponent(raw.replace(/\+/g, ' ')).trim()
    return /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(text) ? '' : text
  } catch { return '' }
}

/** Query for the Google Maps embed: "Business, address" so the pin carries the business name. */
export function mapQuery(job, coords) {
  const name = businessName(job)
  const addr = String(job?.address || '').trim()
  if (addr && !/^https?:\/\//i.test(addr) && isNavigableAddress(addr)) return name ? `${name}, ${addr}` : addr
  const fromUrl = /^https?:\/\//i.test(addr) ? placeFromMapsUrl(addr) : ''
  if (fromUrl) return fromUrl.toLowerCase().includes(name.toLowerCase()) || !name ? fromUrl : `${name}, ${fromUrl}`
  if (coords?.lat != null && coords?.lng != null) return `${coords.lat},${coords.lng}`
  return `${name || job?.client_name || ''} Tokyo`.trim()
}

const CACHE_KEY = 'kp_site_coords_v1'
const readCache = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') } catch { return {} } }
const writeCache = (c) => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)) } catch { /* private mode */ } }

/** Site coordinates of a job: stored gps_lat/gps_lng, else the address geocoded once (cached on the device). */
export async function siteCoords(job) {
  if (job?.gps_lat != null && job?.gps_lng != null) return { lat: Number(job.gps_lat), lng: Number(job.gps_lng) }
  const addr = String(job?.address || '').trim()
  if (!addr) return null
  const cache = readCache()
  if (cache[addr] !== undefined) return cache[addr]
  const r = await geocodeAddress(addr)
  const coords = r?.lat != null && r?.lng != null ? { lat: r.lat, lng: r.lng } : null
  cache[addr] = coords
  writeCache(cache)
  return coords
}

/** Nearest job (with its distance) within `radius` meters of `pos`, or null. */
export function nearestJob(jobs, coordsById, pos, radius = NEARBY_RADIUS_M) {
  if (!pos) return null
  let best = null
  for (const j of jobs || []) {
    const c = coordsById[j.id]
    if (!c) continue
    const d = Math.round(distanceMeters(pos.lat, pos.lng, c.lat, c.lng))
    if (d <= radius && (!best || d < best.dist)) best = { job: j, dist: d }
  }
  return best
}
