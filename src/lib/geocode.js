export async function geocodeAddress(address) {
  // If it's a Google Maps URL, try to extract coords from URL
  if (address?.includes('maps.app.goo.gl') || address?.includes('share.google') || address?.includes('maps.google')) {
    // Try to fetch the URL and extract coords from redirect
    try {
      // Extract coords from maps URLs with @lat,lng format
      const coordMatch = address.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
      if (coordMatch) return { lat: parseFloat(coordMatch[1]), lng: parseFloat(coordMatch[2]) }
    } catch {}
    return null
  }
  // Otherwise geocode the text address
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`)
    const data = await res.json()
    if (data.length > 0) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
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
