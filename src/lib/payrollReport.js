import { jobEmployeePay, parseEmployeePay } from './jobEmployeePay.js'
import { isDeepCleanJob, locationNameFromTitle } from './cleaningType.js'
import { jobMinutes, payrollMonth, spotExtra } from './salaryCalc.js'

// v1.0.209 · Folha → relatório: every completed job of the month with date and the value the admin pays
// ("Pagamento do funcionário"), editable before sending. Values typed here are saved on the job
// (jobs.employee_pay, audited), so Meu salário, holerite PDF, Pagamentos and Salário all read the same number.

/** Kind of a job for the quick fill: 'deep' | 'basic' | 'spot'. */
export function jobKind(job) {
  if (job?.job_category === 'spot') return 'spot'
  return isDeepCleanJob(job) ? 'deep' : 'basic'
}

/** Kind label shown on the row: the part after "—" in the title (Basic Cleaning, Deep Clean (…)). */
export function kindLabel(job) {
  const parts = String(job?.title || '').split(' — ')
  return parts.length > 1 ? parts.slice(1).join(' — ') : ''
}

/**
 * Rows of the report. `edits` = { [jobId]: string } typed values not saved yet ('' = a definir).
 * Each row: { id, date, place, kind, kindText, hours, saved, value, pay, dirty, spot }
 */
export function reportRows(jobs = [], edits = {}) {
  return (jobs || [])
    .filter(j => j.status === 'completed')
    .slice()
    .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)) || String(a.scheduled_time || '').localeCompare(String(b.scheduled_time || '')) || String(a.title).localeCompare(String(b.title)))
    .map(j => {
      const saved = jobEmployeePay(j)
      const has = Object.prototype.hasOwnProperty.call(edits, j.id)
      let pay = saved
      let bad = false
      if (has) {
        try { pay = parseEmployeePay(edits[j.id]) } catch { pay = null; bad = true }
      }
      return {
        id: j.id, job: j, date: j.scheduled_date, place: locationNameFromTitle(j.title) || j.title || '—',
        kind: jobKind(j), kindText: kindLabel(j), hours: jobMinutes(j) / 60,
        saved, pay, bad, value: has ? edits[j.id] : (saved === null ? '' : String(saved)),
        dirty: has && pay !== saved, spot: spotExtra(j),
      }
    })
}

/** Fill only the jobs with no value yet: { basic, deep } in ¥ (empty = leave). Returns new edits. */
export function fillEmpty(rows, edits, { basic = '', deep = '' } = {}) {
  const next = { ...edits }
  for (const r of rows) {
    if (r.pay !== null || r.kind === 'spot') continue
    const v = r.kind === 'deep' ? deep : basic
    if (String(v).trim() !== '') next[r.id] = String(v)
  }
  return next
}

/** Jobs with the typed values applied (to preview the payslip before saving). */
export function jobsWithEdits(jobs = [], edits = {}) {
  return (jobs || []).map(j => {
    if (!Object.prototype.hasOwnProperty.call(edits, j.id)) return j
    let pay = null
    try { pay = parseEmployeePay(edits[j.id]) } catch { pay = null }
    return { ...j, employee_pay: pay, description: j.description }
  })
}

/** Payslip preview with the typed values (same payrollMonth as every screen). */
export function previewMonth({ emp, jobs, lines, month, basis, edits = {} }) {
  return payrollMonth({ emp, jobs: jobsWithEdits(jobs, edits), lines, month, basis })
}
