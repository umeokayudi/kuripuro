import { supabase } from './supabase'
import { buildSpotContractRow, emptySpotContractForm, contractPrefillFromClient } from './spotContract'
import { saveSpotContractWithInvoice } from './spotContractOps'
import { salesPost } from './salesApi'
import { tokyoToday } from './dates'

// v1.0.70 · What happens after a client says yes to a quote.
//
// accepted → admin books one or more sessions (date, worker, price). Each session is a spot job
// (the worker gets it as a spot offer), its 業務委託契約書 and a draft invoice dated on the session
// day, so it already counts as confirmed revenue of that month. When the worker finishes the job
// the invoice turns 'sent' (the client sees it in Billing) and the request is marked done.
//
// No new columns: a session is linked to its quote by spot_contracts.contract_details.quote_ref,
// 'req:<client_requests.id>' (asked in the client portal) or 'mit:<mitsumori.id>' (made by a seller/admin).

export const QUOTE_FLOW_CHANGED = 'kp:quote-flow-changed'
const changed = () => { try { window.dispatchEvent(new Event(QUOTE_FLOW_CHANGED)) } catch { /* tests */ } }

export const quoteRef = (kind, id) => `${kind === 'mitsumori' ? 'mit' : 'req'}:${id}`

/** One shape for both kinds of accepted quote. */
export function quoteFromRequest(rq, client) {
  return {
    kind: 'request', id: rq.id, ref: quoteRef('request', rq.id),
    client_id: rq.client_id || null, client_name: client?.company_name || rq.client_name || '',
    place: rq.location_name || '', service: rq.category || '', description: rq.description || '',
    total: Number(rq.quote_amount || 0), tax_rate: 10, price_includes_tax: true,
    salesperson_id: rq.salesperson_id || rq.account_seller_id || null,
    preferred_date: rq.preferred_date || '', decided_at: rq.decided_at || null, address: '',
  }
}

export function quoteFromMitsumori(q) {
  const items = (q.items || q.mitsumori_items || []).map(i => i.description).filter(Boolean)
  return {
    kind: 'mitsumori', id: q.id, ref: quoteRef('mitsumori', q.id),
    client_id: null, client_name: q.company_name || '',
    place: q.site_name || q.company_name || '', service: items[0] || q.needs || '', description: [q.needs, items.join(' / ')].filter(Boolean).join(' · '),
    total: Number(q.total || 0), tax_rate: Number(q.tax_rate ?? 10), price_includes_tax: true,
    salesperson_id: q.salesperson_id || null, preferred_date: q.expected_start || '', decided_at: q.decided_at || null,
    address: q.address || '', quote_number: q.quote_number || '',
  }
}

/** Sessions of a quote: contract + job + invoice, oldest first. */
export async function fetchQuoteSessions(ref) {
  const { data, error } = await supabase.from('spot_contracts')
    .select('id,contract_number,job_id,service_date,service_time,employee_id,employee_name,price,fatura_id,status,location_name,client_id,client_name,salesperson_id,contract_details')
    .eq('contract_details->>quote_ref', ref).eq('is_active', true).order('service_date')
  if (error) throw error
  const rows = data || []
  const jobIds = rows.map(r => r.job_id).filter(Boolean)
  const invIds = rows.map(r => r.fatura_id).filter(Boolean)
  const [jobs, invs] = await Promise.all([
    jobIds.length ? supabase.from('jobs').select('id,status,spot_status,started_at,completed_at,employee_name,scheduled_date,scheduled_time,photo_start_url,photo_end_url,notes_employee,retro_report,retro_ai_summary,checklist_total,checklist_done,checklist_missed_items,photo_ai_score,photo_ai_issues').in('id', jobIds) : { data: [] },
    invIds.length ? supabase.from('faturas').select('id,status,total,issue_date,due_date').in('id', invIds) : { data: [] },
  ])
  const jobById = new Map((jobs.data || []).map(j => [j.id, j]))
  const invById = new Map((invs.data || []).map(f => [f.id, f]))
  return rows.map(r => ({ ...r, job: jobById.get(r.job_id) || null, invoice: invById.get(r.fatura_id) || null }))
}

