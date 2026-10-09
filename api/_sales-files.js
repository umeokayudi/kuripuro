import { SALES_BUCKET, normalizeMime, ownsSalesObject, requireActiveSalesSession, salesDb } from './_salesSession.js'

const BUCKET = SALES_BUCKET
const MAX_IMAGE = 8 * 1024 * 1024
const MAX_AUDIO = 18 * 1024 * 1024
const MAX_PDF = 15 * 1024 * 1024

const MIME_EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'application/pdf': 'pdf', 'audio/webm': 'webm', 'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const user = await requireActiveSalesSession(req, res)
  if (!user) return
  try {
    const db = salesDb()
    if (req.method === 'POST') {
      if (user.role !== 'salesperson') return res.status(403).json({ error: 'O envio de arquivos deve ser feito pela conta do vendedor.' })
      const { purpose, size } = req.body || {}
      const mime = normalizeMime(req.body?.mime_type)
      const extension = MIME_EXT[mime]
      if (!extension || !['business-card', 'contract', 'meeting-audio'].includes(purpose)) return res.status(400).json({ error: 'Tipo de arquivo não permitido.' })
      if (purpose === 'contract' && mime !== 'application/pdf') return res.status(400).json({ error: 'O contrato assinado precisa ser PDF.' })
      if (purpose === 'business-card' && !mime.startsWith('image/')) return res.status(400).json({ error: 'Envie uma imagem do cartão.' })
      if (purpose === 'meeting-audio' && !mime.startsWith('audio/')) return res.status(400).json({ error: 'Envie um arquivo de áudio.' })
      const max = purpose === 'contract' ? MAX_PDF : purpose === 'meeting-audio' ? MAX_AUDIO : MAX_IMAGE
      if (!Number(size) || Number(size) > max) return res.status(413).json({ error: `Arquivo vazio ou acima de ${Math.round(max / 1024 / 1024)} MB.` })
      const prefix = purpose === 'contract' ? 'contracts' : purpose === 'meeting-audio' ? 'meetings' : 'cards'
      const path = `${prefix}/${user.id}/${crypto.randomUUID()}.${extension}`
      // The browser uploads straight to Storage with this one-time URL, so big
      // files never pass through the Vercel function body limit.
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path)
      if (error) throw error
      return res.status(200).json({ path, mime_type: mime, upload_url: data.signedUrl })
    }

    if (req.method === 'GET') {
      const path = String(req.query?.path || '')
      const submissionId = String(req.query?.submission_id || '')
      let allowed = user.role === 'admin'
      if (!allowed && submissionId) {
        const { data: contract } = await db.from('sales_contract_submissions').select('salesperson_id,signed_pdf_object_path').eq('id', submissionId).maybeSingle()
        allowed = contract?.salesperson_id === user.id && contract?.signed_pdf_object_path === path
      } else if (!allowed) allowed = ownsSalesObject(user, path, ['cards', 'meetings'])
      if (!allowed || !ownsSalesObject(user, path) && user.role !== 'admin') return res.status(403).json({ error: 'Acesso negado ao arquivo.' })
      const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 60)
      if (error) throw error
      return res.status(200).json({ url: data.signedUrl })
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    console.error('[sales-files]', error?.message || error)
    return res.status(500).json({ error: 'Não foi possível processar o arquivo.' })
  }
}
