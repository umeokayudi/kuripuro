// v1.0.147 · On The Planet night route: no planned start, a DEADLINE.
// Every On The Planet job planned at 00:30 (basic, maintenance, special) no longer has a start
// time: it must be FINISHED by 10:00 of the same day. Starting "late" is not late any more;
// late = not completed at 10:00. Atomic Bar and the 20:00 garbage pick-ups do not change.
//
// The rule is read from the job itself (client On The Planet + planned 00:30), so it covers the
// jobs already created and every new one, with no change in the database. scheduled_time stays
// '00:30' in the row only as the "route opens" marker (keeps the Schedule Generator's
// no-duplicates check working); no screen shows it as a start time.

export const OTP_CLIENT_ID = '7138f082-0d38-43e4-bd77-00c4598690b3'
export const OTP_ROUTE_TIME = '00:30'
export const OTP_DEADLINE = '10:00'
export const OTP_ALERT_AT = '05:00'

const toMin = t => {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
const hhmm = t => {
  const m = toMin(t)
  return m == null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
export const DEADLINE_MIN = toMin(OTP_DEADLINE)
export const ALERT_MIN = toMin(OTP_ALERT_AT)

/** On The Planet job (by client id, or by name when the id is missing). */
export function isOtpJob(job) {
  if (!job) return false
  if (job.client_id) return job.client_id === OTP_CLIENT_ID
  return /on\s*the\s*planet/i.test(`${job.client_name || ''} ${job.title || ''}`)
}

/** Deadline job: On The Planet planned at 00:30. */
export function isDeadlineJob(job) {
  return isOtpJob(job) && hhmm(job.scheduled_time) === OTP_ROUTE_TIME
}

/** 'HH:MM' the job must be finished by, or null for a normal (start-time) job. */
export const deadlineOf = job => (isDeadlineJob(job) ? OTP_DEADLINE : null)

/** Timestamp (ms) of the deadline in Tokyo time. */
export function deadlineMs(job) {
  if (!isDeadlineJob(job) || !job.scheduled_date) return null
  return new Date(`${job.scheduled_date}T${OTP_DEADLINE}:00+09:00`).getTime()
}

/** Minutes past the deadline (negative = still ahead). null for normal jobs. */
export function minutesPastDeadline(job, now = new Date()) {
  const d = deadlineMs(job)
  return d == null ? null : Math.round((now.getTime() - d) / 60000)
}

/**
 * Late for a deadline job = not completed when the deadline passes (running ones too).
 * `today`/`nowMin` (Tokyo) can be given instead of `now` by the screens that already have them.
 */
export function isDeadlineLate(job, { now = new Date(), today = null, nowMin = null } = {}) {
  if (!isDeadlineJob(job) || !job.scheduled_date) return false
  if (job.status === 'completed' || job.status === 'cancelled') return false
  if (today != null && nowMin != null) {
    if (job.scheduled_date < today) return true
    if (job.scheduled_date > today) return false
    return nowMin >= DEADLINE_MIN
  }
  return minutesPastDeadline(job, now) >= 0
}

/** Reference time for "how late": the deadline for deadline jobs, the start time for the others. */
export const referenceTime = job => deadlineOf(job) || job?.scheduled_time || null

/** Text for the time slot: "Concluir até 10:00" for deadline jobs, else the start time. */
export function jobTimeLabel(job, tr = (en, ja, pt) => pt) {
  const d = deadlineOf(job)
  if (d) return tr(`Finish by ${d}`, `${d}までに完了`, `Concluir até ${d}`)
  return job?.scheduled_time ? hhmm(job.scheduled_time) : ''
}

/**
 * Minutes the job finished after its deadline (negative = before). For reports/punctuality:
 * a deadline job is measured by its finish, never by its start.
 */
export function finishDelayMin(job) {
  const d = deadlineMs(job)
  if (d == null || !job.completed_at) return null
  const delay = (new Date(job.completed_at).getTime() - d) / 60000
  return Math.abs(delay) > 24 * 60 ? null : Math.round(delay)
}

const tokyoHHMM = iso => new Date(iso).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false })

