// v1.0.206 · "Visita agendada" do vendedor + "jogar tudo na IA" para preencher o lead.
// Plain JS, no imports from React, shared by the browser and the API (feed .ics, save).
// Visits live in private Storage (sales-private/visits/<sellerId>.json), so no SQL is needed.
// Times are Tokyo wall-clock ("YYYY-MM-DD" + "HH:MM"); Japan has no DST.

const DAY = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const VISIT_STATUSES = ['scheduled', 'done', 'cancelled']
export const DEFAULT_VISIT_MINUTES = 60

const str = (v, max) => String(v ?? '').trim().slice(0, max)
const validDay = v => {
  if (!DAY.test(String(v || ''))) return false
  const [y, m, d] = String(v).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}
export const isVisitDay = validDay

/** "9:5" / "9時半" / "14h30" → "HH:MM", or "" when unreadable. */
export function cleanTime(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  if (TIME.test(raw)) return raw
  let m = raw.match(/^(\d{1,2})\s*[:：hH時]\s*(\d{1,2})?\s*(半)?/)
  if (!m) m = raw.match(/^(\d{1,2})$/)
  if (!m) return ''
  const h = Number(m[1])
  const min = m[3] ? 30 : Number(m[2] || 0)
  if (h > 23 || min > 59) return ''
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/** Validates what the seller (or the AI) typed. Returns { visit } or { error }. */
export function normalizeVisit(input = {}, { today = '', allowPast = false } = {}) {
  const date = str(input.date, 10)
  if (!validDay(date)) return { error: 'Escolha a data da visita.' }
  if (!allowPast && today && date < today) return { error: 'A visita precisa ser hoje ou depois.' }
  const time = cleanTime(input.time)
  const minutes = Math.round(Number(input.duration_min ?? input.duration ?? DEFAULT_VISIT_MINUTES))
  const duration = Number.isFinite(minutes) ? Math.min(480, Math.max(15, minutes)) : DEFAULT_VISIT_MINUTES
  const status = VISIT_STATUSES.includes(input.status) ? input.status : 'scheduled'
  const id = UUID.test(String(input.id || '')) ? String(input.id) : ''
  const leadId = UUID.test(String(input.lead_id || '')) ? String(input.lead_id) : ''
  return {
    visit: {
      id, lead_id: leadId, date, time, duration_min: duration, status,
      place: str(input.place, 200), address: str(input.address, 300), contact_name: str(input.contact_name, 120),
      note: str(input.note, 1000),
    },
  }
}

const sortKey = v => `${v.date || ''} ${v.time || '99:99'}`

/** Scheduled visits from today on, soonest first. */
export function upcomingVisits(visits, today, leadId = '') {
  return (visits || [])
    .filter(v => v && v.status === 'scheduled' && v.date >= today && (!leadId || v.lead_id === leadId))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
}

/** Scheduled visits whose day already passed (seller should mark done or reschedule). */
export function missedVisits(visits, today) {
  return (visits || []).filter(v => v && v.status === 'scheduled' && v.date < today).sort((a, b) => sortKey(b).localeCompare(sortKey(a)))
}

/** Insert or replace by id, keeping the file small (newest 400 visits). */
export function upsertVisit(list, visit) {
  const rows = (list || []).filter(v => v && v.id !== visit.id)
  rows.push(visit)
  return rows.sort((a, b) => sortKey(b).localeCompare(sortKey(a))).slice(0, 400)
}

/** Should the lead's "next follow-up" move to the visit day? Only when it is empty or later. */
export function followupForVisit(currentFollowup, visitDate, today) {
  const cur = String(currentFollowup || '').slice(0, 10)
  if (!cur) return visitDate
  if (cur < today) return null // overdue follow-up still needs its own action
  return cur > visitDate ? visitDate : null
}

export function visitTitle(visit, lead) {
  const name = (lead && (lead.site_name || lead.company_name)) || visit.place || 'Cliente'
  return `🤝 Visita · ${name}`
}

/** Same shape as a job, so src/lib/calendar.js builds the Google link and the .ics feed. */
export function visitAsCalendarJob(visit, lead, { sellerName = '' } = {}) {
  const contact = visit.contact_name || lead?.contact_name || ''
  const phone = lead?.contact_phone || ''
  return {
    id: visit.id,
    uid: `visit-${visit.id}@kuripuro`,
    title: visitTitle(visit, lead),
    scheduled_date: visit.date,
    scheduled_time: visit.time || '',
    duration_hours: (visit.duration_min || DEFAULT_VISIT_MINUTES) / 60,
    address: visit.address || lead?.address || visit.place || '',
    status: visit.status === 'cancelled' ? 'cancelled' : 'scheduled',
    description: [
      sellerName && `🧑‍💼 ${sellerName}`,
      lead?.company_name && `🏢 ${lead.company_name}${lead.site_name && lead.site_name !== lead.company_name ? ` · ${lead.site_name}` : ''}`,
      contact && `👤 ${contact}${phone ? ` · ${phone}` : ''}`,
      lead?.maps_url && `📍 ${lead.maps_url}`,
      visit.note,
    ].filter(Boolean).join('\n'),
  }
}

// ── "Jogar tudo na IA" ─────────────────────────────────────────────────────────────────────
// AI answer key → lead field. Only these keys are ever copied into the lead.
const DUMP_TO_LEAD = {
  company_name: 'company_name', site_name: 'site_name', contact_name: 'contact_name', contact_title: 'contact_title',
  phone: 'contact_phone', contact_phone: 'contact_phone', email: 'contact_email', contact_email: 'contact_email',
  address: 'address', website: 'website', line_id: 'contact_line_id', maps_url: 'maps_url', needs: 'needs',
  interest: 'interest', competitor: 'competitor', decision_maker: 'decision_maker', industry: 'industry',
  next_followup_date: 'next_followup_date', expected_start: 'expected_start', expected_monthly: 'expected_monthly',
  locations_count: 'locations_count', company_kana: 'company_kana',
}
const DATE_FIELDS = new Set(['next_followup_date', 'expected_start'])
const NUM_FIELDS = new Set(['expected_monthly', 'locations_count'])
const MAPS = /^https:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)/i

