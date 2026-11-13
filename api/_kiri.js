// v1.0.234 · Mundo Kuripuro × 3D: photos or a video of a store → real 3D model (KIRI Engine).
//   GET  /api/scan3d?model_id=…                     → { configured, scans }
//   POST /api/scan3d { op: 'start', model_id, paths | video_path, confirm_spend: true }
//   POST /api/scan3d { op: 'check', model_id, scan_id }   → asks KIRI; when ready, saves the .glb in Storage
//   POST /api/scan3d { op: 'remove', model_id, scan_id }  → forgets a scan (the model file stays)
// Admin only. Nothing is sent to KIRI without KIRI_API_KEY on the server AND confirm_spend from the
// screen, because every scan spends KIRI credits. The files never pass through the browser → KIRI:
// the browser uploads to Storage (facility/scans/<model>/in/…), this function forwards them.
// The scan list of a store lives in Storage: facility/scans/<model>/scans.json.
import { inflateRawSync } from 'node:zlib'
import { requireAdmin } from './_auth.js'
import { fetchStorageBuffer, uploadStorageObject } from './_storage.js'

const BASE = () => String(process.env.KIRI_API_BASE || 'https://api.kiriengine.app/api').replace(/\/+$/, '')
const KEY = () => process.env.KIRI_API_KEY || ''
const ID = /^[\w-]{6,64}$/
const inDir = model => `facility/scans/${model}/in/`
const listPath = model => `facility/scans/${model}/scans.json`

// KIRI status codes → ours
const STATUS = { '-1': 'uploading', 0: 'processing', 1: 'failed', 2: 'ready', 3: 'queued', 4: 'expired' }

async function readList(model) {
  try { return JSON.parse((await fetchStorageBuffer(listPath(model))).buffer.toString('utf8')) } catch { return [] }
}
const writeList = (model, list) => uploadStorageObject(listPath(model), Buffer.from(JSON.stringify(list)), 'application/json')

async function kiri(path, init = {}) {
  const r = await fetch(`${BASE()}${path}`, { ...init, headers: { Authorization: `Bearer ${KEY()}`, ...(init.headers || {}) } })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not json */ }
  if (!r.ok || !json || (json.ok === false) || (json.code != null && Number(json.code) !== 0 && Number(json.code) !== 200)) {
    throw Object.assign(new Error(`KIRI respondeu ${r.status}${json?.msg ? `: ${json.msg}` : ''}`), { status: 502 })
  }
  return json.data ?? json
}

/** First file with this extension inside a zip (stored or deflated). */
export function unzipFirst(buffer, extension) {
  let end = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66000); i--) if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break }
  if (end < 0) return null
  const count = buffer.readUInt16LE(end + 10)
  let p = buffer.readUInt32LE(end + 16)
  for (let n = 0; n < count && p + 46 <= buffer.length; n++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) break
    const method = buffer.readUInt16LE(p + 10)
    const size = buffer.readUInt32LE(p + 20)
    const nameLen = buffer.readUInt16LE(p + 28), extraLen = buffer.readUInt16LE(p + 30), commentLen = buffer.readUInt16LE(p + 32)
    const local = buffer.readUInt32LE(p + 42)
    const name = buffer.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    if (name.toLowerCase().endsWith(extension) && !name.startsWith('__MACOSX')) {
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28)
      const raw = buffer.subarray(start, start + size)
      return { name, data: method === 0 ? Buffer.from(raw) : inflateRawSync(raw) }
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  return null
}

