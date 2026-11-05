// v1.0.160 · Accepted quote: "Agendar depois" + a suggested good date (logistics / map area).
//
// Pure rules here (no database). The tracker asks one quote at a time and only FILLS the form:
// nothing is booked or moved until the admin presses "Marcar". Nothing else in the schedule changes.
//
// Suggestion = for the next `days` days × each active employee not off that day, a score:
//   same store already on that day (e.g. the night route at Ibushio) ........ +100
//   another job close on the map (≤1 km +40, ≤3 km +25, ≤6 km +10) .......... by GPS of the jobs
//   same área (jobs.area of the store), only when nothing is close by GPS .... +20
//   same client ............................................................. +15
//   day the client asked for ................................................ +35
//   busy day (more than 3 jobs) ............................................. −10 per extra job
//   each day further ahead .................................................. −1.5
// Best 3, at most one per day. Time = right after the job it rides on (its time + 2 h), else empty.
import { splitName } from './schedulePlan.js'
import { distanceMeters, isPlaceholderCoords } from './geocode.js'

const norm = s => String(s || '').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim()
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const toMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null }
const hm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** Store name of a quote place / job title: "Ibushio - Deep Clean" → "ibushio". */
export const storeKey = text => norm(splitName(String(text || '').replace(/\s+[·|]\s+.*$/, '')).base)

const coordsOf = j => (j && j.gps_lat != null && j.gps_lng != null && !isPlaceholderCoords(j.gps_lat, j.gps_lng) ? { lat: Number(j.gps_lat), lng: Number(j.gps_lng) } : null)

/**
 * target: { place, client_id, client_name, coords? }
 * jobs: jobs of the period (any status but cancelled), with employee_id, scheduled_date/time, title, area, gps_lat/lng.
 * offDays: Set of `${employee_id}|${date}` (day off / can't).
 * Returns [{ date, time, employee_id, employee_name, score, reasons: [{ k, ... }] }].
 */
export function suggestQuoteDates({ target = {}, jobs = [], offDays = new Set(), employees = [], today, preferred = '', days = 14, limit = 3 }) {
  if (!today || !employees.length) return []
  const key = storeKey(target.place || target.client_name)
  const live = jobs.filter(j => j && j.status !== 'cancelled' && j.spot_status !== 'declined' && j.employee_id)
  const sameStore = j => key && storeKey(j.title) === key
  // where the store is: its own jobs (GPS + área) win over a geocoded address
  const storeJobs = live.filter(sameStore)
  const coords = storeJobs.map(coordsOf).find(Boolean) || (target.coords && !isPlaceholderCoords(target.coords.lat, target.coords.lng) ? target.coords : null)
  const area = norm(storeJobs.find(j => j.area)?.area || target.area || '')
  const byDayEmp = new Map()
  for (const j of live) {
    const k = `${j.scheduled_date}|${j.employee_id}`
    if (!byDayEmp.has(k)) byDayEmp.set(k, [])
    byDayEmp.get(k).push(j)
  }
  const out = []
  for (let i = 1; i <= days; i++) {
    const date = addDays(today, i)
    for (const e of employees) {
      if (offDays.has(`${e.id}|${date}`)) continue
      const mine = byDayEmp.get(`${date}|${e.id}`) || []
      const reasons = []
      let score = -1.5 * i
      let anchor = null
      const store = mine.filter(sameStore).sort((a, b) => String(a.scheduled_time || '').localeCompare(String(b.scheduled_time || '')))
      if (store.length) { score += 100; anchor = store[store.length - 1]; reasons.push({ k: 'same_store', store: splitName(anchor.title).base, time: String(anchor.scheduled_time || '').slice(0, 5) }) }
      if (!store.length && coords) {
        let best = null
        for (const j of mine) { const c = coordsOf(j); if (!c) continue; const d = distanceMeters(coords.lat, coords.lng, c.lat, c.lng); if (!best || d < best.d) best = { d, j } }
        if (best && best.d <= 6000) {
          score += best.d <= 1000 ? 40 : best.d <= 3000 ? 25 : 10
          anchor = best.j
          reasons.push({ k: 'near', m: Math.round(best.d), store: splitName(best.j.title).base })
        }
      }
      if (!store.length && !anchor && area) {
        const a = mine.find(j => norm(j.area) === area)
        if (a) { score += 20; anchor = anchor || a; reasons.push({ k: 'same_area', area: a.area }) }
      }
      if (target.client_id && mine.some(j => j.client_id === target.client_id) && !store.length) { score += 15; reasons.push({ k: 'same_client' }) }
      if (preferred && preferred === date) { score += 35; reasons.push({ k: 'preferred' }) }
      if (mine.length > 3) score -= 10 * (mine.length - 3)
      reasons.push(mine.length ? { k: 'load', n: mine.length } : { k: 'free_day' })
      const t = toMin(anchor?.scheduled_time)
      out.push({ date, time: t == null ? '' : hm(Math.ceil((t + 120) / 30) * 30), employee_id: e.id, employee_name: e.full_name || '', score: Math.round(score * 10) / 10, reasons, anchored: !!anchor })
    }
  }
  out.sort((a, b) => b.score - a.score || a.date.localeCompare(b.date) || a.employee_name.localeCompare(b.employee_name))
  const picked = []
  const usedDays = new Set()
  for (const s of out) {
    if (usedDays.has(s.date)) continue
    picked.push(s); usedDays.add(s.date)
    if (picked.length >= limit) break
  }
  return picked
}