/**
 * 05:00 alert: one per day per employee (route) with On The Planet deadline jobs on `today`.
 * From 05:00, if none of that person's OTP jobs of the day was started before 05:00 →
 *   { employeeId, employeeName, date, startedAt: null }            still not started
 *   { ..., startedAt: '06:48' }                                     started after 05:00 (kept, with the real time)
 * Days with no deadline jobs, routes started before 05:00, or before 05:00 → nothing.
 */
export function otpRouteAlerts(jobs, { today, nowMin }) {
  if (nowMin == null || nowMin < ALERT_MIN) return []
  const byEmp = new Map()
  for (const j of jobs || []) {
    if (j.scheduled_date !== today || j.status === 'cancelled' || !isDeadlineJob(j)) continue
    const key = j.employee_id || `name:${j.employee_name || '—'}`
    if (!byEmp.has(key)) byEmp.set(key, { employeeId: j.employee_id || null, employeeName: j.employee_name || '—', jobs: [] })
    byEmp.get(key).jobs.push(j)
  }
  const alertMs = new Date(`${today}T${OTP_ALERT_AT}:00+09:00`).getTime()
  const out = []
  for (const g of byEmp.values()) {
    const starts = g.jobs.map(j => j.started_at || (j.status === 'completed' ? j.completed_at : null)).filter(Boolean)
      .map(s => new Date(s).getTime()).sort((a, b) => a - b)
    const first = starts[0] ?? null
    if (first != null && first < alertMs) continue
    out.push({
      id: `otp-route:${today}:${g.employeeId || g.employeeName}`,
      employeeId: g.employeeId, employeeName: g.employeeName, date: today,
      startedAt: first != null ? tokyoHHMM(new Date(first).toISOString()) : null,
      jobs: g.jobs.length,
    })
  }
  return out.sort((a, b) => (a.startedAt ? 1 : 0) - (b.startedAt ? 1 : 0) || a.employeeName.localeCompare(b.employeeName))
}

/** Alert text in the owner's language. */
export function otpRouteAlertText(a, tr = (en, ja, pt) => pt) {
  const base = tr(`Today's OTP route has not started yet — ${a.employeeName}`, `本日のOTPルートがまだ開始されていません — ${a.employeeName}`, `Rota OTP de hoje ainda não começou — ${a.employeeName}`)
  if (!a.startedAt) return base
  return tr(`Today's OTP route did not start by 05:00 — ${a.employeeName} · started at ${a.startedAt}`,
    `本日のOTPルートは05:00までに開始されませんでした — ${a.employeeName}・${a.startedAt}に開始`,
    `Rota OTP de hoje não começou até 05:00 — ${a.employeeName} · começou às ${a.startedAt}`)
}

/** Short form for narrow time columns: "até 10:00". */
export function jobTimeShort(job, tr = (en, ja, pt) => pt) {
  const d = deadlineOf(job)
  if (d) return tr(`by ${d}`, `${d}まで`, `até ${d}`)
  return job?.scheduled_time ? hhmm(job.scheduled_time) : ''
}

const trFor = lang => (en, ja, pt) => (lang === 'ja' ? ja : lang === 'pt' ? pt : en)

/** Time text for a card by language code: "Concluir até 10:00" or the start time (fallback when none). */
export function jobTimeText(job, lang = 'pt', fallback = '—') {
  if (isDeadlineJob(job)) return jobTimeLabel(job, trFor(lang))
  return job?.scheduled_time ? String(job.scheduled_time).slice(0, 5) : fallback
}

/** "Atrasado" chip text for a deadline job not finished at 10:00, else ''. */
export function deadlineLateText(job, lang = 'pt', now = new Date()) {
  return isDeadlineLate(job, { now }) ? trFor(lang)('Late', '遅れ', 'Atrasado') : ''
}

/** Load today's On The Planet jobs and return the 05:00 route alerts (bell + Live Track). */
export async function fetchOtpRouteAlerts(today, nowMin) {
  if (nowMin == null || nowMin < ALERT_MIN) return []
  const { supabase } = await import('./supabase')
  const { data, error } = await supabase.from('jobs')
    .select('id,client_id,client_name,title,scheduled_date,scheduled_time,status,started_at,completed_at,employee_id,employee_name')
    .eq('scheduled_date', today).eq('client_id', OTP_CLIENT_ID).neq('status', 'cancelled')
  if (error) throw error
  return otpRouteAlerts(data || [], { today, nowMin })
}
