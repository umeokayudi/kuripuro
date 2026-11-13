// v1.0.235 · Mundo Kuripuro × "Planta e modelo 3D": photos or a video of a store → ONE 3DGS task in
// the KIRI Engine API. The result is always a DRAFT of the place (nothing is published from here).
//   GET  /api/scan3d?model_id=…                     → { configured, balance, balance_error, scans }
//   POST /api/scan3d { op: 'start', model_id, paths | video_path, confirm_spend: true }   (1 credit)
//   POST /api/scan3d { op: 'check', model_id, scan_id }   → asks KIRI; when ready, stores model + mesh
//   POST /api/scan3d { op: 'remove', model_id, scan_id }  → forgets a finished scan (the files stay)
// Admin only. Nothing is sent to KIRI without KIRI_API_KEY on the server AND confirm_spend from the
// screen, because every task spends a KIRI credit. The key lives only in the environment: it never
// goes to the screen, to the scan list or to the logs (see scrub). The files never pass through the
// browser → KIRI: the browser uploads to Storage (facility/scans/<model>/in/…), this function forwards.
// The scan list of a store lives in Storage: facility/scans/<model>/scans.json.
// Rule of the owner: if the 3DGS result has no mesh, STOP and say so. Never start a second (Photo
// Scan) task automatically; there is no Photo Scan call in this file on purpose.
import { inflateRawSync } from 'node:zlib'
import { requireAdmin } from './_auth.js'
import { fetchStorageBuffer, uploadStorageObject } from './_storage.js'

// Every KIRI endpoint and field name in ONE place. They follow the public KIRI Open API format
// (https://docs.kiriengine.app); the documentation site could not be opened while this was written,
// so the first real check is the balance call, which is free. If KIRI answers 404/400 there, fix here.
export const KIRI = {
  base: 'https://api.kiriengine.app/api',              // env KIRI_API_BASE overrides
  balance: '/v1/open/balance',                         // GET  → data.balance
  gsVideo: '/v1/open/3dgs/video',                      // POST multipart, field videoFile
  gsImage: '/v1/open/3dgs/image',                      // POST multipart, field imagesFiles (repeated)
  status: '/v1/open/model/getStatus?serialize=',       // GET  → data.status
  zip: '/v1/open/model/getModelZip?serialize=',        // GET  → data.modelUrl
  videoField: 'videoFile',
  imagesField: 'imagesFiles',
  // 3DGS parameters: ask for a mesh too (the plan is derived from it), no auto-masking
  params: { isMesh: '1', isMask: '0', fileFormat: 'GLB' },
}

const BASE = () => String(process.env.KIRI_API_BASE || KIRI.base).replace(/\/+$/, '')
const KEY = () => process.env.KIRI_API_KEY || ''
const ID = /^[\w-]{6,64}$/
const MB = 1024 * 1024
const STORAGE_MAX = 50 * MB          // Supabase free plan: 50 MB per file
const DOWNLOAD_MAX = 250 * MB        // above this the function would run out of memory
const MIN_PHOTOS = 20, MAX_PHOTOS = 300
const STALE_SENDING_MS = 10 * 60 * 1000
const POLL_EVERY_MS = 15 * 1000
const inDir = model => `facility/scans/${model}/in/`
const listPath = model => `facility/scans/${model}/scans.json`
export const NO_MESH_MSG = 'O 3DGS não trouxe malha para gerar a planta. Parei aqui sem gastar outro crédito — fale com o responsável antes de tentar Photo Scan.'

/** Takes the key (and any "Bearer xxx") out of a text before it is stored, shown or logged. */
export function scrub(text, key = KEY()) {
  let t = String(text ?? '')
  if (key) t = t.split(key).join('***')
  return t.replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer ***').slice(0, 300)
}

/** KIRI status code → our state. -1 uploading, 0 processing, 1 failed, 2 ready, 3 queued, 4 expired. */
export function mapKiriStatus(code) {
  return { '-1': 'sent', 0: 'processing', 3: 'processing', 2: 'ready', 1: 'failed', 4: 'failed' }[String(code)] || null
}

