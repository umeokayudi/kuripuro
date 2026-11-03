import { tokyoNow, tokyoToday, workedDayKey } from './dates.js'
import { perJobPay } from './jobEmployeePay.js'
import { activePackages, packagesTotal, packageOfJob } from './payPackages.js'

export function jobMinutes(job) {
  if (job?.started_at && job?.completed_at) {
    return (new Date(job.completed_at) - new Date(job.started_at)) / 60000
  }
  if (job?.retro_time_min) return Number(job.retro_time_min)
  return 45
}

export function jobPay(job) {
  return Number(job?.retro_value ?? job?.value ?? 0)
}

export function completedJobsInMonth(jobs, month, todayStr = tokyoToday()) {
  return (jobs || []).filter(j =>
    j.status === 'completed'
    && j.scheduled_date?.startsWith(month)
    && j.scheduled_date <= todayStr,
  )
}

export function countWorkedDays(jobs) {
  const set = new Set()
  for (const j of jobs || []) {
    const key = workedDayKey(j)
    if (key) set.add(key)
  }
  return set.size
}

/**
 * Employee portal monthly salary breakdown (shared logic).
 * `month` (YYYY-MM) defaults to the current Tokyo month; past months use the same rules.
 */
/**
 * v1.0.96 · Fixed monthly salary for a month: the full amount, never less because there were
 * few or no jobs. Only a contract that starts or ends inside the month is prorated by calendar days.
 */
export function fixedMonthBase(emp, month) {
  const fixed = yenAmount(emp?.fixed_salary)
  if (!fixed || !month) return fixed
  const [y, m] = month.split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  const first = `${month}-01`, last = `${month}-${String(days).padStart(2, '0')}`
  const startDay = String(emp?.contract_start || '').slice(0, 10)
  let endDay = String(emp?.contract_end || '').slice(0, 10)
  // v1.0.102 · An ACTIVE person whose contract end is already in the past is an outdated date on
  // the record, not a person who left: the salary of the month is never zeroed by it.
  if (endDay && endDay < first && emp?.is_active !== false) endDay = ''
  const start = startDay && startDay > first ? startDay : first
  const end = endDay && endDay < last ? endDay : last
  if (start > last || end < first) return 0
  const covered = Number(end.slice(8, 10)) - Number(start.slice(8, 10)) + 1
  return covered >= days ? fixed : Math.round(fixed / days * covered)
}

