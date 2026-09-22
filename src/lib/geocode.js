export { isMapsUrl, isNavigableAddress } from './mapsLink.js'

export function validCoords(lat, lng) {
  const a = Number(lat)
  const b = Number(lng)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  if (a < -90 || a > 90 || b < -180 || b > 180) return null
  if (a === 0 && b === 0) return null
  return { lat: a, lng: b }
}

export function parseCoordsFromUrl(url) {
  if (!url) return null
  const text = String(url)

  let m = text.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
  if (m) return validCoords(m[1], m[2])

  m = text.match(/[?&](?:q|ll|query)=(-?\d+\.\d+),(-?\d+\.\d+)/)
  if (m) return validCoords(m[1], m[2])

  m = text.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/)
  if (m) return validCoords(m[1], m[2])

  m = text.match(/\/(-?\d+\.\d+),(-?\d+\.\d+)(?:\/|,|\?|$)/)
  if (m) return validCoords(m[1], m[2])

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

export function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('GPS not available'))
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }),
      err => reject(err),
      { timeout: 10000, enableHighAccuracy: true }
    )
  })
}