/** Reason of a refused call, in the words the screen shows. */
export function explainKiri(httpStatus, json) {
  const code = Number(json?.code)
  const status = httpStatus >= 200 && httpStatus < 300 && [400, 401, 403].includes(code) ? code : httpStatus
  const base = status === 401 ? 'chave do KIRI inválida'
    : status === 403 ? 'créditos insuficientes no KIRI'
      : status === 400 ? 'pedido recusado (parâmetro faltando ou errado)'
        : status >= 200 && status < 300 ? 'o KIRI recusou o pedido' : `o KIRI respondeu ${status}`
  const msg = scrub(json?.msg || json?.message || '').trim()
  return msg && !/^(success|ok)$/i.test(msg) ? `${base} — ${msg}` : base
}

/** The balance, whatever shape the answer has (a number, or { balance } / { credits } / …). */
export function parseBalance(data) {
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null)
  const direct = num(data)
  if (direct != null) return direct
  if (data && typeof data === 'object') for (const k of ['balance', 'credits', 'credit', 'remaining', 'remain', 'available']) { const v = num(data[k]); if (v != null) return v }
  return null
}

const fail = (message, extra = {}) => Object.assign(new Error(scrub(message)), { status: 502, kiri: true, ...extra })

// KIRI answers { code, msg, data, ok }
async function kiri(path, init = {}, timeoutMs = 15000) {
  let r, text
  try {
    r = await fetch(`${BASE()}${path}`, { ...init, headers: { Authorization: `Bearer ${KEY()}`, ...(init.headers || {}) }, signal: AbortSignal.timeout(timeoutMs) })
    text = await r.text()
  } catch (e) {
    const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError'
    throw fail(timeout ? 'o KIRI demorou demais para responder' : 'não consegui falar com o KIRI (rede)', { timeout })
  }
  let json = null
  try { json = JSON.parse(text) } catch { /* not json */ }
  const code = json?.code
  if (!r.ok || !json || json.ok === false || (code != null && Number(code) !== 0 && Number(code) !== 200)) throw fail(explainKiri(r.status, json))
  return json.data ?? json
}

async function readBalance() {
  try {
    const balance = parseBalance(await kiri(KIRI.balance, {}, 8000))
    return balance == null ? { balance: null, balance_error: 'o KIRI não informou o saldo' } : { balance, balance_error: null }
  } catch (e) { return { balance: null, balance_error: scrub(e?.message || 'erro') } }
}

// ── zip (central directory) ──────────────────────────────────────────────────────────────────
/** Files inside a zip: [{ name, size, packed, method, local }] (folders and __MACOSX left out). */
export function listZip(buffer) {
  const out = []
  if (!buffer || buffer.length < 22) return out
  let end = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66000); i--) if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break }
  if (end < 0) return out
  const count = buffer.readUInt16LE(end + 10)
  let p = buffer.readUInt32LE(end + 16)
  for (let n = 0; n < count && p + 46 <= buffer.length; n++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) break
    const method = buffer.readUInt16LE(p + 10)
    const packed = buffer.readUInt32LE(p + 20), size = buffer.readUInt32LE(p + 24)
    const nameLen = buffer.readUInt16LE(p + 28), extraLen = buffer.readUInt16LE(p + 30), commentLen = buffer.readUInt16LE(p + 32)
    const local = buffer.readUInt32LE(p + 42)
    const name = buffer.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    if (!name.endsWith('/') && !name.startsWith('__MACOSX')) out.push({ name, size, packed, method, local })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** The bytes of one entry of listZip (stored or deflated). */
export function readZipEntry(buffer, entry) {
  const start = entry.local + 30 + buffer.readUInt16LE(entry.local + 26) + buffer.readUInt16LE(entry.local + 28)
  const raw = buffer.subarray(start, start + entry.packed)
  return entry.method === 0 ? Buffer.from(raw) : inflateRawSync(raw)
}