function cleanValue(field, value, today) {
  if (value == null) return ''
  if (DATE_FIELDS.has(field)) {
    const d = String(value).slice(0, 10)
    return validDay(d) && (!today || d >= today) ? d : ''
  }
  if (NUM_FIELDS.has(field)) {
    const n = Number(String(value).replace(/[^\d.]/g, ''))
    return Number.isFinite(n) && n > 0 ? n : ''
  }
  const text = String(value).trim()
  if (field === 'maps_url') return MAPS.test(text) ? text.slice(0, 600) : ''
  if (field === 'contact_email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text.slice(0, 200) : ''
  return text.slice(0, field === 'needs' ? 2000 : 300)
}

/**
 * Puts what the AI read into the lead form.
 * New lead: every field the AI found is written. Existing lead (onlyEmpty): only empty fields.
 * The AI "notes" are always added below the seller's own notes, never replacing them.
 * Returns { lead, filled: [field names], visit: normalized visit or null }.
 */
export function applyLeadDump(lead, answer, { today = '', onlyEmpty = false } = {}) {
  const next = { ...(lead || {}) }
  const filled = []
  if (!answer || typeof answer !== 'object') return { lead: next, filled, visit: null }
  for (const [key, field] of Object.entries(DUMP_TO_LEAD)) {
    if (!(key in answer)) continue
    const value = cleanValue(field, answer[key], today)
    if (value === '' || filled.includes(field)) continue
    if (onlyEmpty && String(next[field] ?? '').trim() !== '') continue
    if (String(next[field] ?? '') === String(value)) continue
    next[field] = value
    filled.push(field)
  }
  const note = String(answer.notes || answer.summary || '').trim()
  if (note && !String(next.notes || '').includes(note)) {
    next.notes = [String(next.notes || '').trim(), note].filter(Boolean).join('\n').slice(0, 3000)
    filled.push('notes')
  }
  let visit = null
  if (answer.visit && typeof answer.visit === 'object' && answer.visit.date) {
    const res = normalizeVisit({ ...answer.visit, place: answer.visit.place || next.site_name || next.company_name || '', address: answer.visit.address || next.address || '' }, { today })
    if (res.visit) visit = res.visit
  }
  return { lead: next, filled, visit }
}

const digits = v => String(v || '').replace(/\D/g, '')
const plain = v => String(v || '').normalize('NFKC').toLowerCase().replace(/株式会社|有限会社|合同会社|\(株\)|㈱/g, '').replace(/[\s・·,.\-–—()（）]/g, '')

/** A lead that is probably the same client (same phone, e-mail, or same name + place). */
export function findDuplicateLead(leads, lead, ignoreId = '') {
  const phone = digits(lead?.contact_phone || lead?.phone)
  const email = String(lead?.contact_email || '').trim().toLowerCase()
  const company = plain(lead?.company_name)
  const site = plain(lead?.site_name)
  return (leads || []).find(row => {
    if (!row || row.id === ignoreId) return false
    if (phone.length >= 8 && [row.contact_phone, row.phone].some(p => digits(p).length >= 8 && digits(p).slice(-8) === phone.slice(-8))) return true
    if (email && [row.contact_email, row.email].some(e => String(e || '').trim().toLowerCase() === email)) return true
    if (company && plain(row.company_name) === company && (!site || !plain(row.site_name) || plain(row.site_name) === site)) return true
    return false
  }) || null
}

/** Path of what proves where the lead came from: a card photo or the pasted text saved as JSON. */
export const isImagePath = path => /\.(jpe?g|png|webp)$/i.test(String(path || ''))
