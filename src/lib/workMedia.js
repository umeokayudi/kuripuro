// v1.0.155 · Every photo and video the team uploaded for a service, read from its storage folder
// (jobs/<jobId>/start_N.jpg = before, end_N.jpg / retro.jpg = after, video_N.* = video) plus the
// job's own photo fields. Used to pre-fill reports and for the client's store gallery.
import { supabase } from './supabase'

const BUCKET = 'service-photos'
const VIDEO_RE = /^video_(\d+)\.(mp4|webm|mov|m4v)$/i

const normPath = p => {
  if (!p) return null
  const s = String(p)
  const m = s.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/service-photos\/([^?]+)/)
  return m ? decodeURIComponent(m[1]) : s.replace(/^\/+/, '')
}

const kindOf = name => {
  if (VIDEO_RE.test(name)) return { kind: 'video', section: 'after', order: 300 + Number(name.match(VIDEO_RE)[1]) }
  if (/^start_?\d*\.(jpe?g|png|webp|heic)$/i.test(name)) return { kind: 'photo', section: 'before', order: Number((name.match(/\d+/) || [0])[0]) }
  if (/^(end_?\d*|retro\d*)\.(jpe?g|png|webp|heic)$/i.test(name)) return { kind: 'photo', section: 'after', order: 100 + Number((name.match(/\d+/) || [0])[0]) }
  return null
}

/** Media of one job: [{ path, kind: 'photo'|'video', section: 'before'|'after', job_id }] */
export async function listJobMedia(job) {
  if (!job?.id) return []
  const out = new Map()
  const add = (path, info) => { const p = normPath(path); if (p && !out.has(p)) out.set(p, { path: p, job_id: job.id, ...info }) }
  try {
    const { data } = await supabase.storage.from(BUCKET).list(`jobs/${job.id}`, { limit: 200 })
    for (const f of data || []) {
      const k = kindOf(f.name || '')
      if (k && f.id !== null) add(`jobs/${job.id}/${f.name}`, k)
    }
  } catch { /* the job fields below still give the main photos */ }
  if (job.photo_start_url) add(job.photo_start_url, { kind: 'photo', section: 'before', order: -1 })
  if (job.photo_end_url) add(job.photo_end_url, { kind: 'photo', section: 'after', order: 99 })
  return [...out.values()].sort((a, b) => a.order - b.order).map(({ order, ...m }) => m)
}

/** Media of many jobs (8 folders at a time). Returns Map jobId → media[]. */
export async function mediaForJobs(jobs, { onProgress } = {}) {
  const list = (jobs || []).filter(j => j?.id)
  const map = new Map()
  let i = 0, done = 0
  const worker = async () => {
    while (i < list.length) {
      const j = list[i++]
      map.set(j.id, await listJobMedia(j).catch(() => []))
      onProgress?.(++done, list.length)
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
  return map
}

export const isVideoPath = p => /\.(mp4|webm|mov|m4v)$/i.test(String(p || ''))