/** Where a quote is: approved → scheduled → done (every session finished, invoices sent). */
export function quoteStage(sessions = []) {
  const live = sessions.filter(s => s.job?.status !== 'cancelled' && s.job?.spot_status !== 'declined')
  if (!live.length) return 'approved'
  if (live.every(s => s.job?.status === 'completed')) return 'done'
  return 'scheduled'
}

// v1.0.87 · follow-up after the booking: late alert, "how did it go" check, billing check.
// All of it lives in spot_contracts.contract_details (jsonb), no new columns:
//   check: { result: 'ok' | 'issue' | 'not_done', note, at }   (admin looked at the job)
//   billing_checked_at                                          (admin confirmed the invoice reached the client)
//   reschedules: [{ from, to, at, reason }]                    (it was not done on the booked day)

const isOff = j => j?.status === 'cancelled' || j?.spot_status === 'declined'
const tokyoMinutes = (now = new Date()) => {
  const [h, m] = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Tokyo', hour12: false }).split(':').map(Number)
  return (h % 24) * 60 + m
}
const LATE_GRACE_MIN = 60

/**
 * Why a booked session is late, or null:
 * 'missed' (the day passed and it never started), 'unfinished' (started, the day passed, not finished),
 * 'not_started' (today, an hour past the booked time and nobody started it).
 */
export function sessionLate(s, now = new Date()) {
  const j = s?.job
  if (!j || j.status === 'completed' || isOff(j)) return null
  const day = String(s.service_date || j.scheduled_date || '').slice(0, 10)
  if (!day) return null
  const today = tokyoToday()
  if (day > today) return null
  if (day < today) return j.status === 'in_progress' ? 'unfinished' : 'missed'
  const time = String(s.service_time || j.scheduled_time || '')
  if (!/^\d{1,2}:\d{2}/.test(time) || j.status === 'in_progress') return null
  const [h, m] = time.split(':').map(Number)
  return tokyoMinutes(now) > h * 60 + m + LATE_GRACE_MIN ? 'not_started' : null
}

const billed = s => ['sent', 'paid'].includes(s.invoice?.status)
const billChecked = s => s.invoice?.status === 'paid' || Boolean(s.contract_details?.billing_checked_at)

/** Counts for the steps strip: booked → done → checked → invoice sent → invoice checked. */
export function quoteProgress(sessions = []) {
  const live = sessions.filter(s => !isOff(s.job))
  const done = live.filter(s => s.job?.status === 'completed')
  const late = live.filter(s => sessionLate(s))
  const upcoming = live.filter(s => s.job?.status !== 'completed').map(s => s.service_date).filter(Boolean).sort()
  return {
    stage: quoteStage(sessions),
    booked: live.length,
    done: done.length,
    checked: done.filter(s => s.contract_details?.check?.result && s.contract_details.check.result !== 'not_done').length,
    billed: live.filter(billed).length,
    billChecked: live.filter(billChecked).length,
    late: late.length,
    next: upcoming[0] || null,
  }
}

async function patchDetails(session, patch) {
  const details = { ...(session.contract_details || {}), ...patch }
  const { error } = await supabase.from('spot_contracts').update({ contract_details: details }).eq('id', session.id)
  if (error) throw error
  return details
}

/** Admin's look at a finished (or missed) session: result + how it went. */
export async function checkQuoteSession(session, { result, note = '' }) {
  const details = await patchDetails(session, { check: { result, note: String(note || '').trim(), at: new Date().toISOString() } })
  changed()
  return details
}

/** Admin confirmed the invoice of this session reached the client. */
export async function checkQuoteBilling(session) {
  const details = await patchDetails(session, { billing_checked_at: new Date().toISOString() })
  changed()
  return details
}

