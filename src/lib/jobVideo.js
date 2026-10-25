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

/**
 * Envia o vídeo (já comprimido) direto ao Storage. Retorna o path salvo.
 * Mostra progresso (0..1) e tenta de novo até 4 vezes quando a internet falha.
 */
export async function uploadJobVideo(jobId, { blob, contentType, ext }, { onProgress } = {}) {
  let lastError = null
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    let signedError = null
    if (attempt > 0) {
      onProgress?.(0)
      await sleep(RETRY_DELAYS[attempt - 1])
    }
    // 1) URL de upload assinada pelo servidor (service role) — o arquivo não passa pela Vercel
    try {
      const signed = await requestSignedUpload(jobId, contentType)
      await putWithProgress(signed.path, signed.token, blob, contentType, onProgress)
      onProgress?.(1)
      return signed.path
    } catch (err) {
      if (err?.status === 409) throw new Error(err.message || 'Limite de vídeos atingido')
      signedError = err
    }

    // 2) Upload direto com a chave pública (políticas do bucket)
    try {
      const existing = await listFromStorage(jobId).catch(() => [])
      const next = existing.reduce((n, v) => Math.max(n, v.index + 1), 0)
      const path = `jobs/${jobId}/video_${next}.${ext}`
      const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: false, contentType })
      if (!error) { onProgress?.(1); return path }
      lastError = signedError || error
    } catch (err) {
      lastError = signedError || err
    }
    // Sem internet: não adianta gastar as tentativas agora; a fila tenta quando voltar
    if (typeof navigator !== 'undefined' && navigator.onLine === false) break
  }
  throw new Error(lastError?.message || 'Falha ao enviar vídeo')
}

/** Lista os vídeos de um serviço com URLs assinadas (1h) para tocar no <video>. */
export async function listJobVideos(jobId) {
  if (!jobId) return []
  try {
    const resp = await fetch(`/api/photo?videos=${encodeURIComponent(jobId)}`, { cache: 'no-store' })
    if (resp.ok) {
      const result = await resp.json()
      if (Array.isArray(result.videos)) return result.videos.filter(v => v.url)
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
  })).filter(v => v.url)
}