async function start(req, res, model, user) {
  if (!KEY()) return res.status(503).json({ error: 'Falta cadastrar a chave da KIRI (KIRI_API_KEY) no servidor.' })
  if (req.body?.confirm_spend !== true) return res.status(400).json({ error: 'Confirme na tela: cada modelo consome créditos da KIRI.' })
  const video = String(req.body?.video_path || '')
  const paths = (Array.isArray(req.body?.paths) ? req.body.paths : []).map(String).slice(0, 120)
  const mine = p => p.startsWith(inDir(model)) && !p.includes('..')
  if (video ? !mine(video) : (paths.length < 20 || !paths.every(mine))) {
    return res.status(400).json({ error: video ? 'Vídeo inválido.' : 'Envie pelo menos 20 fotos do local (o ideal é 40 a 80, dando a volta no ambiente).' })
  }
  const form = new FormData()
  form.append('modelQuality', '1')    // medium
  form.append('textureQuality', '2')  // 1K: light enough for a phone
  form.append('fileFormat', 'GLB')
  form.append('isMask', '0')
  form.append('textureSmoothing', '1')
  if (video) {
    const f = await fetchStorageBuffer(video)
    form.append('videoFile', new Blob([f.buffer], { type: f.contentType || 'video/mp4' }), video.split('/').pop())
  } else {
    // 6 at a time: fast enough for 80 photos inside the function's time
    let i = 0
    const files = new Array(paths.length)
    await Promise.all(Array.from({ length: 6 }, async () => { while (i < paths.length) { const k = i++; files[k] = await fetchStorageBuffer(paths[k]) } }))
    files.forEach((f, k) => form.append('imagesFiles', new Blob([f.buffer], { type: f.contentType || 'image/jpeg' }), `${String(k).padStart(3, '0')}.jpg`))
  }
  const data = await kiri(`/v1/open/photo-scan/${video ? 'video' : 'image'}`, { method: 'POST', body: form })
  if (!data?.serialize) return res.status(502).json({ error: 'A KIRI não devolveu o número do modelo.' })
  const list = await readList(model)
  const scan = { id: `s${Date.now().toString(36)}`, serialize: data.serialize, status: 'processing', source: video ? 'video' : 'photos', files: video ? 1 : paths.length, created_at: new Date().toISOString(), by: user?.name || 'admin', glb_path: null }
  await writeList(model, [scan, ...list].slice(0, 30))
  return res.status(200).json({ scan })
}

async function check(req, res, model) {
  if (!KEY()) return res.status(503).json({ error: 'Falta cadastrar a chave da KIRI (KIRI_API_KEY) no servidor.' })
  const list = await readList(model)
  const scan = list.find(s => s.id === String(req.body?.scan_id || ''))
  if (!scan) return res.status(404).json({ error: 'Modelo não encontrado.' })
  if (scan.status === 'ready' && scan.glb_path) return res.status(200).json({ scan })
  const st = await kiri(`/v1/open/model/getStatus?serialize=${encodeURIComponent(scan.serialize)}`)
  scan.status = STATUS[String(st?.status)] || 'processing'
  scan.checked_at = new Date().toISOString()
  if (scan.status === 'ready') {
    const dl = await kiri(`/v1/open/model/getModelZip?serialize=${encodeURIComponent(scan.serialize)}`)
    const url = dl?.modelUrl || dl?.url
    if (!url) throw Object.assign(new Error('A KIRI não devolveu o arquivo do modelo.'), { status: 502 })
    const zip = await fetch(url)
    if (!zip.ok) throw Object.assign(new Error(`Não consegui baixar o modelo (${zip.status}).`), { status: 502 })
    const buf = Buffer.from(await zip.arrayBuffer())
    const glb = buf.readUInt32LE(0) === 0x46546c67 ? { data: buf } : unzipFirst(buf, '.glb')
    if (!glb) throw Object.assign(new Error('O arquivo da KIRI veio sem modelo .glb.'), { status: 502 })
    scan.glb_path = await uploadStorageObject(`facility/scans/${model}/${scan.id}.glb`, glb.data, 'model/gltf-binary')
    scan.bytes = glb.data.length
    scan.ready_at = new Date().toISOString()
  }
  await writeList(model, list)
  return res.status(200).json({ scan })
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (!(await requireAdmin(req, res))) return
  const { readSalesSession } = await import('./_salesSession.js')
  const user = readSalesSession(req)
  const model = String((req.method === 'GET' ? req.query?.model_id : req.body?.model_id) || '')
  if (!ID.test(model)) return res.status(400).json({ error: 'Loja inválida.' })
  try {
    if (req.method === 'GET') return res.status(200).json({ configured: !!KEY(), in_dir: inDir(model), scans: await readList(model) })
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const op = String(req.body?.op || '')
    if (op === 'start') return await start(req, res, model, user)
    if (op === 'check') return await check(req, res, model)
    if (op === 'remove') {
      const list = (await readList(model)).filter(s => s.id !== String(req.body?.scan_id || ''))
      await writeList(model, list)
      return res.status(200).json({ scans: list })
    }
    return res.status(400).json({ error: 'Operação inválida.' })
  } catch (e) {
    console.error('[scan3d]', e?.message || e)
    return res.status(e.status || 500).json({ error: e.status ? e.message : 'Não foi possível falar com o serviço de 3D.' })
  }
}
