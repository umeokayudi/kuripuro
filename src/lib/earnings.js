import { tokyoToday } from './dates'
import { calcEmployeeMonthlySalary, jobMinutes, jobPay, countWorkedDays } from './salaryCalc'

// Earnings history for the "Ganhos" charts (employee Salary tab + admin Salary page).
// Months reuse calcEmployeeMonthlySalary so the bars match the payslip exactly.
// Weeks (Mon–Sun, Tokyo) use the same rules without the monthly fixed-salary cap.

const pad = n => String(n).padStart(2, '0')
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = s => new Date(`${s}T12:00:00`)

const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  ja: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
}

export function monthLabel(month, lang = 'en', long = false) {
  const [y, m] = month.split('-').map(Number)
  if (lang === 'ja') return long ? `${y}年${m}月` : `${m}月`
  return long ? `${MONTHS.en[m - 1]} ${y}` : MONTHS.en[m - 1]
}

/** Last `count` months, oldest first, ending with the current Tokyo month. */
export function recentMonths(count, today = tokyoToday()) {
  const [y, m] = today.slice(0, 7).split('-').map(Number)
  const out = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1)
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`)
  }
  return out
}

/** Last `count` Monday–Sunday weeks, oldest first, ending with the current week. */
export function recentWeeks(count, today = tokyoToday()) {
  const t = parse(today)
  const monday = new Date(t)
  monday.setDate(t.getDate() - ((t.getDay() + 6) % 7))
  const out = []
  for (let i = count - 1; i >= 0; i--) {
    const s = new Date(monday)
    s.setDate(monday.getDate() - i * 7)
    const e = new Date(s)
    e.setDate(s.getDate() + 6)
    out.push({ start: iso(s), end: iso(e) })
  }
  return out
}

/** First day the charts need data from (covers both views). */
export function earningsWindowStart(months = 6, weeks = 8, today = tokyoToday()) {
  const m = recentMonths(months, today)[0] + '-01'
  const w = recentWeeks(weeks, today)[0].start
  return m < w ? m : w
}

const isSpot = j => j.job_category === 'spot'
const spotPay = j => (isSpot(j) ? Number(j.spot_value || 0) : 0)

/** What one completed job adds on top of a fixed salary (shown in the job list). */
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

function weekSalary(emp, jobs) {
  const fixedMax = Number(emp?.fixed_salary || 0)
  const dailyRate = fixedMax / (emp?.monthly_work_days || 22)
  const workedDays = countWorkedDays(jobs)
  const type = emp?.salary_type || 'fixed'
  const fixedPart = (type === 'fixed' || type === 'mixed') ? Math.round(dailyRate * workedDays) : 0
  const perJob = jobs.reduce((s, j) => s + jobEarnings(j, emp) - spotPay(j), 0)
  const spotEarned = jobs.reduce((s, j) => s + spotPay(j), 0)
  const base = fixedPart + perJob
  return { base, spotEarned, total: base + spotEarned, workedDays }
}

const inRange = (date, start, end) => date && date >= start && date <= end

/**
 * One entry per bar: { key, label, title, start, end, total, deductions, net, base, spot,
 * jobs, hours, workedDays, jobList }. `jobs` must be completed, already value-enriched jobs.
 */
export function buildEarningsSeries({ emp, jobs, deductions = [], mode = 'month', count, lang = 'en', today = tokyoToday() }) {
  const done = (jobs || []).filter(j => j.status === 'completed' && j.scheduled_date && j.scheduled_date <= today)
  const deductionDate = d => (d.payment_date || d.created_at || '').slice(0, 10)

  if (mode === 'week') {
    return recentWeeks(count || 8, today).map(({ start, end }, i, all) => {
      const list = done.filter(j => inRange(j.scheduled_date, start, end))
      const s = weekSalary(emp, list)
      const ded = deductions.filter(d => inRange(deductionDate(d), start, end)).reduce((a, d) => a + Number(d.amount || 0), 0)
      const mins = list.reduce((a, j) => a + jobMinutes(j), 0)
      const sd = parse(start), ed = parse(end)
      const short = lang === 'ja' ? `${sd.getMonth() + 1}/${sd.getDate()}` : `${sd.getDate()}/${sd.getMonth() + 1}`
      return {
        key: start, start, end,
        label: i === all.length - 1 ? (lang === 'ja' ? '今週' : 'Now') : short,
        title: lang === 'ja'
          ? `${sd.getMonth() + 1}/${sd.getDate()} – ${ed.getMonth() + 1}/${ed.getDate()}`
          : `${sd.getDate()}/${sd.getMonth() + 1} – ${ed.getDate()}/${ed.getMonth() + 1}`,
        total: s.total, base: s.base, spot: s.spotEarned, deductions: ded, net: Math.max(0, s.total - ded),
        jobs: list.length, hours: mins / 60, workedDays: s.workedDays,
        jobList: list.sort((a, b) => (b.scheduled_date || '').localeCompare(a.scheduled_date || '')),
      }
    })
  }

  return recentMonths(count || 6, today).map(month => {
    const ded = deductions.filter(d => deductionDate(d).startsWith(month))
    const s = calcEmployeeMonthlySalary(emp, done, ded, month)
    const list = done.filter(j => j.scheduled_date.startsWith(month))
    return {
      key: month, start: `${month}-01`, end: `${month}-31`, month,
      label: monthLabel(month, lang), title: monthLabel(month, lang, true),
      total: s.total, base: s.base, spot: s.spotEarned, deductions: s.deductions, net: s.net,
      jobs: s.jobs, hours: Number(s.hours), workedDays: s.workedDays, salary: s,
      jobList: list.sort((a, b) => (b.scheduled_date || '').localeCompare(a.scheduled_date || '')),
    }
  })
}

/** Change of the selected bar vs the one before it, in % (null when there is nothing to compare). */
export function trendPercent(series, index) {
  if (index <= 0) return null
  const prev = series[index - 1]?.net || 0
  const cur = series[index]?.net || 0
  if (!prev) return null
  return Math.round(((cur - prev) / prev) * 100)
}
