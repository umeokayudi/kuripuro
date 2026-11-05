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
  // v1.0.148 · until the field is filled (SQL + one-off migration), the line already written in the
  // description ("Pagamento do funcionário (Nome): ¥X") is the job's pay — the same value the migration writes.
  if (v === null || v === undefined || v === '') return payFromDescription(job?.description)
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

// ─────────────────────────────────────────────────────────────────────────────
// v1.0.157 · Monthly package ("Pacote mensal"): the worker is paid per month for a set of services
// (OTP maintenances ¥50.000/mês, Atomic Bar ¥35.000/mês). Per service there is no own value: the
// employee sees "Pacote mensal", never a sliced ¥1.470/¥1.471. Read from jobs.employee_pay_package when
// that column exists, else from the description ("pacote ... ¥50.000/mês").
// ─────────────────────────────────────────────────────────────────────────────
const PACKAGE_RE = /pacote[^|\n]*?¥\s*[0-9][0-9.,]*\s*\/\s*m[eê]s/i

/** Package text of a job ("pacote de manutenções OTP ¥50.000/mês") or null. */
export function jobPayPackage(job) {
  if (job?.employee_pay_package) return String(job.employee_pay_package)
  const m = String(job?.description || '').match(PACKAGE_RE)
  return m ? m[0].replace(/^\(?/, '').trim() : null
}

/** 'spot' | 'package' | 'defined' | 'undefined' — what the worker earns for this job. */
export function payKind(job) {
  if (job?.job_category === 'spot') return 'spot'
  if (jobPayPackage(job)) return 'package'
  return jobEmployeePay(job) === null ? 'undefined' : 'defined'
}

/**
 * v1.0.157 · Rule 4: a job with the worker's pay still "a definir" must not stay invisible — a finished
 * job (or one of today) with a person and no pay goes to the bell until the owner defines it.
 */
export function needsPayDefinition(job, today) {
  if (!job || job.status === 'cancelled' || !job.employee_id) return false
  if (!(job.status === 'completed' || job.scheduled_date === today)) return false
  return payKind(job) === 'undefined'
}

/** Description without the worker-pay / package sentences (shown to the employee). */
export function stripPayText(text) {
  return String(text || '')
    .replace(/Pagamento do funcion[áa]rio \([^)]*\):\s*¥\s*[0-9][0-9.,]*(?:\s*[—-]\s*.*?)?(?=\s*\||Key box|\n|$)/gi, '')
    .replace(/Pacote [^|\n]*?¥\s*[0-9][0-9.,]*\s*\/\s*m[eê]s.*?(?=\s*\||Key box|\n|$)/gi, '')
    .replace(/^[\s|]+/gm, '')
    .replace(/[ \t]*\|[ \t]*\|/g, ' |')
    .trim()
}

// Columns the client pays (never sent to an employee screen).
export const CLIENT_MONEY_COLUMNS = ['value', 'retro_value']
// Every jobs column an employee screen may read. Columns from SQL not yet applied are probed once.
const EMPLOYEE_JOB_BASE = 'id,title,client_id,client_name,employee_id,employee_name,scheduled_date,scheduled_time,address,gps_lat,gps_lng,description,checklist_template,photo_required,status,started_at,completed_at,notes_employee,photo_start_url,photo_end_url,created_at,job_category,spot_value,spot_status,spot_responded_at,counts_as_work_day,materials,reference_photos,instructions,sequence_order,gps_end_distance,gps_override,gps_start_distance,checklist_total,checklist_done,checklist_missed_items,photo_ai_score,photo_ai_approved,photo_ai_issues,signature_url,retro_report,retro_ai_summary,retro_time_min,admin_reviewed,start_lat,start_lng,start_accuracy,end_lat,end_lng,end_accuracy,area,closed_manually_by,closed_manually_at,closed_manually_note'
const OPTIONAL_COLS = ['employee_pay', 'employee_pay_package', 'location_id', 'expected_minutes']
let colsPromise = null
/** "id,title,…" for employee queries: everything except what the client pays. */
export function employeeJobColumns(db) {
  if (!colsPromise) {
    colsPromise = Promise.all(OPTIONAL_COLS.map(c => db.from('jobs').select(c).limit(1).then(r => (r.error ? null : c), () => null)))
      .then(list => [EMPLOYEE_JOB_BASE, ...list.filter(Boolean)].join(','))
      .catch(() => EMPLOYEE_JOB_BASE)
  }
  return colsPromise
}
/** Forget the probed columns (after an SQL is applied in this tab). */
export const resetEmployeeJobColumns = () => { colsPromise = null }

/**
 * What an employee screen keeps of a job: no client money, the worker's own pay resolved
 * (field, else the description line), a package as "Pacote mensal" with no sliced value,
 * and the description without the pay sentences.
 */
export function employeeSafeJob(job) {
  if (!job) return job
  const { value, retro_value, ...rest } = job // eslint-disable-line no-unused-vars
  const pkg = jobPayPackage(job)
  return {
    ...rest,
    employee_pay: pkg ? null : jobEmployeePay(job),
    employee_pay_package: pkg ? 'monthly' : null,
    description: stripPayText(job.description),
  }
}

/** Monthly total for the employee screen: done (completed) and planned (all jobs of the month). Packages apart. */
export function employeeMonthPay(jobs = [], month) {
  const mine = (jobs || []).filter(j => String(j.scheduled_date || '').startsWith(month) && j.status !== 'cancelled' && j.job_category !== 'spot')
  const perJob = mine.filter(j => payKind(j) !== 'package')
  const sum = list => list.reduce((s, j) => s + (jobEmployeePay(j) || 0), 0)
  const done = perJob.filter(j => j.status === 'completed')
  return {
    done: sum(done),
    planned: sum(perJob),
    undefinedCount: perJob.filter(j => !hasEmployeePay(j)).length,
    packageJobs: mine.length - perJob.length,
    any: perJob.some(hasEmployeePay) || mine.length > perJob.length,
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
