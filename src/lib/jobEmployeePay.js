// v1.0.131 · "Pagamento do funcionário (¥)" of one job — what the scheduled employee earns for it.
// Separate from jobs.value (the store's contract price), which this never touches.
// Empty = "a definir" (to be defined), never ¥0. Columns + audit come from
// sql/2026-11-02_pagamento_funcionario_job.sql; until it runs, everything here reads as "a definir".

/** null when empty; otherwise a whole yen amount ≥ 0. Throws 'negative' / 'invalid'. */
export function parseEmployeePay(input) {
  if (input === null || input === undefined) return null
  const raw = String(input).trim()
  if (!raw) return null
  if (/^-/.test(raw)) throw new Error('negative')
  // "1.000" / "1,000" / "¥1000" → 1000
  const digits = raw.replace(/[¥￥\s]/g, '').replace(/[.,](?=\d{3}(\D|$))/g, '')
  if (!/^\d+$/.test(digits)) throw new Error('invalid')
  return Number(digits)
}

/** The job's employee pay as a number, or null ("a definir"). */
export function jobEmployeePay(job) {
  const v = job?.employee_pay
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export const hasEmployeePay = job => jobEmployeePay(job) !== null

/** "Pagamento do funcionário (Gabriel): ¥3.125 — ..." in a description → 3125 (null when absent). */
export function payFromDescription(text) {
  const m = String(text || '').match(/Pagamento do funcion[áa]rio \([^)]*\):\s*¥\s*([0-9][0-9.,]*)/)
  if (!m) return null
  try { return parseEmployeePay(m[1]) } catch { return null }
}

/** Sum of employee_pay of the completed jobs + the list (date, store) for the payroll. */
export function perJobPay(jobs = []) {
  const done = (jobs || []).filter(j => j.status === 'completed')
  const rows = done
    .map(j => ({ id: j.id, date: j.scheduled_date, title: j.title, pay: jobEmployeePay(j) }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.title).localeCompare(String(b.title)))
  const priced = rows.filter(r => r.pay !== null)
  return {
    total: priced.reduce((s, r) => s + r.pay, 0),
    rows,
    priced: priced.length,
    undefinedCount: rows.length - priced.length,
  }
}

/** Monthly total for the employee screen: done (completed) and planned (all jobs of the month). */
export function employeeMonthPay(jobs = [], month) {
  const mine = (jobs || []).filter(j => String(j.scheduled_date || '').startsWith(month) && j.status !== 'cancelled')
  const sum = list => list.reduce((s, j) => s + (jobEmployeePay(j) || 0), 0)
  const done = mine.filter(j => j.status === 'completed')
  return {
    done: sum(done),
    planned: sum(mine),
    undefinedCount: mine.filter(j => !hasEmployeePay(j)).length,
    any: mine.some(hasEmployeePay),
  }
}

const adminName = () => {
  try { return JSON.parse(localStorage.getItem('kp_user') || '{}').name || 'admin' } catch { return 'admin' }
}

export const isMissingColumn = err => /employee_pay|payroll_pay_basis|schema cache|does not exist/i.test(err?.message || '')

/**
 * Admin saves the pay of one job. Writes who changed it (employee_pay_updated_by); the database
 * trigger records old/new/who/when in job_pay_audit when the job was already completed.
 * Never touches jobs.value.
 */
export async function saveJobEmployeePay(db, job, input) {
  const pay = parseEmployeePay(input)
  const { data, error } = await db.from('jobs')
    .update({ employee_pay: pay, employee_pay_updated_by: adminName() })
    .eq('id', job.id).select('*').maybeSingle()
  if (error) throw error
  return data || { ...job, employee_pay: pay }
}

export async function loadJobPayAudit(db, jobId) {
  const { data, error } = await db.from('job_pay_audit').select('*').eq('job_id', jobId).order('changed_at', { ascending: false })
  return error ? [] : (data || [])
}

/** Payroll choice per person for a month: { [employee_id]: row }. Empty when the table is missing. */
export async function loadPayBasis(db, period, employeeId = null) {
  let q = db.from('payroll_pay_basis').select('*').eq('period', period)
  if (employeeId) q = q.eq('employee_id', employeeId)
  const { data, error } = await q
  if (error) return {}
  return Object.fromEntries((data || []).map(r => [r.employee_id, r]))
}

export async function savePayBasis(db, { employeeId, period, basis, fixedTotal, perJobTotal }) {
  const row = {
    employee_id: employeeId, period, basis,
    fixed_total: Math.round(fixedTotal || 0), per_job_total: Math.round(perJobTotal || 0),
    chosen_by: adminName(), chosen_at: new Date().toISOString(),
  }
  const { data, error } = await db.from('payroll_pay_basis').upsert(row, { onConflict: 'employee_id,period' }).select('*').maybeSingle()
  if (error) throw error
  return data || row
}
