// Payroll close shared by the admin page (manual button) and the daily cron (automatic).
// Takes any Supabase client: the browser one or the server one with the service role.
import { getPeriodDates } from './salaryPeriod.js'

const tokyoToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())

export function previousPeriod(today = tokyoToday()) {
  const [y, m] = today.slice(0, 7).split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

/** Last day the cron may still close last month on its own: staff confirm until the 5th. */
export const AUTO_CLOSE_LAST_DAY = 5

export function computeBase(emp, jobs) {
  const jobPay = (j) => Number(j.retro_value ?? j.value ?? 0)
  if (emp.salary_type === 'fixed') {
    const days = new Set(jobs.map(j => j.scheduled_date)).size
    return Math.min(Math.round((emp.fixed_salary || 0) / (emp.monthly_work_days || 22) * days), emp.fixed_salary || 0)
  }
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
  const { closeDate, confirmDeadline, payDate } = getPeriodDates(period)
  const { error: periodErr } = await db.from('salary_periods').upsert({
    period, closed_at: new Date().toISOString(), confirm_deadline: confirmDeadline,
    pay_date: payDate, status: auto ? 'auto_closed' : 'closed',
  }, { onConflict: 'period' })
  if (periodErr) throw periodErr

  const { data: employees, error: empErr } = await db.from('employees').select('*').eq('is_active', true)
  if (empErr) throw empErr

  let total = 0
  for (const emp of employees || []) {
    const { data: jobs, error: jobsErr } = await db.from('jobs').select('*')
      .eq('employee_id', emp.id).eq('status', 'completed')
      .gte('scheduled_date', `${period}-01`).lte('scheduled_date', closeDate)
    if (jobsErr) throw jobsErr

    const { data: deductions } = await db.from('salary_payments').select('amount')
      .eq('employee_id', emp.id).eq('period', period).eq('is_deduction', true)

    const base = computeBase(emp, jobs || [])
    const dedTotal = (deductions || []).reduce((s, d) => s + Number(d.amount || 0), 0)
    const net = Math.max(0, base - dedTotal)
    total += net

    const { error: stErr } = await db.from('salary_statements').upsert({
      period, employee_id: emp.id, employee_name: emp.full_name,
      base_salary: base, deductions: dedTotal, net_total: net,
      breakdown: { jobs: jobs?.length || 0, salary_type: emp.salary_type },
      status: 'awaiting_confirmation',
    }, { onConflict: 'period,employee_id' })
    if (stErr) throw stErr

    // No unique index on (employee_id, period, payment_type): deductions and
    // advances share the period, so update the salary row if it exists.
    const salaryRow = {
      employee_id: emp.id, employee_name: emp.full_name,
      period, amount: net, payment_date: payDate,
      description: salaryDesc,
      status: 'scheduled', payment_type: 'salary', is_deduction: false,
    }
    const { data: existing } = await db.from('salary_payments')
      .select('id').eq('employee_id', emp.id).eq('period', period).eq('payment_type', 'salary').limit(1)
    const { error: payErr } = existing?.length
      ? await db.from('salary_payments').update(salaryRow).eq('id', existing[0].id)
      : await db.from('salary_payments').insert(salaryRow)
    if (payErr) throw payErr
  }
  return { period, employees: employees?.length || 0, total, confirmDeadline, payDate }
}
