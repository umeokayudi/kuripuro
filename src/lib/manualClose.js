// v1.0.98 · "Fechar manualmente": the admin closes a job the employee forgot to finish.
// Pure helpers (no database) shared by the modal, jobAdminOps, Reports and the employee message.
import { locationNameFromTitle } from './cleaningType'

const TZ = 'Asia/Tokyo'
export const DEFAULT_CLOSE_REASON = {
  en: 'forgot to finish',
  ja: '終了操作の忘れ',
  pt: 'esquecimento de finalizar',
}
// v1.0.144 · reason used when the office finishes a job the employee never started (Live Track).
export const OFFICE_FINISH_REASON = {
  en: 'finished by the office',
  ja: '事務所で完了処理',
  pt: 'finalizado pelo escritório',
}
// Columns added by sql/2026-10-29_fechamento_manual.sql (the close still works without them).
export const MANUAL_CLOSE_COLUMNS = ['closed_manually_by', 'closed_manually_at', 'closed_manually_note']

const pick = (lang, en, ja, pt) => (lang === 'ja' ? ja : lang === 'pt' ? pt : en)

/** Planned finish: start + planned minutes (null without a start). */
export function plannedEnd(job, expectedMin) {
  if (!job?.started_at || !(expectedMin > 0)) return null
  return new Date(new Date(job.started_at).getTime() + expectedMin * 60000).toISOString()
}

/** Suggested finish for the modal: the planned finish, never later than now. */
export function suggestedEnd(job, expectedMin, now = new Date()) {
  const end = plannedEnd(job, expectedMin)
  if (!end) return now.toISOString()
  return new Date(Math.min(new Date(end).getTime(), now.getTime())).toISOString()
}

/**
 * v1.0.144 · Suggested start/finish for a job the employee never started (admin finishes it from Live Track).
 * Start = the later of the scheduled time and the end of this person's last finished job that day
 * (so finishing a route one by one chains the times); finish = start + planned minutes.
 * Nothing in the future: when the window would end after now, it is moved back to end now.
 */
export function suggestedWindow(job, expectedMin, prevEnd = null, now = new Date()) {
  const plan = expectedMin > 0 ? expectedMin : 60
  const sched = job?.scheduled_date
    ? new Date(`${job.scheduled_date}T${(job.scheduled_time || '09:00').slice(0, 5)}:00+09:00`).getTime()
    : now.getTime()
  let start = Math.max(sched, prevEnd ? new Date(prevEnd).getTime() : 0)
  let end = start + plan * 60000
  if (end > now.getTime()) { end = now.getTime(); start = Math.min(start, end - plan * 60000) }
  return { startedAt: new Date(start).toISOString(), completedAt: new Date(end).toISOString() }
}

const placeKey = j => locationNameFromTitle(j?.title || '').toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * v1.0.144 · Same place, same day, done (or being done) by someone else: the job is probably a
 * duplicate and should be marked "not done" instead of finished.
 */
export function likelyDuplicates(job, sameDayJobs = []) {
  const key = placeKey(job)
  if (!key) return []
  return sameDayJobs.filter(o => o.id !== job.id && o.employee_id !== job.employee_id
    && ['completed', 'in_progress'].includes(o.status) && placeKey(o) === key)
}

/** v1.0.144 · End of this person's last finished job that day (null when none). */
export function lastFinishOf(job, sameDayJobs = []) {
  const ends = sameDayJobs.filter(o => o.id !== job.id && o.employee_id === job.employee_id && o.status === 'completed' && o.completed_at)
    .map(o => o.completed_at).sort()
  return ends.length ? ends[ends.length - 1] : null
}

/** Problems with the chosen times: 'start' (missing), 'order' (finish not after start), 'future'. */
export function manualCloseError({ startedAt, completedAt }, now = new Date()) {
  if (!startedAt) return 'start'
  if (!completedAt || new Date(completedAt) <= new Date(startedAt)) return 'order'
  if (new Date(completedAt).getTime() > now.getTime() + 60000) return 'future'
  return null
}

