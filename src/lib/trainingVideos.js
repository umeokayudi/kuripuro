// v1.0.190 · Treinamento — storage + API calls. No SQL: small JSON files in the public
// service-photos bucket (same as job signatures / reports):
//   training/videos.json             → the catalog the admin curates
//   training/progress/<employeeId>.json → what each employee watched
// The videos themselves stay on YouTube (unlisted or public) and play in the YouTube player.
import { supabase } from './supabase'
import { storagePublicUrl } from './workReport'
import { apiFetch } from './apiFetch'

const BUCKET = 'service-photos'
const CATALOG = 'training/videos.json'
const progressPath = id => `training/progress/${id}.json`

async function readJson(path) {
  const r = await fetch(`${storagePublicUrl(path)}?t=${Date.now()}`, { cache: 'no-store' })
  if (r.status === 404 || r.status === 400) return null
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

async function writeJson(path, data) {
  const body = new Blob([JSON.stringify(data)], { type: 'application/json' })
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, { upsert: true, contentType: 'application/json', cacheControl: '0' })
  if (error) throw new Error(error.message)
}

export async function loadCatalog() {
  try {
    const j = await readJson(CATALOG)
    return Array.isArray(j?.videos) ? j.videos : []
  } catch { return [] }
}

export async function saveCatalog(videos) {
  await writeJson(CATALOG, { videos, updated_at: new Date().toISOString() })
  window.dispatchEvent(new Event(TRAINING_CHANGED))
}

export async function loadProgress(employeeId) {
  if (!employeeId) return {}
  try { return (await readJson(progressPath(employeeId))) || {} } catch { return {} }
}

export async function saveProgress(employeeId, progress) {
  if (!employeeId) return
  await writeJson(progressPath(employeeId), progress || {})
}

export const TRAINING_CHANGED = 'kp-training-changed'

async function api(op, params = {}) {
  const qs = new URLSearchParams({ op, ...params })
  const r = await apiFetch(`/api/youtube/${op}?${qs}`, { credentials: 'include' })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
  return j
}

/** Title, channel, thumbnail (and length when the YouTube key is set) of one video. */
export const videoInfo = id => api('info', { id })
/** Whether YOUTUBE_API_KEY is set (needed only to import a whole channel/playlist). */
export const youtubeStatus = () => api('status')
/** Every video of a channel (@handle / UC… / link) or a playlist (also unlisted videos in it). */
export const importFromYouTube = source => api('list', { source })
