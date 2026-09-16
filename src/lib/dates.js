/** Tokyo (Asia/Tokyo) date helpers — single source of truth */

export function tokyoToday() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).split(' ')[0]
}

/** Calendar YMD from a Date using its local components (for T12:00 constructed dates). */
export function formatLocalYmd(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Add whole calendar days to a YYYY-MM-DD string (timezone-safe). */
export function addCalendarDays(ymd, delta) {
  const [y, m, d] = String(ymd || '').split('-').map(Number)
  if (!y || !m || !d) return ymd
  const dt = new Date(Date.UTC(y, m - 1, d + Number(delta || 0)))
  return dt.toISOString().slice(0, 10)
}

export function tokyoNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
}

export function tokyoYearMonth(date = new Date()) {
  return date.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 7)
}

/** First and last calendar days of `YYYY-MM` (Tokyo-naive, local date strings). */
export function monthBounds(ym) {
  const [y, m] = String(ym || '').split('-').map(Number)
  if (!y || !m) return { from: '', to: '' }
  const from = `${y}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { from, to }
}

/** Last N calendar days in Tokyo, including today (newest first). */
export function recentTokyoDates(count = 7) {
  const dates = []
  let cursor = tokyoToday()
  for (let i = 0; i < count; i++) {
    dates.push(cursor)
    cursor = addCalendarDays(cursor, -1)
  }
  return dates
}

export function workedDayKey(job) {
  if (!job?.scheduled_date || job.counts_as_work_day === false) return null
  const hour = parseInt((job.scheduled_time || '12:00').split(':')[0], 10)
  if (hour < 6) {
    const d = new Date(`${job.scheduled_date}T12:00:00`)
    d.setDate(d.getDate() - 1)
    return formatLocalYmd(d)
  }
  return job.scheduled_date
}
