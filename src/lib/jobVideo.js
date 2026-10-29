import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase'

// Vídeos opcionais do serviço, guardados por convenção de caminho (sem coluna no banco):
// service-photos/jobs/<jobId>/video_<n>.<webm|mp4|mov>
const BUCKET = 'service-photos'
const VIDEO_NAME = /^video_(\d+)\.(webm|mp4|mov)$/

async function listFromStorage(jobId) {
  const { data, error } = await supabase.storage.from(BUCKET).list(`jobs/${jobId}`, { limit: 1000 })
  if (error) throw error
  return (data || [])
    .filter(f => VIDEO_NAME.test(f.name || ''))
    .map(f => ({
      path: `jobs/${jobId}/${f.name}`,
      index: Number(f.name.match(VIDEO_NAME)[1]),
      size: f.metadata?.size ?? null,
      created_at: f.created_at || null,
    }))
    .sort((a, b) => a.index - b.index)
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const RETRY_DELAYS = [2000, 5000, 12000]

/** PUT do arquivo na URL assinada, com progresso (fetch não informa progresso de envio). */
function putWithProgress(path, token, blob, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const encoded = path.split('/').map(encodeURIComponent).join('/')
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', `${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${encoded}?token=${encodeURIComponent(token)}`)
    xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY)
    xhr.setRequestHeader('Authorization', `Bearer ${SUPABASE_ANON_KEY}`)
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.setRequestHeader('cache-control', 'max-age=3600')
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable && ev.total) onProgress?.(ev.loaded / ev.total) }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve()
      let msg = ''
      try { msg = JSON.parse(xhr.responseText || '{}').message || '' } catch { /* ignora */ }
      const err = new Error(msg || `Upload falhou (${xhr.status})`)
      err.status = xhr.status
      reject(err)
    }
    xhr.onerror = () => reject(new Error('Sem conexão'))
    xhr.ontimeout = () => reject(new Error('Tempo esgotado'))
    xhr.timeout = 10 * 60 * 1000
    xhr.send(blob)
  })
}

async function requestSignedUpload(jobId, contentType) {
  const resp = await fetch('/api/upload-photo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'video-upload-url', jobId, contentType }),
  })
  const result = await resp.json().catch(() => ({}))
  if (resp.ok && result.path && result.token) return result
  const err = new Error(result.error || `Servidor não liberou o envio (${resp.status})`)
  err.status = resp.status
  throw err
}

