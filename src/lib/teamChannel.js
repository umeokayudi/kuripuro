// v1.0.215 · Canal da Equipe (Fase 1) — pure rules, no database here (see teamChannelOps.js).
//
// One conversation for the whole team (admin + every employee). No SQL: each message is one small
// JSON file in the public service-photos bucket (one file per message = two people posting at the
// same moment never overwrite each other):
//   team-channel/msgs/<YYYY-MM>/<epoch ms 13 digits>_<rand>.json
//     { id, kind: 'text' | 'cover' | 'took' | 'cant_go' | 'cancel', text, at,
//       author: { role: 'admin' | 'employee', id, name }, job?: { id, store, service, date, time } }
// A "não posso ir" request of the person who has the job:
//   team-channel/requests/<jobId>.json
//     { job_id, from: { id, name }, reason, at, status: 'open' | 'taken' | 'cancelled', taken_by?, closed_at? }
//
// Cover cards are NOT stored: they are read live from jobs every time, so the channel and the
// Painel do Dia always agree:
//   • 'free'    → open offer (no person, spot_status pending) — same rule as "Serviços livres"
//   • 'cant_go' → the person who has the job asked for cover and still has it (not started)
// A card only ever shows store, day, time and type of service: never the client's value.

export const CHANNEL_ROOT = 'team-channel'
export const MSG_DIR = `${CHANNEL_ROOT}/msgs`
export const REQ_DIR = `${CHANNEL_ROOT}/requests`
export const MAX_TEXT = 1000

const MONTH_RE = /^\d{4}-\d{2}$/
export const monthOf = iso => String(iso || '').slice(0, 7)

/** The month folder before `month` ('2026-01' → '2025-12'). */
export function prevMonth(month) {
  if (!MONTH_RE.test(month)) return ''
  let [y, m] = month.split('-').map(Number)
  m -= 1
  if (m === 0) { m = 12; y -= 1 }
  return `${y}-${String(m).padStart(2, '0')}`
}

/** Path for a new message. Name sorts by time (13-digit epoch ms). */
export function messagePath(now = new Date(), rand = Math.random().toString(36).slice(2, 8)) {
  const d = new Date(now)
  const tokyoMonth = new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 7)
  return `${MSG_DIR}/${tokyoMonth}/${String(d.getTime()).padStart(13, '0')}_${String(rand).replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'x'}.json`
}
export const requestPath = jobId => `${REQ_DIR}/${jobId}.json`

/** Only these paths may be read by the push route (no way to point it anywhere else). */
export const CHANNEL_PATH_RE = /^team-channel\/(msgs\/\d{4}-\d{2}\/\d{13}_[a-z0-9]{1,8}|requests\/[0-9a-f-]{36})\.json$/i
export const isChannelPath = p => CHANNEL_PATH_RE.test(String(p || ''))

/** Clean text of a message (trimmed, max length, no empty). */
export function cleanText(text) {
  const t = String(text || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) : t
}

const splitTitle = title => String(title || '').split(' — ')

/** What a card / a message may say about a job: store, service, day, time. Nothing else. */
export function jobBrief(job) {
  if (!job) return null
  const [store, ...rest] = splitTitle(job.title)
  return {
    id: job.id,
    store: (store || job.client_name || '—').trim(),
    service: rest.join(' — ').trim(),
    date: job.scheduled_date || '',
    time: job.scheduled_time ? String(job.scheduled_time).slice(0, 5) : '',
  }
}

/** A new message object (without the path). */
export function buildMessage({ kind = 'text', text = '', author, job = null, now = new Date() }) {
  if (!author?.id || !['admin', 'employee'].includes(author.role)) throw new Error('author')
  const body = cleanText(text)
  if (kind === 'text' && !body) throw new Error('empty')
  return {
    kind,
    text: body,
    at: new Date(now).toISOString(),
    author: { role: author.role, id: author.id, name: String(author.name || '').slice(0, 60) },
    ...(job ? { job: jobBrief(job) } : {}),
  }
}

/** Messages oldest first; keeps only well-formed ones. */
export function sortMessages(list = []) {
  return list
    .filter(m => m && m.at && m.author && typeof m.kind === 'string')
    .sort((a, b) => String(a.at).localeCompare(String(b.at)) || String(a.id || '').localeCompare(String(b.id || '')))
}

