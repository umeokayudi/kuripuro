// v1.0.146 · The three dates printed on the 請求書 — 発行日 (issue), 対象期間 (billing period) and
// 支払期限 (payment due) — are chosen by the admin before the invoice goes out. These helpers give the
// suggested values and say what looks wrong (a year typed by mistake, due before the issue date…).
import { tokyoToday } from './dates.js'

const ymd = v => (v ? String(v).slice(0, 10) : '')
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))

function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** `day` of the month after `base` (clamped to the month's last day); day 31 = end of that month. */
export function dayOfNextMonth(base, day = 10) {
  const [y, m] = (ymd(base) || tokyoToday()).split('-').map(Number)
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m, Math.min(Math.max(1, Number(day) || 10), last))).toISOString().slice(0, 10)
}

/** Quick choices for 支払期限, counted from the issue date. */
export function dueChoices(issue, paymentDay = 10) {
  const base = ymd(issue) || tokyoToday()
  const pd = Number(paymentDay) || 10
  const list = [
    { key: 'pday', label: { en: `${pd}th next month`, ja: `翌月${pd}日`, pt: `Dia ${pd} do mês seguinte` }, value: dayOfNextMonth(base, pd) },
    { key: 'eom', label: { en: 'End of next month', ja: '翌月末', pt: 'Fim do mês seguinte' }, value: dayOfNextMonth(base, 31) },
    { key: 'd14', label: { en: '+14 days', ja: '14日後', pt: '+14 dias' }, value: addDays(base, 14) },
    { key: 'd30', label: { en: '+30 days', ja: '30日後', pt: '+30 dias' }, value: addDays(base, 30) },
  ]
  const seen = new Set()
  return list.filter(c => (seen.has(c.value) ? false : seen.add(c.value)))
}

/**
 * Suggested dates for an invoice about to be issued: issue = today, period = what the invoice already
 * has (else the service day), due = payment day of the month after the issue date.
 */
export function suggestedInvoiceDates(f = {}, { today = tokyoToday(), paymentDay = 10, serviceDate = '' } = {}) {
  const start = ymd(f.period_start) || ymd(serviceDate) || today
  const end = ymd(f.period_end) || start
  const issue = ymd(f.issue_date) || today
  return {
    issue_date: issue,
    period_start: start,
    period_end: end < start ? start : end,
    due_date: ymd(f.due_date) || dayOfNextMonth(issue, paymentDay),
  }
}

/** What to fix (errors block saving) and what to double-check (warnings, saving still allowed). */
export function checkInvoiceDates(d = {}, today = tokyoToday()) {
  const errors = []
  const warnings = []
  for (const k of ['issue_date', 'period_start', 'period_end', 'due_date']) {
    if (!isDate(d[k])) errors.push({ key: k, code: 'missing' })
  }
  if (errors.length) return { errors, warnings }
  if (d.period_end < d.period_start) errors.push({ key: 'period_end', code: 'end_before_start' })
  if (d.due_date < d.issue_date) errors.push({ key: 'due_date', code: 'due_before_issue' })
  const far = addDays(today, 31)
  if (d.period_start > far || d.period_end > far) warnings.push({ key: 'period_start', code: 'period_far_future' })
  if (d.period_start > d.issue_date) warnings.push({ key: 'period_start', code: 'period_after_issue' })
  if (d.issue_date > addDays(today, 31) || d.issue_date < addDays(today, -366)) warnings.push({ key: 'issue_date', code: 'issue_odd' })
  if (d.due_date > addDays(d.issue_date, 92)) warnings.push({ key: 'due_date', code: 'due_far' })
  return { errors, warnings }
}

/** 対象期間 as printed: one day when start = end, else "start 〜 end". */
export function periodLabel(start, end, sep = ' 〜 ') {
  const s = ymd(start)
  const e = ymd(end) || s
  if (!s) return ''
  return s === e ? s : `${s}${sep}${e}`
}

/** A session date more than 45 days ahead is often a typo in the year (or month). */
export function looksLikeYearTypo(day, today = tokyoToday()) {
  return isDate(day) && day > addDays(today, 45)
}