// ── v1.0.96 · resumable upload (TUS), poster and a status file the admin can read ─────────────
// Next to each video: video_<n>.jpg (poster) and one jobs/<jobId>/video_status.json with
// { status: 'uploading' | 'uploaded' | 'failed', path, poster, duration, size, updated_at }.
const TUS_CHUNK = 6 * 1024 * 1024 // Supabase wants 6 MB chunks (the last one can be smaller)
const b64 = v => btoa(unescape(encodeURIComponent(String(v))))
const tusHeaders = extra => ({ apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Tus-Resumable': '1.0.0', ...extra })

// https://<ref>.supabase.co → https://<ref>.storage.supabase.co (recommended for large uploads)
function storageHost() {
  const m = String(SUPABASE_URL).match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/)
  return m ? `https://${m[1]}.storage.supabase.co` : SUPABASE_URL
}

function xhr(method, url, headers, body, onProgress) {
  return new Promise((resolve, reject) => {
    const r = new XMLHttpRequest()
    r.open(method, url)
    for (const [k, v] of Object.entries(headers)) r.setRequestHeader(k, v)
    if (onProgress) r.upload.onprogress = ev => { if (ev.lengthComputable) onProgress(ev.loaded) }
    r.onload = () => resolve(r)
    r.onerror = () => reject(new Error('Sem conexão'))
    r.ontimeout = () => reject(new Error('Tempo esgotado'))
    r.timeout = 5 * 60 * 1000
    r.send(body ?? null)
  })
}

/**
 * Upload in 6 MB parts. If the connection drops, the next try asks the server how much arrived
 * (HEAD) and continues from there. `resume` = { path, url } saved by the queue.
 */
async function tusUpload(path, blob, contentType, { onProgress, resume, onResume } = {}) {
  let url = resume?.path === path ? resume.url : null
  let offset = 0
  if (url) {
    const head = await xhr('HEAD', url, tusHeaders({}))
    if (head.status === 200 || head.status === 204) offset = Number(head.getResponseHeader('Upload-Offset') || 0)
    else url = null
  }
  if (!url) {
    const meta = [['bucketName', BUCKET], ['objectName', path], ['contentType', contentType], ['cacheControl', '3600']]
      .map(([k, v]) => `${k} ${b64(v)}`).join(',')
    const createHeaders = tusHeaders({ 'Upload-Length': String(blob.size), 'Upload-Metadata': meta, 'x-upsert': 'true' })
    // v1.0.100: Supabase's direct storage host is faster for big files; the normal one stays as backup
    let created
    let base = storageHost()
    try {
      created = await xhr('POST', `${base}/storage/v1/upload/resumable`, createHeaders)
    } catch {
      base = SUPABASE_URL
      created = await xhr('POST', `${base}/storage/v1/upload/resumable`, createHeaders)
    }
    if (created.status !== 201) {
      let msg = ''
      try { msg = JSON.parse(created.responseText || '{}').message || '' } catch { /* ignore */ }
      const err = new Error(msg || `Upload falhou (${created.status})`)
      err.status = created.status
      throw err
    }
    url = created.getResponseHeader('Location')
    if (!url) throw new Error('Upload sem endereço de retomada')
    if (url.startsWith('/')) url = base + url
    onResume?.({ path, url })
  }
  while (offset < blob.size) {
    const part = blob.slice(offset, offset + TUS_CHUNK)
    const base = offset
    const r = await xhr('PATCH', url, tusHeaders({ 'Upload-Offset': String(offset), 'Content-Type': 'application/offset+octet-stream' }), part,
      loaded => onProgress?.(Math.min(1, (base + loaded) / blob.size)))
    if (r.status !== 204) {
      const err = new Error(`Upload parou (${r.status})`)
      err.status = r.status
      throw err
    }
    offset = Number(r.getResponseHeader('Upload-Offset') || offset + part.size)
    onProgress?.(Math.min(1, offset / blob.size))
  }
  return path
}

/** First frame (~1 s in) as a small JPEG, plus the duration. Never throws. */
export async function videoPoster(blob) {
  try {
    const src = URL.createObjectURL(blob)
    const v = document.createElement('video')
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = src
    try {
      await new Promise((ok, fail) => { v.onloadeddata = ok; v.onerror = fail; setTimeout(fail, 10000) })
      const duration = Number.isFinite(v.duration) ? Math.round(v.duration) : null
      v.currentTime = Math.min(1, (v.duration || 2) / 2)
      await new Promise(ok => { v.onseeked = ok; setTimeout(ok, 3000) })
      const scale = Math.min(1, 480 / Math.max(v.videoWidth || 480, v.videoHeight || 480))
      const c = document.createElement('canvas')
      c.width = Math.max(2, Math.round((v.videoWidth || 480) * scale)); c.height = Math.max(2, Math.round((v.videoHeight || 270) * scale))
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
      const poster = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.7))
      return { poster, duration }
    } finally {
      URL.revokeObjectURL(src)
    }
  } catch {
    return { poster: null, duration: null }
  }
}

const statusPath = jobId => `jobs/${jobId}/video_status.json`

/** Writes the job's video status (best effort; never blocks the upload). */
export async function writeVideoStatus(jobId, info) {
  try {
    const body = new Blob([JSON.stringify({ ...info, updated_at: new Date().toISOString() })], { type: 'application/json' })
    await supabase.storage.from(BUCKET).upload(statusPath(jobId), body, { upsert: true, contentType: 'application/json', cacheControl: '0' })
  } catch { /* status is informative only */ }
}

