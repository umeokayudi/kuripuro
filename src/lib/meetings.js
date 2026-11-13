// v1.0.231 · Reuniões (admin) — pure rules shared by the page and the server (api/_meetings.js).
//
// Meetings happen on Google Meet. Meet already writes the meeting notes ("Anotações do Gemini" +
// transcript, with who spoke); the admin IMPORTS that document (paste the text, or the .docx/.pdf/.txt
// downloaded from Google Docs). Fallback: upload an audio file and the AI transcribes it. No bot
// joins the call.
//
// No SQL: every meeting is one private JSON file, read and written only by the server with the
// service role, in the private bucket sales-private:
//   team-meetings/m/<id>.json      the meeting (below)
//   team-meetings/index.json       one short row per meeting, for the list and the search
//   team-meetings/a/<id>/<n>.<ext> uploaded audio files (fallback)
//
// Meeting:
//   { id, rev, title, series (group), starts_at (ISO), meet_url, agenda, status: 'planned' | 'done',
//     invited: [{ key: 'employee:<id>' | 'admin:<id>' | 'salesperson:<id>', name, role }],
//     attendance: { <key>: 'present' | 'absent' },
//     content: { source: 'meet' | 'audio' | '', file_name, imported_at, raw, lines: [{ t (s) | null, speaker, text }] },
//     audio: [{ n, path, mime, duration (s), name, parts: [{ from, to, segments: [{ t, speaker, text }] }], status }],
//     notes: [{ id, text, at, topic_id | null }]            ← the admin's own notes
//     topics: [{ id, title, start_line, end_line, start_t, summary }],  ← lines [start_line, end_line)
//     summary, decisions: [{ id, text }],
//     tasks: [{ id, text, owner: { key, name } | null, due: 'YYYY-MM-DD' | '', status: 'open' | 'done' | 'carried', from? }],
//     ai: { at, decisions: [text], tasks: [{ text, owner_name, owner, due }] } | null,
//     created_at, created_by, updated_at, updated_by }

export const ROOT = 'team-meetings'
export const BUCKET = 'sales-private'
export const meetingPath = id => `${ROOT}/m/${id}.json`
export const INDEX_PATH = `${ROOT}/index.json`
export const audioDir = id => `${ROOT}/a/${id}`

/** A long attached file is transcribed in windows of this many seconds. */
export const WINDOW_SECONDS = 600
export const MAX_AUDIO_BYTES = 19 * 1024 * 1024

export const ID_RE = /^[a-z0-9]{6,32}$/
export const AUDIO_EXT = {
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a',
  'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
}
export const baseMime = m => String(m || '').split(';')[0].trim().toLowerCase()

export const MAX_RAW = 400_000
export const MAX_LINES = 5000

export function newId(len = 12) {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  const rnd = (globalThis.crypto?.getRandomValues) ? globalThis.crypto.getRandomValues(new Uint8Array(len)) : null
  for (let i = 0; i < len; i++) out += abc[(rnd ? rnd[i] : Math.floor(Math.random() * 256)) % abc.length]
  return out
}

const str = (v, max) => String(v ?? '').slice(0, max)
const num = v => (Number.isFinite(Number(v)) ? Number(v) : null)
const DATE = /^\d{4}-\d{2}-\d{2}$/

export const emptyContent = () => ({ source: '', file_name: '', imported_at: '', raw: '', lines: [] })

export function emptyMeeting({ title = '', series = '', starts_at = '', agenda = '', invited = [] } = {}) {
  return {
    id: newId(), rev: 0, title, series, starts_at, agenda, status: 'planned',
    meet_url: '', invited, attendance: {}, content: emptyContent(), audio: [], notes: [], topics: [], summary: '', decisions: [], tasks: [], ai: null,
  }
}

