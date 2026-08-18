// Serve fotos do Supabase Storage (bucket pode ser privado)

import { fetchStorageBuffer } from './_storage.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const pathOrUrl = req.query.url || req.query.path
  if (!pathOrUrl) return res.status(400).json({ error: 'URL de foto inválida' })

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
