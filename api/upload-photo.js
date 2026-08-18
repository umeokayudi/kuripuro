import { uploadStorageObject } from './_storage.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { path, data, contentType } = req.body || {}
  if (!path || !data) return res.status(400).json({ error: 'path e data são obrigatórios' })

  try {
    const buffer = Buffer.from(data, 'base64')
    const storedPath = await uploadStorageObject(path, buffer, contentType || 'image/jpeg')
    return res.status(200).json({ path: storedPath, url: storedPath })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
