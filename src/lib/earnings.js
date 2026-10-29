import { tokyoToday, workedDayKey } from './dates'
import { calcEmployeeMonthlySalary, jobMinutes, jobPay } from './salaryCalc'

// Earnings history for the Salary screens (employee Salary tab + admin Salary page).
// Each worked day gets its own amount, like a driver-app earnings screen. A full calendar
// month uses calcEmployeeMonthlySalary, so its total matches the payslip exactly.

const pad = n => String(n).padStart(2, '0')
const parse = s => new Date(`${s}T12:00:00Z`)
const iso = d => d.toISOString().slice(0, 10)

export function addDays(day, n) {
  const d = parse(day)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}

export const daysBetween = (from, to) => Math.round((parse(to) - parse(from)) / 86400000) + 1

export function weekStart(day) {
  return addDays(day, -((parse(day).getUTCDay() + 6) % 7))
}

export function monthEnd(month) {
  const [y, m] = month.split('-').map(Number)
  return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`
}

export function shiftMonth(month, n) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}

const MONTHS_BY_LANG = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  pt: ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'],
}
const MONTHS_LONG_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const WEEKDAYS = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ja: ['日', '月', '火', '水', '木', '金', '土'],
  pt: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'],
}
const monthsFor = lang => MONTHS_BY_LANG[lang] || MONTHS_BY_LANG.en
const weekdaysFor = lang => WEEKDAYS[lang] || WEEKDAYS.en

export function monthLabel(month, lang = 'en', long = false) {
  const [y, m] = month.split('-').map(Number)
  if (lang === 'ja') return long ? `${y}年${m}月` : `${m}月`
  if (lang === 'pt' && long) return `${MONTHS_LONG_PT[m - 1]} de ${y}`
  const months = monthsFor(lang)
  return long ? `${months[m - 1]} ${y}` : months[m - 1]
}

export function dayLabel(day, lang = 'en', withWeekday = true) {
  const d = parse(day)
  const wd = weekdaysFor(lang)[d.getUTCDay()]
  if (lang === 'ja') return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日${withWeekday ? `(${wd})` : ''}`
  return `${withWeekday ? wd + ' ' : ''}${d.getUTCDate()} ${monthsFor(lang)[d.getUTCMonth()]}`
}

export function rangeLabel(from, to, lang = 'en') {
  const a = parse(from), b = parse(to)
  if (lang === 'ja') {
    const left = `${a.getUTCMonth() + 1}/${a.getUTCDate()}`
    const right = `${b.getUTCMonth() + 1}/${b.getUTCDate()}`
    return from === to ? left : `${left} – ${right}`
  }
  const months = monthsFor(lang)
  const left = `${a.getUTCDate()} ${months[a.getUTCMonth()]}`
  const right = `${b.getUTCDate()} ${months[b.getUTCMonth()]}`
  return from === to ? left : `${left} – ${right}`
}

const spotPay = j => (j.job_category === 'spot' ? Number(j.spot_value || 0) : 0)

/** What one completed job pays on its own (fixed salary pays per day, not per job). */
export function jobEarnings(job, emp) {
  const type = emp?.salary_type || 'fixed'
  const mins = jobMinutes(job)
  let pay = 0
  if (type === 'hourly') pay = Math.round((mins / 60) * Number(emp?.hourly_rate || 0))
  else if (type === 'per_job') pay = Math.round(jobPay(job) * ((emp?.job_bonus_rate || 100) / 100))
  else if (type === 'mixed') {
    pay = Math.round((mins / 60) * Number(emp?.hourly_rate || 0))
      + Math.round(jobPay(job) * ((emp?.job_bonus_rate || 0) / 100))
  } else if (type !== 'fixed') pay = Math.round((mins / 60) * Number(emp?.hourly_rate || 0))
  return pay + spotPay(job)
}

