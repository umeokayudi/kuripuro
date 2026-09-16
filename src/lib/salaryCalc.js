import { tokyoNow, tokyoToday, tokyoYearMonth, monthBounds, workedDayKey } from './dates'

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
  const { from, to } = monthBounds(month)
  if (!from || !to) return []
  const end = todayStr < to ? todayStr : to
  return (jobs || []).filter(j =>
    j.status === 'completed'
    && j.scheduled_date >= from
    && j.scheduled_date <= end,
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

export function isDeductionRow(row) {
  return !!(row?.is_deduction || row?.payment_type === 'deduction')
}

export function isAdvanceRow(row) {
  return row?.payment_type === 'advance'
}

export function advanceDate(row) {
  return String(row?.payment_date || row?.received_at || row?.created_at || '').slice(0, 10) || null
}

export function isAdvanceReceived(row, todayStr = tokyoToday()) {
  if (!row) return false
  if (row.status === 'paid') return true
  const date = advanceDate(row)
  return !!(date && date < todayStr)
}

export function sumAmounts(rows) {
  return (rows || []).reduce((s, r) => s + Number(r.amount || 0), 0)
}

export function fridaysInMonth(period) {
  const { from, to } = monthBounds(period)
  if (!from || !to) return []
  const last = Number(to.slice(8, 10))
  const dates = []
  for (let d = 1; d <= last; d++) {
    const date = `${period}-${String(d).padStart(2, '0')}`
    if (new Date(`${date}T12:00:00`).getDay() === 5) dates.push(date)
  }
  return dates
}

/** Weekly advance drafts that are not already on the ledger. Does not insert. */
export function plannedWeeklyAdvances(emp, period, existingAdvances = []) {
  const amount = Number(emp?.advance_per_week || 0)
  if (amount <= 0) return []
  const taken = new Set((existingAdvances || []).map(a => a.payment_date).filter(Boolean))
  return fridaysInMonth(period)
    .filter(date => !taken.has(date))
    .map(date => ({
      payment_date: date,
      amount,
      description: `Weekly advance ${date}`,
      payment_type: 'advance',
      status: 'scheduled',
      is_deduction: false,
    }))
}

function computeBase(empInfo, completed) {
  const totalMins = completed.reduce((s, j) => s + jobMinutes(j), 0)
  const workedDays = countWorkedDays(completed)
  const fixedMax = Number(empInfo?.fixed_salary || 0)
  const monthlyDays = empInfo?.monthly_work_days || 22
  const dailyRate = monthlyDays ? fixedMax / monthlyDays : 0
  const bonusRate = (empInfo?.job_bonus_rate || 100) / 100
  const type = empInfo?.salary_type || 'fixed'

  let base = 0
  if (type === 'fixed') {
    base = Math.min(Math.round(dailyRate * workedDays), fixedMax)
  } else if (type === 'hourly') {
    base = Math.round((totalMins / 60) * (empInfo?.hourly_rate || 0))
  } else if (type === 'per_job') {
    base = completed.reduce((s, j) => s + Math.round(jobPay(j) * bonusRate), 0)
  } else if (type === 'mixed') {
    const fixedPart = Math.min(Math.round(dailyRate * workedDays), fixedMax)
    const hourlyPart = Math.round((totalMins / 60) * (empInfo?.hourly_rate || 0))
    const bonusPart = completed.reduce((s, j) => s + Math.round(jobPay(j) * ((empInfo?.job_bonus_rate || 0) / 100)), 0)
    base = fixedPart + hourlyPart + bonusPart
  } else {
    base = Math.round(fixedMax + (totalMins / 60) * (empInfo?.hourly_rate || 0))
  }

  return { base, totalMins, workedDays, fixedMax, dailyRate: Math.round(dailyRate), type }
}

function remainingWeekdays() {
  const now = tokyoNow()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  let remain = 0
  for (let d = now.getDate() + 1; d <= daysInMonth; d++) {
    const day = new Date(now.getFullYear(), now.getMonth(), d).getDay()
    if (day !== 0 && day !== 6) remain++
  }
  return remain
}

/**
 * One salary breakdown for admin + portal + month close.
 * net = earned after deductions (what they earned)
 * toPay = net minus advances already given (15th transfer)
 */
export function calcPeriodSalary(empInfo, allJobs, payments = [], { period, today } = {}) {
  const todayStr = today || tokyoToday()
  const ym = period || tokyoYearMonth()
  const completed = completedJobsInMonth(allJobs, ym, todayStr)
  const { base, totalMins, workedDays, fixedMax, dailyRate, type } = computeBase(empInfo, completed)

  const spotEarned = completed
    .filter(j => j.job_category === 'spot')
    .reduce((s, j) => s + Number(j.spot_value || 0), 0)

  const deductionRows = (payments || []).filter(isDeductionRow)
  const advanceRows = (payments || []).filter(isAdvanceRow)
  const bonusRows = (payments || []).filter(p => p.payment_type === 'bonus' && !isDeductionRow(p))
  const transportRows = (payments || []).filter(p => p.payment_type === 'transport' && !isDeductionRow(p))
  const salaryRows = (payments || []).filter(p => p.payment_type === 'salary' && !isDeductionRow(p))

  const deductions = sumAmounts(deductionRows)
  const advancesReceived = sumAmounts(advanceRows.filter(a => isAdvanceReceived(a, todayStr)))
  const advancesPending = sumAmounts(advanceRows.filter(a => !isAdvanceReceived(a, todayStr)))
  const bonuses = sumAmounts(bonusRows)
  const transport = sumAmounts(transportRows)

  const gross = base + spotEarned
  const net = Math.max(0, gross - deductions)
  const toPay = Math.max(0, net - advancesReceived)
  const remain = ym === tokyoYearMonth() ? remainingWeekdays() : 0

  return {
    period: ym,
    salaryType: type,
    jobs: completed.length,
    completed,
    hours: (totalMins / 60).toFixed(1),
    base,
    spotEarned,
    bonuses,
    transport,
    deductions,
    deductionRows,
    advanceRows,
    advancesReceived,
    advancesPending,
    salaryRows,
    gross,
    total: gross,
    net,
    toPay,
    workedDays,
    fixedMax,
    dailyRate,
    projected: fixedMax ? Math.min(base + Math.round(dailyRate * remain), fixedMax) : base,
  }
}

/**
 * Employee portal monthly salary breakdown (current Tokyo month).
 */
export function calcEmployeeMonthlySalary(empInfo, allJobs, deductionsList = []) {
  const payments = (deductionsList || []).map(d => (
    d.payment_type ? d : { ...d, payment_type: 'deduction', is_deduction: true }
  ))
  return calcPeriodSalary(empInfo, allJobs, payments, { period: tokyoYearMonth() })
}