/**
 * It was not done on the booked day: move job, contract and draft invoice to a new day.
 * A new worker gets it as a fresh spot offer.
 */
export async function rescheduleQuoteSession(session, { date, time = '', employee = null, reason = '' }) {
  if (!date) throw new Error('date')
  const job = { scheduled_date: date, scheduled_time: time || null }
  if (session.job?.status === 'in_progress') job.status = 'assigned'
  if (employee && employee.id !== session.employee_id) Object.assign(job, { employee_id: employee.id, employee_name: employee.full_name || '', spot_status: 'pending', status: 'assigned' })
  if (session.job_id) {
    const { error } = await supabase.from('jobs').update(job).eq('id', session.job_id)
    if (error) throw error
  }
  const reschedules = [...(session.contract_details?.reschedules || []), { from: session.service_date, to: date, at: new Date().toISOString(), reason: String(reason || '').trim() }]
  const details = { ...(session.contract_details || {}), reschedules }
  delete details.check
  const contract = { service_date: date, service_time: time || null, contract_details: details }
  if (employee && employee.id !== session.employee_id) Object.assign(contract, { employee_id: employee.id, employee_name: employee.full_name || '' })
  const { error } = await supabase.from('spot_contracts').update(contract).eq('id', session.id)
  if (error) throw error
  if (session.fatura_id && session.invoice?.status === 'draft') await supabase.from('faturas').update({ issue_date: date }).eq('id', session.fatura_id)
  notifySeller(session, 'quote_rescheduled', `Serviço remarcado · ${session.client_name || session.location_name || ''}`, `${session.service_date} → ${date}${time ? ` ${time}` : ''}`)
  changed()
}

const sessionPlace = (quote, n) => {
  const base = quote.place || quote.client_name || 'Spot'
  const service = quote.service ? ` — ${quote.service}` : ''
  return `${base}${service}${n > 1 ? ` (${n})` : ''}`
}

/**
 * Books one session: spot job (offer to the worker) + contract + draft invoice on that day.
 * form: { date, time, employee, price, employee_pay, client, address, notes }
 */
export async function scheduleQuoteSession(quote, form, sessionsSoFar = []) {
  const n = sessionsSoFar.length + 1
  const title = sessionPlace(quote, n)
  const price = Math.round(Number(form.price) || 0)
  const client = form.client || null
  const { data: job, error } = await supabase.from('jobs').insert({
    title,
    client_id: client?.id || quote.client_id || null,
    client_name: client?.company_name || quote.client_name || '',
    employee_id: form.employee.id,
    employee_name: form.employee.full_name || '',
    scheduled_date: form.date,
    scheduled_time: form.time || null,
    address: form.address || quote.address || client?.address || '',
    value: price,
    spot_value: Math.round(Number(form.employee_pay) || 0),
    description: [quote.description, form.notes].filter(Boolean).join('\n'),
    photo_required: true,
    job_category: 'spot',
    status: 'assigned',
    spot_status: 'pending',
  }).select().single()
  if (error) throw error

  const contract = {
    ...emptySpotContractForm(), ...contractPrefillFromClient(client),
    price, tax_rate: quote.tax_rate ?? 10, price_includes_tax: quote.price_includes_tax !== false,
    salesperson_id: quote.salesperson_id || '', commission_type: null, commission_amount: 0,
    contract_details: { quote_ref: quote.ref },
  }
  const jobForm = {
    title, client_id: client?.id || quote.client_id || null, employee_id: form.employee.id,
    scheduled_date: form.date, scheduled_time: form.time || '', address: job.address,
    value: price, spot_value: job.spot_value, description: job.description, location_id: '',
  }
  const row = buildSpotContractRow({ contract, job, form: jobForm, client: client || { company_name: quote.client_name }, employee: form.employee })
  // The seller of the quote already earns through the quote; no second commission on the contract.
  row.commission_type = null; row.commission_value = null; row.commission_amount = 0
  const saved = await saveSpotContractWithInvoice(row)
  // Invoice dated on the session day → it lands in that month's revenue as confirmed (draft = not sent yet).
  if (saved.invoice?.id) await supabase.from('faturas').update({ issue_date: form.date }).eq('id', saved.invoice.id)

  if (quote.kind === 'request') {
    await supabase.from('client_requests').update({ status: 'scheduled' }).eq('id', quote.id).neq('status', 'completed')
  }
  notifySeller(quote, 'quote_scheduled', `Serviço marcado · ${quote.client_name || quote.place}`, `${form.date}${form.time ? ` ${form.time}` : ''} · ${form.employee.full_name || ''} · ¥${price.toLocaleString()}`)
  changed()
  return { job, ...saved }
}

