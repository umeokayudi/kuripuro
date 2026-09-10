/** Tokyo (Asia/Tokyo) date helpers — single source of truth */

export function tokyoToday() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).split(' ')[0]
}

export function tokyoNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
}

export function tokyoYearMonth(date = new Date()) {
  return date.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 7)
}

/** Last N calendar days in Tokyo, including today (newest first). */
export function recentTokyoDates(count = 7) {
  const dates = []
  let cursor = tokyoToday()
  for (let i = 0; i < count; i++) {
    dates.push(cursor)
    const [y, m, d] = cursor.split('-').map(Number)
    const prev = new Date(Date.UTC(y, m - 1, d - 1))
    cursor = prev.toISOString().slice(0, 10)
  }
  return dates
}

export function workedDayKey(job) {
  if (!job?.scheduled_date || job.counts_as_work_day === false) return null
  const hour = parseInt((job.scheduled_time || '12:00').split(':')[0], 10)
  if (hour < 6) {
    const d = new Date(`${job.scheduled_date}T12:00:00`)
    d.setDate(d.getDate() - 1)
    return d.toISOString().split('T')[0]
  }
  return job.scheduled_date
}
