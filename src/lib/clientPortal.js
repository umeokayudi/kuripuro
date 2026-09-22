import { getCleaningType, locationNameFromTitle } from './cleaningType'

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

export function filterClientVisits(jobs, {
  from,
  to,
  type = 'all',
  store = '',
  unratedOnly = false,
  ratedJobIds = new Set(),
} = {}) {
  return (jobs || []).filter(j => {
    if (j.status !== 'completed') return false
    if (from && j.scheduled_date < from) return false
    if (to && j.scheduled_date > to) return false
    if (store && locationFromJob(j) !== store) return false
    if (type === 'deep' && getCleaningType(j) !== 'deep') return false
    if (type === 'basic' && getCleaningType(j) !== 'basic') return false
    if (unratedOnly && ratedJobIds.has(j.id)) return false
    return true
  })
}

export function monthCompletedCount(jobs, yearMonth) {
  const prefix = String(yearMonth || '').slice(0, 7)
  return (jobs || []).filter(j => j.status === 'completed' && String(j.scheduled_date || '').startsWith(prefix)).length
}

export function visibleInvoices(rows) {
  return (rows || []).filter(f => {
    const s = String(f.status || '').toLowerCase()
    return s && s !== 'draft' && s !== 'cancelled'
  })
}

export function isUnpaidInvoiceStatus(status) {
  const s = String(status || '').toLowerCase()
  return s === 'sent' || s === 'pending'
}

export function unpaidInvoices(rows) {
  return visibleInvoices(rows).filter(f => isUnpaidInvoiceStatus(f.status))
}

export function filterInvoices(rows, status = 'all') {
  const vis = visibleInvoices(rows)
  if (status === 'sent' || status === 'unpaid' || status === 'pending') {
    return vis.filter(f => isUnpaidInvoiceStatus(f.status))
  }
  if (status === 'paid') return vis.filter(f => f.status === 'paid')
  return vis
}

export function clientMonthlyCost(client) {
  return Number(client?.monthly_cost || client?.monthly_cost_estimate || 0)
}

export function lastDeepVisit(jobs) {
  return (jobs || [])
    .filter(j => j.status === 'completed' && getCleaningType(j) === 'deep')
    .sort((a, b) => String(b.scheduled_date || '').localeCompare(String(a.scheduled_date || '')))[0] || null
}

export function itemsForInvoice(items, faturaId) {
  return (items || []).filter(it => it.fatura_id === faturaId)
}

export function clientLocations(user, contracts = [], jobs = []) {
  if (user?.location_name) return [user.location_name]
  return [...new Set([
    ...contracts.map(ct => ct.location_name).filter(Boolean),
    ...jobs.map(j => locationFromJob(j)).filter(Boolean),
  ])]
}
