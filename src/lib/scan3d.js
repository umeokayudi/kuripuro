// v1.0.234 · Mundo Kuripuro × 3D: browser side of the scan (see api/_kiri.js).
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
export const MAX_PHOTOS = 120
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024

/** Sends the photos (or one video) to Storage, then asks the server to start the 3D model. */
export async function startScan(modelId, { photos = [], video = null, onProgress } = {}) {
  const batch = Date.now().toString(36)
  const dir = `facility/scans/${modelId}/in`
  if (video) {
    const ext = (video.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4'
    const path = `${dir}/${batch}.${ext}`
    onProgress?.({ stage: 'upload', done: 0, total: 1 })
    const { error } = await supabase.storage.from('service-photos').upload(path, video, { upsert: true, contentType: video.type || 'video/mp4' })
    if (error) throw new Error(`Falha ao enviar o vídeo: ${error.message}`)
    onProgress?.({ stage: 'start' })
    return call('POST', { op: 'start', model_id: modelId, video_path: path, confirm_spend: true })
  }
  const paths = new Array(photos.length)
  let i = 0, done = 0
  const worker = async () => {
    while (i < photos.length) {
      const k = i++
      paths[k] = await uploadJobPhoto(`${dir}/${batch}_${String(k).padStart(3, '0')}.jpg`, photos[k])
      onProgress?.({ stage: 'upload', done: ++done, total: photos.length })
    }
  }
  await Promise.all(Array.from({ length: 3 }, worker))
  onProgress?.({ stage: 'start' })
  return call('POST', { op: 'start', model_id: modelId, paths, confirm_spend: true })
}
