export { isMapsUrl, isNavigableAddress } from './mapsLink.js'

function parseCoordsFromUrl(url) {
  if (!url) return null
  const m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) }
  const m2 = url.match(/[?&](?:q|ll)=(-?\d+\.\d+),(-?\d+\.\d+)/)
  if (m2) return { lat: parseFloat(m2[1]), lng: parseFloat(m2[2]) }
  return null
}

export async function geocodeAddress(address) {
  if (!address) return null

  const local = parseCoordsFromUrl(address)
  if (local) return local

  try {
    const res = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`)
    const data = await res.json()
    if (data.lat != null && data.lng != null) return { lat: data.lat, lng: data.lng }
    if (data.mapsLink) return { mapsLink: true }
    if (!res.ok) return null
  } catch {}

  return null
}

/** "850 m" up to 999 m, then "24.6 km" (or "125 km" from 100 km on). */
export function formatDistance(meters) {
  const m = Number(meters)
  if (!Number.isFinite(m)) return '—'
  if (Math.round(m) < 1000) return `${Math.round(m)} m`
  const km = m / 1000
  return `${km >= 100 ? Math.round(km) : km.toFixed(1)} km`
}

export function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

// Phones often hand back an old or Wi-Fi/cell-based fix first. Watch for a few seconds and keep
// the most accurate reading, stopping early once it is good enough.
export function getCurrentPosition({ maxWait = 9000, goodEnough = 25 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('GPS not available'))
    let best = null
    let id = null
    let timer = null
    const finish = (err) => {
      if (id != null) navigator.geolocation.clearWatch(id)
      clearTimeout(timer)
      if (best) resolve(best)
      else reject(err || new Error('GPS timeout'))
    }
    timer = setTimeout(() => finish(), maxWait)
    id = navigator.geolocation.watchPosition(
      pos => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }
        if (!best || (p.acc ?? Infinity) <= (best.acc ?? Infinity)) best = p
        if ((p.acc ?? Infinity) <= goodEnough) finish()
      },
      err => { if (err?.code === 1 || !best) finish(err) },
      { enableHighAccuracy: true, maximumAge: 0, timeout: maxWait },
    )
  })
}