/** Fields written on the job. `audit` false = the SQL columns are not there yet. */
export function manualClosePatch({ startedAt, completedAt, adminName, note, now = new Date(), audit = true }) {
  const patch = { status: 'completed', started_at: startedAt, completed_at: completedAt }
  if (audit) Object.assign(patch, {
    closed_manually_by: adminName || 'admin',
    closed_manually_at: now.toISOString(),
    closed_manually_note: note?.trim() || null,
  })
  return patch
}

/** True when a PostgREST error says one of the new columns does not exist yet. */
export function isMissingColumnError(err) {
  const msg = `${err?.code || ''} ${err?.message || ''}`
  return /PGRST204|42703/.test(msg) || /closed_manually_\w+/.test(msg)
}

const stamp = (iso, lang) => iso
  ? new Date(iso).toLocaleString(pick(lang, 'en-GB', 'ja-JP', 'pt-BR'), { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  : ''
const hm = iso => iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '—'

export const isClosedManually = job => !!job?.closed_manually_at

/** "Closed manually by Yudi on 29/10 18:40 · reason: forgot to finish" (null when not closed by hand). */
export function manualCloseStamp(job, lang = 'en') {
  if (!isClosedManually(job)) return null
  const reason = job.closed_manually_note || DEFAULT_CLOSE_REASON[lang] || DEFAULT_CLOSE_REASON.en
  const who = job.closed_manually_by || 'admin'
  const when = stamp(job.closed_manually_at, lang)
  return pick(lang,
    `Closed manually by ${who} on ${when} · reason: ${reason}`,
    `${who}が${when}に手動で終了 · 理由：${reason}`,
    `Fechado manualmente por ${who} em ${when} · motivo: ${reason}`)
}

/**
 * Chat message to the employee (lands in their bell as a new message; they reply there to contest).
 * One language per message: PT for the Brazilian team, else JA then EN like the other office notices.
 */
export function manualCloseMessage(job, { startedAt, completedAt, note, adminName }, lang = 'en') {
  const place = locationNameFromTitle(job?.title || '')
  const [, mo, d] = (job?.scheduled_date || '').split('-')
  const dayOf = l => (mo ? (l === 'ja' ? `${+mo}/${+d}` : `${d}/${mo}`) : '')
  // Finish on another day (the usual forgotten job): show its date too.
  const tokyoDay = iso => iso ? new Date(iso).toLocaleDateString('sv-SE', { timeZone: TZ }) : ''
  const endDay = tokyoDay(completedAt) !== tokyoDay(startedAt) ? tokyoDay(completedAt).split('-') : null
  const start = hm(startedAt)
  const endOf = l => `${endDay ? (l === 'ja' ? `${+endDay[1]}/${+endDay[2]} ` : `${endDay[2]}/${endDay[1]} `) : ''}${hm(completedAt)}`
  const min = Math.max(0, Math.round((new Date(completedAt) - new Date(startedAt)) / 60000))
  const dur = min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : `${min} min`
  const who = adminName || 'admin'
  const after = !job?.photo_end_url
  const msg = l => {
    const day = dayOf(l), end = endOf(l)
    const reason = note?.trim() || (job?.started_at ? DEFAULT_CLOSE_REASON : OFFICE_FINISH_REASON)[l]
    return pick(l,
      `🔒 ${who} closed your job ${place} (${day}) for you: ${start} → ${end} (${dur}). Reason: ${reason}.${after ? ' Please still send the After photo on the home screen.' : ''} If the time is wrong, reply here.`,
      `🔒 ${who}があなたの作業「${place}」（${day}）を終了しました：${start} → ${end}（${dur}）。理由：${reason}。${after ? 'After写真はホーム画面から送ってください。' : ''}時間が違う場合はここに返信してください。`,
      `🔒 ${who} fechou o seu job ${place} (${day}): ${start} → ${end} (${dur}). Motivo: ${reason}.${after ? ' Ainda envie a foto Depois pela tela inicial.' : ''} Se o horário estiver errado, responda aqui.`)
  }
  return lang === 'pt' ? msg('pt') : `${msg('ja')}\n\n${msg('en')}`
}
