// v1.0.231 · Reuniões (admin only) — /api/sales?route=meetings&op=…
// Files live in the PRIVATE bucket sales-private (service role only), see src/lib/meetings.js.
// No SQL. Every op needs the admin login cookie.

import { aiRateLimited } from './_auth.js'
import { requireSalesSession, salesDb } from './_salesSession.js'
import { analyzeMeeting, pdfToText, transcribeAudio } from './_meeting-ai.js'
import {
  AUDIO_EXT, BUCKET, ID_RE, INDEX_PATH, MAX_AUDIO_BYTES, MAX_RAW, WINDOW_SECONDS, audioDir, audioLines, baseMime, cleanPatch, cleanTask,
  emptyContent, indexRow, linesOf, matchPerson, meetingPath, newId, openTasks, parseMeetText, previousOf,
} from '../src/lib/meetings.js'

const first = v => (Array.isArray(v) ? v[0] : v)

async function readJson(db, path) {
  const { data, error } = await db.storage.from(BUCKET).download(path)
  if (error) {
    const msg = String(error.message || error.statusCode || error)
    if (/not.?found|404|400|Object not found/i.test(msg) || error.statusCode === '404' || error.status === 404 || error.status === 400) return null
    throw new Error(msg)
  }
  try { return JSON.parse(await data.text()) } catch { return null }
}

async function writeJson(db, path, value) {
  const body = Buffer.from(JSON.stringify(value))
  const { error } = await db.storage.from(BUCKET).upload(path, body, { upsert: true, contentType: 'application/json', cacheControl: '0' })
  if (error) throw new Error(error.message || 'Falha ao salvar')
}

async function readIndex(db) {
  const idx = await readJson(db, INDEX_PATH)
  if (idx && Array.isArray(idx.rows)) return idx.rows
  // First run or lost index: rebuild from the meeting files.
  const { data, error } = await db.storage.from(BUCKET).list('team-meetings/m', { limit: 1000 })
  if (error) return []
  const files = (data || []).filter(f => /\.json$/.test(f.name))
  const rows = []
  for (let i = 0; i < files.length; i += 12) {
    const batch = await Promise.all(files.slice(i, i + 12).map(f => readJson(db, `team-meetings/m/${f.name}`).catch(() => null)))
    batch.filter(Boolean).forEach(m => rows.push(indexRow(m)))
  }
  await writeJson(db, INDEX_PATH, { rows, updated_at: new Date().toISOString() }).catch(() => {})
  return rows
}

async function putIndexRow(db, m, remove = false) {
  const rows = (await readIndex(db)).filter(r => r.id !== m.id)
  if (!remove) rows.push(indexRow(m))
  await writeJson(db, INDEX_PATH, { rows, updated_at: new Date().toISOString() })
  return rows
}

async function loadMeeting(db, id) {
  if (!ID_RE.test(id || '')) return null
  return readJson(db, meetingPath(id))
}

async function storeMeeting(db, m, user) {
  m.rev = (Number(m.rev) || 0) + 1
  m.updated_at = new Date().toISOString()
  m.updated_by = user?.name || user?.id || 'admin'
  await writeJson(db, meetingPath(m.id), m)
  await putIndexRow(db, m)
  return m
}

async function withPrevious(db, m, rows) {
  const prev = previousOf(rows || await readIndex(db), m)
  if (!prev) return { meeting: m, previous: null }
  const pm = await loadMeeting(db, prev.id)
  if (!pm) return { meeting: m, previous: null }
  return {
    meeting: m,
    previous: { id: pm.id, title: pm.title, starts_at: pm.starts_at, series: pm.series, open_tasks: openTasks(pm), decisions: pm.decisions || [] },
  }
}

