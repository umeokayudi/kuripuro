// v1.0.190 · Treinamento: YouTube lookups for the admin (routed through api/sales.js as
// /api/youtube/:op to stay inside the 12-function Hobby limit).
//   status            → { apiKey }  is YOUTUBE_API_KEY set?
//   info?id=VIDEO     → title / channel / thumbnail (oEmbed, no key) + length (only with the key)
//   list?source=…     → every video of a playlist (unlisted videos in it too) or of a channel's
//                       public uploads. Needs YOUTUBE_API_KEY (free key from Google Cloud,
//                       "YouTube Data API v3"). Without it the admin pastes links one by one.
import { requireAppSession } from './_auth.js'

const KEY = () => process.env.YOUTUBE_API_KEY || ''
const YT = 'https://www.googleapis.com/youtube/v3'
const YT_ID = /^[A-Za-z0-9_-]{11}$/

const first = v => (Array.isArray(v) ? v[0] : v)

async function getJson(url) {
  const r = await fetch(url)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error?.message || `YouTube HTTP ${r.status}`)
  return j
}

/** "PT1H2M3S" → seconds */
export function isoDuration(s) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(s || ''))
  if (!m) return 0
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0)
}

async function durations(ids) {
  const out = {}
  if (!KEY() || !ids.length) return out
  for (let i = 0; i < ids.length; i += 50) {
    const j = await getJson(`${YT}/videos?part=contentDetails,snippet,status&id=${ids.slice(i, i + 50).join(',')}&key=${KEY()}`)
    for (const it of j.items || []) out[it.id] = { duration_s: isoDuration(it.contentDetails?.duration), privacy: it.status?.privacyStatus, embeddable: it.status?.embeddable !== false, title: it.snippet?.title, channel: it.snippet?.channelTitle }
  }
  return out
}

async function info(id) {
  if (!YT_ID.test(id)) throw Object.assign(new Error('Link do YouTube inválido.'), { status: 400 })
  let o = {}
  try { o = await getJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`) } catch { /* private / deleted / no embed */ }
  const extra = (await durations([id]).catch(() => ({})))[id] || {}
  if (!o.title && !extra.title) throw Object.assign(new Error('Não achei esse vídeo. Ele precisa ser Público ou Não listado (não Privado).'), { status: 404 })
  return { yt: id, title: o.title || extra.title, channel: o.author_name || extra.channel || '', thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, duration_s: extra.duration_s || 0, embeddable: extra.embeddable !== false }
}

function parseSource(raw) {
  const s = String(raw || '').trim()
  if (/^(PL|UU|OL|FL)[\w-]{10,}$/.test(s)) return { playlistId: s }
  if (/^UC[\w-]{22}$/.test(s)) return { channelId: s }
  if (/^@[\w.-]{2,}$/.test(s)) return { handle: s }
  try {
    const u = new URL(/^https?:/i.test(s) ? s : `https://${s}`)
    if (u.searchParams.get('list')) return { playlistId: u.searchParams.get('list') }
    const p = u.pathname.split('/').filter(Boolean)
    if (p[0]?.startsWith('@')) return { handle: p[0] }
    if (p[0] === 'channel' && p[1]) return { channelId: p[1] }
  } catch { /* fallthrough */ }
  return null
}

async function list(source) {
  if (!KEY()) throw Object.assign(new Error('YOUTUBE_API_KEY ainda não está configurada no Vercel.'), { status: 412 })
  const src = parseSource(source)
  if (!src) throw Object.assign(new Error('Cole o link de uma playlist ou do canal (@nome).'), { status: 400 })
  let playlistId = src.playlistId
  let from = ''
  if (!playlistId) {
    const q = src.handle ? `forHandle=${encodeURIComponent(src.handle)}` : `id=${src.channelId}`
    const c = await getJson(`${YT}/channels?part=contentDetails,snippet&${q}&key=${KEY()}`)
    const ch = c.items?.[0]
    if (!ch) throw Object.assign(new Error('Canal não encontrado.'), { status: 404 })
    playlistId = ch.contentDetails?.relatedPlaylists?.uploads
    from = ch.snippet?.title || ''
  }
  const items = []
  let page = ''
  for (let n = 0; n < 6; n++) { // up to 300 videos
    const j = await getJson(`${YT}/playlistItems?part=snippet,contentDetails,status&maxResults=50&playlistId=${encodeURIComponent(playlistId)}&key=${KEY()}${page ? `&pageToken=${page}` : ''}`)
    for (const it of j.items || []) {
      const id = it.contentDetails?.videoId
      if (!id || it.status?.privacyStatus === 'private' || /^(Private|Deleted) video$/.test(it.snippet?.title || '')) continue
      items.push({ yt: id, title: it.snippet?.title || '', channel: it.snippet?.videoOwnerChannelTitle || from, thumb: it.snippet?.thumbnails?.high?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg` })
    }
    page = j.nextPageToken
    if (!page) break
  }
  const d = await durations(items.map(i => i.yt)).catch(() => ({}))
  return { from, videos: items.map(i => ({ ...i, duration_s: d[i.yt]?.duration_s || 0, embeddable: d[i.yt]?.embeddable !== false })) }
}

export default async function handler(req, res) {
  const op = String(first(req.query?.op) || '')
  const user = await requireAppSession(req, res, ['admin'])
  if (!user) return
  try {
    if (op === 'status') return res.status(200).json({ apiKey: !!KEY() })
    if (op === 'info') return res.status(200).json(await info(String(first(req.query?.id) || '')))
    if (op === 'list') return res.status(200).json(await list(first(req.query?.source)))
    return res.status(404).json({ error: 'YouTube endpoint not found.' })
  } catch (e) {
    return res.status(e.status || 502).json({ error: e.message || 'YouTube error' })
  }
}