/** Reads the video status of a job (null when it never had a video). */
export async function readVideoStatus(jobId) {
  try {
    const url = supabase.storage.from(BUCKET).getPublicUrl(statusPath(jobId)).data?.publicUrl
    if (!url) return null
    const r = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

async function nextVideoPath(jobId, ext) {
  const existing = await listFromStorage(jobId).catch(() => [])
  const next = existing.reduce((n, v) => Math.max(n, v.index + 1), 0)
  return `jobs/${jobId}/video_${next}.${ext}`
}

/**
 * Envia o vídeo (já comprimido) direto ao Storage em partes retomáveis. Retorna o path salvo.
 * Progresso 0..1; até 4 tentativas; `resume`/`onResume` deixam a fila continuar de onde parou.
 */
export async function uploadJobVideo(jobId, { blob, contentType, ext, poster, duration }, { onProgress, resume, onResume } = {}) {
  let lastError = null
  const path = resume?.path || await nextVideoPath(jobId, ext)
  await writeVideoStatus(jobId, { status: 'uploading', path, size: blob.size, duration: duration ?? null })
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS[attempt - 1])
    try {
      await tusUpload(path, blob, contentType, { onProgress, resume, onResume: info => { resume = info; onResume?.(info) } })
      lastError = null
      break
    } catch (err) {
      lastError = err
      // Resumable endpoint refused (not a network drop): one plain upload as before.
      if (err?.status && err.status >= 400 && err.status < 500 && err.status !== 409) {
        try {
          const signed = await requestSignedUpload(jobId, contentType)
          await putWithProgress(signed.path, signed.token, blob, contentType, onProgress)
          return finishUpload(jobId, signed.path, { blob, poster, duration })
        } catch (e2) { lastError = e2 }
      }
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) break
  }
  if (lastError) {
    await writeVideoStatus(jobId, { status: 'failed', path, size: blob.size, duration: duration ?? null, error: String(lastError.message || lastError).slice(0, 200) })
    throw new Error(lastError?.message || 'Falha ao enviar vídeo')
  }
  return finishUpload(jobId, path, { blob, poster, duration })
}

async function finishUpload(jobId, path, { blob, poster, duration }) {
  let posterPath = null
  try {
    if (poster) {
      posterPath = path.replace(/\.[a-z0-9]+$/, '.jpg')
      const { error } = await supabase.storage.from(BUCKET).upload(posterPath, poster, { upsert: true, contentType: 'image/jpeg' })
      if (error) posterPath = null
    }
  } catch { posterPath = null }
  await writeVideoStatus(jobId, { status: 'uploaded', path, poster: posterPath, size: blob.size, duration: duration ?? null })
  return path
}

/** Lista os vídeos de um serviço com URLs assinadas (1h) para tocar no <video>. */
export async function listJobVideos(jobId) {
  if (!jobId) return []
  try {
    const resp = await fetch(`/api/photo?videos=${encodeURIComponent(jobId)}`, { cache: 'no-store' })
    if (resp.ok) {
      const result = await resp.json()
      if (Array.isArray(result.videos)) return result.videos.filter(v => v.url).map(withPoster)
    }
  } catch {
    // fallback abaixo
  }
  const videos = await listFromStorage(jobId)
  if (!videos.length) return []
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(videos.map(v => v.path), 3600)
  const signed = Object.fromEntries((data || []).filter(d => d.signedUrl).map(d => [d.path, d.signedUrl]))
  return videos.map(v => ({
    ...v,
    url: signed[v.path] || supabase.storage.from(BUCKET).getPublicUrl(v.path).data?.publicUrl || null,
  })).filter(v => v.url).map(withPoster)
}

// Poster saved next to the video (video_<n>.jpg); lists show only this until someone taps play.
function withPoster(v) {
  const posterPath = v.path.replace(/\.[a-z0-9]+$/, '.jpg')
  return { ...v, poster: supabase.storage.from(BUCKET).getPublicUrl(posterPath).data?.publicUrl || null }
}

// v1.0.100 · Reports list: video icon per row without loading any video. Reads only the small
// status file, at most 4 at a time, cached for this page visit.
const statusCache = new Map()
const waiting = []
let active = 0
function pump() {
  while (active < 4 && waiting.length) {
    const { jobId, resolve } = waiting.shift()
    active++
    readVideoStatus(jobId).then(resolve, () => resolve(null)).finally(() => { active--; pump() })
  }
}
export function peekVideoStatus(jobId) {
  if (!jobId) return Promise.resolve(null)
  if (!statusCache.has(jobId)) statusCache.set(jobId, new Promise(resolve => { waiting.push({ jobId, resolve }); pump() }))
  return statusCache.get(jobId)
}
