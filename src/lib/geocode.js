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
