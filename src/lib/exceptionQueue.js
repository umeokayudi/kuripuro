// v1.0.110 · ONE queue of exceptions for the owner, ordered by urgency; every row carries the action
// that resolves it. It lives in the bell ("Waiting for you"). Pure builder + one fetch.
import { supabase } from './supabase'
import { tokyoToday } from './dates'
import { addDays } from './schedulePlan'
import { isMissedJob, hoursPastScheduled, hoursPastDue } from './jobOverdue'
import { isDeadlineJob, isDeadlineLate, deadlineOf } from './jobDeadline.js'
import { jobMinutes } from './salaryCalc'
import { expectedMinutes, contractForAgendaJob } from './agenda'
import { isTestName } from './testData'
import { problemJobId } from './fieldExec'
import { coveredJobs } from './jobCoverage.js'

const JOB_COLS = 'id,title,description,admin_reviewed,client_id,client_name,employee_id,employee_name,status,scheduled_date,scheduled_time,started_at,completed_at,retro_time_min,photo_start_url,photo_end_url,photo_ai_score,photo_ai_approved,job_category,retro_report'

export const URGENCY = { retro_review: 65, late: 95, covered: 88, no_person: 90, problem: 85, incomplete: 80, disputed: 75, paid_unconfirmed: 72, payroll_review: 70, long: 60, no_photo: 50, ai_waiting: 30 }

const place = j => String(j?.title || '').split(' — ')[0]

// v1.0.115 · job exceptions that need a decision have an owner and a deadline (days after the job date).
// incomplete → the office closes or reschedules it by the next day; long (> 2× planned) → the office
// reviews it with the employee within 3 days. Past the deadline the row goes up the queue as "vencido".
export const EXCEPTION_RULES = { incomplete: { owner: 'office', dueDays: 1 }, long: { owner: 'office', dueDays: 3 } }
export function withDeadline(kind, date, today) {
  const rule = EXCEPTION_RULES[kind]
  if (!rule || !date) return {}
  const due = addDays(date, rule.dueDays)
  return { owner: rule.owner, due, overdue: today > due }
}

/**
 * jobs: last 14 days → next 2 days; contracts for the expected duration; payroll: { autoClosed, disputed, paidUnconfirmed }.
 * Returns [{ id, kind, urgency, date, place, who, jobId, owner?, due?, overdue? }] sorted most urgent first.
 */
export function buildExceptions({ jobs = [], contracts = [], payroll = {}, problems = [], today = tokyoToday(), now = new Date(), hideTests = true }) {
  const out = []
  const push = (kind, j, extra) => {
    const dl = withDeadline(kind, j?.scheduled_date, today)
    out.push({ id: `${kind}:${j?.id || extra.key}`, kind, urgency: URGENCY[kind] + (dl.overdue ? 10 : 0), date: j?.scheduled_date || '', place: j ? place(j) : '', who: j?.employee_name || '', jobId: j?.id || null,
      // v1.0.151 · what the bell card needs to be told apart without opening it: service type + the event's own time
      title: j?.title || '', time: j?.scheduled_time ? String(j.scheduled_time).slice(0, 5) : '', at: j?.completed_at || j?.started_at || null, ...dl, ...extra })
  }
  // v1.0.148 · B did A's service: A is not late / incomplete — the owner decides [Retirar de A] / [Manter em A]
  const cov = coveredJobs(jobs)
  for (const j of jobs) {
    if (j.status === 'cancelled') continue
    if (cov.has(j.id)) {
      const b = cov.get(j.id)
      if (!(hideTests && (isTestName(j.employee_name) || isTestName(j.client_name)))) push('covered', j, { by: b.employee_name || '—', byJob: b, job: j, employeeId: j.employee_id })
      continue
    }
    if (hideTests && (isTestName(j.employee_name) || isTestName(j.client_name))) continue
    const done = j.status === 'completed'
    if (!done && !j.employee_id && j.scheduled_date >= today && j.scheduled_date <= addDays(today, 1)) push('no_person', j, {})
    // v1.0.147 · OTP night jobs: late only when not finished at 10:00 (running too), measured from 10:00
    else if (isDeadlineJob(j) ? (j.scheduled_date === today && isDeadlineLate(j, { now })) : (!done && j.status === 'assigned' && !j.started_at && j.scheduled_date === today && hoursPastScheduled(j, now) >= 0.5)) push('late', j, { minutes: Math.round(hoursPastDue(j, now) * 60), ...(isDeadlineJob(j) ? { deadline: deadlineOf(j) } : {}) })
    else if (isMissedJob(j, now) && j.scheduled_date >= addDays(today, -14)) push('incomplete', j, {})
    // v1.0.151 · retroactive registration ("já concluído") waiting for the admin's review — was only in Ao vivo
    if (j.retro_report != null && !j.admin_reviewed && j.scheduled_date >= addDays(today, -14)) push('retro_review', j, { at: j.completed_at || null })
    // v1.0.149 · the admin already checked this finished job (accepted without photo / reviewed): nothing left to do
    if (done && j.admin_reviewed) continue
    if (done && j.scheduled_date >= addDays(today, -7)) {
      if (!j.photo_end_url) push('no_photo', j, {})
      else if (j.photo_end_url && j.photo_ai_score == null && j.scheduled_date >= addDays(today, -3)) push('ai_waiting', j, {})
      const expected = expectedMinutes(j, contractForAgendaJob(j, contracts))
      const real = jobMinutes(j)
      if (expected && real > 2 * expected) push('long', j, { minutes: Math.round(real), expected })
    }
  }
  // v1.0.112 · "Report a problem" from the job, still unread in the office chat
  for (const m of problems) {
    if (hideTests && isTestName(m.employee_name)) continue
    const head = String(m.content || '').split('\n')
    push('problem', null, { key: m.id, who: m.employee_name, employeeId: m.employee_id, place: head[0].replace(/^🛠\s*/, ''), text: head[1] || '', jobId: problemJobId(m.content), date: String(m.created_at || '').slice(0, 10), at: m.created_at || null })
  }
  for (const p of payroll.autoClosed || []) push('payroll_review', null, { key: p.period, period: p.period, date: p.period })
  for (const s of payroll.disputed || []) push('disputed', null, { key: s.id, who: s.employee_name, period: s.period, date: s.period })
  for (const s of payroll.paidUnconfirmed || []) push('paid_unconfirmed', null, { waiting: true, key: s.id, who: s.employee_name, period: s.period, date: s.period })
  return out.sort((a, b) => b.urgency - a.urgency || String(a.date).localeCompare(String(b.date)))
}

