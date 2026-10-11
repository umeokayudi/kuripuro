import { requireAppSession } from './_auth.js'

// Resolve Google Maps URLs (incl. goo.gl / share.google) → lat/lng

function parseCoordsFromUrl(url) {
  if (!url) return null

  let m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) }

  m = url.match(/[?&](?:q|ll|query)=(-?\d+\.\d+),(-?\d+\.\d+)/)
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) }

  m = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/)
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) }

  m = url.match(/\/(-?\d+\.\d+),(-?\d+\.\d+)(?:\/|,|\?|$)/)
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) }

  return null
}

function parseCoordsFromHtml(html) {
  if (!html) return null
  const patterns = [
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /"center":\{"lat":(-?\d+\.\d+),"lng":(-?\d+\.\d+)\}/,
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    /\[null,null,(-?\d+\.\d+),(-?\d+\.\d+)\]/,
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) }
  }
  return null
}

function isMapsUrl(url) {
  return /goo\.gl|maps\.app|share\.google|maps\.google|google\.com\/maps/i.test(url || '')
}

// Only Google short/maps links are followed, so this route can't be used to fetch arbitrary sites.
function isGoogleHost(address) {
  try {
    const { protocol, hostname } = new URL(address)
    return protocol === 'https:' && /(^|\.)(goo\.gl|maps\.app\.goo\.gl|share\.google|google\.[a-z.]+)$/i.test(hostname)
  } catch { return false }
}

async function resolveMapsUrl(address) {
  const direct = parseCoordsFromUrl(address)
  if (direct) return direct

  if (!isMapsUrl(address) || !isGoogleHost(address)) return null

  try {
    const res = await fetch(address, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KuriPuro/1.0)' },
    })
    const fromUrl = parseCoordsFromUrl(res.url)
    if (fromUrl) return fromUrl

    const html = await res.text()
    return parseCoordsFromHtml(html)
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!(await requireAppSession(req, res))) return

  const address = req.query.address
  if (!address) return res.status(400).json({ error: 'address required' })

  if (isMapsUrl(address)) {
    const coords = await resolveMapsUrl(address)
    if (coords) return res.status(200).json({ ...coords, mapsLink: true })
    return res.status(200).json({ mapsLink: true, lat: null, lng: null })
  }

  try {
    const nom = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`,
      { headers: { 'User-Agent': 'KuriPuro/1.0' } },
    )
    const data = await nom.json()
    if (data?.length) {
      return res.status(200).json({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) })
    }
  } catch {}

  return res.status(404).json({ error: 'not found' })
}
