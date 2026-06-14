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