/** Keeps only the fields the page may change, with sane sizes. Unknown keys are dropped. */
export function cleanPatch(patch = {}) {
  const out = {}
  if ('title' in patch) out.title = str(patch.title, 160).trim()
  if ('series' in patch) out.series = str(patch.series, 80).trim()
  if ('starts_at' in patch) out.starts_at = Number.isNaN(Date.parse(patch.starts_at)) ? '' : new Date(patch.starts_at).toISOString()
  if ('agenda' in patch) out.agenda = str(patch.agenda, 8000)
  if ('meet_url' in patch) out.meet_url = /^https:\/\/meet\.google\.com\/[\w-]+/.test(patch.meet_url || '') ? str(patch.meet_url, 200).trim() : ''
  if ('status' in patch) out.status = patch.status === 'done' ? 'done' : 'planned'
  if ('summary' in patch) out.summary = str(patch.summary, 8000)
  if ('invited' in patch) {
    const seen = new Set()
    out.invited = (Array.isArray(patch.invited) ? patch.invited : []).filter(p => {
      const ok = p && /^(admin|employee|salesperson):[\w-]{1,64}$/.test(p.key || '') && !seen.has(p.key)
      if (ok) seen.add(p.key)
      return ok
    }).slice(0, 80).map(p => ({ key: p.key, name: str(p.name, 80), role: str(p.role, 20) }))
  }
  if ('attendance' in patch) {
    out.attendance = {}
    for (const [k, v] of Object.entries(patch.attendance || {})) {
      if (/^(admin|employee|salesperson):[\w-]{1,64}$/.test(k) && (v === 'present' || v === 'absent')) out.attendance[k] = v
    }
  }
  if ('notes' in patch) {
    out.notes = (Array.isArray(patch.notes) ? patch.notes : []).slice(0, 500).map(n => ({
      id: str(n.id || newId(8), 32), at: str(n.at, 40), text: str(n.text, 4000), topic_id: n.topic_id ? str(n.topic_id, 32) : null,
    })).filter(n => n.text.trim())
  }
  if ('topics' in patch) {
    out.topics = (Array.isArray(patch.topics) ? patch.topics : []).slice(0, 60).map(tp => ({
      id: str(tp.id || newId(8), 32), title: str(tp.title, 160), start_line: num(tp.start_line) ?? 0, end_line: num(tp.end_line),
      start_t: num(tp.start_t), summary: str(tp.summary, 3000),
    }))
  }
  if ('decisions' in patch) {
    out.decisions = (Array.isArray(patch.decisions) ? patch.decisions : []).slice(0, 100).map(d => ({ id: str(d.id || newId(8), 32), text: str(d.text, 1000) })).filter(d => d.text.trim())
  }
  if ('tasks' in patch) {
    out.tasks = (Array.isArray(patch.tasks) ? patch.tasks : []).slice(0, 150).map(cleanTask).filter(tk => tk.text.trim())
  }
  return out
}

export function cleanTask(tk = {}) {
  const owner = tk.owner && /^(admin|employee|salesperson):[\w-]{1,64}$/.test(tk.owner.key || '') ? { key: tk.owner.key, name: str(tk.owner.name, 80) } : null
  const out = {
    id: str(tk.id || newId(8), 32), text: str(tk.text, 1000), owner,
    due: DATE.test(tk.due || '') ? tk.due : '',
    status: ['open', 'done', 'carried'].includes(tk.status) ? tk.status : 'open',
  }
  if (tk.done_at) out.done_at = str(tk.done_at, 40)
  if (tk.from && ID_RE.test(tk.from.meeting_id || '')) out.from = { meeting_id: tk.from.meeting_id, task_id: str(tk.from.task_id, 32), title: str(tk.from.title, 160) }
  return out
}

/** The meeting content lines (imported Meet notes, or the audio transcript). */
export const linesOf = m => m?.content?.lines || []
export const transcriptOf = linesOf

/** Lines from the transcribed audio files, in file order then time. */
export function audioLines(m) {
  let offset = 0
  const out = []
  for (const a of [...(m?.audio || [])].sort((x, y) => x.n - y.n)) {
    for (const p of a.parts || []) for (const sg of p.segments || []) out.push({ t: Math.round((sg.t + offset) * 10) / 10, speaker: sg.speaker || '', text: sg.text })
    offset += Number(a.duration) || 0
  }
  return out.sort((x, y) => (x.t ?? 0) - (y.t ?? 0))
}

export const audioPending = m => (m?.audio || []).filter(a => a.status !== 'done')

const TIME_ONLY = /^\(?\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\)?$/
const TIME_IN = /[([]\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[)\]]/
const SPEAKER = /^([^:：]{1,48})[:：]\s+(.+)$/
const NOT_A_NAME = /^(https?|http|obs|nota|note|summary|resumo|detalhes|details|próximos passos|next steps|transcri\w*|pauta|agenda|decis\w*|data|date|hora|time)$/i

export function clockToSeconds(v) {
  const parts = String(v || '').split(':').map(Number)
  if (!parts.length || parts.some(n => !Number.isFinite(n))) return null
  return parts.reduce((s, n) => s * 60 + n, 0)
}

/**
 * Text of the Google Meet notes / transcript document → lines { t, speaker, text }.
 * Understands "Nome: fala", a time alone on its own line ("00:05:12"), and "(00:05:12)" inside a line.
 */
