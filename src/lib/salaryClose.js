// Payroll close shared by the admin page (manual button) and the daily cron (automatic).
// Takes any Supabase client: the browser one or the server one with the service role.
import { getPeriodDates } from './salaryPeriod.js'
import { fixedMonthBase } from './salaryCalc.js'
import { ensureServiceReports } from './jobReport.js'

const tokyoToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())

export function previousPeriod(today = tokyoToday()) {
  const [y, m] = today.slice(0, 7).split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

/** Last day the cron may still close last month on its own: staff confirm until the 5th. */
export const AUTO_CLOSE_LAST_DAY = 5

export function computeBase(emp, jobs, period) {
  const jobPay = (j) => Number(j.retro_value ?? j.value ?? 0)
  // Fixed salary: the whole month, even with no jobs (only prorated by contract start / end).
  if (emp.salary_type === 'fixed') return fixedMonthBase(emp, period)
  if (emp.salary_type === 'hourly') {
    const minutes = jobs.reduce((s, j) => {
      if (j.started_at && j.completed_at) return s + (new Date(j.completed_at) - new Date(j.started_at)) / 60000
      return s + (j.retro_time_min || 45)
    }, 0)
    return Math.round(minutes / 60 * (emp.hourly_rate || 0))
  }
  if (emp.salary_type === 'per_job') {
    return jobs.reduce((s, j) => s + Math.round(jobPay(j) * ((emp.job_bonus_rate || 100) / 100)), 0)
  }
  return emp.fixed_salary || 0
}

/**
 * Close one month: period row, one payslip per active employee and the scheduled salary payment.
 * auto=true marks the period 'auto_closed' so the admin bell asks for a review.
 */
export async function closeSalaryPeriod(db, period, { auto = false, salaryDesc = `Salary ${period}` } = {}) {
  const { confirmDeadline, payDate } = getPeriodDates(period)
  const { error: periodErr } = await db.from('salary_periods').upsert({
    period, closed_at: new Date().toISOString(), confirm_deadline: confirmDeadline,
    pay_date: payDate, status: auto ? 'auto_closed' : 'closed',
  }, { onConflict: 'period' })
  if (periodErr) throw periodErr

  const { data: employees, error: empErr } = await db.from('employees').select('*').eq('is_active', true)
  if (empErr) throw empErr

  let total = 0
  let kept = 0
  for (const emp of employees || []) {
    const res = await closeEmployeeMonth(db, period, emp, { salaryDesc })
    if (res.kept) kept++
    total += res.net
  }
  return { period, employees: employees?.length || 0, total, kept, confirmDeadline, payDate }
}

/**
 * Payslip + scheduled salary of one person for one month (used by the month close and by the
 * per-employee close screen in Payments). A month already paid is never touched again, and a payslip
 * the employee already confirmed keeps its confirmation when the amount did not change.
 * @returns {{ net: number, base: number, dedTotal: number, jobs: number, kept: boolean }}
 */
export async function closeEmployeeMonth(db, period, emp, { salaryDesc = `Salary ${period}` } = {}) {
  const { closeDate, payDate } = getPeriodDates(period)
  const { data: existing } = await db.from('salary_payments')
    .select('id,status,amount').eq('employee_id', emp.id).eq('period', period).eq('payment_type', 'salary').limit(1)
  if (existing?.[0]?.status === 'paid') {
    return { net: Number(existing[0].amount || 0), base: null, dedTotal: null, jobs: null, kept: true }
  }

  const { data: jobs, error: jobsErr } = await db.from('jobs').select('*')
    .eq('employee_id', emp.id).eq('status', 'completed')
    .gte('scheduled_date', `${period}-01`).lte('scheduled_date', closeDate)
  if (jobsErr) throw jobsErr
  // Every job paid here also has its service report (same rule as billing).
  await ensureServiceReports(db, jobs).catch(() => {})

  const { data: deductions } = await db.from('salary_payments').select('amount')
    .eq('employee_id', emp.id).eq('period', period).eq('is_deduction', true).neq('status', 'cancelled')

  const base = computeBase(emp, jobs || [], period)
  const dedTotal = (deductions || []).reduce((s, d) => s + Number(d.amount || 0), 0)
  const net = Math.max(0, base - dedTotal)

  const { data: prev } = await db.from('salary_statements').select('*')
    .eq('period', period).eq('employee_id', emp.id).limit(1)
  const old = prev?.[0]
  const same = old && Number(old.net_total) === net && Number(old.base_salary) === base && Number(old.deductions) === dedTotal
  const statement = {
    period, employee_id: emp.id, employee_name: emp.full_name,
    base_salary: base, deductions: dedTotal, net_total: net,
    breakdown: { jobs: jobs?.length || 0, salary_type: emp.salary_type },
  }
  // Same amount as before: keep what the employee / admin already did with it.
  if (!same) Object.assign(statement, { status: 'awaiting_confirmation', employee_confirmed_at: null, employee_disputed_at: null })
  const { error: stErr } = old
    ? await db.from('salary_statements').update(statement).eq('id', old.id)
    : await db.from('salary_statements').insert({ ...statement, status: 'awaiting_confirmation' })
  if (stErr) throw stErr

  // No unique index on (employee_id, period, payment_type): deductions and
  // advances share the period, so update the salary row if it exists.
  const salaryRow = {
    employee_id: emp.id, employee_name: emp.full_name,
    period, amount: net, payment_date: payDate,
    description: salaryDesc,
    status: 'scheduled', payment_type: 'salary', is_deduction: false,
  }
  const { error: payErr } = existing?.length
    ? await db.from('salary_payments').update(salaryRow).eq('id', existing[0].id)
    : await db.from('salary_payments').insert(salaryRow)
  if (payErr) throw payErr
  return { net, base, dedTotal, jobs: jobs?.length || 0, kept: false }
}