/** Is a "não posso ir" request still asking for cover? (job still with the requester, not started, not past) */
export function requestStillOpen(req, job, today) {
  if (!req || req.status !== 'open' || !job) return false
  if (job.employee_id !== req.from?.id) return false
  if (job.status !== 'assigned') return false
  return String(job.scheduled_date || '') >= String(today || '')
}

/**
 * Cover cards, soonest first.
 * openJobs: open offers (no person, spot_status pending, status assigned, today or later).
 * requests: "não posso ir" files; jobsById: the jobs those point to (fresh).
 * me: { id, role } (employee or admin); fitOf(job) → { ok, reason } for the employee (role / day).
 */
export function buildCoverCards({ openJobs = [], requests = [], jobsById = {}, today, me = null, fitOf = null }) {
  const cards = []
  const seen = new Set()
  for (const j of openJobs) {
    if (!j?.id || seen.has(j.id)) continue
    if (j.employee_id || j.spot_status !== 'pending' || j.status !== 'assigned') continue
    if (String(j.scheduled_date || '') < String(today || '')) continue
    seen.add(j.id)
    cards.push({ key: `free:${j.id}`, kind: 'free', job: j, brief: jobBrief(j), from: null })
  }
  for (const r of requests) {
    const j = jobsById[r?.job_id]
    if (!j || seen.has(j.id) || !requestStillOpen(r, j, today)) continue
    seen.add(j.id)
    cards.push({ key: `cant:${j.id}`, kind: 'cant_go', job: j, brief: jobBrief(j), from: r.from, reason: r.reason || '', at: r.at })
  }
  for (const c of cards) {
    c.mine = !!me && c.kind === 'cant_go' && c.from?.id === me.id
    c.fit = me?.role === 'employee' && !c.mine && fitOf ? fitOf(c.job) : { ok: true, reason: 'ok' }
    c.canTake = me?.role === 'employee' && !c.mine && c.fit.reason !== 'role' && c.fit.reason !== 'inactive'
  }
  return cards.sort((a, b) => `${a.brief.date} ${a.brief.time || '99'}`.localeCompare(`${b.brief.date} ${b.brief.time || '99'}`))
}

/** Own upcoming jobs where the person can still say "não posso ir" (assigned, not started, from today). */
export function cantGoCandidates(jobs = [], meId, today, requests = []) {
  const asked = new Set(requests.filter(r => r?.status === 'open').map(r => r.job_id))
  return jobs
    .filter(j => j && j.employee_id === meId && j.status === 'assigned' && String(j.scheduled_date || '') >= String(today || ''))
    .filter(j => !asked.has(j.id))
    .sort((a, b) => `${a.scheduled_date} ${a.scheduled_time || ''}`.localeCompare(`${b.scheduled_date} ${b.scheduled_time || ''}`))
}

/** The fields that make a "não posso ir" job belong to the person who took it. */
export function takeCantGoPatch(job, taker) {
  const patch = { employee_id: taker.id, employee_name: taker.name || null }
  // a spot keeps being a spot of the new person, already accepted by them
  if (job?.job_category === 'spot') { patch.spot_status = 'accepted'; patch.spot_responded_at = new Date().toISOString() }
  return patch
}

/** Push text for a cover request (same words in the channel). Never money. */
export function coverPushText(msg, lang = 'pt') {
  const L = (en, ja, pt) => (lang === 'ja' ? ja : lang === 'pt' ? pt : en)
  const j = msg?.job || {}
  const day = j.date ? `${j.date.slice(8, 10)}/${j.date.slice(5, 7)}` : ''
  const where = [j.store, j.service, day, j.time].filter(Boolean).join(' · ')
  if (msg?.kind === 'cant_go') {
    return {
      title: L(`🆘 ${msg.author?.name || 'Someone'} needs cover`, `🆘 ${msg.author?.name || ''}さんの代わりを募集`, `🆘 ${msg.author?.name || 'Alguém'} precisa de cobertura`),
      body: where,
    }
  }
  return { title: L('🙋 Service needs someone', '🙋 担当者募集', '🙋 Serviço precisa de alguém'), body: where }
}