/** First file with this extension inside a zip. */
export function unzipFirst(buffer, extension) {
  const entry = listZip(buffer).find(e => e.name.toLowerCase().endsWith(extension))
  return entry ? { name: entry.name, data: readZipEntry(buffer, entry) } : null
}

const MESH_EXT = ['.glb', '.gltf', '.obj', '.fbx', '.stl', '.usdz']   // .glb first: the one the viewer opens
const SPLAT_EXT = ['.ply', '.splat', '.spz']
const byExt = (entries, exts) => { for (const x of exts) { const e = entries.find(f => f.name.toLowerCase().endsWith(x)); if (e) return e } return null }

/** What came in the result: the file list (max 40), the mesh (if any) and the splat (if any). */
export function summarizeResult(entries) {
  const mesh = byExt(entries, MESH_EXT), splat = byExt(entries, SPLAT_EXT)
  return {
    files: entries.slice(0, 40).map(e => ({ name: e.name, size: e.size })),
    file_count: entries.length,
    mesh_file: mesh?.name || null,
    splat_file: splat?.name || null,
  }
}

// ── scan list ────────────────────────────────────────────────────────────────────────────────
async function readList(model) {
  try { const list = JSON.parse((await fetchStorageBuffer(listPath(model))).buffer.toString('utf8')); return Array.isArray(list) ? list : [] } catch { return [] }
}
const writeList = (model, list) => uploadStorageObject(listPath(model), Buffer.from(JSON.stringify(list)), 'application/json')

/** Old names (v1.0.234) and a "sending" that never finished → the four states of the screen. Returns true when something changed. */
export function settle(list, now = Date.now()) {
  let changed = false
  for (const s of list) {
    const legacy = { uploading: 'sent', queued: 'processing', expired: 'failed' }[s.status]
    if (legacy) { if (s.status === 'expired' && !s.error) s.error = 'A tarefa expirou no KIRI'; s.status = legacy; changed = true }
    if (s.status === 'sending' && now - Date.parse(s.created_at || 0) > STALE_SENDING_MS) {
      s.status = 'failed'
      s.error = 'O envio não terminou (tempo esgotado). Não dá para saber se o KIRI recebeu: confira o saldo antes de tentar de novo.'
      changed = true
    }
  }
  return changed
}
const inProgress = s => ['sending', 'sent', 'processing'].includes(s.status)
const mb = bytes => Math.max(1, Math.round(bytes / MB))

async function saveScan(model, scan) {
  const list = await readList(model)
  const i = list.findIndex(s => s.id === scan.id)
  if (i >= 0) list[i] = scan; else list.unshift(scan)
  await writeList(model, list.slice(0, 30))
}

