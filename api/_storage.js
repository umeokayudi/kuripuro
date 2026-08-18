// Supabase Storage helpers (server-side, service role when available)

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://fxsakrshmldmkdmbevna.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4c2FrcnNobWxkbWtkbWJldm5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMjYwMTEsImV4cCI6MjA5NjcwMjAxMX0.OSnexIDC2bflyDmCTd_pjvcbswB77ri5lDdccEfANMo'

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
  if (!/^(jobs|claims)\//.test(cleanPath)) {
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

function guessType(path) {
  const ext = (path.split('.').pop() || '').toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'heic' || ext === 'heif') return 'image/heic'
  if (ext === 'gif') return 'image/gif'
  return 'image/jpeg'
}
