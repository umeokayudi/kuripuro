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

export function previousPeriod(period) {
  const [y, m] = String(period).split('-').map(Number)
  const pm = m === 1 ? 12 : m - 1
  const py = m === 1 ? y - 1 : y
  return `${py}-${String(pm).padStart(2, '0')}`
}

/** pending on payroll = closed, not paid. paid = salary already paid. */
export function closeStatusLabel(rowStatus) {
  if (rowStatus === 'paid') return 'paid'
  return 'closed'
}

export function periodsFromPayroll(rows) {
  const seen = new Map()
  for (const row of rows || []) {
    if (!row?.period) continue
    const label = closeStatusLabel(row.status)
    const prev = seen.get(row.period)
    if (!prev || prev.status === 'paid' && label === 'closed') {
      seen.set(row.period, { period: row.period, status: label })
    }
  }
  return [...seen.values()].sort((a, b) => b.period.localeCompare(a.period))
}

export function buildCloseRow(emp, jobs, payments, period) {
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
    calc,
    advances,
  }
}

export function buildSalaryPayment(payrollRow, { payDate, salaryDesc }) {
  return {
    employee_id: payrollRow.employee_id,
    employee_name: payrollRow.employee_name,
    period: payrollRow.period,
    amount: Number(payrollRow.net_total || 0),
    payment_date: payDate,
    description: salaryDesc,
    status: 'scheduled',
    payment_type: 'salary',
    is_deduction: false,
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

async function loadPeriodInputs(sb, period, employeeId) {
  const monthStart = monthFirstDate(period)
  const monthEnd = monthLastDate(period)
  if (!monthEnd) throw new Error('Invalid period')
  let empQ = sb.from('employees').select('*').eq('is_active', true)
  if (employeeId) empQ = empQ.eq('id', employeeId)
  const { data: employees, error: empErr } = await empQ
  if (empErr) throw new Error(empErr.message)
  let jobQ = sb.from('jobs').select('*').eq('status', 'completed')
    .gte('scheduled_date', monthStart).lte('scheduled_date', monthEnd)
  if (employeeId) jobQ = jobQ.eq('employee_id', employeeId)
  const { data: jobs, error: jobErr } = await jobQ
  if (jobErr) throw new Error(jobErr.message)
  let payQ = sb.from('salary_payments').select('*').eq('period', period)
  if (employeeId) payQ = payQ.eq('employee_id', employeeId)
  const { data: pays, error: payErr } = await payQ
  if (payErr) throw new Error(payErr.message)
  return { monthStart, monthEnd, employees: employees || [], jobs: jobs || [], pays: pays || [] }
}

/** Writes payroll only. Never creates a salary payment. Skips rows already paid. */
export async function closePayrollMonth(sb, period, { employeeId } = {}) {
  const { payDate, confirmDeadline, closeDate } = getPeriodDates(period)
  const { monthStart, monthEnd, employees, jobs, pays } = await loadPeriodInputs(sb, period, employeeId)
  const jobsBy = groupBy(jobs, 'employee_id')
  const paysBy = groupBy(pays, 'employee_id')
  const closed = []
  const skippedPaid = []

  for (const emp of employees) {
    const { data: existing } = await sb.from('payroll').select('id,status')
      .eq('employee_id', emp.id).eq('period', period).limit(1)
    if (existing?.[0]?.status === 'paid') {
      skippedPaid.push(emp.id)
      continue
    }
    const built = buildCloseRow(emp, jobsBy[emp.id] || [], paysBy[emp.id] || [], period)
    const pErr = await upsertByKeys(sb, 'payroll', built.payroll, { employee_id: emp.id, period })
    if (pErr) throw new Error(pErr.message)
    closed.push(built)
  }

  await sb.from('salary_periods').upsert({
    period,
    closed_at: new Date().toISOString(),
    confirm_deadline: confirmDeadline,
    pay_date: payDate,
    status: 'closed',
  }, { onConflict: 'period' })

  return {
    period,
    monthStart,
    monthEnd,
    closeDate,
    payDate,
    confirmDeadline,
    closed,
    skippedPaid,
    wrotePayments: false,
  }
}

export async function refreshEmployeeClose(sb, emp, period) {
  return closePayrollMonth(sb, period, { employeeId: emp.id })
}

/** Creates salary_payments from a closed payroll row. Does not recalculate. */
export async function payClosedPayroll(sb, period, { employeeId, salaryDesc } = {}) {
  const { payDate } = getPeriodDates(period)
  let q = sb.from('payroll').select('*').eq('period', period)
  if (employeeId) q = q.eq('employee_id', employeeId)
  const { data: rows, error } = await q
  if (error) throw new Error(error.message)
  const unpaid = (rows || []).filter(r => r.status !== 'paid')
  if (!unpaid.length) return { period, paid: [], skipped: rows || [] }
  const desc = salaryDesc || `Salary ${period}`
  const paid = []
  for (const row of unpaid) {
    const payment = buildSalaryPayment(row, { payDate, salaryDesc: desc })
    const sErr = await upsertByKeys(sb, 'salary_payments', payment, {
      employee_id: row.employee_id,
      period,
      payment_type: 'salary',
    })
    if (sErr) throw new Error(sErr.message)
    const { error: u } = await sb.from('payroll').update({
      status: 'paid',
      paid_at: new Date().toISOString(),
    }).eq('id', row.id)
    if (u) throw new Error(u.message)
    paid.push({ payrollId: row.id, amount: payment.amount, payment_date: payDate })
  }
  return { period, payDate, paid, wroteClose: false }
}
