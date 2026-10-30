// Where a place really is (v1.0.104). A place only counts as located with real coordinates:
// the ones typed in, picked from Google Places, tapped on the map or found in a Google Maps link.

// Seeded in June on every place as a stand-in (Shinbashi), even Kinshicho and Oimachi: never a real location.
const PLACEHOLDERS = [[35.6585, 139.7514]]

const num = v => (v === '' || v == null ? NaN : Number(v))

/** True for coordinates inside Japan that are not the seeded stand-in. */
export function isRealCoords(lat, lng) {
  const a = num(lat)
  const b = num(lng)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  if (a < 20 || a > 46 || b < 122 || b > 154) return false
  return !PLACEHOLDERS.some(([pa, pb]) => Math.abs(a - pa) < 0.00005 && Math.abs(b - pb) < 0.00005)
}

/** { lat, lng } of a row's gps_lat/gps_lng, or null when missing or the stand-in. */
export function realCoords(row) {
  return isRealCoords(row?.gps_lat, row?.gps_lng) ? { lat: Number(row.gps_lat), lng: Number(row.gps_lng) } : null
}

const PATTERNS = [
  /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, // the pin itself in /maps/place/... links
  /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/, // map centre in /maps/place/.../@lat,lng,17z
  /[?&](?:q|ll|query|destination|center|sll)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/i,
  /\/maps\/(?:place|search)\/(-?\d+\.\d+)(?:,|%2C)\s*\+?(-?\d+\.\d+)/i,
]

/**
 * Coordinates written in a text: a Google Maps link (/place/ with @ or !3d!4d, ?q=lat,lng) or
 * pasted numbers such as "35.67417, 139.76688" (also "35.67417 139.76688"). Null when none.
 */
export function coordsFromText(text) {
  const s = String(text || '').trim()
  if (!s) return null
  for (const re of PATTERNS) {
    const m = s.match(re)
    if (m && isRealCoords(m[1], m[2])) return { lat: Number(m[1]), lng: Number(m[2]) }
  }
  const plain = s.normalize('NFKC').match(/^\(?\s*(-?\d{1,2}\.\d+)\s*[,，、\s]\s*(-?\d{2,3}\.\d+)\s*\)?$/)
  if (plain && isRealCoords(plain[1], plain[2])) return { lat: Number(plain[1]), lng: Number(plain[2]) }
  return null
}

/** Short "35.67417, 139.76688" for the screen. */
export const fmtCoords = c => (c ? `${Number(c.lat).toFixed(5)}, ${Number(c.lng).toFixed(5)}` : '')
