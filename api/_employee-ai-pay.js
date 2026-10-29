// What the employee AI may say about money on a job: only what the employee earns.
// jobs.value / retro_value are what the CLIENT pays and must never reach the employee;
// spot_value is the employee's own extra for a spot job. A fixed-salary employee earns
// per day, not per job, so their jobs carry no amount at all (only a spot extra, if any).

import { jobEarnings } from '../src/lib/earnings.js'

export const JOB_MONEY_COLUMNS = ['value', 'retro_value', 'spot_value']

// What a job row says when the AI asks for "*": enough to answer, without photo lists,
// checklists and GPS points that made every answer slower (more text for the model to read).
const DEFAULT_JOB_COLUMNS = 'id,title,client_name,scheduled_date,scheduled_time,address,status,started_at,completed_at,job_category,spot_status,description,instructions,materials,notes_employee'

const storeOf = title => String(title || '').replace(/ — .*/, '').trim().toLowerCase()

/** Scheduled jobs often have value 0; the price per visit comes from the store's contract. */
function withContractValue(job, priceByStore) {
  if (Number(job.value) > 0 || Number(job.retro_value) > 0) return job
  const price = priceByStore[storeOf(job.title)]
  return price ? { ...job, value: price } : job
}

const spotExtra = job => (job.job_category === 'spot' ? Number(job.spot_value || 0) : 0)

/** Pay for a job that is not done yet, when it does not depend on the time worked. */
function expectedPay(job, emp) {
  const type = emp?.salary_type || 'fixed'
  const clientValue = Number(job.retro_value ?? job.value ?? 0)
  if (type === 'per_job') return Math.round(clientValue * ((emp?.job_bonus_rate || 100) / 100)) + spotExtra(job)
  if (type === 'mixed') return Math.round(clientValue * ((emp?.job_bonus_rate || 0) / 100)) + spotExtra(job)
  return spotExtra(job)
}

/**
 * rows: jobs rows read with select "*". columns: what the AI asked for ('*' or a list).
 * Returns the rows with the client amounts removed and my_pay / my_pay_expected added.
 */
export function employeeJobRows(rows, emp, columns = '*', contracts = []) {
  if (!Array.isArray(rows)) return rows
  const priceByStore = {}
  for (const c of contracts || []) {
    if (c.location_name) priceByStore[c.location_name.trim().toLowerCase()] = Number(c.price_per_visit || 0)
  }
  const wanted = new Set((columns === '*' ? DEFAULT_JOB_COLUMNS : columns).split(','))
  return rows.map(raw => {
    const job = withContractValue(raw, priceByStore)
    const out = {}
    for (const [key, value] of Object.entries(raw)) {
      if (JOB_MONEY_COLUMNS.includes(key)) continue
      if (!wanted.has(key)) continue
      out[key] = value
    }
    const pay = job.status === 'completed' ? jobEarnings(job, emp) : expectedPay(job, emp)
    if (pay > 0) out[job.status === 'completed' ? 'my_pay' : 'my_pay_expected'] = pay
    return out
  })
}

/** Tells the model how this employee is paid and what it may say about money. */
export function payRule(emp) {
  const type = emp?.salary_type || 'fixed'
  const base = `MONEY ON JOBS (always applies):
- Job rows never include what the client pays. Never state, estimate or guess a job's price, value or the client's amount.
- my_pay is what this employee earned from a completed job; my_pay_expected is what a job not done yet should pay. Only these may be shown as money for a job.`
  if (type === 'fixed') {
    return `${base}
- This employee has a FIXED MONTHLY SALARY. Do not show any amount per job (only my_pay / my_pay_expected when present, which is a spot extra). For salary questions use salary_statements and salary_payments.`
  }
  if (type === 'hourly') {
    return `${base}
- This employee is paid by the hour; pay for a job that is not done yet depends on the time worked, so do not estimate it.`
  }
  if (type === 'mixed') {
    return `${base}
- This employee has a monthly base plus a share of each job; my_pay and my_pay_expected are only the job share (the monthly base is not per job).`
  }
  return base
}
