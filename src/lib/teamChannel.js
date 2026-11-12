// v1.0.217 · Canal da Equipe (Fase 1) — pure rules, no database here (see teamChannelOps.js).
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
export const MEMBERS_PATH = `${CHANNEL_ROOT}/members.json`

// ── v1.0.221 · Channels by area ─────────────────────────────────────────────
// Geral: every active internal user. Limpeza / Vendas / Marketing: whoever has the area's role.
// The admin is in every channel and can add or remove anyone from any channel (members.json):
//   { channels: { <key>: { add: ['employee:<id>', …], remove: [...] } }, mirrorCoversInGeral, updated_at, updated_by }
// Removing someone only hides the channel from them; the messages stay (the admin still sees them).
// Clients are never in a channel (their chat stays private, 1 to 1).
export const CHANNELS = [
  { key: 'geral', icon: '💬', en: 'General', ja: '全体', pt: 'Geral' },
  { key: 'limpeza', icon: '🧽', en: 'Cleaning', ja: '清掃', pt: 'Limpeza' },
  { key: 'vendas', icon: '🤝', en: 'Sales', ja: '営業', pt: 'Vendas' },
  { key: 'marketing', icon: '📣', en: 'Marketing', ja: 'マーケティング', pt: 'Marketing' },
]
export const CHANNEL_KEYS = CHANNELS.map(c => c.key)
export const channelDir = ch => (isDmKey(ch) ? `${CHANNEL_ROOT}/dm/${ch.slice(3)}` : `${CHANNEL_ROOT}/c/${ch}`)

// ── v1.0.224 · Private conversations (DM) between two internal people ───────
// Key 'dm:<role>-<id>__<role>-<id>' (sorted), files in team-channel/dm/<pair>/<YYYY-MM>/…
// Only the two people see it. Used for "falar com a gerência" (leaders, supervisors, admins).
const TOKEN_RE = /^(admin|employee|salesperson)-[0-9a-f-]{36}$/i
export const personToken = p => `${p?.role}-${p?.id}`
export function dmKey(a, b) {
  const [x, y] = [personToken(a), personToken(b)].sort()
  if (!TOKEN_RE.test(x) || !TOKEN_RE.test(y) || x === y) throw new Error('dm')
  return `dm:${x}__${y}`
}
export const isDmKey = k => /^dm:(admin|employee|salesperson)-[0-9a-f-]{36}__(admin|employee|salesperson)-[0-9a-f-]{36}$/i.test(String(k || ''))
/** The two people of a DM key: [{ role, id }, { role, id }]. */
export function dmPeople(key) {
  if (!isDmKey(key)) return []
  return key.slice(3).split('__').map(t => { const i = t.indexOf('-'); return { role: t.slice(0, i), id: t.slice(i + 1) } })
}
export const inDm = (p, key) => dmPeople(key).some(x => x.role === p?.role && x.id === p?.id)
/** The other person of a DM (with name when found in `people`). */
export function dmOther(key, me, people = []) {
  const o = dmPeople(key).find(x => !(x.role === me?.role && x.id === me?.id))
  return o ? (people.find(p => p.role === o.role && p.id === o.id) || o) : null
}
const MANAGER_ROLES = ['leader', 'supervisor']
/** Gerência: admins + employees whose role is leader / supervisor (never me). */
export const managersOf = (people = [], me) => people.filter(p => isInternalActive(p) && !(p.role === me?.role && p.id === me?.id)
  && (p.role === 'admin' || (p.role === 'employee' && MANAGER_ROLES.includes(String(p.job_role || '').trim()))))
export const LEGACY_DIR_CHANNEL = 'limpeza'
export const COVER_CHANNEL = 'limpeza'
export const INTERNAL_ROLES = ['admin', 'employee', 'salesperson']
export const personKey = p => `${p?.role}:${p?.id}`

const SALES_ROLE = /\b(vendas?|sales|seller|営業)/i
const MKT_ROLE = /\b(mkt|marketing)/i
const NOT_FIELD = /\b(mkt|marketing|vendas?|sales|seller|office|escrit|admin|事務|営業)/i

/** Is this person an active internal user? (clients and inactive people are never members) */
export const isInternalActive = p => !!p?.id && INTERNAL_ROLES.includes(p.role) && p.is_active !== false

/** Channels a person is in by role alone (before the admin's changes). */
export function autoChannels(p) {
  if (!isInternalActive(p)) return []
  if (p.role === 'admin') return [...CHANNEL_KEYS]
  const out = ['geral']
  if (p.role === 'salesperson') out.push(p.team === 'marketing' ? 'marketing' : 'vendas')
  if (p.role === 'employee') {
    const r = String(p.job_role || '').trim()
    if (MKT_ROLE.test(r)) out.push('marketing')
    else if (SALES_ROLE.test(r)) out.push('vendas')
    else if (!NOT_FIELD.test(r)) out.push('limpeza') // cleaner, leader, driver, trainee, no role…
  }
  return out
}

