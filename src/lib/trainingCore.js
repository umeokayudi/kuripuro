// v1.0.189 · Treinamento (training videos) — pure helpers, no Supabase, shared by the admin page,
// the employee screen and the tests.
//
// Catalog (one JSON for the company):  { videos: [Video], updated_at }
//   Video = { id, yt, title, channel, thumb, duration_s, category, required, audience: 'all' | [employeeId],
//             note, order, added_at }
// Progress (one JSON per employee):    { [videoId]: { watched_s, pos, pct, done, done_at, last_at } }

export const DONE_RATIO = 0.9 // watched 90% of the video (really watched, not skipped) = done

const YT_ID = /^[A-Za-z0-9_-]{11}$/

/**
 * Understands any YouTube link (or a bare 11-char id) and says what it is.
 * → { videoId } | { playlistId } | { channel } | null
 */
export function parseYouTube(input) {
  const raw = String(input || '').trim()
  if (!raw) return null
  if (YT_ID.test(raw)) return { videoId: raw }
  if (/^@[\w.-]{2,}$/.test(raw)) return { channel: raw }
  if (/^UC[\w-]{22}$/.test(raw)) return { channel: raw }
  if (/^(PL|UU|OL|FL|LL)[\w-]{10,}$/.test(raw)) return { playlistId: raw }
  let url
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) } catch { return null }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '')
  const parts = url.pathname.split('/').filter(Boolean)
  if (host === 'youtu.be') return YT_ID.test(parts[0] || '') ? { videoId: parts[0] } : null
  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return null
  const v = url.searchParams.get('v')
  if (v && YT_ID.test(v)) return { videoId: v }
  if (['shorts', 'embed', 'live', 'v'].includes(parts[0]) && YT_ID.test(parts[1] || '')) return { videoId: parts[1] }
  const list = url.searchParams.get('list')
  if (list) return { playlistId: list }
  if (parts[0]?.startsWith('@')) return { channel: parts[0] }
  if (parts[0] === 'channel' && parts[1]) return { channel: parts[1] }
  return null
}

/** Every video id found in a pasted block (one or many links, any separator), without repeats. */
export function videoIdsIn(text) {
  const out = []
  for (const piece of String(text || '').split(/[\s,;]+/)) {
    const p = parseYouTube(piece)
    if (p?.videoId && !out.includes(p.videoId)) out.push(p.videoId)
  }
  return out
}

export const thumbOf = yt => `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`
export const watchUrl = yt => `https://www.youtube.com/watch?v=${yt}`

export function fmtDuration(s) {
  const n = Math.round(Number(s) || 0)
  if (!n) return ''
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), sec = n % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

const newId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)

export function makeVideo({ yt, title, channel, thumb, duration_s, category, required, audience, note }, order = 0) {
  return {
    id: newId(),
    yt,
    title: String(title || '').trim() || 'YouTube',
    channel: channel || '',
    thumb: thumb || thumbOf(yt),
    duration_s: Number(duration_s) || 0,
    category: String(category || '').trim(),
    required: !!required,
    audience: Array.isArray(audience) && audience.length ? audience : 'all',
    note: String(note || '').trim(),
    order,
    added_at: new Date().toISOString(),
  }
}

export const sortVideos = list => [...(list || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.added_at).localeCompare(String(b.added_at)))

/** Adds new videos at the end; a video already in the catalog (same YouTube id) is not added twice. */
export function addVideos(list, drafts) {
  const cur = sortVideos(list)
  const have = new Set(cur.map(v => v.yt))
  let order = cur.length ? Math.max(...cur.map(v => v.order ?? 0)) + 1 : 0
  const added = []
  for (const d of drafts || []) {
    if (!d?.yt || have.has(d.yt)) continue
    have.add(d.yt)
    added.push(makeVideo(d, order++))
  }
  return { list: [...cur, ...added], added: added.length, skipped: (drafts || []).length - added.length }
}

/** Moves one video up (-1) or down (+1) and renumbers. */
export function moveVideo(list, id, dir) {
  const cur = sortVideos(list)
  const i = cur.findIndex(v => v.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= cur.length) return cur.map((v, k) => ({ ...v, order: k }))
  ;[cur[i], cur[j]] = [cur[j], cur[i]]
  return cur.map((v, k) => ({ ...v, order: k }))
}

export const visibleTo = (video, employeeId) =>
  !video?.audience || video.audience === 'all' || (Array.isArray(video.audience) && video.audience.includes(employeeId))

export const videosFor = (list, employeeId) => sortVideos(list).filter(v => visibleTo(v, employeeId))

/**
 * One player tick. Counts only seconds that were really played (a jump forward does not count),
 * so skipping to the end does not mark the video done.
 */
export function tickProgress(prev, { current, duration, lastCurrent }) {
  const p = { watched_s: 0, pos: 0, pct: 0, done: false, ...(prev || {}) }
  const dur = Number(duration) || 0
  const cur = Number(current) || 0
  const step = cur - (Number(lastCurrent) || 0)
  if (step > 0 && step <= 3) p.watched_s = Math.min(dur || Infinity, (p.watched_s || 0) + step)
  p.pos = cur
  p.pct = dur ? Math.min(1, p.watched_s / dur) : 0
  p.last_at = new Date().toISOString()
  if (!p.done && dur && p.pct >= DONE_RATIO) { p.done = true; p.done_at = p.last_at }
  return p
}

/** The player said "ended": done only if most of it was really watched. */
export function endProgress(prev, duration) {
  const p = { ...(prev || {}) }
  const dur = Number(duration) || 0
  p.pos = 0
  p.last_at = new Date().toISOString()
  if (!p.done && dur && (p.watched_s || 0) / dur >= DONE_RATIO - 0.05) { p.done = true; p.done_at = p.last_at; p.pct = 1 }
  return p
}

/** What one employee still has to do. */
export function summary(list, progress, employeeId) {
  const mine = videosFor(list, employeeId)
  const pr = progress || {}
  const done = mine.filter(v => pr[v.id]?.done).length
  const requiredLeft = mine.filter(v => v.required && !pr[v.id]?.done).length
  return { total: mine.length, done, requiredLeft, left: mine.length - done }
}

/** Groups for the screen: category name → videos, in catalog order (no category = ''). */
export function byCategory(list) {
  const out = []
  for (const v of list) {
    const k = v.category || ''
    let g = out.find(x => x.category === k)
    if (!g) out.push(g = { category: k, videos: [] })
    g.videos.push(v)
  }
  return out
}