export async function fetchExceptions({ hideTests = true } = {}) {
  const today = tokyoToday()
  const [jobs, contracts, periods, disputed, paidLines, statements, problems] = await Promise.all([
    supabase.from('jobs').select(JOB_COLS).gte('scheduled_date', addDays(today, -31)).lte('scheduled_date', addDays(today, 1)).limit(3000),
    supabase.from('service_contracts').select('location_name,hours_per_visit,service_type').eq('is_active', true),
    supabase.from('salary_periods').select('period,status').eq('status', 'auto_closed'),
    supabase.from('salary_statements').select('id,employee_name,period').not('employee_disputed_at', 'is', null).is('employee_confirmed_at', null),
    supabase.from('salary_payments').select('employee_id,employee_name,period').eq('payment_type', 'salary').eq('status', 'paid').gte('payment_date', addDays(today, -60)),
    supabase.from('salary_statements').select('employee_id,period,employee_confirmed_at').gte('period', addDays(today, -90).slice(0, 7)),
    supabase.from('messages').select('id,employee_id,employee_name,content,created_at').eq('sender', 'employee').eq('read', false).like('content', '%#job:%').gte('created_at', addDays(today, -7)).limit(100),
  ])
  const confirmed = new Set((statements.data || []).filter(s => s.employee_confirmed_at).map(s => `${s.employee_id}:${s.period}`))
  const paidUnconfirmed = (paidLines.data || []).filter(l => !confirmed.has(`${l.employee_id}:${l.period}`)).map(l => ({ id: `${l.employee_id}:${l.period}`, ...l }))
  return buildExceptions({
    jobs: jobs.data || [], contracts: contracts.data || [], hideTests, problems: problems.data || [],
    payroll: { autoClosed: periods.data || [], disputed: disputed.data || [], paidUnconfirmed },
  })
}

/**
 * v1.0.123 · The bell shows many exceptions of the same kind as ONE card ("11 never started —
 * review"), not 11 cards. Kinds about a job group from `min` items on; the group keeps the urgency
 * of its most urgent item and lists the dates, the people and the items to review one by one.
 */
const GROUPABLE = new Set(['incomplete', 'no_photo', 'ai_waiting', 'long'])
export function groupExceptions(list = [], { min = 3 } = {}) {
  const byKind = {}
  for (const x of list) if (GROUPABLE.has(x.kind)) (byKind[x.kind] = byKind[x.kind] || []).push(x)
  const out = []
  const done = new Set()
  for (const x of list) {
    if (done.has(x.kind)) continue
    const same = byKind[x.kind]
    if (same && same.length >= min) {
      done.add(x.kind)
      const dates = same.map(i => i.date).filter(Boolean).sort()
      out.push({
        id: `group:${x.kind}`, kind: x.kind, group: true, items: same, urgency: Math.max(...same.map(i => i.urgency)),
        from: dates[0] || '', to: dates[dates.length - 1] || '', who: [...new Set(same.map(i => i.who).filter(Boolean))],
        overdue: same.some(i => i.overdue),
      })
    } else out.push(x)
  }
  return out.sort((a, b) => b.urgency - a.urgency || String(a.date || a.from).localeCompare(String(b.date || b.from)))
}