/** Cancels a session that was not done: job cancelled, its draft invoice cancelled. */
export async function cancelQuoteSession(session) {
  if (session.job_id) await supabase.from('jobs').update({ status: 'cancelled' }).eq('id', session.job_id)
  if (session.fatura_id && session.invoice?.status === 'draft') await supabase.from('faturas').update({ status: 'cancelled' }).eq('id', session.fatura_id)
  await supabase.from('spot_contracts').update({ is_active: false }).eq('id', session.id)
  changed()
}

/**
 * A quote job was finished (by the worker, or by the admin from the tracker):
 * its invoice goes out (draft → sent, dated today) and, when it was the last session,
 * the client request is marked done. Safe to call for any job; never throws.
 */
export async function finishQuoteJob(jobId, { byAdmin = false } = {}) {
  try {
    if (!jobId) return null
    const { data: sc } = await supabase.from('spot_contracts')
      .select('id,fatura_id,contract_details,client_name,location_name,price,salesperson_id')
      .eq('job_id', jobId).eq('is_active', true).maybeSingle()
    const ref = sc?.contract_details?.quote_ref
    if (!ref) return null
    if (byAdmin) {
      await supabase.from('jobs').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', jobId).neq('status', 'completed')
    }
    let sent = false
    if (sc.fatura_id) {
      const { data: inv } = await supabase.from('faturas').update({ status: 'sent', issue_date: tokyoToday() })
        .eq('id', sc.fatura_id).eq('status', 'draft').select('id').maybeSingle()
      sent = Boolean(inv)
    }
    const sessions = await fetchQuoteSessions(ref)
    const done = quoteStage(sessions) === 'done'
    if (done && ref.startsWith('req:')) {
      await supabase.from('client_requests').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', ref.slice(4))
    }
    if (byAdmin && sent) {
      notifySeller({ salesperson_id: sc.salesperson_id }, 'quote_done', `Serviço feito · nota enviada · ${sc.client_name || sc.location_name || ''}`, `¥${Math.round(Number(sc.price || 0)).toLocaleString()}`)
    }
    changed()
    return { sent, done }
  } catch (err) {
    console.warn('quote job not finished', err)
    return null
  }
}

/** Jobs a worker finished while nobody had the admin open: send their invoices now. */
export async function syncQuoteSessions(sessions) {
  const stale = (sessions || []).filter(s => s.job?.status === 'completed' && s.invoice?.status === 'draft')
  for (const s of stale) await finishQuoteJob(s.job_id)
  return stale.length
}

function notifySeller(quote, event_type, title, body) {
  if (!quote?.salesperson_id) return
  salesPost('/api/sales-data', { action: 'quote-flow-notice', salesperson_id: quote.salesperson_id, event_type, title, body }).catch(() => {})
}

/**
 * For the admin bell: accepted quotes nobody has booked yet, quote jobs finished in the last
 * 7 days (their invoice went out) and booked sessions that are late (not done on their day). Ids are prefixed so the bell can remember what it showed.
 */