export function parseMeetText(raw) {
  const out = []
  let t = null
  for (let line of String(raw || '').replace(/\r/g, '').split('\n')) {
    line = line.replace(/\u00a0/g, ' ').replace(/^\s*[-*•·]\s*/, '').trim()
    if (!line) continue
    const only = line.match(TIME_ONLY)
    if (only) { t = clockToSeconds(only[1]); continue }
    const inl = line.match(TIME_IN)
    let lt = t
    if (inl) { lt = clockToSeconds(inl[1]); line = line.replace(TIME_IN, '').replace(/\s{2,}/g, ' ').trim() }
    const sp = line.match(SPEAKER)
    const name = sp?.[1]?.trim()
    if (sp && name && name.split(/\s+/).length <= 4 && /\p{L}/u.test(name) && !NOT_A_NAME.test(name) && !/\d{2,}/.test(name)) {
      out.push({ t: lt, speaker: name.slice(0, 60), text: sp[2].trim().slice(0, 4000) })
    } else out.push({ t: lt, speaker: '', text: line.slice(0, 4000) })
    if (out.length >= MAX_LINES) break
  }
  return out
}

/** Who spoke, by number of lines. */
export function speakersOf(lines) {
  const count = new Map()
  for (const l of lines || []) if (l.speaker) count.set(l.speaker, (count.get(l.speaker) || 0) + 1)
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([name, lines]) => ({ name, lines }))
}

/** Lines and admin notes under each topic (topic = lines [start_line, next topic start)). */
export function groupByTopic(m) {
  const topics = [...(m?.topics || [])].sort((a, b) => a.start_line - b.start_line)
  const lines = linesOf(m)
  const notes = m?.notes || []
  return topics.map((tp, i) => {
    const from = i === 0 ? 0 : tp.start_line
    const to = topics[i + 1] ? topics[i + 1].start_line : lines.length
    return { ...tp, from, to, lines: lines.slice(from, to).map((l, k) => ({ ...l, n: from + k })), notes: notes.filter(n => n.topic_id === tp.id) }
  })
}

/** "1:05:09" / "4:07" */
export function fmtClock(sec) {
  if (sec == null || !Number.isFinite(sec)) return ''
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600), mi = Math.floor((s % 3600) / 60), se = s % 60
  return h ? `${h}:${String(mi).padStart(2, '0')}:${String(se).padStart(2, '0')}` : `${mi}:${String(se).padStart(2, '0')}`
}

export const openTasks = m => (m?.tasks || []).filter(tk => tk.status === 'open')

/** The last earlier meeting of the same group (series), from the index rows. */
export function previousOf(rows, m) {
  const series = String(m?.series || '').trim().toLowerCase()
  if (!series || !m?.starts_at) return null
  const at = Date.parse(m.starts_at)
  return (rows || [])
    .filter(r => r.id !== m.id && String(r.series || '').trim().toLowerCase() === series && Date.parse(r.starts_at) < at)
    .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at))[0] || null
}

const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Short row for the list + the text the search looks into (capped). */
export function indexRow(m) {
  const lines = transcriptOf(m)
  const present = Object.values(m.attendance || {}).filter(v => v === 'present').length
  const search = fold([
    m.title, m.series, m.agenda, m.summary,
    ...(m.invited || []).map(p => p.name),
    ...(m.decisions || []).map(d => d.text),
    ...(m.tasks || []).map(tk => `${tk.text} ${tk.owner?.name || ''}`),
    ...(m.topics || []).map(tp => `${tp.title} ${tp.summary}`),
    ...(m.notes || []).map(n => n.text),
    ...lines.map(l => `${l.speaker || ''} ${l.text}`),
  ].filter(Boolean).join(' \n ')).slice(0, 60000)
  return {
    id: m.id, title: m.title, series: m.series, starts_at: m.starts_at, status: m.status,
    invited: (m.invited || []).length, present,
    open_tasks: openTasks(m).length, tasks: (m.tasks || []).length,
    source: m.content?.source || '', lines: lines.length, has_content: lines.length > 0,
    updated_at: m.updated_at || null, search,
  }
}

export function searchRows(rows, q) {
  const words = fold(q).split(/\s+/).filter(Boolean)
  if (!words.length) return rows
  return rows.filter(r => words.every(w => r.search?.includes(w)))
}

/** Map a name the AI wrote ("Gabriel") to an invited person. */
export function matchPerson(people, name) {
  const n = fold(name).trim()
  if (!n) return null
  return people.find(p => fold(p.name) === n)
    || people.find(p => fold(p.name).split(/\s+/)[0] === n.split(/\s+/)[0])
    || people.find(p => fold(p.name).includes(n) || n.includes(fold(p.name)))
    || null
}