/** One reason as text. tr = (en, ja, pt) => string. */
export function reasonText(r, tr) {
  switch (r.k) {
    case 'same_store': return tr(`already at ${r.store}${r.time ? ` (${r.time})` : ''} that day`, `この日すでに${r.store}${r.time ? `（${r.time}）` : ''}に入っています`, `já vai na ${r.store}${r.time ? ` (${r.time})` : ''} nesse dia`)
    case 'near': return tr(`${r.store} is ${r.m < 1000 ? `${r.m} m` : `${(r.m / 1000).toFixed(1)} km`} away`, `${r.store}から${r.m < 1000 ? `${r.m}m` : `${(r.m / 1000).toFixed(1)}km`}`, `${r.store} fica a ${r.m < 1000 ? `${r.m} m` : `${(r.m / 1000).toFixed(1)} km`}`)
    case 'same_area': return tr(`same area (${r.area})`, `同じエリア（${r.area}）`, `mesma área (${r.area})`)
    case 'same_client': return tr('same client that day', '同じお客様の日', 'mesmo cliente no dia')
    case 'preferred': return tr('day the client asked for', 'お客様の希望日', 'dia que o cliente pediu')
    case 'load': return tr(`${r.n} job${r.n > 1 ? 's' : ''} that day`, `この日${r.n}件`, `${r.n} serviço${r.n > 1 ? 's' : ''} no dia`)
    case 'free_day': return tr('free day', '予定なし', 'dia livre')
    default: return ''
  }
}

// ── "Agendar depois" ───────────────────────────────────────────────────────────────────────────
// { until: 'YYYY-MM-DD', note, by, at }. Until that day the quote leaves the counted bell (listed
// apart as "agendar depois") and its toast does not pop; on the day it comes back as a reminder.

/** Reminder choices: tomorrow, in 3 days, next Monday, in 2 weeks. */
export function laterOptions(today) {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay()
  const toMonday = ((8 - dow) % 7) || 7
  return [
    { key: 'tomorrow', date: addDays(today, 1) },
    { key: '3d', date: addDays(today, 3) },
    { key: 'monday', date: addDays(today, toMonday) },
    { key: '2w', date: addDays(today, 14) },
  ]
}

/** Still snoozed today? */
export const isLaterActive = (later, today) => !!(later && later.until && later.until > today)
