import {
  calcPeriodSalary,
  monthFirstDate,
  monthLastDate,
  otherDeductionTotal,
  payslipAdvanceLines,
} from './salaryCalc'
import { getPeriodDates } from './salaryPeriod'

export function groupBy(rows, key) {
  const map = {}
  for (const row of rows || []) {
    const k = row?.[key]
    if (!k) continue
    if (!map[k]) map[k] = []
    map[k].push(row)
  }
  return map
}

export function periodsFromPayroll(rows) {
  const seen = new Map()
  for (const row of rows || []) {
    if (!row?.period) continue
    const prev = seen.get(row.period)
    const status = row.status === 'paid' && prev?.status !== 'pending' ? (prev?.status || 'paid') : (row.status === 'pending' ? 'pending' : (prev?.status || 'closed'))
    seen.set(row.period, { period: row.period, status: status === 'pending' ? 'closed' : (status === 'paid' ? 'paid' : 'closed') })
  }
  return [...seen.values()].sort((a, b) => b.period.localeCompare(a.period))
}

export function buildCloseRow(emp, jobs, payments, period, { payDate, salaryDesc }) {
  const monthEnd = monthLastDate(period)
  const calc = calcPeriodSalary(emp, jobs, [], period, monthEnd)
  const advances = payslipAdvanceLines(payments, period)
  const otherDeds = otherDeductionTotal(payments)
  const deductions = otherDeds + advances.total
  const net = Math.max(0, calc.total - deductions)
  return {
    payroll: {
      employee_id: emp.id,
      employee_name: emp.full_name,
      period,
      hours_worked: Number(calc.hours),
      base_salary: calc.base,
      transport_allowance: 0,
      bonus: calc.spotEarned,
      deductions,
      net_total: net,
      status: 'pending',
    },
    salaryPayment: {
      employee_id: emp.id,
      employee_name: emp.full_name,
      period,
      amount: net,
      payment_date: payDate,
      description: salaryDesc,
      status: 'scheduled',
      payment_type: 'salary',
      is_deduction: false,
    },
    calc,
    advances,
  }
}

export async function upsertByKeys(sb, table, row, keys) {
  let q = sb.from(table).select('id')
  for (const [k, v] of Object.entries(keys)) q = q.eq(k, v)
  const { data, error } = await q.limit(1)
  if (error) return error
  const id = data?.[0]?.id
  if (id) {
    const { error: u } = await sb.from(table).update(row).eq('id', id)
    return u
  }
  const { error: i } = await sb.from(table).insert(row)
  return i
}

export async function closePayrollMonth(sb, period, { salaryDesc } = {}) {
  const { payDate, confirmDeadline, closeDate } = getPeriodDates(period)
  const monthStart = monthFirstDate(period)
  const monthEnd = monthLastDate(period)
  if (!monthEnd) throw new Error('Invalid period')

  const { data: employees, error: empErr } = await sb.from('employees').select('*').eq('is_active', true)
  if (empErr) throw new Error(empErr.message)
  const { data: jobs, error: jobErr } = await sb
    .from('jobs')
    .select('*')
    .eq('status', 'completed')
    .gte('scheduled_date', monthStart)
    .lte('scheduled_date', monthEnd)
  if (jobErr) throw new Error(jobErr.message)
  const { data: pays, error: payErr } = await sb.from('salary_payments').select('*').eq('period', period)
  if (payErr) throw new Error(payErr.message)

  const jobsBy = groupBy(jobs, 'employee_id')
  const paysBy = groupBy(pays, 'employee_id')
  const desc = salaryDesc || `Salary ${period}`
  const closed = []

  for (const emp of employees || []) {
    const built = buildCloseRow(emp, jobsBy[emp.id] || [], paysBy[emp.id] || [], period, {
      payDate,
      salaryDesc: desc,
    })
    const pErr = await upsertByKeys(sb, 'payroll', built.payroll, { employee_id: emp.id, period })
    if (pErr) throw new Error(pErr.message)
    const sErr = await upsertByKeys(sb, 'salary_payments', built.salaryPayment, {
      employee_id: emp.id,
      period,
      payment_type: 'salary',
    })
    if (sErr) throw new Error(sErr.message)
    closed.push(built)
  }

  await sb.from('salary_periods').upsert({
    period,
    closed_at: new Date().toISOString(),
    confirm_deadline: confirmDeadline,
    pay_date: payDate,
    status: 'closed',
  }, { onConflict: 'period' })

  return { period, monthStart, monthEnd, closeDate, payDate, confirmDeadline, closed }
}
