import { supabase } from './supabase'

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

/** Envia o vídeo (já comprimido) direto ao Storage. Retorna o path salvo. */
export async function uploadJobVideo(jobId, { blob, contentType, ext }) {
  let lastError = null
  // 1) URL de upload assinada pelo servidor (service role) — o arquivo não passa pela Vercel
  try {
    const resp = await fetch('/api/upload-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'video-upload-url', jobId, contentType }),
    })
    const result = await resp.json().catch(() => ({}))
    if (resp.ok && result.path && result.token) {
      const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(result.path, result.token, blob, { contentType })
      if (!error) return result.path
      lastError = error
    } else if (resp.status === 409) {
      throw new Error(result.error || 'Limite de vídeos atingido')
    }
  } catch (err) {
    if (/Limite/.test(err?.message || '')) throw err
    lastError = err
  }

  // 2) Upload direto com a chave pública (políticas do bucket)
  try {
    const existing = await listFromStorage(jobId).catch(() => [])
    const next = existing.reduce((n, v) => Math.max(n, v.index + 1), 0)
    const path = `jobs/${jobId}/video_${next}.${ext}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: false, contentType })
    if (!error) return path
    lastError = error
  } catch (err) {
    lastError = err
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
