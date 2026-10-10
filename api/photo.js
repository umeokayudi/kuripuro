// Serve fotos do Supabase Storage (bucket pode ser privado)

import { fetchStorageBuffer, parseStorageRef, uploadStorageObject } from './_storage.js'

// Only job/claim photos go through here. Private buckets (signed contracts,
// business cards, meeting audio) are served only by /api/sales-files.
const PUBLIC_PHOTO_BUCKET = 'service-photos'
const UPLOAD_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_UPLOAD = 4 * 1024 * 1024

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const { path, data, contentType } = req.body || {}
    if (!path || !data) return res.status(400).json({ error: 'path e data são obrigatórios' })
    const type = String(contentType || 'image/jpeg').toLowerCase()
    if (!UPLOAD_TYPES.has(type)) return res.status(415).json({ error: 'Envie uma foto JPEG, PNG ou WebP.' })
    try {
      const buffer = Buffer.from(data, 'base64')
      if (!buffer.length || buffer.length > MAX_UPLOAD) return res.status(413).json({ error: 'Foto vazia ou grande demais.' })
      const storedPath = await uploadStorageObject(path, buffer, type)
      return res.status(200).json({ path: storedPath, url: storedPath })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const pathOrUrl = req.query.url || req.query.path
  if (!pathOrUrl) return res.status(400).json({ error: 'URL de foto inválida' })
  const ref = parseStorageRef(pathOrUrl)
  if (!ref || ref.bucket !== PUBLIC_PHOTO_BUCKET || ref.path.includes('..')) return res.status(404).json({ error: 'Foto não encontrada' })

  try {
    const { buffer, contentType } = await fetchStorageBuffer(pathOrUrl)

    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.setHeader('Content-Disposition', `inline; filename="${String(pathOrUrl).split('/').pop()}"`)
    return res.status(200).send(buffer)
  } catch (err) {
    const status = err.message === 'Foto não encontrada' ? 404 : 502
    return res.status(status).json({ error: err.message })
  }
}
