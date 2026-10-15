/** Google Maps links — resolve short/broken URLs for navigation */

const MAPS_HOST_RE = /goo\.gl|maps\.app|share\.google|maps\.google|google\.com\/maps/i

export function isMapsUrl(address) {
  return MAPS_HOST_RE.test(address || '')
}

export function isNavigableAddress(address) {
  if (!address) return false
  return isMapsUrl(address) || /^https?:\/\//i.test(address) || address.trim().length > 8
}

const searchUrl = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`

/** Coordinates as a Google Maps search link (opens the app on phones). */
export function mapsCoordsUrl(lat, lng) {
  return searchUrl(`${lat},${lng}`)
}

/**
 * Turn a long google.com/maps link into the official cross-platform form.
 * Links like /maps/place/<name>/data=!4m2!3m1!1s0x..:0x..!18m1!1e1 open
 * "google.com/maps/undefined&cid=..." (404) in Android browsers, so we keep
 * only the place text (name + address), else the coordinates, else the cid.
 */
function normalizeGoogleMapsUrl(url, placeName) {
  let u
  try { u = new URL(url) } catch { return null }
  if (u.searchParams.get('api') === '1') return url
  const placeMatch = u.pathname.match(/\/maps\/(?:place|search)\/([^/]+)/)
  let text = ''
  if (placeMatch) { try { text = decodeURIComponent(placeMatch[1].replace(/\+/g, ' ')).trim() } catch { text = '' } }
  if (!text) text = (u.searchParams.get('query') || u.searchParams.get('q') || '').trim()
  if (text) return searchUrl(text)
  const at = u.pathname.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
  if (at) return mapsCoordsUrl(at[1], at[2])
  const cid = u.searchParams.get('cid') || (u.pathname.match(/0x[0-9a-f]+:(0x[0-9a-f]+)/i) || [])[1]
  if (cid) return `https://maps.google.com/?cid=${/^0x/i.test(cid) ? BigInt(cid).toString() : cid}`
  return searchUrl(placeName ? `${placeName} Tokyo` : 'Tokyo')
}

/** Build a reliable Google Maps URL from stored address + optional place name */
export function mapsOpenUrl(address, placeName) {
  if (!address && placeName) return searchUrl(`${placeName} Tokyo`)
  if (!address) return null

  const trimmed = String(address).trim()
  if (!trimmed || trimmed === 'undefined' || trimmed === 'null') {
    return placeName ? searchUrl(`${placeName} Tokyo`) : null
  }

  if (/^https?:\/\//i.test(trimmed)) {
    if (/share\.google/i.test(trimmed)) return searchUrl(placeName ? `${placeName} Tokyo` : 'Tokyo')
    if (/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(trimmed)) return trimmed
    if (/google\.[a-z.]+\/maps|maps\.google\./i.test(trimmed)) {
      return normalizeGoogleMapsUrl(trimmed, placeName)
    }
    return trimmed
  }

  return searchUrl(trimmed)
}

/** Whether address should show a Maps button */
export function hasMapsLink(address, placeName) {
  return Boolean(mapsOpenUrl(address, placeName))
}
