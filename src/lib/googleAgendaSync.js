// v1.0.179 · Google Agenda ⇄ KuriPuro: pure helpers shared by the browser (preview screen) and the
// server (api/_google-calendar.js). No imports without ".js" so Node on Vercel can load it.
import { jobTimes, jobEventTitle, jobEventDetails } from './calendar.js'

// Same ids/labels as DEEP_TASKS in cleaningType.js (scripts/test-google-agenda.mjs checks they match).
export const DEEP_TASK_LABELS = {
  range_hood: 'Range Hood', grease_trap: 'Grease Trap', grating: 'Grating', stove: 'Stove',
  ac: 'AC Cleaning', fryer: 'Fryer', kitchen_equipment: 'Kitchen Equipment', fridge: 'Fridge',
  walls: 'Walls & Tiles', floor_scrub: 'Floor Scrub', drains: 'Drains', restroom: 'Restroom',
  windows: 'Windows', ceiling: 'Ceiling & Lights', seats: 'Seats & Sofas', floor_wax: 'Floor Wax',
}

// Words in an event that point to a deep-clean task (EN / PT / JA).
const DEEP_WORDS = {
  range_hood: /range\s*hood|coifa|レンジフード|フード/i,
  grease_trap: /grease\s*trap|caixa de gordura|グリストラップ|グリスト/i,
  grating: /grating|grelha|グレーチング|グレーティング/i,
  stove: /stove|fog[aã]o|コンロ/i,
  ac: /\bac\b|air\s*con|ar[- ]condicionado|エアコン/i,
  fryer: /fryer|fritadeira|フライヤー/i,
  kitchen_equipment: /kitchen equipment|equipamentos? da cozinha|厨房機器/i,
  fridge: /fridge|geladeira|冷蔵庫/i,
  walls: /walls?|tiles?|paredes?|azulejos?|壁|タイル/i,
  floor_scrub: /floor scrub|lavar piso|床洗浄|床の洗浄/i,
  drains: /drains?|ralos?|排水/i,
  restroom: /restroom|toilet|banheiro|トイレ/i,
  windows: /windows?|vidros?|janelas?|窓/i,
  ceiling: /ceiling|teto|lumin[aá]ria|天井|照明/i,
  seats: /seats?|sof[aá]s?|cadeiras?|椅子|ソファ/i,
  floor_wax: /wax|cera|ワックス/i,
}
const DEEP_RE = /deep\s*clean|limpeza (pesada|profunda)|深層|ディープ|大掃除/i
const SPOT_RE = /\bspot\b|urgente|urgent|スポット|臨時/i

export const AUTO_IMPORT_MODES = ['off', 'preview', 'create']
export const DEFAULT_SETTINGS = {
  company_tag: 'JBM', color_id: '9', auto_import: 'preview', auto_export: true, days_ahead: 60, default_hours: 2,
}

const pad = n => String(n).padStart(2, '0')

