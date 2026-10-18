import { locationNameFromTitle } from './cleaningType'

export function locationFromJob(job) {
  return locationNameFromTitle(job?.title || job?.job_title || '')
}

/** Job belongs to this client portal user */
export function jobMatchesClientUser(job, user) {
  if (!job || !user?.client_id) return false
  if (job.client_id && job.client_id !== user.client_id) return false
  if (user.location_name) {
    const loc = locationFromJob(job)
    if (loc !== user.location_name) return false
  }
  return true
}

export function reportMatchesClientUser(report, user) {
  if (!report || !user?.client_id) return false
  if (report.client_id && report.client_id !== user.client_id) return false
  if (user.location_name) {
    const loc = report.location_name || report.client_name || locationFromJob(report)
    if (loc !== user.location_name) return false
  }
  return true
}

export function ratingMatchesClientUser(rating, user) {
  if (!rating || !user?.client_id) return false
  if (rating.client_id && rating.client_id !== user.client_id) return false
  if (user.location_name && rating.location_name && rating.location_name !== user.location_name) return false
  return true
}

export function fmtVisitTime(job, lang = 'ja') {
  const locale = lang === 'ja' ? 'ja-JP' : 'en-GB'
  if (job.started_at) {
    return new Date(job.started_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })
  }
  return job.scheduled_time || '—'
}

export function fmtVisitEnd(job, lang = 'ja') {
  const locale = lang === 'ja' ? 'ja-JP' : 'en-GB'
  if (job.completed_at) {
    return new Date(job.completed_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })
  }
  return '—'
}

// Contracts are named per service ("Ibushio — Grease Trap", "Tooda - Deep Clean");
// the client thinks in stores, so everything after the dash is dropped.
export function storeBaseName(name) {
  return String(name || '').split(/\s+[-—–]\s+/)[0].trim()
}

/** Unique store names for this portal user; a store login only ever sees its own store. */
export function clientStoreNames(names, user) {
  if (user?.location_name) return [user.location_name]
  return [...new Set((names || []).map(storeBaseName).filter(Boolean))]
}

/**
 * Who looks after a store, for the client to talk to: the account manager the
 * admin set on the client wins, then the seller on that store's contract, then
 * any seller on the client's contracts. null = no named person yet.
 */
export function storeContact({ client, contracts, salespeople, location }) {
  if (client?.manager_name) {
    return {
      name: client.manager_name, phone: client.manager_phone, email: client.manager_email,
      line: client.manager_line_url, photo: client.manager_photo_url,
    }
  }
  const byId = new Map((salespeople || []).map(s => [s.id, s]))
  const withSeller = (contracts || []).filter(ct => ct.salesperson_id && byId.has(ct.salesperson_id))
  const own = withSeller.find(ct => storeBaseName(ct.location_name) === location) || withSeller[0]
  const sp = own && byId.get(own.salesperson_id)
  return sp ? { name: sp.full_name, phone: sp.phone, email: sp.email } : null
}

/** Cleaners who did most of the recent visits at this store (first names, most visits first). */
export function storeCrew(jobs, location, { limit = 2, since } = {}) {
  const count = new Map()
  for (const j of jobs || []) {
    if (j.status !== 'completed' || !j.employee_name) continue
    if (since && j.scheduled_date < since) continue
    if (location && storeBaseName(locationFromJob(j)) !== location) continue
    const first = j.employee_name.trim().split(/\s+/)[0]
    count.set(first, (count.get(first) || 0) + 1)
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([n]) => n)
}
