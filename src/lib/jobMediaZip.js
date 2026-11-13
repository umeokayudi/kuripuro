// v1.0.230 · "Baixar tudo (fotos e vídeos)": every photo and video of ONE service in one ZIP,
// with clear names (antes-1.jpg, depois-1.jpg, video-1.mp4). Read-only: it only downloads the
// files the screen already shows and packs them — nothing in storage is changed or deleted.
import { supabase } from './supabase'
import { listJobMedia } from './workMedia'
import { listJobVideos } from './jobVideo'
import { zipFiles } from './zipStore'

const BUCKET = 'service-photos'

const extOf = (p, fallback) => {
  const m = String(p || '').split('?')[0].match(/\.([a-z0-9]{2,5})$/i)
  return m ? m[1].toLowerCase() : fallback
}

/** Safe file name that keeps accents and Japanese (only drops characters PCs refuse). */
export function zipSafeName(s, max = 80) {
  return String(s || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^[_.]+|[_.]+$/g, '')
    .slice(0, max)
}

/** kuripuro_2026-11-12_OTP_Shinbashi_Gabriel.zip */
export function jobZipName({ date, place, employee } = {}) {
  const base = [date, place, employee].map(x => zipSafeName(x, 40)).filter(Boolean).join('_')
  return `kuripuro_${base || 'servico'}.zip`
}

/**
 * Media list with the names they get inside the ZIP, in screen order:
 * all "antes", then all "depois", then videos. [{ path, url, name, kind, section }]
 */
export async function jobZipEntries(job) {
  if (!job?.id) return []
  const [media, videos] = await Promise.all([
    listJobMedia(job).catch(() => []),
    listJobVideos(job.id).catch(() => []),
  ])
  const urlOf = p => (/^(https?:|data:|blob:)/i.test(p) ? p : supabase.storage.from(BUCKET).getPublicUrl(p).data?.publicUrl)
  const byPath = new Map()
  for (const m of media) byPath.set(m.path, { ...m, url: urlOf(m.path) })
  // The video list from the server gives signed links (work even if the folder list is refused).
  for (const v of videos) {
    if (!v?.path) continue
    const prev = byPath.get(v.path)
    byPath.set(v.path, { ...(prev || { path: v.path, kind: 'video', section: 'after' }), kind: 'video', url: v.url || prev?.url || urlOf(v.path) })
  }
  const all = [...byPath.values()].filter(m => m.url)
  const before = all.filter(m => m.kind === 'photo' && m.section === 'before')
  const after = all.filter(m => m.kind === 'photo' && m.section !== 'before')
  const vids = all.filter(m => m.kind === 'video')
  const named = (list, prefix, ext) => list.map((m, i) => ({ ...m, name: `${prefix}-${i + 1}.${extOf(m.path, ext)}` }))
  return [...named(before, 'antes', 'jpg'), ...named(after, 'depois', 'jpg'), ...named(vids, 'video', 'mp4')]
}

async function fetchBytes(url) {
  if (url.startsWith('data:')) {
    const b64 = url.split(',')[1] || ''
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}

/**
 * Downloads every file (3 at a time) and builds the ZIP.
 * onProgress({ done, total }) · returns { blob, count, total, failed: [names] }
 */
export async function buildJobMediaZip(entries, { onProgress } = {}) {
  const list = entries || []
  const results = new Array(list.length)
  const failed = []
  let next = 0, done = 0
  const worker = async () => {
    while (next < list.length) {
      const i = next++
      try { results[i] = { name: list[i].name, data: await fetchBytes(list[i].url) } }
      catch { failed.push(list[i].name) }
      onProgress?.({ done: ++done, total: list.length })
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, list.length) }, worker))
  const files = results.filter(Boolean)
  if (!files.length) return { blob: null, count: 0, total: list.length, failed }
  return { blob: zipFiles(files), count: files.length, total: list.length, failed }
}

/** Saves the ZIP on this device (PC: Downloads · phone: browser download / share sheet). */
export async function saveZip(blob, fileName) {
  const iosApp = typeof navigator !== 'undefined' && navigator.standalone === true
  if (iosApp && typeof File !== 'undefined' && navigator.canShare) {
    // iPhone app on the home screen ignores <a download>; the share sheet has "Save to Files".
    const file = new File([blob], fileName, { type: 'application/zip' })
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: fileName }); return 'shared' }
      catch (e) { if (e?.name === 'AbortError') return 'cancelled' }
    }
  }
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href; a.download = fileName; a.rel = 'noopener'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 120000)
  return 'downloaded'
}
