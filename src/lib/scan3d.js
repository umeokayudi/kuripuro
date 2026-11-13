// v1.0.235 · Mundo Kuripuro × "Planta e modelo 3D": browser side of the scan (see api/_kiri.js).
import { supabase } from './supabase'
import { uploadJobPhoto } from './uploadPhoto'

async function call(method, body, query = '') {
  const r = await fetch(`/api/scan3d${query}`, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  const json = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(json.error || `Falha (${r.status})`)
  return json
}
export const scanStatus = modelId => call('GET', null, `?model_id=${encodeURIComponent(modelId)}`)
export const scanCheck = (modelId, scanId) => call('POST', { op: 'check', model_id: modelId, scan_id: scanId })
export const scanRemove = (modelId, scanId) => call('POST', { op: 'remove', model_id: modelId, scan_id: scanId })

export const MIN_PHOTOS = 20
export const MAX_PHOTOS = 300
// Storage (free plan) takes at most 50 MB per file
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024
export const VIDEO_MAX_SEC = 180
export const VIDEO_MAX_LONG = 1920
export const VIDEO_MAX_SHORT = 1080
const PHOTO_MAX_SIDE = 2048

/** Duration and size of a video, read in the browser. null when the browser cannot open it (e.g. a codec it does not play). */
export function readVideoMeta(file, timeoutMs = 8000) {
  return new Promise(resolve => {
    let url = null, timer = null, settled = false
    const video = document.createElement('video')
    const done = value => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      video.removeAttribute('src')
      try { video.load() } catch { /* already gone */ }
      if (url) URL.revokeObjectURL(url)
      resolve(value)
    }
    try {
      url = URL.createObjectURL(file)
      video.preload = 'metadata'
      video.muted = true
      video.playsInline = true
      video.onloadedmetadata = () => done({ duration: Number.isFinite(video.duration) ? video.duration : null, width: video.videoWidth || 0, height: video.videoHeight || 0 })
      video.onerror = () => done(null)
      timer = setTimeout(() => done(null), timeoutMs)
      video.src = url
    } catch { done(null) }
  })
}

/** Why this video cannot be used ('long' | 'big' | 'heavy'), or null when it fits. meta comes from readVideoMeta. */
export function videoProblem(file, meta) {
  if (file.size > MAX_VIDEO_BYTES) return 'heavy'
  if (meta?.duration && meta.duration > VIDEO_MAX_SEC + 0.5) return 'long'
  if (meta?.width && meta?.height && (Math.max(meta.width, meta.height) > VIDEO_MAX_LONG || Math.min(meta.width, meta.height) > VIDEO_MAX_SHORT)) return 'big'
  return null
}

/** Photo → JPEG with the long side at most 2048 px (quality .85). Falls back to the original file (uploadJobPhoto still converts HEIC etc.). */
export async function shrinkPhoto(file) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const ratio = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    if (ratio === 1 && file.type === 'image/jpeg' && file.size < 2_500_000) { bitmap.close?.(); return file }
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio))
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    canvas.width = canvas.height = 0
    if (!blob) return file
    return new File([blob], (file.name || 'photo.jpg').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch { return file }
}

/** Sends the photos (or one video) to Storage, then asks the server to start the 3D model (1 credit). */
export async function startScan(modelId, { photos = [], video = null, onProgress } = {}) {
  const batch = Date.now().toString(36)
  const dir = `facility/scans/${modelId}/in`
  if (video) {
    if (video.size > MAX_VIDEO_BYTES) throw new Error(`O vídeo tem ${(video.size / 1048576).toFixed(0)} MB e o nosso armazenamento aceita até 50 MB por arquivo.`)
    const ext = (video.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4'
    const path = `${dir}/${batch}.${ext}`
    onProgress?.({ stage: 'upload', done: 0, total: 1 })
    const { error } = await supabase.storage.from('service-photos').upload(path, video, { upsert: true, contentType: video.type || 'video/mp4' })
    if (error) throw new Error(`Falha ao enviar o vídeo: ${error.message}. O nosso armazenamento aceita até 50 MB por arquivo; nada foi mandado ao KIRI.`)
    onProgress?.({ stage: 'start' })
    return call('POST', { op: 'start', model_id: modelId, video_path: path, confirm_spend: true })
  }
  const paths = new Array(photos.length)
  let i = 0, done = 0
  const worker = async () => {
    while (i < photos.length) {
      const k = i++
      paths[k] = await uploadJobPhoto(`${dir}/${batch}_${String(k).padStart(3, '0')}.jpg`, await shrinkPhoto(photos[k]))
      onProgress?.({ stage: 'upload', done: ++done, total: photos.length })
    }
  }
  await Promise.all(Array.from({ length: 3 }, worker))
  onProgress?.({ stage: 'start' })
  return call('POST', { op: 'start', model_id: modelId, paths, confirm_spend: true })
}
