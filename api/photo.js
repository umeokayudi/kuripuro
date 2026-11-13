// Serve fotos do Supabase Storage (bucket pode ser privado)

import { requireAdmin } from './_auth.js'
import { createSignedUploadUrl, createSignedUrls, fetchStorageBuffer, listJobVideos, parseStorageRef, uploadStorageObject } from './_storage.js'

// Only job/claim photos go through here. Private buckets (signed contracts,
// business cards, meeting audio) are served only by /api/sales-files.
const PUBLIC_PHOTO_BUCKET = 'service-photos'
const UPLOAD_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_UPLOAD = 4 * 1024 * 1024
// Saved contract PDFs (業務委託契約書) live next to the job photos, under jobs/contracts/.
const isContractPdf = (path, type) => type === 'application/pdf' && /^jobs\/contracts\/[\w-]+\/[\w.-]+\.pdf$/.test(String(path))
// Vídeo opcional do serviço: jobs/<jobId>/video_<n>.<ext>. Só devolvemos URLs assinadas;
// o arquivo nunca passa por esta função (limite de ~4,5 MB do corpo na Vercel).
const VIDEO_EXT = { 'video/webm': 'webm', 'video/mp4': 'mp4', 'video/quicktime': 'mov' }
const MAX_VIDEOS_PER_JOB = 5
const validJobId = (id) => /^[\w-]{6,64}$/.test(String(id || '')) && id !== 'contracts'

async function videoUploadUrl(req, res) {
  const { jobId, contentType } = req.body || {}
  const type = String(contentType || '').toLowerCase().split(';')[0].trim()
  const ext = VIDEO_EXT[type]
  if (!validJobId(jobId)) return res.status(400).json({ error: 'jobId inválido' })
  if (!ext) return res.status(415).json({ error: 'Envie um vídeo WebM, MP4 ou MOV.' })
  try {
    const existing = await listJobVideos(jobId)
    if (existing.length >= MAX_VIDEOS_PER_JOB) return res.status(409).json({ error: 'Limite de vídeos deste serviço atingido.' })
    const next = existing.reduce((n, v) => Math.max(n, v.index + 1), 0)
    const signed = await createSignedUploadUrl(`jobs/${jobId}/video_${next}.${ext}`)
    return res.status(200).json({ ...signed, contentType: type })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

// v1.0.132 · download name: kuripuro_<name>_<n>.<ext> (letters, numbers, - and _ only)
const safeName = (s) => String(s || '').normalize('NFKD').replace(/[^\w-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 80)
function downloadName(base, v) {
  const ext = (v.path.split('.').pop() || 'mp4').toLowerCase()
  return `kuripuro_${safeName(base) || 'video'}_${v.index + 1}.${ext}`
}
// Signed URL + &download= → the browser saves the file instead of opening it.
const withDownload = (url, name) => url ? `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(name)}` : null

async function signVideos(videos, base) {
  const urls = await createSignedUrls(videos.map(v => v.path), 3600)
  return videos.map(v => ({ ...v, url: urls[v.path] || null, download_url: withDownload(urls[v.path], downloadName(base, v)), file_name: downloadName(base, v) }))
}

async function videoList(req, res) {
  const jobId = req.query.videos
  if (!validJobId(jobId)) return res.status(400).json({ error: 'jobId inválido' })
  res.setHeader('Cache-Control', 'no-store')
  try {
    const videos = await listJobVideos(jobId)
    return res.status(200).json({ videos: await signVideos(videos, req.query.name || jobId.slice(0, 8)) })
  } catch (err) {
    return res.status(502).json({ error: err.message })
  }
}

// v1.0.132 · admin "Videos" page: which of these jobs have a video, with play + download links.
// Videos are found by path (jobs/<id>/video_n.*), so we look in each job's folder, 8 at a time.
async function videoIndex(req, res) {
  if (!(await requireAdmin(req, res))) return
  const jobs = (Array.isArray(req.body?.jobs) ? req.body.jobs : []).filter(j => validJobId(j?.id)).slice(0, 600)
  res.setHeader('Cache-Control', 'no-store')
  const out = []
  let i = 0
  const worker = async () => {
    while (i < jobs.length) {
      const job = jobs[i++]
      try {
        const videos = await listJobVideos(job.id)
        if (videos.length) out.push({ job_id: job.id, videos: await signVideos(videos, job.name || job.id.slice(0, 8)) })
      } catch { /* one folder failing does not hide the others */ }
    }
  }
  try {
    await Promise.all(Array.from({ length: 8 }, worker))
    return res.status(200).json({ checked: jobs.length, items: out })
  } catch (err) {
    return res.status(502).json({ error: err.message })
  }
}

// v1.0.234 · once the server issues per-person database keys (SUPABASE_JWT_SECRET set), sending a
// photo or a video also asks for a login of any profile. Before that it stays as it was, because
// client logins only receive their cookie from this version on.
async function uploaderAllowed(req, res) {
  const { dbTokensConfigured, readSalesSession } = await import('./_salesSession.js')
  if (!dbTokensConfigured() || readSalesSession(req)) return true
  res.status(401).json({ error: 'Entre de novo para enviar fotos.' })
  return false
}

export default async function handler(req, res) {
  if (req.method === 'POST' && req.body?.action !== 'video-index' && !(await uploaderAllowed(req, res))) return
  if (req.method === 'POST' && req.body?.action === 'video-upload-url') return videoUploadUrl(req, res)
  if (req.method === 'POST' && req.body?.action === 'video-index') return videoIndex(req, res)
  if (req.method === 'GET' && req.query.videos) return videoList(req, res)
  if (req.method === 'POST') {
    const { path, data, contentType } = req.body || {}
    if (!path || !data) return res.status(400).json({ error: 'path e data são obrigatórios' })
    const type = String(contentType || 'image/jpeg').toLowerCase()
    if (!UPLOAD_TYPES.has(type) && !isContractPdf(path, type)) return res.status(415).json({ error: 'Envie uma foto JPEG, PNG ou WebP.' })
    try {
      const buffer = Buffer.from(data, 'base64')
      if (!buffer.length || buffer.length > MAX_UPLOAD) return res.status(413).json({ error: 'Foto vazia ou grande demais.' })
      if (type === 'application/pdf' && buffer.subarray(0, 5).toString('latin1') !== '%PDF-') return res.status(415).json({ error: 'PDF inválido.' })
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
