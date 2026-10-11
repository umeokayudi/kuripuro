// Google Calendar / iCalendar helpers for jobs. Plain JS with no imports so the
// browser (add-to-calendar buttons) and the API (subscription feed) share it.
// Jobs are stored in Tokyo time (scheduled_date + scheduled_time "HH:MM"); Japan has no DST,
// so converting to UTC is a fixed -9h.

const DEFAULT_HOURS = 2
const pad = n => String(n).padStart(2, '0')

function parseTime(value) {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  if (h > 23 || min > 59) return null
  return { h, min }
}

/** UTC start/end Date for a job, or null when it has no usable time (all-day). */
export function jobTimes(job, hours = DEFAULT_HOURS) {
  if (!job?.scheduled_date) return null
  const t = parseTime(job.scheduled_time)
  if (!t) return null
  const [y, mo, d] = String(job.scheduled_date).split('-').map(Number)
  const start = new Date(Date.UTC(y, mo - 1, d, t.h - 9, t.min))
  const end = new Date(start.getTime() + Number(hours || DEFAULT_HOURS) * 3600000)
  return { start, end }
}

const utcStamp = date => `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}00Z`
const dayStamp = ymd => String(ymd).replaceAll('-', '')
function nextDay(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

export function jobEventTitle(job) {
  const spot = job?.job_category === 'spot' ? '⚡ ' : ''
  return `${spot}${job?.title || 'KuriPuro'}`
}

export function jobEventDetails(job, { appUrl = '' } = {}) {
  return [
    job?.employee_name && `👷 ${job.employee_name}`,
    job?.client_name && `🏢 ${job.client_name}`,
    job?.description,
    job?.instructions,
    appUrl && `KuriPuro: ${appUrl}`,
  ].filter(Boolean).join('\n')
}

/** "Add to Google Calendar" link for one job (opens Google Calendar prefilled). */
export function googleCalendarUrl(job, opts = {}) {
  if (!job?.scheduled_date) return ''
  const times = jobTimes(job, opts.hours)
  const dates = times
    ? `${utcStamp(times.start)}/${utcStamp(times.end)}`
    : `${dayStamp(job.scheduled_date)}/${dayStamp(nextDay(job.scheduled_date))}`
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: jobEventTitle(job),
    dates,
    details: jobEventDetails(job, opts),
    location: job.address || '',
    ctz: 'Asia/Tokyo',
  })
  if (opts.guestEmail) params.set('add', opts.guestEmail)
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

function icsText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/([,;])/g, '\\$1')
}

/** RFC 5545 lines are at most 75 octets; continuation lines start with a space. */
function fold(line) {
  const out = []
  let current = ''
  let bytes = 0
  for (const ch of line) {
    const size = new TextEncoder().encode(ch).length
    if (bytes + size > 73) { out.push(current); current = ' '; bytes = 1 }
    current += ch
    bytes += size
  }
  out.push(current)
  return out.join('\r\n')
}

function eventLines(job, opts) {
  const times = jobTimes(job, opts.hours)
  const status = job.status === 'cancelled' || job.spot_status === 'declined' ? 'CANCELLED' : 'CONFIRMED'
  return [
    'BEGIN:VEVENT',
    `UID:job-${job.id}@kuripuro`,
    `DTSTAMP:${utcStamp(opts.now || new Date())}`,
    ...(times
      ? [`DTSTART:${utcStamp(times.start)}`, `DTEND:${utcStamp(times.end)}`]
      : [`DTSTART;VALUE=DATE:${dayStamp(job.scheduled_date)}`, `DTEND;VALUE=DATE:${dayStamp(nextDay(job.scheduled_date))}`]),
    `SUMMARY:${icsText(jobEventTitle(job))}`,
    job.address && `LOCATION:${icsText(job.address)}`,
    `DESCRIPTION:${icsText(jobEventDetails(job, opts))}`,
    `STATUS:${status}`,
    'END:VEVENT',
  ].filter(Boolean)
}

/** Full .ics calendar for a list of jobs. */
export function buildIcs(jobs, { name = 'KuriPuro', ...opts } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//KuriPuro//Jobs//PT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(name)}`,
    'X-WR-TIMEZONE:Asia/Tokyo',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...(jobs || []).filter(j => j?.id && j.scheduled_date).flatMap(j => eventLines(j, opts)),
    'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}

/** Triggers a download of a one-job .ics file (Apple/Outlook/Google import). */
export function downloadJobIcs(job, opts = {}) {
  const blob = new Blob([buildIcs([job], { name: job.title, ...opts })], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `kuripuro-${job.scheduled_date || 'job'}.ics`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Asks the server for this user's private subscription URL (Google Calendar → "From URL"). */
export async function fetchCalendarFeedUrl(employeeId) {
  const qs = employeeId ? `&employee=${encodeURIComponent(employeeId)}` : ''
  const res = await fetch(`/api/sales?action=calendar-link${qs}`, { credentials: 'same-origin' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'Calendar link unavailable')
  return body.url
}