/** ¥ amount typed in any way ("212000", "212,000", "¥212.000", 212000) → number. */
export function yenAmount(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * v1.0.102 · Base of the payslip with the same rules everywhere (payroll close, Payments, employee app).
 * Fixed salary = the whole month with or without jobs. Mixed = fixed + hours + job bonus.
 * A person with a monthly salary on the record and no / unknown salary type is paid as fixed.
 */
export function monthBase(emp, jobs, month) {
  const done = jobs || []
  const minutes = done.reduce((s, j) => s + jobMinutes(j), 0)
  const hourly = Math.round(minutes / 60 * yenAmount(emp?.hourly_rate))
  const type = emp?.salary_type
  if (type === 'hourly') return hourly
  if (type === 'per_job') return done.reduce((s, j) => s + Math.round(jobPay(j) * ((emp?.job_bonus_rate || 100) / 100)), 0)
  if (type === 'mixed') {
    return fixedMonthBase(emp, month) + hourly + done.reduce((s, j) => s + Math.round(jobPay(j) * ((emp?.job_bonus_rate || 0) / 100)), 0)
  }
  return fixedMonthBase(emp, month)
}

export function calcEmployeeMonthlySalary(empInfo, allJobs, deductionsList = [], month, basis = null) {
  const todayStr = tokyoToday()
  month = month || todayStr.slice(0, 7)
  const isCurrentMonth = month === todayStr.slice(0, 7)
  const completed = completedJobsInMonth(allJobs, month, todayStr)
  const totalMins = completed.reduce((s, j) => s + jobMinutes(j), 0)
  // v1.0.108 · base, jobs and deductions come from payrollMonth (same numbers as Payroll close).
  const one = payrollMonth({ emp: empInfo, jobs: completed, lines: (deductionsList || []).map(d => ({ ...d, period: d.period || month })), month, basis })
  const spotEarned = one.jobsPay
  const deductions = one.deductions
  const workedDays = countWorkedDays(completed)
  const fixedMax = yenAmount(empInfo?.fixed_salary)
  const monthlyDays = empInfo?.monthly_work_days || 22
  const dailyRate = fixedMax / monthlyDays

  const base = one.base

  const now = tokyoNow()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  let remain = 0
  for (let d = now.getDate() + 1; d <= daysInMonth; d++) {
    const day = new Date(now.getFullYear(), now.getMonth(), d).getDay()
    if (day !== 0 && day !== 6) remain++
  }

  const total = base + spotEarned
  return {
    jobs: completed.length,
    hours: (totalMins / 60).toFixed(1),
    base,
    spotEarned,
    deductions,
    net: Math.max(0, total - deductions),
    total,
    workedDays,
    fixedMax,
    dailyRate: Math.round(dailyRate),
    projected: isCurrentMonth ? Math.min(base + Math.round(dailyRate * remain), fixedMax) : 0,
    month,
    salaryType: empInfo?.salary_type || 'fixed',
    /** True when nothing in the employee record can produce pay (all rates are 0). */
    notConfigured: payRatesMissing(empInfo),
  }
}

/** No fixed salary, hourly rate or per-job rate that applies to this salary type. */
export function payRatesMissing(empInfo) {
  if (!empInfo) return true
  const fixed = Number(empInfo.fixed_salary || 0)
  const hourly = Number(empInfo.hourly_rate || 0)
  const bonus = Number(empInfo.job_bonus_rate || 0)
  switch (empInfo.salary_type) {
    case 'fixed': return fixed <= 0
    case 'hourly': return hourly <= 0
    case 'per_job': return false
    case 'mixed': return fixed <= 0 && hourly <= 0 && bonus <= 0
    default: return fixed <= 0 && hourly <= 0
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// v1.0.108 · ONE calculation of a person's month, used by Payroll close, Payments, Salary,
// Deductions, the payslip sheet and the employee app. Never show a stored snapshot instead.
//   base (fixed never zeroes) + jobs (spot extras) − deductions = net
// ─────────────────────────────────────────────────────────────────────────────

/** Month a salary_payments row belongs to: its period, else the month of its date. */
export const lineMonth = row => row?.period || String(row?.payment_date || row?.created_at || '').slice(0, 7)

/** A deduction that counts in pay: not cancelled (automatic suggestions wait as cancelled until approved). */
export const countsAsDeduction = row => !!row?.is_deduction && row.status !== 'cancelled'

/** Last day of a YYYY-MM month. */
export function monthLastDay(month) {
  const [y, m] = month.split('-').map(Number)
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
}

/** Spot jobs pay their own extra on top of the base (the "+¥" offered to the employee). */
export const spotExtra = job => (job?.job_category === 'spot' ? yenAmount(job.spot_value) : 0)

/**
 * @param emp employees row
 * @param jobs that person's jobs (any status / dates — filtered here)
 * @param lines that person's salary_payments rows (any month — filtered here)
 * @param month YYYY-MM
 */
export function payrollMonth({ emp, jobs = [], lines = [], month, basis = null }) {
  const last = monthLastDay(month)
  const done = (jobs || []).filter(j => j.status === 'completed' && j.scheduled_date >= `${month}-01` && j.scheduled_date <= last)
  // v1.0.131 · Fixed salary and the sum of "Pagamento do funcionário" per job are two separate totals.
  // The admin picks which one counts in the month (basis 'fixed' | 'per_job'); they are never added.
  // No choice yet → the old rule (monthBase), except when jobs carry a pay: then `needsBasis`.
  // v1.0.148 · a monthly package (e.g. Atomic ¥35.000) is paid apart; its jobs are "no pacote", not "a definir"
  const packages = activePackages(emp, month)
  const packageTotal = packagesTotal(packages)
  const pkgJobs = packages.length ? done.filter(j => packageOfJob(j, packages)) : []
  const perJob = perJobPay(pkgJobs.length ? done.filter(j => !pkgJobs.includes(j)) : done)
  const fixedTotal = fixedMonthBase(emp, month)
  const pick = basis?.basis || basis || null
  // v1.0.133 · No choice yet: a fixed salary on the record IS the base (never ¥0, even with 0 jobs);
  // without a fixed salary, the sum of "Pagamento do funcionário" when jobs carry one; else the old rule.
  const type = emp?.salary_type
  const fixedRule = fixedTotal > 0 && type !== 'mixed'
  const auto = fixedRule ? 'fixed' : ((perJob.priced > 0 || packageTotal > 0) && type !== 'mixed' ? 'per_job' : null)
  const used = pick || auto
  const base = (used === 'per_job' ? perJob.total : used === 'fixed' ? fixedTotal : monthBase(emp, pkgJobs.length ? done.filter(j => !pkgJobs.includes(j)) : done, month)) + packageTotal
  const jobsPay = done.reduce((s, j) => s + spotExtra(j), 0)
  const mine = (lines || []).filter(l => lineMonth(l) === month)
  const dedRows = mine.filter(countsAsDeduction)
  const deductions = dedRows.reduce((s, d) => s + yenAmount(d.amount), 0)
  return {
    month, base, jobsPay, deductions, dedRows,
    basis: pick, autoBasis: pick ? null : auto, fixedTotal, perJob, packages, packageTotal, packageJobs: pkgJobs.length,
    // v1.0.133 · never blocks the close any more (fixed wins by default); kept for old callers.
    needsBasis: false,
    // both a fixed salary and jobs with employee pay: the admin may switch (fixed counts until then)
    bothOptions: !pick && fixedTotal > 0 && perJob.priced > 0,
    gross: base + jobsPay,
    net: Math.max(0, base + jobsPay - deductions),
    jobs: done.length,
    minutes: done.reduce((s, j) => s + jobMinutes(j), 0),
    salaryLine: mine.find(l => l.payment_type === 'salary' && l.status !== 'cancelled') || null,
  }
}

/** First day a month may be closed: the 1st of the following month (Tokyo). */
export function canCloseMonth(month, today = tokyoToday()) {
  return today.slice(0, 7) > month
}
