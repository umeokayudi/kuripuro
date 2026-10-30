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

// Address text inside a Maps link: /maps/place/<text>/ or ?q=<text>.
export function placeTextFromUrl(url) {
  try {
    const u = new URL(url)
    const m = u.pathname.match(/\/maps\/place\/([^/]+)/)
    const raw = m ? m[1] : (u.searchParams.get('query') || u.searchParams.get('q') || '')
    return decodeURIComponent(raw.replace(/\+/g, ' ')).trim()
  } catch { return '' }
}

const DASH = /[-−‐‑–—ー－]/g

// Japanese address → "東京都港区新橋3-16-10" for the GSI address search.
// Google often writes it in English ("〒105-0004 Tokyo, Minato City, Shinbashi, 3 Chome−16−10 2F …"):
// then the postal code gives the town and the chome numbers are added after it.
export function japaneseAddressParts(text) {
  const t = String(text || '').normalize('NFKC')
  const zip = t.match(/〒?\s*(\d{3})-?(\d{4})/)
  const en = t.match(/(\d+)\s*chome\s*[-−‐‑–—]?\s*(\d+)?(?:\s*[-−‐‑–—]\s*(\d+))?/i)
  const enBlock = en ? [en[1], en[2], en[3]].filter(Boolean).join('-') : ''
  let ja = ''
  if (/[都道府県].*[市区町村郡]/.test(t)) {
    ja = t.replace(/〒?\s*\d{3}-?\d{4}/, '')
      .replace(/日本、?/, '')
      .replace(/丁目/g, '-').replace(/番地?/g, '-').replace(/号/g, '')
      .replace(DASH, '-')
      .replace(/-\s+/g, '-')
      .trim()
    // A shop name written before the address ("焼肉男マンモス 東京都港区…") makes the search miss: start at the prefecture.
    const pref = ja.search(/東京都|北海道|大阪府|京都府|[^\s\d]{2,3}県/)
    if (pref > 0) ja = ja.slice(pref)
    // Keep up to the house number; the floor / building name after a space is dropped.
    const cut = ja.match(/^(.*?\d+(?:-\d+){0,2})/)
    ja = (cut ? cut[1] : ja).replace(/\s+/g, '')
  }
  return { zip: zip ? `${zip[1]}${zip[2]}` : '', block: enBlock, ja }
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'KuriPuro/1.0' } })
  if (!res.ok) return null
  return res.json()
}

async function gsiSearch(q) {
  if (!q) return null
  const data = await fetchJson(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`)
  const c = Array.isArray(data) && data[0]?.geometry?.coordinates
  return c && Number.isFinite(c[0]) && Number.isFinite(c[1]) ? { lat: c[1], lng: c[0] } : null
}

export async function geocodeJapanese(text) {
  const { zip, block, ja } = japaneseAddressParts(text)
  try {
    if (ja) {
      const hit = await gsiSearch(ja)
      if (hit) return hit
    }
    if (zip) {
      const z = await fetchJson(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`)
      const r = z?.results?.[0]
      if (r) {
        const town = `${r.address1}${r.address2}${r.address3}`
        return (block && await gsiSearch(town + block)) || await gsiSearch(town)
      }
    }
  } catch { /* offline or service down */ }
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
    const coords = await resolveMapsUrl(address) || await geocodeJapanese(placeTextFromUrl(address))
    if (coords) return res.status(200).json({ ...coords, mapsLink: true })
    return res.status(200).json({ mapsLink: true, lat: null, lng: null })
  }

  const jp = await geocodeJapanese(address)
  if (jp) return res.status(200).json(jp)

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