async function start(req, res, model, user) {
  if (!KEY()) return res.status(503).json({ error: 'Falta cadastrar a chave do KIRI (KIRI_API_KEY) no servidor.' })
  if (req.body?.confirm_spend !== true) return res.status(400).json({ error: 'Confirme na tela: cada modelo consome 1 crédito do KIRI.' })
  const t0 = Date.now()
  const list = await readList(model)
  settle(list)
  if (list.some(inProgress)) return res.status(409).json({ error: 'Já existe um modelo deste local em andamento. Espere terminar antes de gastar outro crédito.' })
  const video = String(req.body?.video_path || '')
  const paths = (Array.isArray(req.body?.paths) ? req.body.paths : []).map(String)
  const mine = p => p.startsWith(inDir(model)) && !p.includes('..')
  if (video) {
    if (!mine(video) || paths.length) return res.status(400).json({ error: 'Envie um vídeo só (ou só fotos).' })
  } else if (paths.length < MIN_PHOTOS || paths.length > MAX_PHOTOS || !paths.every(mine)) {
    return res.status(400).json({ error: `Envie de ${MIN_PHOTOS} a ${MAX_PHOTOS} fotos do local, dando a volta no ambiente.` })
  }
  // the entry is written BEFORE the call: if this function dies in the middle, the screen still shows it
  const scan = {
    id: `s${Date.now().toString(36)}`, serialize: null, algorithm: '3dgs', status: 'sending', error: null,
    source: video ? 'video' : 'photos', files: video ? 1 : paths.length, created_at: new Date().toISOString(),
    by: user?.name || 'admin', draft: true, published: false, credits: 1, glb_path: null,
  }
  await writeList(model, [scan, ...list].slice(0, 30))
  let sentToKiri = false
  try {
    const form = new FormData()
    for (const [k, v] of Object.entries(KIRI.params)) form.append(k, v)
    try {
      if (video) {
        const f = await fetchStorageBuffer(video)
        form.append(KIRI.videoField, new Blob([f.buffer], { type: f.contentType || 'video/mp4' }), video.split('/').pop())
      } else {
        let i = 0
        const files = new Array(paths.length)
        await Promise.all(Array.from({ length: 8 }, async () => { while (i < paths.length) { const k = i++; files[k] = await fetchStorageBuffer(paths[k]) } }))
        files.forEach((f, k) => form.append(KIRI.imagesField, new Blob([f.buffer], { type: f.contentType || 'image/jpeg' }), `${String(k).padStart(3, '0')}.jpg`))
      }
    } catch (e) { throw fail(`não consegui ler os arquivos enviados (${e?.message || 'erro'}). Nada foi mandado ao KIRI.`) }
    sentToKiri = true
    const data = await kiri(video ? KIRI.gsVideo : KIRI.gsImage, { method: 'POST', body: form }, Math.max(10000, 55000 - (Date.now() - t0)))
    if (!data?.serialize) throw fail('o KIRI não devolveu o número da tarefa. Confira o saldo antes de tentar de novo.')
    scan.serialize = String(data.serialize)
    scan.status = 'sent'
  } catch (e) {
    scan.status = 'failed'
    scan.error = scrub(e?.message || 'erro ao enviar')
    if (e?.timeout && sentToKiri) scan.error += '. Não dá para saber se o KIRI recebeu: confira o saldo antes de tentar de novo.'
    console.error('[scan3d] start', scan.error)
  }
  await saveScan(model, scan)
  return res.status(200).json({ scan })
}

/** Downloads the finished result and stores model + mesh. Throws on a temporary problem. */
async function collect(scan, model) {
  const dl = await kiri(`${KIRI.zip}${encodeURIComponent(scan.serialize)}`)
  const url = dl?.modelUrl || dl?.url
  if (!url) throw fail('o KIRI não devolveu o arquivo do modelo')
  let r
  try { r = await fetch(url, { signal: AbortSignal.timeout(40000) }) } catch { throw fail('não consegui baixar o resultado do KIRI (rede ou tempo)') }
  if (!r.ok) throw fail(`não consegui baixar o resultado do KIRI (${r.status})`)
  const notes = []
  const declared = Number(r.headers.get('content-length') || 0)
  if (declared > DOWNLOAD_MAX) {
    try { await r.body?.cancel() } catch { /* nothing to cancel */ }
    scan.bytes = declared
    scan.result = { files: [], file_count: 0, mesh_file: null, splat_file: null, bytes: declared, notes: [`Resultado grande demais para guardar aqui (${mb(declared)} MB), continua no KIRI. Não deu para conferir se veio malha.`] }
    return
  }
  const buf = Buffer.from(await r.arrayBuffer())
  const rawGlb = buf.length >= 12 && buf.readUInt32LE(0) === 0x46546c67
  const entries = rawGlb ? [{ name: 'model.glb', size: buf.length }] : listZip(buf)
  if (!entries.length) notes.push('Não consegui ler o conteúdo do arquivo que o KIRI devolveu.')
  const summary = summarizeResult(entries)
  const glbEntry = rawGlb ? entries[0] : entries.find(e => e.name.toLowerCase().endsWith('.glb'))
  if (glbEntry) {
    const data = rawGlb ? buf : readZipEntry(buf, glbEntry)
    if (data.length <= STORAGE_MAX) scan.glb_path = await uploadStorageObject(`facility/scans/${model}/${scan.id}.glb`, data, 'model/gltf-binary')
    else notes.push(`A malha é grande demais para o Storage (${mb(data.length)} MB), continua no KIRI.`)
  } else if (summary.mesh_file) notes.push('A malha veio em outro formato (não .glb): está dentro do zip, o visualizador 3D não abre.')
  if (!rawGlb && entries.length) {
    if (buf.length <= STORAGE_MAX) scan.zip_path = await uploadStorageObject(`facility/scans/${model}/${scan.id}.zip`, buf, 'application/zip')
    else notes.push(`Zip completo grande demais para o Storage (${mb(buf.length)} MB), continua no KIRI.`)
  }
  scan.bytes = buf.length
  scan.result = { ...summary, bytes: buf.length, notes }
  scan.no_mesh = !summary.mesh_file
  if (scan.no_mesh) scan.message = NO_MESH_MSG
}