/** Clean members.json (unknown channels / bad keys dropped). */
export function normalizeMembers(raw) {
  const channels = {}
  for (const k of CHANNEL_KEYS) {
    const c = raw?.channels?.[k] || {}
    const ok = v => typeof v === 'string' && /^(employee|salesperson|admin):[\w-]+$/.test(v)
    const add = [...new Set((c.add || []).filter(ok))]
    const remove = [...new Set((c.remove || []).filter(ok))].filter(x => !add.includes(x))
    channels[k] = { add, remove }
  }
  return { channels, mirrorCoversInGeral: !!raw?.mirrorCoversInGeral, updated_at: raw?.updated_at || null, updated_by: raw?.updated_by || null }
}

/** Is the person in the channel? Admin: always. Inactive / client: never. */
export function inChannel(p, channel, members) {
  if (isDmKey(channel)) return isInternalActive(p) && inDm(p, channel)
  if (!isInternalActive(p) || !CHANNEL_KEYS.includes(channel)) return false
  if (p.role === 'admin') return true
  const m = normalizeMembers(members).channels[channel]
  const key = personKey(p)
  if (m.remove.includes(key)) return false
  if (m.add.includes(key)) return true
  return autoChannels(p).includes(channel)
}

/** Channels this person sees, in the fixed order. */
export const myChannels = (p, members) => CHANNEL_KEYS.filter(k => inChannel(p, k, members))

/** Members of a channel among `people` ({ role, id, name, … }). */
export const channelMembers = (channel, people = [], members) => people.filter(p => inChannel(p, channel, members))

/** members.json after the admin ticks (on = true) or unticks a person in a channel. */
export function setMember(members, channel, p, on) {
  const m = normalizeMembers(members)
  if (!CHANNEL_KEYS.includes(channel) || p?.role === 'admin') return m
  const key = personKey(p)
  const c = m.channels[channel]
  const auto = autoChannels(p).includes(channel)
  c.add = c.add.filter(x => x !== key)
  c.remove = c.remove.filter(x => x !== key)
  if (on && !auto) c.add.push(key)
  if (!on && auto) c.remove.push(key)
  return m
}

/** Does the channel show the cover cards? Limpeza always; Geral when the admin mirrors them. */
export const showsCovers = (channel, members) => channel === COVER_CHANNEL || (channel === 'geral' && normalizeMembers(members).mirrorCoversInGeral)

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

/**
 * Path for a new message. Name sorts by time (13-digit epoch ms).
 * v1.0.221 · one folder per channel: team-channel/c/<channel>/<YYYY-MM>/… (the v1.0.217 folder
 * team-channel/msgs/<YYYY-MM>/… is read as the history of Limpeza, where the covers live).
 */
export function messagePath(now = new Date(), rand = Math.random().toString(36).slice(2, 8), channel = 'limpeza') {
  const d = new Date(now)
  const tokyoMonth = new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 7)
  const ch = CHANNEL_KEYS.includes(channel) || isDmKey(channel) ? channel : 'geral'
  return `${channelDir(ch)}/${tokyoMonth}/${String(d.getTime()).padStart(13, '0')}_${String(rand).replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'x'}.json`
}
export const requestPath = jobId => `${REQ_DIR}/${jobId}.json`

/** Only these paths may be read by the push route (no way to point it anywhere else). */
export const CHANNEL_PATH_RE = /^team-channel\/((msgs|c\/(geral|limpeza|vendas|marketing)|dm\/(admin|employee|salesperson)-[0-9a-f-]{36}__(admin|employee|salesperson)-[0-9a-f-]{36})\/\d{4}-\d{2}\/\d{13}_[a-z0-9]{1,8}|requests\/[0-9a-f-]{36})\.json$/i
/** Channel of a message path ('limpeza' for the v1.0.217 folder and for cover requests). */
export function channelOfPath(p) {
  const d = String(p || '').match(/^team-channel\/dm\/([^/]+)\//)
  if (d) return `dm:${d[1]}`
  const m = String(p || '').match(/^team-channel\/c\/(geral|limpeza|vendas|marketing)\//)
  return m ? m[1] : 'limpeza'
}
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
export function buildMessage({ kind = 'text', text = '', author, job = null, now = new Date(), channel = 'geral' }) {
  if (!author?.id || !INTERNAL_ROLES.includes(author.role)) throw new Error('author')
  if (isDmKey(channel) ? !inDm(author, channel) : !CHANNEL_KEYS.includes(channel)) throw new Error('channel')
  const body = cleanText(text)
  if (kind === 'text' && !body) throw new Error('empty')
  return {
    kind,
    channel,
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

export const channelLabel = (key, lang = 'pt') => {
  const c = CHANNELS.find(x => x.key === key)
  if (!c) return key
  return lang === 'ja' ? c.ja : lang === 'pt' ? c.pt : c.en
}

/** Push for a plain message: "#Limpeza · Gabriel" + the text. */
export function textPushText(msg, lang = 'pt') {
  if (isDmKey(msg?.channel)) {
    const t = String(msg?.text || '').replace(/\s+/g, ' ').trim()
    return { title: `💬 ${msg?.author?.name || ''}`.trim(), body: t.length > 120 ? `${t.slice(0, 119)}…` : t }
  }
  const ch = CHANNELS.find(x => x.key === msg?.channel)
  const t = String(msg?.text || '').replace(/\s+/g, ' ').trim()
  return { title: `${ch?.icon || '💬'} ${channelLabel(msg?.channel, lang)} · ${msg?.author?.name || ''}`.trim(), body: t.length > 120 ? `${t.slice(0, 119)}…` : t }
}
