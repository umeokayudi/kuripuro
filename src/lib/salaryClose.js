// Payroll close shared by the admin page (manual button) and the daily cron (automatic).
// Takes any Supabase client: the browser one or the server one with the service role.
import { getPeriodDates } from './salaryPeriod.js'
import { monthBase, payrollMonth, canCloseMonth } from './salaryCalc.js'
import { ensureServiceReports } from './jobReport.js'

const tokyoToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())

export function previousPeriod(today = tokyoToday()) {
  const [y, m] = today.slice(0, 7).split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

/** Last day the cron may still close last month on its own: staff confirm until the 5th. */
export const AUTO_CLOSE_LAST_DAY = 5

export function computeBase(emp, jobs, period) {
  return monthBase(emp, jobs, period)
}

/** v1.0.102 · Who is in a payroll: every employee not switched off (is_active true OR empty). */
export const isPayrollActive = emp => emp?.is_active !== false

/**
 * v1.0.102 · ONE state for the salary of a person in a month, read by Payments, Payroll close and the
 * month list, so "Paid" and the payslip can never say different things.
 *  none        not calculated yet
 *  waiting     payslip sent, employee has not confirmed
 *  disputed    employee disputed it
 *  confirmed   employee confirmed (admin may finalize and pay)
 *  finalized   admin finalized after the confirmation
 *  paid        paid AND confirmed
 *  paid_unconfirmed  marked paid while the payslip is still not confirmed (old data) — needs a look
 */
export function payrollState(statement, salaryLine) {
  const slip = !statement ? 'none'
    : statement.employee_confirmed_at ? 'confirmed'
    : (statement.employee_disputed_at || statement.status === 'disputed') ? 'disputed'
    : 'waiting'
  const paid = salaryLine?.status === 'paid'
  if (paid) return slip === 'confirmed' ? 'paid' : 'paid_unconfirmed'
  if (slip === 'confirmed' && statement.status === 'finalized') return 'finalized'
  return slip
}

/**
 * Close one month: period row, one payslip per active employee and the scheduled salary payment.
 * auto=true marks the period 'auto_closed' so the admin bell asks for a review.
 */
export async function closeSalaryPeriod(db, period, { auto = false, salaryDesc = `Salary ${period}`, today } = {}) {
  // v1.0.108 · a month closes only from the 1st of the following month.
  if (!canCloseMonth(period, today)) throw new Error(`${period} can only be closed from the 1st of the next month`)
  const { confirmDeadline, payDate } = getPeriodDates(period)
  const { error: periodErr } = await db.from('salary_periods').upsert({
    period, closed_at: new Date().toISOString(), confirm_deadline: confirmDeadline,
    pay_date: payDate, status: auto ? 'auto_closed' : 'closed',
  }, { onConflict: 'period' })
  if (periodErr) throw periodErr

  // v1.0.102 · Everyone not switched off (is_active empty counts as active, as in Payments), and one
  // person failing never stops the others: who stayed out is returned with the reason.
  const { data: all, error: empErr } = await db.from('employees').select('*')
  if (empErr) throw empErr
  const employees = (all || []).filter(isPayrollActive)

  let total = 0
  let kept = 0
  const failed = []
  for (const emp of employees) {
    try {
      const res = await closeEmployeeMonth(db, period, emp, { salaryDesc })
      if (res.kept) kept++
      total += res.net
    } catch (e) {
      failed.push({ id: emp.id, name: emp.full_name, error: e?.message || String(e) })
    }
  }
  return { period, employees: employees.length, total, kept, failed, confirmDeadline, payDate }
}

/**
 * Payslip + scheduled salary of one person for one month (used by the month close and by the
 * per-employee close screen in Payments). A month already paid is never touched again, and a payslip
 * the employee already confirmed keeps its confirmation when the amount did not change.
 * @returns {{ net: number, base: number, dedTotal: number, jobs: number, kept: boolean }}
 */
export async function closeEmployeeMonth(db, period, emp, { salaryDesc = `Salary ${period}` } = {}) {
  if (!canCloseMonth(period)) throw new Error(`${period} can only be closed from the 1st of the next month`)
  const { closeDate, payDate } = getPeriodDates(period)
  const { data: existing } = await db.from('salary_payments')
    .select('id,status,amount').eq('employee_id', emp.id).eq('period', period).eq('payment_type', 'salary').limit(1)
  // A month already paid is never recalculated — except a salary "paid" at ¥0, which was never a
  // real payment (old close of a fixed salary without jobs): it is recalculated and opened again.
  const paidZero = existing?.[0]?.status === 'paid' && Number(existing[0].amount || 0) === 0
  if (existing?.[0]?.status === 'paid' && !paidZero) {
    return { net: Number(existing[0].amount || 0), base: null, dedTotal: null, jobs: null, kept: true }
  }

  const { data: jobs, error: jobsErr } = await db.from('jobs').select('*')
    .eq('employee_id', emp.id).eq('status', 'completed')
    .gte('scheduled_date', `${period}-01`).lte('scheduled_date', closeDate)
  if (jobsErr) throw jobsErr
  // Every job paid here also has its service report (same rule as billing).
  await ensureServiceReports(db, jobs).catch(() => {})

  const { data: lines } = await db.from('salary_payments').select('*')
    .eq('employee_id', emp.id).eq('period', period)

  // v1.0.108 · the same calculation every screen shows (base + jobs − deductions).
  const calc = payrollMonth({ emp, jobs: jobs || [], lines: lines || [], month: period })
  const base = calc.base
  const dedTotal = calc.deductions
  const net = calc.net

  const { data: prev } = await db.from('salary_statements').select('*')
    .eq('period', period).eq('employee_id', emp.id).limit(1)
  const old = prev?.[0]
  const same = old && Number(old.net_total) === net && Number(old.base_salary) === base && Number(old.deductions) === dedTotal
  const statement = {
    period, employee_id: emp.id, employee_name: emp.full_name,
    base_salary: base, deductions: dedTotal, net_total: net,
    breakdown: { jobs: calc.jobs, jobs_pay: calc.jobsPay, salary_type: emp.salary_type },
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
  return { net, base, dedTotal, jobsPay: calc.jobsPay, jobs: calc.jobs, kept: false }
}

/**
 * v1.0.108 · The ONE text for a payrollState, used by Fechar folha, Payments and the payslip sheet:
 * a pagar → confirmado pelo funcionário → pago. "Pago" without the confirmation is flagged, never shown as paid.
 * `tr` is useLang().tr. Returns { text, tone } with tone green / amber / red.
 */
export function payStateText(state, tr, paidOn = '') {
  switch (state) {
    case 'paid': return { text: tr(`Paid${paidOn ? ` on ${paidOn}` : ''}`, `支払済${paidOn ? `（${paidOn}）` : ''}`, `Pago${paidOn ? ` em ${paidOn}` : ''}`), tone: 'green' }
    case 'finalized':
    case 'confirmed': return { text: tr('Confirmed by the employee — to pay', '本人確認済み — 支払待ち', 'Confirmado pelo funcionário — a pagar'), tone: 'green' }
    case 'waiting': return { text: tr('To pay — waiting for the employee to confirm', '支払予定 — 本人の確認待ち', 'A pagar — esperando o funcionário confirmar'), tone: 'amber' }
    case 'disputed': return { text: tr('Disputed by the employee — answer in Salary issues', '本人が異議 — 給与の問題で回答', 'Contestado — responda em Problemas de salário'), tone: 'red' }
    case 'paid_unconfirmed': return { text: tr('Marked paid WITHOUT the employee’s confirmation — check', '本人確認なしで支払済 — 要確認', 'Marcado pago SEM confirmação do funcionário — conferir'), tone: 'red' }
    default: return { text: tr('No payslip yet', '明細なし', 'Sem holerite ainda'), tone: 'amber' }
  }
}
