/** Google Maps links — resolve short/broken URLs for navigation */

const MAPS_HOST_RE = /goo\.gl|maps\.app|share\.google|maps\.google|google\.com\/maps/i

export function isMapsUrl(address) {
  return MAPS_HOST_RE.test(address || '')
}

export function isNavigableAddress(address) {
  if (!address) return false
  return isMapsUrl(address) || /^https?:\/\//i.test(address) || address.trim().length > 8
}

/** Build a reliable Google Maps URL from stored address + optional place name */
export function mapsOpenUrl(address, placeName) {
  if (!address && placeName) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${placeName} Tokyo`)}`
  }
  if (!address) return null

  const trimmed = address.trim()

  if (/^https?:\/\//i.test(trimmed)) {
    if (/share\.google/i.test(trimmed)) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(placeName ? `${placeName} Tokyo` : 'Tokyo')}`
    }
    if (/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(trimmed)) {
      return trimmed
    }
    if (/google\.com\/maps/i.test(trimmed)) return trimmed
    return trimmed
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed)}`
}

/** Whether address should show a Maps button */
export function hasMapsLink(address, placeName) {
  return Boolean(mapsOpenUrl(address, placeName))
}
