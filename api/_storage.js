// Supabase Storage helpers (server-side, service role when available)

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://fxsakrshmldmkdmbevna.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || (process.env.NODE_ENV === 'production' ? null : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4c2FrcnNobWxkbWtkbWJldm5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMjYwMTEsImV4cCI6MjA5NjcwMjAxMX0.OSnexIDC2bflyDmCTd_pjvcbswB77ri5lDdccEfANMo')

if (!process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.VERCEL_ENV === 'production') {
  console.warn('[storage] SUPABASE_SERVICE_ROLE_KEY missing in production — photo proxy may fail')
}

const DEFAULT_BUCKET = 'service-photos'

export function parseStorageRef(input) {
  if (!input) return null
  const raw = String(input).trim()
  if (!raw) return null

  if (!raw.startsWith('http')) {
    const path = raw.replace(/^\/+/, '')
    if (path.includes('/')) return { bucket: DEFAULT_BUCKET, path }
    return null
  }

  try {
    const u = new URL(raw)
    const patterns = [
      /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)/,
      /\/storage\/v1\/object\/([^/]+)\/(.+)/,
    ]
    for (const re of patterns) {
      const m = u.pathname.match(re)
      if (m) return { bucket: m[1], path: decodeURIComponent(m[2]) }
    }
  } catch {}

  return null
}

function storageHeaders(extra = {}) {
  if (!SUPABASE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY required')
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...extra,
  }
}

export async function fetchStorageBuffer(pathOrUrl) {
  const ref = parseStorageRef(pathOrUrl)
  if (!ref) throw new Error('URL de foto inválida')

  const storageUrl = `${SUPABASE_URL}/storage/v1/object/${ref.bucket}/${ref.path}`
  const upstream = await fetch(storageUrl, { headers: storageHeaders() })

  if (!upstream.ok) {
    throw new Error(upstream.status === 404 ? 'Foto não encontrada' : `Storage error ${upstream.status}`)
  }

  return {
    buffer: Buffer.from(await upstream.arrayBuffer()),
    contentType: upstream.headers.get('content-type') || guessType(ref.path),
    path: ref.path,
  }
}

export async function uploadStorageObject(path, buffer, contentType = 'image/jpeg') {
  const cleanPath = String(path).replace(/^\/+/, '')
  if (!/^(jobs|claims|facility)\//.test(cleanPath)) {
    throw new Error('Caminho de upload inválido')
  }

  const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/${DEFAULT_BUCKET}/${cleanPath}`, {
    method: 'POST',
    headers: storageHeaders({
      'Content-Type': contentType,
      'x-upsert': 'true',
    }),
    body: buffer,
  })

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    throw new Error(`Upload falhou (${resp.status}): ${detail || 'verifique bucket e políticas no Supabase'}`)
  }

  return cleanPath
}

// Vídeos do serviço: o arquivo vai direto do navegador para o Storage (URL de upload assinada),
// porque o corpo de uma função da Vercel é limitado a ~4,5 MB.
const VIDEO_NAME = /^video_(\d+)\.(webm|mp4|mov)$/

export async function listJobVideos(jobId) {
  const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${DEFAULT_BUCKET}`, {
    method: 'POST',
    headers: storageHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefix: `jobs/${jobId}`, limit: 1000, sortBy: { column: 'name', order: 'asc' } }),
  })
  if (!resp.ok) throw new Error(`Storage error ${resp.status}`)
  const rows = await resp.json()
  return (Array.isArray(rows) ? rows : [])
    .filter(r => VIDEO_NAME.test(r.name || ''))
    .map(r => ({
      path: `jobs/${jobId}/${r.name}`,
      index: Number(r.name.match(VIDEO_NAME)[1]),
      size: r.metadata?.size ?? null,
      created_at: r.created_at || null,
    }))
    .sort((a, b) => a.index - b.index)
}

export async function createSignedUploadUrl(path) {
  const cleanPath = String(path).replace(/^\/+/, '')
  if (!/^jobs\/[\w-]+\/video_\d+\.(webm|mp4|mov)$/.test(cleanPath)) throw new Error('Caminho de upload inválido')
  const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${DEFAULT_BUCKET}/${cleanPath}`, {
    method: 'POST',
    headers: storageHeaders({ 'Content-Type': 'application/json' }),
    body: '{}',
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(`Upload assinado falhou (${resp.status}): ${data.message || data.error || ''}`)
  const token = data.url ? new URL(`${SUPABASE_URL}/storage/v1${data.url}`).searchParams.get('token') : null
  if (!token) throw new Error('Storage não devolveu token de upload')
  return { path: cleanPath, token }
}

export async function createSignedUrls(paths, expiresIn = 3600) {
  if (!paths.length) return {}
  const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${DEFAULT_BUCKET}`, {
    method: 'POST',
    headers: storageHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ expiresIn, paths }),
  })
  if (!resp.ok) throw new Error(`Storage error ${resp.status}`)
  const rows = await resp.json()
  const out = {}
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r.signedURL && r.path) out[r.path] = `${SUPABASE_URL}/storage/v1${r.signedURL}`
  }
  return out
}

function guessType(path) {
  const ext = (path.split('.').pop() || '').toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'heic' || ext === 'heif') return 'image/heic'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'webm') return 'video/webm'
  if (ext === 'mp4') return 'video/mp4'
  if (ext === 'mov') return 'video/quicktime'
  return 'image/jpeg'
}
