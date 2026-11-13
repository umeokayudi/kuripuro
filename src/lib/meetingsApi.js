// v1.0.231 · Reuniões — browser side of /api/meetings (admin only). See src/lib/meetings.js.
import { salesGet, salesPost } from './salesApi'
import { baseMime } from './meetings'

const URL_ = '/api/meetings'
const q = obj => new URLSearchParams(obj).toString()

export const listMeetings = () => salesGet(`${URL_}?${q({ op: 'list' })}`, 'pt').then(r => r.rows || [])
export const getMeeting = id => salesGet(`${URL_}?${q({ op: 'get', id })}`, 'pt')
export const listPeople = () => salesGet(`${URL_}?${q({ op: 'people' })}`, 'pt').then(r => r.people || [])
export const audioUrl = (id, n) => salesGet(`${URL_}?${q({ op: 'audio-url', id, n })}`, 'pt').then(r => r.url)

const post = (op, body) => salesPost(`${URL_}?${q({ op })}`, body, 'pt')
export const createMeeting = meeting => post('create', { meeting })
export const saveMeeting = (id, patch) => post('save', { id, patch }).then(r => r.meeting)
export const deleteMeeting = id => post('delete', { id })
export const updateTask = (id, task_id, patch) => post('task', { id, task_id, patch }).then(r => r.task)
export const analyzeMeeting = (id, lang) => post('analyze', { id, lang }).then(r => r.meeting)
export const importMeetText = (id, text, file_name = '') => post('import', { id, text, file_name }).then(r => r.meeting)
export const clearContent = id => post('clear-content', { id }).then(r => r.meeting)

/** Read a file the admin downloaded from Google Docs (Meet notes) and import it. */
export async function importMeetFile(id, file) {
  const name = file.name || ''
  if (/\.pdf$/i.test(name) || file.type === 'application/pdf') {
    if (file.size > 3 * 1024 * 1024) throw new Error('PDF grande demais (até 3 MB). Baixe como .docx ou cole o texto.')
    const b64 = await new Promise((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result).split(',')[1] || '')
      fr.onerror = () => reject(new Error('Não consegui ler o arquivo.'))
      fr.readAsDataURL(file)
    })
    return post('import-pdf', { id, pdf_base64: b64, file_name: name }).then(r => r.meeting)
  }
  const text = /\.docx$/i.test(name) ? await docxText(file) : await file.text()
  return importMeetText(id, text, name)
}

/** Plain text of a .docx (word/document.xml inside the zip), one paragraph per line. No library. */
export async function docxText(file) {
  const buf = new Uint8Array(await file.arrayBuffer())
  const dv = new DataView(buf.buffer)
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('Arquivo .docx inválido.')
  const count = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)
  for (let k = 0; k < count; k++) {
    const method = dv.getUint16(p + 10, true)
    const csize = dv.getUint32(p + 20, true)
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true)
    const local = dv.getUint32(p + 42, true)
    const fname = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen))
    if (fname === 'word/document.xml') {
      const lnl = dv.getUint16(local + 26, true), lel = dv.getUint16(local + 28, true)
      const data = buf.subarray(local + 30 + lnl + lel, local + 30 + lnl + lel + csize)
      let xml
      if (method === 0) xml = new TextDecoder().decode(data)
      else {
        if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador não abre .docx. Cole o texto ou envie em PDF.')
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
        xml = await new Response(stream).text()
      }
      return xml
        .replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n')
        .replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    }
    p += 46 + nlen + elen + clen
  }
  throw new Error('Não achei o texto dentro do .docx.')
}

/** Duration of an audio Blob/File in seconds (0 when the browser cannot tell). */
export function audioDuration(blob) {
  return new Promise(resolve => {
    const el = document.createElement('audio')
    const url = URL.createObjectURL(blob)
    let done = false
    const finish = v => { if (done) return; done = true; URL.revokeObjectURL(url); resolve(Number.isFinite(v) ? v : 0) }
    el.preload = 'metadata'
    el.onloadedmetadata = () => {
      if (el.duration === Infinity) { // Chrome webm: seek far to learn the real length
        el.currentTime = 1e7
        el.ontimeupdate = () => { el.ontimeupdate = null; finish(el.duration) }
      } else finish(el.duration)
    }
    el.onerror = () => finish(0)
    setTimeout(() => finish(0), 8000)
    el.src = url
  })
}

/** Fallback: upload one audio file straight to Storage, register it, then transcribe it (all windows). */
export async function uploadAndTranscribe(id, blob, { duration, source = 'file', name = '', onStage } = {}) {
  const mime = baseMime(blob.type) || 'audio/webm'
  onStage?.('upload')
  const slot = await post('audio-upload', { id, mime, size: blob.size })
  const put = await fetch(slot.upload_url, { method: 'PUT', headers: { 'Content-Type': mime, 'x-upsert': 'true' }, body: blob })
  if (!put.ok) throw new Error(`Falha ao enviar o áudio (${put.status}).`)
  const dur = duration || await audioDuration(blob)
  let r = await post('audio-add', { id, n: slot.n, path: slot.path, mime, duration: dur, source, name })
  return transcribePart(id, slot.n, { onStage, meeting: r.meeting })
}

/** Transcribe (or continue transcribing) one part; long files go window by window. */
export async function transcribePart(id, n, { onStage, from = 0, meeting } = {}) {
  let next = from
  let last = meeting
  for (let guard = 0; next != null && guard < 40; guard++) {
    onStage?.('transcribe', next)
    const r = await post('transcribe', { id, n, from: next })
    last = r.meeting
    next = r.next_from ?? null
  }
  return last
}

