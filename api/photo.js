// Serve fotos do Supabase Storage (bucket pode ser privado)

const SUPABASE_URL = 'https://fxsakrshmldmkdmbevna.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4c2FrcnNobWxkbWtkbWJldm5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMjYwMTEsImV4cCI6MjA5NjcwMjAxMX0.OSnexIDC2bflyDmCTd_pjvcbswB77ri5lDdccEfANMo'
const DEFAULT_BUCKET = 'service-photos'

function parseStorageRef(input) {
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

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const ref = parseStorageRef(req.query.url || req.query.path)
  if (!ref) return res.status(400).json({ error: 'URL de foto inválida' })

  try {
    const storageUrl = `${SUPABASE_URL}/storage/v1/object/${ref.bucket}/${ref.path}`
    const upstream = await fetch(storageUrl, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    })

    if (!upstream.ok) {
      return res.status(upstream.status === 404 ? 404 : 502).json({
        error: upstream.status === 404 ? 'Foto não encontrada' : `Storage error ${upstream.status}`,
      })
    }

    const contentType = upstream.headers.get('content-type') || guessType(ref.path)
    const buf = Buffer.from(await upstream.arrayBuffer())

    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.setHeader('Content-Disposition', `inline; filename="${ref.path.split('/').pop()}"`)
    return res.status(200).send(buf)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

function guessType(path) {
  const ext = (path.split('.').pop() || '').toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'heic' || ext === 'heif') return 'image/heic'
  if (ext === 'gif') return 'image/gif'
  return 'image/jpeg'
}