async function check(req, res, model) {
  const list = await readList(model)
  const changed = settle(list)
  const scan = list.find(s => s.id === String(req.body?.scan_id || ''))
  if (!scan) return res.status(404).json({ error: 'Modelo não encontrado.' })
  const done = () => res.status(200).json({ scan })
  if (['ready', 'failed', 'sending'].includes(scan.status) || !scan.serialize) { if (changed) await writeList(model, list); return done() }
  if (!KEY()) return res.status(503).json({ error: 'Falta cadastrar a chave do KIRI (KIRI_API_KEY) no servidor.' })
  // at most one question to KIRI every 15 s per scan
  if (scan.checked_at && Date.now() - Date.parse(scan.checked_at) < POLL_EVERY_MS) return res.status(200).json({ scan, throttled: true })
  scan.checked_at = new Date().toISOString()
  try {
    const st = await kiri(`${KIRI.status}${encodeURIComponent(scan.serialize)}`)
    const code = st?.status ?? st
    const next = mapKiriStatus(code)
    if (next === 'failed') {
      scan.status = 'failed'
      scan.error = Number(code) === 4 ? 'A tarefa expirou no KIRI' : 'O KIRI não conseguiu montar o modelo com este material'
    } else if (next === 'ready') {
      await collect(scan, model)   // throws on a temporary problem: the state only becomes "ready" with the result stored
      scan.status = 'ready'
      scan.ready_at = new Date().toISOString()
    } else if (next) scan.status = next
    delete scan.last_check_error
  } catch (e) {
    // a temporary error never turns the scan into "failed": it is kept and shown, the next check tries again
    scan.last_check_error = scrub(e?.message || 'erro ao consultar o KIRI')
    console.error('[scan3d] check', scan.last_check_error)
  }
  await saveScan(model, scan)
  return done()
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (!(await requireAdmin(req, res))) return
  const { readSalesSession } = await import('./_salesSession.js')
  const user = readSalesSession(req)
  const model = String((req.method === 'GET' ? req.query?.model_id : req.body?.model_id) || '')
  if (!ID.test(model)) return res.status(400).json({ error: 'Loja inválida.' })
  try {
    if (req.method === 'GET') {
      const configured = !!KEY()
      const [scans, bal] = await Promise.all([readList(model), configured ? readBalance() : { balance: null, balance_error: null }])
      if (settle(scans)) await writeList(model, scans).catch(() => {})
      return res.status(200).json({ configured, ...bal, in_dir: inDir(model), scans })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const op = String(req.body?.op || '')
    if (op === 'start') return await start(req, res, model, user)
    if (op === 'check') return await check(req, res, model)
    if (op === 'remove') {
      const all = await readList(model)
      settle(all)
      const target = all.find(s => s.id === String(req.body?.scan_id || ''))
      if (target && inProgress(target)) return res.status(409).json({ error: 'Este modelo ainda está em andamento. Espere terminar para tirar da lista.' })
      const list = all.filter(s => s !== target)
      await writeList(model, list)
      return res.status(200).json({ scans: list })
    }
    return res.status(400).json({ error: 'Operação inválida.' })
  } catch (e) {
    console.error('[scan3d]', scrub(e?.message || e))
    return res.status(e.status || 500).json({ error: e.status ? scrub(e.message) : 'Não foi possível falar com o serviço de 3D.' })
  }
}