export async function fetchQuoteFlowAlerts() {
  const since = new Date(Date.now() - 7 * 864e5).toISOString()
  const [reqs, mits, linked, recent] = await Promise.all([
    supabase.from('client_requests').select('id,client_id,location_name,category,quote_amount,decided_at,status')
      .eq('request_type', 'quote').eq('quote_status', 'accepted').neq('status', 'completed').limit(100),
    supabase.from('mitsumori').select('id,company_name,site_name,total,decided_at,status').eq('status', 'accepted').limit(100),
    supabase.from('spot_contracts').select('contract_details').eq('is_active', true).not('contract_details->>quote_ref', 'is', null).limit(1000),
    supabase.from('spot_contracts').select('id,job_id,client_name,location_name,price,contract_details,fatura_id').eq('is_active', true)
      .not('contract_details->>quote_ref', 'is', null).gte('updated_at', since).limit(100),
  ])
  const booked = new Set((linked.data || []).map(r => r.contract_details?.quote_ref).filter(Boolean))
  const clientIds = [...new Set((reqs.data || []).map(r => r.client_id).filter(Boolean))]
  const { data: clients } = clientIds.length ? await supabase.from('clients').select('id,company_name').in('id', clientIds) : { data: [] }
  const cname = new Map((clients || []).map(c => [c.id, c.company_name]))
  const toBook = [
    ...(reqs.data || []).filter(r => !booked.has(quoteRef('request', r.id))).map(r => ({ id: `qf-book-${r.id}`, kind: 'request', ref_id: r.id, name: [cname.get(r.client_id), r.location_name].filter(Boolean).join(' · '), what: r.category || '', total: r.quote_amount, at: r.decided_at })),
    // Old accepted mitsumori (before this flow) would all show up; only the last 60 days.
    ...(mits.data || []).filter(q => !booked.has(quoteRef('mitsumori', q.id)) && (!q.decided_at || q.decided_at > new Date(Date.now() - 60 * 864e5).toISOString())).map(q => ({ id: `qf-book-${q.id}`, kind: 'mitsumori', ref_id: q.id, name: q.site_name || q.company_name, what: '', total: q.total, at: q.decided_at })),
  ]
  const jobIds = (recent.data || []).map(r => r.job_id).filter(Boolean)
  const { data: jobs } = jobIds.length ? await supabase.from('jobs').select('id,status,completed_at').in('id', jobIds).eq('status', 'completed').gte('completed_at', since) : { data: [] }
  const doneIds = new Set((jobs || []).map(j => j.id))
  const done = (recent.data || []).filter(r => doneIds.has(r.job_id)).map(r => ({ id: `qf-done-${r.id}`, ref: r.contract_details?.quote_ref, name: r.client_name || r.location_name, total: r.price }))
  // v1.0.87 · booked sessions whose day came and the job is not done: they stay until done, moved or cancelled
  const today = tokyoToday()
  const { data: due } = await supabase.from('spot_contracts').select('id,job_id,client_name,location_name,price,service_date,service_time,contract_details')
    .eq('is_active', true).not('contract_details->>quote_ref', 'is', null).lte('service_date', today).gte('service_date', new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)).limit(300)
  const dueJobIds = (due || []).map(r => r.job_id).filter(Boolean)
  const { data: dueJobs } = dueJobIds.length ? await supabase.from('jobs').select('id,status,spot_status,scheduled_date,scheduled_time,employee_name').in('id', dueJobIds) : { data: [] }
  const dueJob = new Map((dueJobs || []).map(j => [j.id, j]))
  const late = (due || []).map(r => ({ ...r, job: dueJob.get(r.job_id) })).map(r => [r, sessionLate(r)]).filter(([, why]) => why).map(([r, why]) => ({
    id: `qf-late-${r.id}-${r.service_date}`, ref: r.contract_details?.quote_ref, why, name: r.client_name || r.location_name, total: r.price,
    date: r.service_date, time: r.service_time || '', who: r.job?.employee_name || '',
  }))
  // a finished job the admin already looked at does not need the bell any more
  const checkedDone = new Set((recent.data || []).filter(r => r.contract_details?.check).map(r => `qf-done-${r.id}`))
  return { toBook, done: done.filter(d => !checkedDone.has(d.id)), late }
}
