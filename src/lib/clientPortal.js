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