async function loadPeople(db) {
  const [a, e, s] = await Promise.all([
    db.from('admins').select('id,name'),
    db.from('employees').select('id,full_name,is_active,job_role'),
    db.from('salespeople').select('id,full_name,is_active'),
  ])
  const out = []
  ;(a.data || []).forEach(p => out.push({ key: `admin:${p.id}`, name: p.name || 'Admin', role: 'admin' }))
  ;(e.data || []).filter(p => p.is_active !== false).forEach(p => out.push({ key: `employee:${p.id}`, name: p.full_name || '—', role: 'employee', job_role: p.job_role || '' }))
  ;(s.data || []).filter(p => p.is_active !== false).forEach(p => out.push({ key: `salesperson:${p.id}`, name: p.full_name || '—', role: 'salesperson' }))
  return out
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const user = requireSalesSession(req, res, ['admin'])
  if (!user) return
  const op = String(first(req.query?.op) || '')
  try {
    const db = salesDb()

    if (req.method === 'GET') {
      if (op === 'list') {
        const rows = await readIndex(db)
        // The search text is sent too (the list filters on the phone without another call), capped.
        return res.status(200).json({ rows: rows.map(r => ({ ...r, search: String(r.search || '').slice(0, 60000) })) })
      }
      if (op === 'get') {
        const m = await loadMeeting(db, String(first(req.query.id) || ''))
        if (!m) return res.status(404).json({ error: 'Reunião não encontrada.' })
        return res.status(200).json(await withPrevious(db, m))
      }
      if (op === 'people') return res.status(200).json({ people: await loadPeople(db) })
      if (op === 'audio-url') {
        const m = await loadMeeting(db, String(first(req.query.id) || ''))
        const item = m?.audio?.find(a => String(a.n) === String(first(req.query.n)))
        if (!item) return res.status(404).json({ error: 'Áudio não encontrado.' })
        const { data, error } = await db.storage.from(BUCKET).createSignedUrl(item.path, 60 * 30)
        if (error) throw error
        return res.status(200).json({ url: data.signedUrl })
      }
      return res.status(404).json({ error: 'Operação desconhecida.' })
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const body = req.body || {}

    if (op === 'create') {
      const patch = cleanPatch(body.meeting || {})
      if (!patch.title) return res.status(400).json({ error: 'Dê um título para a reunião.' })
      if (!patch.starts_at) return res.status(400).json({ error: 'Escolha a data e a hora.' })
      const m = {
        id: newId(), rev: 0, status: 'planned', series: '', agenda: '', meet_url: '', invited: [], attendance: {}, content: emptyContent(), notes: [], audio: [],
        topics: [], summary: '', decisions: [], tasks: [], ai: null, ...patch,
        created_at: new Date().toISOString(), created_by: user.name || user.id,
      }
      await storeMeeting(db, m, user)
      return res.status(200).json(await withPrevious(db, m))
    }

    const id = String(body.id || '')
    const m = await loadMeeting(db, id)
    if (!m) return res.status(404).json({ error: 'Reunião não encontrada.' })

    if (op === 'save') {
      // Only the fields in the patch change; audio and AI results are kept by the server.
      Object.assign(m, cleanPatch(body.patch || {}))
      await storeMeeting(db, m, user)
      return res.status(200).json({ meeting: m })
    }

    if (op === 'delete') {
      const { data } = await db.storage.from(BUCKET).list(audioDir(id), { limit: 1000 })
      const paths = [meetingPath(id), ...(data || []).map(f => `${audioDir(id)}/${f.name}`)]
      await db.storage.from(BUCKET).remove(paths)
      await putIndexRow(db, m, true)
      return res.status(200).json({ ok: true })
    }

    // A task of THIS meeting changes (used from the next meeting: "pendências da reunião anterior").
    if (op === 'task') {
      const tasks = m.tasks || []
      const i = tasks.findIndex(tk => tk.id === body.task_id)
      if (i < 0) return res.status(404).json({ error: 'Tarefa não encontrada.' })
      const next = cleanTask({ ...tasks[i], ...(body.patch || {}), id: tasks[i].id })
      if (next.status === 'done' && !tasks[i].done_at) next.done_at = new Date().toISOString()
      tasks[i] = next
      m.tasks = tasks
      await storeMeeting(db, m, user)
      return res.status(200).json({ task: next })
    }

    // Google Meet notes: the text (pasted, or read from .txt/.docx in the browser) or a PDF (read by the AI).
    if (op === 'import' || op === 'import-pdf') {
      let raw = String(body.text || '')
      if (op === 'import-pdf') {
        const b64 = String(body.pdf_base64 || '')
        if (!b64 || b64.length > 4_000_000) return res.status(413).json({ error: 'PDF vazio ou grande demais (até 3 MB). Baixe como .docx ou cole o texto.' })
        if (aiRateLimited(user, res, { max: 30, windowMin: 10 })) return
        raw = await pdfToText({ base64: b64 })
      }
      raw = raw.slice(0, MAX_RAW)
      const lines = parseMeetText(raw)
      if (!lines.length) return res.status(400).json({ error: 'Não encontrei texto nesse documento.' })
      m.content = { source: 'meet', file_name: String(body.file_name || '').slice(0, 160), imported_at: new Date().toISOString(), raw, lines }
      m.topics = []   // the old topics pointed to other lines
      await storeMeeting(db, m, user)
      return res.status(200).json({ meeting: m })
    }

    if (op === 'clear-content') {
      m.content = emptyContent()
      m.topics = []
      await storeMeeting(db, m, user)
      return res.status(200).json({ meeting: m })
    }

    // 1) Browser asks where to upload an audio file (fallback when there are no Meet notes) (straight to Storage: no 4.5 MB function limit).
    if (op === 'audio-upload') {
      const mime = baseMime(body.mime)
      const ext = AUDIO_EXT[mime]
      if (!ext) return res.status(415).json({ error: 'Formato de áudio não suportado (use m4a, mp3, webm, ogg ou wav).' })
      if (!Number(body.size) || Number(body.size) > MAX_AUDIO_BYTES) return res.status(413).json({ error: 'Arquivo vazio ou maior que 19 MB. Grave pelo botão Gravar (ele divide em partes) ou envie um arquivo menor.' })
      const n = Math.max(0, ...(m.audio || []).map(a => Number(a.n) || 0)) + 1
      const path = `${audioDir(id)}/${String(n).padStart(3, '0')}.${ext}`
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true })
      if (error) throw error
      return res.status(200).json({ n, path, upload_url: data.signedUrl, token: data.token })
    }

    // 2) After the upload: register the part (its place on the meeting timeline).
    if (op === 'audio-add') {
      const n = Number(body.n)
      const path = `${audioDir(id)}/`
      if (!Number.isInteger(n) || !String(body.path || '').startsWith(path)) return res.status(400).json({ error: 'Parte de áudio inválida.' })
      const audio = (m.audio || []).filter(a => a.n !== n)
      audio.push({
        n, path: body.path, mime: baseMime(body.mime), duration: Math.max(0, Number(body.duration) || 0),
        source: body.source === 'file' ? 'file' : 'recorded', name: String(body.name || '').slice(0, 120), parts: [], status: 'uploaded',
      })
      m.audio = audio.sort((a, b) => a.n - b.n)
      await storeMeeting(db, m, user)
      return res.status(200).json({ meeting: m })
    }

    // 3) Transcribe one part (or one 10-minute window of a long attached file).
    if (op === 'transcribe') {
      if (aiRateLimited(user, res, { max: 80, windowMin: 10 })) return
      const item = (m.audio || []).find(a => a.n === Number(body.n))
      if (!item) return res.status(404).json({ error: 'Parte de áudio não encontrada.' })
      const { data, error } = await db.storage.from(BUCKET).download(item.path)
      if (error) throw new Error('Não achei o arquivo de áudio no Storage.')
      const buf = Buffer.from(await data.arrayBuffer())
      const dur = Number(item.duration) || 0
      const windowed = dur > WINDOW_SECONDS * 1.25
      const from = windowed ? Math.max(0, Number(body.from) || 0) : null
      const to = windowed ? Math.min(dur, from + WINDOW_SECONDS) : null
      const names = (m.invited || []).map(p => p.name)
      let segments
      try {
        segments = await transcribeAudio({ base64: buf.toString('base64'), mimeType: item.mime === 'audio/x-m4a' || item.mime === 'audio/m4a' ? 'audio/mp4' : item.mime, from, to, names })
      } catch (err) {
        item.status = 'error'; item.error = String(err.message || err).slice(0, 300)
        await storeMeeting(db, m, user)
        return res.status(502).json({ error: 'A IA não conseguiu transcrever esta parte. Tente de novo.', meeting: m })
      }
      const key = windowed ? from : 0
      const part = { from: key, to: windowed ? to : dur, segments }
      item.parts = [...(item.parts || []).filter(p => p.from !== key), part].sort((a, b) => a.from - b.from)
      const next = windowed && to < dur ? to : null
      item.status = next == null ? 'done' : 'uploaded'
      delete item.error
      // The transcript becomes the meeting content, unless Meet notes were imported (they win).
      if (m.content?.source !== 'meet') {
        m.content = { ...emptyContent(), source: 'audio', imported_at: new Date().toISOString(), file_name: (m.audio || []).map(a => a.name).filter(Boolean).join(', '), lines: audioLines(m) }
        m.topics = []
      }
      await storeMeeting(db, m, user)
      return res.status(200).json({ meeting: m, next_from: next })
    }

    // 4) Topics + summary + suggested decisions and next steps from the whole content.
    if (op === 'analyze') {
      if (aiRateLimited(user, res, { max: 30, windowMin: 10 })) return
      const lines = linesOf(m)
      const notes = m.notes || []
      if (!lines.length && !notes.length) return res.status(400).json({ error: 'Importe as anotações do Meet (ou um áudio) antes de organizar.' })
      const people = (m.invited || []).map(p => p.name)
      const date = m.starts_at ? new Date(new Date(m.starts_at).getTime() + 9 * 3600e3).toISOString().slice(0, 10) : ''
      const r = await analyzeMeeting({ title: m.title, date, agenda: m.agenda, people, lines, notes, lang: body.lang })
      if (!r.topics.length && lines.length) r.topics = [{ title: m.title || 'Reunião', start_line: 0, summary: r.summary }]
      if (r.topics.length) r.topics[0].start_line = 0
      m.topics = r.topics.map((tp, i, all) => ({
        id: newId(8), title: tp.title, start_line: tp.start_line, end_line: all[i + 1]?.start_line ?? lines.length,
        start_t: lines[tp.start_line]?.t ?? null, summary: tp.summary,
      }))
      // Notes go to the topic the AI chose, unless the admin already picked one by hand.
      m.notes = notes.map((n, i) => {
        if (n.topic_id && m.topics.some(tp => tp.id === n.topic_id)) return n
        const k = Number(r.noteTopics[`N${i}`])
        return { ...n, topic_id: Number.isInteger(k) && m.topics[k] ? m.topics[k].id : null }
      })
      if (!String(m.summary || '').trim() || body.replace_summary) m.summary = r.summary
      m.ai = {
        at: new Date().toISOString(),
        decisions: r.decisions,
        tasks: r.tasks.map(tk => {
          const p = matchPerson(m.invited || [], tk.owner_name)
          return { text: tk.text, owner_name: tk.owner_name, owner: p ? { key: p.key, name: p.name } : null, due: tk.due }
        }),
      }
      await storeMeeting(db, m, user)
      return res.status(200).json({ meeting: m })
    }

    return res.status(404).json({ error: 'Operação desconhecida.' })
  } catch (error) {
    console.error('[meetings]', op, error?.message || error)
    return res.status(500).json({ error: error?.message || 'Não foi possível concluir.' })
  }
}