/** Normalized text for matching: NFKC, lower case, no spaces/punctuation. */
export function norm(text) {
  return String(text || '').normalize('NFKC').toLowerCase().replace(/[\s\-_.,·・/\\()（）[\]【】「」'"`!?！？:：]+/g, '')
}

/** Google start/end ({ dateTime } or { date }) → Tokyo "YYYY-MM-DD" + "HH:MM" (Japan has no DST). */
export function tokyoParts(point) {
  if (!point) return { date: '', time: '' }
  if (point.date && !point.dateTime) return { date: point.date, time: '' }
  const d = new Date(point.dateTime)
  if (Number.isNaN(d.getTime())) return { date: '', time: '' }
  const t = new Date(d.getTime() + 9 * 3600000)
  return {
    date: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`,
    time: `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`,
  }
}

export const eventKey = (accountId, calendarId, eventId) => `${accountId}|${calendarId}|${eventId}`

/** True for events KuriPuro itself wrote into Google (never import them back). */
export function isKuripuroEvent(ev) {
  return Boolean(ev?.extendedProperties?.private?.kuripuro_job)
}

/** Google event → the small object the AI and the preview work with. */
export function normalizeEvent(ev, { account = {}, calendar = {} } = {}) {
  const start = tokyoParts(ev.start)
  const end = tokyoParts(ev.end)
  return {
    key: eventKey(account.id, calendar.id, ev.id),
    account_id: account.id,
    calendar_id: calendar.id,
    calendar_name: calendar.summary || calendar.id,
    event_id: ev.id,
    owner_kind: account.owner_kind,
    owner_id: account.owner_id,
    owner_name: account.owner_name || '',
    summary: String(ev.summary || '').trim(),
    description: String(ev.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+\n/g, '\n').trim().slice(0, 1500),
    location: String(ev.location || '').trim(),
    attendees: (ev.attendees || []).map(a => a.displayName || a.email).filter(Boolean).slice(0, 10),
    date: start.date,
    time: start.time,
    end_time: end.date === start.date ? end.time : '',
    all_day: !start.time,
    updated: ev.updated || '',
    html_link: ev.htmlLink || '',
    cancelled: ev.status === 'cancelled',
  }
}

function bestByName(list, text, nameOf) {
  const hay = norm(text)
  let best = null
  for (const item of list) {
    const n = norm(nameOf(item))
    if (n.length < 2 || !hay.includes(n)) continue
    if (!best || n.length > norm(nameOf(best)).length) best = item
  }
  return best
}

/** Employee named in the event (full name, or a first/last name of 3+ letters that only one person has). */
export function matchEmployee(employees = [], text = '') {
  const full = bestByName(employees, text, e => e.full_name)
  if (full) return full
  const hay = norm(text)
  const hits = new Map()
  for (const e of employees) {
    for (const part of String(e.full_name || '').normalize('NFKC').toLowerCase().split(/\s+/)) {
      if (part.length >= 3 && hay.includes(norm(part))) hits.set(e.id, e)
    }
  }
  return hits.size === 1 ? [...hits.values()][0] : null
}

export function matchPlace(places = [], text = '') {
  return bestByName(places, text, p => p.name)
}

export function detectDeepTasks(text = '') {
  return Object.keys(DEEP_WORDS).filter(id => DEEP_WORDS[id].test(text))
}

/** Draft made without AI (also the fallback when the AI fails). */
export function heuristicDraft(event, { places = [], employees = [], clients = [] } = {}) {
  const text = [event.summary, event.location, event.description, ...(event.attendees || [])].join('\n')
  const place = matchPlace(places, [event.summary, event.location].join(' ')) || matchPlace(places, text)
  const owner = event.owner_kind === 'employee' ? employees.find(e => e.id === event.owner_id) : null
  const emp = matchEmployee(employees, text) || owner
  const deepTasks = detectDeepTasks(text)
  const deep = DEEP_RE.test(text) || deepTasks.length > 0
  const client = place?.client_id ? clients.find(c => c.id === place.client_id) : null
  return finishDraft({
    key: event.key,
    is_job: Boolean(place) || /limpeza|cleaning|清掃|掃除|faxina/i.test(text),
    confidence: place && emp ? 0.6 : place ? 0.45 : 0.2,
    reason: place ? `Local "${place.name}" achado no evento` : 'Nenhum local conhecido no evento',
    place_name: place?.name || event.location || event.summary,
    location_id: place && !String(place.id).startsWith('sc:') ? place.id : null,
    client_id: client?.id || place?.client_id || null,
    address: place?.address || event.location || '',
    cleaning_type: deep ? 'deep' : 'basic',
    deep_tasks: deep ? deepTasks : [],
    employee_id: emp?.id || null,
    date: event.date,
    time: event.time,
    end_time: event.end_time,
    job_category: SPOT_RE.test(text) ? 'spot' : 'regular',
    value: 0,
    description: event.description,
    instructions: '',
    source: 'regras',
  }, { places, employees, clients, event })
}

/**
 * Cleans an AI (or edited) draft: ids must exist, date/time formats, known deep tasks only.
 * Unknown employee/place ids become null so a hallucinated id can never reach the jobs table.
 */
export function finishDraft(d, { places = [], employees = [], clients = [], event = null } = {}) {
  const emp = employees.find(e => e.id === d.employee_id) || null
  const place = places.find(p => p.id === d.location_id) || (d.place_name ? places.find(p => norm(p.name) === norm(d.place_name)) : null) || null
  const clientId = clients.find(c => c.id === d.client_id)?.id || place?.client_id || null
  const client = clients.find(c => c.id === clientId) || null
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(d.date || '')) ? d.date : (event?.date || '')
  const time = /^\d{2}:\d{2}$/.test(String(d.time || '')) ? d.time : (event?.time || '')
  const end = /^\d{2}:\d{2}$/.test(String(d.end_time || '')) ? d.end_time : ''
  const type = d.cleaning_type === 'deep' ? 'deep' : 'basic'
  const tasks = type === 'deep' ? [...new Set((d.deep_tasks || []).filter(id => DEEP_TASK_LABELS[id]))] : []
  return {
    key: d.key || event?.key,
    is_job: d.is_job !== false,
    confidence: Math.max(0, Math.min(1, Number(d.confidence) || 0)),
    reason: String(d.reason || '').slice(0, 240),
    place_name: String(place?.name || d.place_name || '').replace(/\s+—\s+.*$/, '').trim().slice(0, 120),
    location_id: place && !String(place.id).startsWith('sc:') ? place.id : null,
    known_place: Boolean(place),
    client_id: clientId,
    client_name: client?.company_name || '',
    address: String(d.address || place?.address || '').trim().slice(0, 300),
    cleaning_type: type,
    deep_tasks: tasks,
    employee_id: emp?.id || null,
    employee_name: emp?.full_name || '',
    date,
    time,
    end_time: end,
    job_category: d.job_category === 'spot' ? 'spot' : 'regular',
    value: Math.max(0, Math.round(Number(d.value) || 0)),
    description: String(d.description || '').slice(0, 1500),
    instructions: String(d.instructions || '').slice(0, 800),
    source: d.source || 'ia',
  }
}

export function draftTitle(d) {
  const loc = d.place_name || 'Serviço'
  if (d.cleaning_type !== 'deep') return `${loc} — Basic Cleaning`
  const chosen = new Set(d.deep_tasks || [])
  const labels = Object.keys(DEEP_TASK_LABELS).filter(id => chosen.has(id)).map(id => DEEP_TASK_LABELS[id])
  return labels.length && labels.length < Object.keys(DEEP_TASK_LABELS).length
    ? `${loc} — Deep Clean (${labels.join(', ')})` : `${loc} — Deep Clean`
}

/** What is still missing before a draft can become a job (empty = ready). */
export function draftProblems(d) {
  return [
    !d.place_name && 'local',
    !d.date && 'data',
    !d.employee_id && 'funcionário',
  ].filter(Boolean)
}

/** Draft → row for public.jobs (same fields the New Job form writes). */
export function draftToJobRow(d, { companyTag = '', eventLink = '' } = {}) {
  const window = d.time ? `${d.time}${d.end_time ? `–${d.end_time}` : ''}` : ''
  const note = [
    d.description,
    window && `Horário na agenda: ${window}`,
    `📅 Importado do Google Agenda${companyTag ? ` · ${companyTag}` : ''}`,
    eventLink,
  ].filter(Boolean).join('\n')
  const spot = d.job_category === 'spot'
  return {
    title: draftTitle(d),
    client_id: d.client_id || null,
    client_name: d.client_name || '',
    employee_id: d.employee_id,
    employee_name: d.employee_name || '',
    scheduled_date: d.date,
    scheduled_time: d.time || '',
    address: d.address || '',
    value: spot ? 0 : d.value || 0,
    spot_value: spot ? d.value || 0 : 0,
    description: note,
    instructions: d.instructions || null,
    job_category: spot ? 'spot' : 'regular',
    status: 'assigned',
    spot_status: spot ? 'pending' : null,
    photo_required: false,
  }
}

/** "[JBM] title" — the company is always marked, and never twice. */
export function tagTitle(title, tag) {
  const t = String(tag || '').trim()
  const base = String(title || '').trim()
  if (!t) return base
  const mark = `[${t}]`
  return base.startsWith(mark) ? base : `${mark} ${base}`
}

function hoursFrom(job, fallback) {
  const m = String(job?.description || '').match(/Horário na agenda: (\d{2}):(\d{2})–(\d{2}):(\d{2})/)
  if (m) {
    const mins = (Number(m[3]) * 60 + Number(m[4])) - (Number(m[1]) * 60 + Number(m[2]))
    if (mins > 0) return mins / 60
  }
  return Number(fallback) || 2
}

/** KuriPuro job → Google Calendar event body, always tagged with the company. */
export function jobToGoogleEvent(job, settings = DEFAULT_SETTINGS, { appUrl = '' } = {}) {
  const tag = settings.company_tag || ''
  const times = jobTimes(job, hoursFrom(job, settings.default_hours))
  const body = {
    summary: tagTitle(jobEventTitle(job), tag),
    description: [tag && `🏢 ${tag}`, jobEventDetails(job, { appUrl })].filter(Boolean).join('\n'),
    location: job.address || '',
    extendedProperties: { private: { kuripuro_job: job.id, kuripuro_company: tag } },
    source: appUrl ? { title: 'KuriPuro', url: appUrl } : undefined,
  }
  if (settings.color_id) body.colorId = String(settings.color_id)
  if (times) {
    body.start = { dateTime: times.start.toISOString(), timeZone: 'Asia/Tokyo' }
    body.end = { dateTime: times.end.toISOString(), timeZone: 'Asia/Tokyo' }
  } else {
    const [y, m, d] = String(job.scheduled_date).split('-').map(Number)
    body.start = { date: job.scheduled_date }
    body.end = { date: new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10) }
  }
  if (!body.source) delete body.source
  return body
}

/** Small stable hash so an unchanged job is not sent to Google again. */
export function jobHash(job, settings = DEFAULT_SETTINGS) {
  const s = JSON.stringify([job.title, job.scheduled_date, job.scheduled_time, job.address, job.employee_name,
    job.client_name, job.description, job.instructions, job.status, job.job_category, job.spot_status,
    settings.company_tag, settings.color_id, settings.default_hours])
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** Jobs that must disappear from Google (cancelled / eliminated / declined spot). */
export function jobGoneFromAgenda(job) {
  return job.status === 'cancelled' || job.spot_status === 'declined'
}
