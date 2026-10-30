// v1.0.110 · ONE queue of exceptions for the owner, ordered by urgency; every row carries the action
// that resolves it. It lives in the bell ("Waiting for you"). Pure builder + one fetch.
import { supabase } from './supabase'
import { tokyoToday } from './dates'
import { addDays } from './schedulePlan'
import { isMissedJob, hoursPastScheduled } from './jobOverdue'
import { jobMinutes } from './salaryCalc'
import { expectedMinutes, contractForAgendaJob } from './agenda'
import { isTestName } from './testData'
import { problemJobId } from './fieldExec'

const JOB_COLS = 'id,title,client_name,employee_id,employee_name,status,scheduled_date,scheduled_time,started_at,completed_at,retro_time_min,photo_start_url,photo_end_url,photo_ai_score,photo_ai_approved,job_category'

export const URGENCY = { late: 95, no_person: 90, problem: 85, incomplete: 80, disputed: 75, paid_unconfirmed: 72, payroll_review: 70, long: 60, no_photo: 50, ai_waiting: 30 }

const place = j => String(j?.title || '').split(' — ')[0]

/**
 * jobs: last 14 days → next 2 days; contracts for the expected duration; payroll: { autoClosed, disputed, paidUnconfirmed }.
 * Returns [{ id, kind, urgency, title, detail, date, action: { label, to } }] sorted most urgent first.
 */
export function buildExceptions({ jobs = [], contracts = [], payroll = {}, problems = [], today = tokyoToday(), now = new Date(), hideTests = true }) {
  const out = []
  const push = (kind, j, extra) => out.push({ id: `${kind}:${j?.id || extra.key}`, kind, urgency: URGENCY[kind], date: j?.scheduled_date || '', place: j ? place(j) : '', who: j?.employee_name || '', jobId: j?.id || null, ...extra })
  for (const j of jobs) {
    if (j.status === 'cancelled') continue
    if (hideTests && (isTestName(j.employee_name) || isTestName(j.client_name))) continue
    const done = j.status === 'completed'
    if (!done && !j.employee_id && j.scheduled_date >= today && j.scheduled_date <= addDays(today, 1)) push('no_person', j, {})
    else if (!done && j.status === 'assigned' && !j.started_at && j.scheduled_date === today && hoursPastScheduled(j, now) >= 0.5) push('late', j, { minutes: Math.round(hoursPastScheduled(j, now) * 60) })
    else if (isMissedJob(j, now) && j.scheduled_date >= addDays(today, -14)) push('incomplete', j, {})
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
    push('problem', null, { key: m.id, who: m.employee_name, employeeId: m.employee_id, place: head[0].replace(/^🛠\s*/, ''), text: head[1] || '', jobId: problemJobId(m.content), date: String(m.created_at || '').slice(0, 10) })
  }
  for (const p of payroll.autoClosed || []) push('payroll_review', null, { key: p.period, period: p.period, date: p.period })
  for (const s of payroll.disputed || []) push('disputed', null, { key: s.id, who: s.employee_name, period: s.period, date: s.period })
  for (const s of payroll.paidUnconfirmed || []) push('paid_unconfirmed', null, { key: s.id, who: s.employee_name, period: s.period, date: s.period })
  return out.sort((a, b) => b.urgency - a.urgency || String(a.date).localeCompare(String(b.date)))
}

export async function fetchExceptions({ hideTests = true } = {}) {
  const today = tokyoToday()
  const [jobs, contracts, periods, disputed, paidLines, statements, problems] = await Promise.all([
    supabase.from('jobs').select(JOB_COLS).gte('scheduled_date', addDays(today, -14)).lte('scheduled_date', addDays(today, 1)).limit(3000),
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