/** Daily share of a fixed salary (paid once per worked day). */
export function dailyFixedRate(emp) {
  const type = emp?.salary_type || 'fixed'
  if (type !== 'fixed' && type !== 'mixed') return 0
  return Number(emp?.fixed_salary || 0) / (emp?.monthly_work_days || 22)
}

const dayOf = j => workedDayKey(j) || j.scheduled_date

/**
 * Everything the Salary screen shows for one date range.
 * `jobs`: completed, value-enriched jobs (any dates). `deductions`: salary_payments rows with is_deduction.
 * When the range is exactly one calendar month, totals come from calcEmployeeMonthlySalary (same as payslip).
 */
export function summarizeRange({ emp, jobs, deductions = [], from, to, today = tokyoToday() }) {
  const end = to > today ? today : to
  const done = (jobs || []).filter(j => j.status === 'completed' && j.scheduled_date && j.scheduled_date <= today)
  const inRange = done.filter(j => { const d = dayOf(j); return d >= from && d <= end })
  const rate = dailyFixedRate(emp)

  const byDay = new Map()
  for (const j of inRange) {
    const d = dayOf(j)
    if (!byDay.has(d)) byDay.set(d, [])
    byDay.get(d).push(j)
  }

  const days = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const list = (byDay.get(d) || []).sort((a, b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || ''))
    const fixed = list.length && list.some(j => j.counts_as_work_day !== false) ? Math.round(rate) : 0
    const perJob = list.reduce((s, j) => s + jobEarnings(j, emp) - spotPay(j), 0)
    const spot = list.reduce((s, j) => s + spotPay(j), 0)
    days.push({
      day: d, future: d > today, jobs: list,
      total: fixed + perJob + spot, base: fixed + perJob, spot,
      minutes: list.reduce((s, j) => s + jobMinutes(j), 0),
    })
  }

  const dedRows = deductions.filter(r => {
    const d = (r.payment_date || r.created_at || '').slice(0, 10)
    return d >= from && d <= to
  })
  const dedTotal = dedRows.reduce((s, r) => s + Number(r.amount || 0), 0)

  const month = from.slice(8) === '01' && to === monthEnd(from.slice(0, 7)) ? from.slice(0, 7) : null
  const salary = month ? calcEmployeeMonthlySalary(emp, done, dedRows, month) : null

  const base = salary ? salary.base : days.reduce((s, d) => s + d.base, 0)
  const spot = salary ? salary.spotEarned : days.reduce((s, d) => s + d.spot, 0)
  const total = base + spot
  const minutes = days.reduce((s, d) => s + d.minutes, 0)
  return {
    from, to, month, salary, days,
    total, base, spot,
    deductions: dedTotal, deductionRows: dedRows,
    net: Math.max(0, total - dedTotal),
    jobs: inRange.length,
    hours: minutes / 60,
    workedDays: days.filter(d => d.jobs.length).length,
  }
}

/** Bars for the chart: one per day, or one per week when the range is long. */
export function chartBars(summary, lang = 'en') {
  const { days } = summary
  if (days.length <= 42) {
    return days.map(d => ({
      key: d.day, from: d.day, to: d.day, value: d.total, future: d.future,
      label: days.length <= 7
        ? weekdaysFor(lang)[parse(d.day).getUTCDay()]
        : String(Number(d.day.slice(8))),
      title: dayLabel(d.day, lang),
    }))
  }
  const weeks = []
  for (const d of days) {
    const k = weekStart(d.day)
    let w = weeks[weeks.length - 1]
    if (!w || w.key !== k) { w = { key: k, from: d.day, to: d.day, value: 0, future: d.future }; weeks.push(w) }
    w.to = d.day
    w.value += d.total
    w.future = w.future && d.future
  }
  return weeks.map(w => ({ ...w, label: rangeLabel(w.from, w.from, lang), title: rangeLabel(w.from, w.to, lang) }))
}

/** Change vs the previous range of the same length, in % (null when there is nothing to compare). */
export function trendPercent(cur, prev) {
  if (!prev) return null
  return Math.round(((cur - prev) / prev) * 100)
}
