// v1.0.106 · Monthly report the restaurant receives (Clients → client page → "Client reports").
// The admin picks client → month → sees the preview → PDF and/or share on the client portal.
// What the client sees is a SNAPSHOT saved in client_reports.content when the admin shares it:
// later edits on the jobs never change a report already shared.
//
// Never in here: times (start/end/duration), money (job value, staff pay, costs), AI grade and
// reasons, GPS/distance, internal notes, audit, other clients. Only the DAY, the type, who did it,
// photos, video, checklist count, notes marked "visible to the client" and what comes next.
//
// Works in the browser (supabase client) and in the cron (api/_payroll-close.js, service client).
import { clientVisibleNotes } from './reportSheet.js'

// Same rules as getCleaningType (cleaningType.js), locationNameFromTitle and storeBaseName
// (clientPortal.js). Copied here because those files import without ".js", which the cron (Node) can't load.
const locationNameFromTitle = title => String(title || '').replace(/ — .*/, '').trim()
const storeBaseName = name => String(name || '').split(/\s+[-—–]\s+/)[0].trim()
function getCleaningType(job) {
  const t = `${job?.title || ''} ${job?.description || ''}`.toLowerCase()
  if (/deep\s*clean|profunda|limpeza profunda/.test(t)) return 'deep'
  if (/range hood|grease trap|grating|ac cleaning|stove|fog[aã]o|レンジフード|グリストラップ|コンロ/.test(t)) return 'deep'
  return 'basic'
}

export const CLIENT_REPORTS_TABLE = 'client_reports'
const NEXT_DAYS = 45

const pad = n => String(n).padStart(2, '0')

/** First and last day of 'YYYY-MM'. */
export function monthRange(period) {
  const [y, m] = String(period).split('-').map(Number)
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}` }
}

/** 'YYYY-MM' n months before/after. */
export function shiftPeriod(period, n) {
  const [y, m] = String(period).split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}

const addDays = (day, n) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 'basic' | 'deep' | 'spot' — spot wins, then the deep/basic rule used everywhere else. */
export function serviceType(job) {
  if (job?.job_category === 'spot') return 'spot'
  return getCleaningType(job) === 'deep' ? 'deep' : 'basic'
}

const storeOf = job => storeBaseName(locationNameFromTitle(job?.title)) || '—'

/** Task list written in the title ("Deep Clean (Range Hood, Fryer)") — what was done, without times. */
function whatOf(job) {
  const rest = String(job?.title || '').split(' — ').slice(1).join(' — ')
  const m = rest.match(/\(([^)]*)\)\s*$/)
  return m ? m[1] : ''
}

function checklistOf(job) {
  const total = Number(job?.checklist_total || 0)
  if (!total) return null
  const done = job.checklist_done == null ? (job.status === 'completed' ? total : 0) : Math.min(total, Number(job.checklist_done))
  return { done, total }
}

/**
 * Pure: the report content from rows already loaded.
 * jobs: this client's jobs from the start of the month up to NEXT_DAYS after it (plus older deep cleans);
 * videoJobs: Set of job ids that have a post-cleaning video.
 */
export function buildClientReport({ client, period, jobs = [], contracts = [], videoJobs = new Set(), now = new Date() }) {
  const { from, to } = monthRange(period)
  const nextTo = addDays(to, NEXT_DAYS)
  const live = (jobs || []).filter(j => j && j.status !== 'cancelled')
  const done = live.filter(j => j.status === 'completed' && j.scheduled_date >= from && j.scheduled_date <= to)
  const upcoming = live.filter(j => j.status !== 'completed' && j.scheduled_date > to && j.scheduled_date <= nextTo)

  const names = new Set([
    ...(contracts || []).filter(c => c.is_active !== false).map(c => storeBaseName(c.location_name)).filter(Boolean),
    ...done.map(storeOf),
  ])
  const locations = [...names].sort((a, b) => a.localeCompare(b, 'ja')).map(name => {
    const mine = done.filter(j => storeOf(j) === name).sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
    const services = mine.map(j => ({
      job_id: j.id,
      date: j.scheduled_date,
      type: serviceType(j),
      what: whatOf(j),
      by: j.employee_name || null,
      before: j.photo_start_url || null,
      after: j.photo_end_url || null,
      video: videoJobs.has(j.id),
      checklist: checklistOf(j),
      notes: clientVisibleNotes(j),
    }))
    const ck = services.reduce((s, x) => (x.checklist ? { done: s.done + x.checklist.done, total: s.total + x.checklist.total } : s), { done: 0, total: 0 })
    const deeps = live.filter(j => storeOf(j) === name && serviceType(j) === 'deep')
    const lastDeep = deeps.filter(j => j.status === 'completed' && j.scheduled_date <= to).map(j => j.scheduled_date).sort().pop() || null
    const nextDeep = deeps.filter(j => j.status !== 'completed' && j.scheduled_date > to).map(j => j.scheduled_date).sort()[0] || null
    const next = upcoming.filter(j => storeOf(j) === name).sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
      .slice(0, 6).map(j => ({ date: j.scheduled_date, type: serviceType(j), what: whatOf(j) }))
    return {
      name,
      services,
      counts: { basic: services.filter(s => s.type === 'basic').length, deep: services.filter(s => s.type === 'deep').length, spot: services.filter(s => s.type === 'spot').length },
      checklist: ck.total ? ck : null,
      deep: { last: lastDeep, next: nextDeep },
      next,
    }
  })
  const served = locations.filter(l => l.services.length)
  const all = served.flatMap(l => l.services)
  return {
    v: 1,
    client: { id: client.id, name: client.company_name || client.name || '' },
    period,
    generated_at: now.toISOString(),
    totals: {
      locations: served.length,
      services: all.length,
      basic: all.filter(s => s.type === 'basic').length,
      deep: all.filter(s => s.type === 'deep').length,
      spot: all.filter(s => s.type === 'spot').length,
      photos: all.filter(s => s.before || s.after).length,
      videos: all.filter(s => s.video).length,
    },
    locations,
  }
}

/** A store login only sees its own store; a company login sees all of them. */
export function reportForViewer(content, locationName) {
  if (!content || !locationName) return content
  const own = storeBaseName(locationName)
  const locations = (content.locations || []).filter(l => l.name === own)
  const all = locations.flatMap(l => l.services)
  return {
    ...content,
    locations,
    totals: {
      ...content.totals,
      locations: locations.filter(l => l.services.length).length,
      services: all.length,
      basic: all.filter(s => s.type === 'basic').length,
      deep: all.filter(s => s.type === 'deep').length,
      spot: all.filter(s => s.type === 'spot').length,
      photos: all.filter(s => s.before || s.after).length,
      videos: all.filter(s => s.video).length,
    },
  }
}

const JOB_COLS = 'id,title,client_id,client_name,employee_name,scheduled_date,status,job_category,description,photo_start_url,photo_end_url,checklist_total,checklist_done'

/** Loads what buildClientReport needs. hasVideo(jobId) → boolean (browser: video status file). */
export async function loadClientReport(db, client, period, { hasVideo } = {}) {
  const { from, to } = monthRange(period)
  const lookBack = addDays(from, -120)
  const nextTo = addDays(to, NEXT_DAYS)
  const [byId, byName, contracts] = await Promise.all([
    db.from('jobs').select(JOB_COLS).eq('client_id', client.id).gte('scheduled_date', lookBack).lte('scheduled_date', nextTo).limit(3000),
    client.company_name
      ? db.from('jobs').select(JOB_COLS).is('client_id', null).eq('client_name', client.company_name).gte('scheduled_date', lookBack).lte('scheduled_date', nextTo).limit(3000)
      : { data: [] },
    db.from('service_contracts').select('location_name,is_active').eq('client_id', client.id),
  ])
  if (byId.error) throw byId.error
  const map = new Map()
  for (const j of [...(byId.data || []), ...(byName.data || [])]) map.set(j.id, j)
  // Older months are only there to find the last deep clean
  const jobs = [...map.values()].filter(j => j.scheduled_date >= from || serviceType(j) === 'deep')
  const done = jobs.filter(j => j.status === 'completed' && j.scheduled_date >= from && j.scheduled_date <= to)
  const check = hasVideo || (id => serverHasVideo(db, id))
  const videoJobs = new Set()
  for (let i = 0; i < done.length; i += 6) {
    const part = done.slice(i, i + 6)
    const flags = await Promise.all(part.map(j => Promise.resolve(check(j.id)).catch(() => false)))
    part.forEach((j, k) => { if (flags[k]) videoJobs.add(j.id) })
  }
  return buildClientReport({ client, period, jobs, contracts: contracts.data || [], videoJobs })
}

async function serverHasVideo(db, jobId) {
  if (!db.storage) return false
  const { data } = await db.storage.from('service-photos').list(`jobs/${jobId}`, { limit: 100 })
  return (data || []).some(f => /^video_\d+\.(webm|mp4|mov)$/.test(f.name || ''))
}

/** True when the error means the client_reports table was not created yet (SQL not applied). */
export function missingTable(error) {
  const t = `${error?.code || ''} ${error?.message || ''}`
  return /42P01|PGRST205|client_reports/.test(t) && /exist|find|42P01|PGRST205/i.test(t)
}

/** Saved reports of a client (drafts and shared), newest month first. */
export async function listClientReports(db, clientId) {
  const q = db.from(CLIENT_REPORTS_TABLE).select('id,client_id,period,status,shared_at,shared_by,updated_at')
  const { data, error } = await (clientId ? q.eq('client_id', clientId) : q).order('period', { ascending: false }).limit(200)
  if (error) return { rows: [], missing: missingTable(error), error }
  return { rows: data || [], missing: false }
}

export async function getClientReport(db, clientId, period) {
  const { data, error } = await db.from(CLIENT_REPORTS_TABLE).select('*').eq('client_id', clientId).eq('period', period).maybeSingle()
  if (error) throw error
  return data || null
}

/** Saves (or refreshes) the draft. A shared report is never overwritten here. */
export async function saveDraft(db, content) {
  const existing = await getClientReport(db, content.client.id, content.period)
  if (existing?.status === 'shared') return existing
  const row = { client_id: content.client.id, period: content.period, status: 'draft', content, updated_at: new Date().toISOString() }
  const q = existing
    ? db.from(CLIENT_REPORTS_TABLE).update(row).eq('id', existing.id)
    : db.from(CLIENT_REPORTS_TABLE).insert(row)
  const { data, error } = await q.select('*').single()
  if (error) throw error
  return data
}

/** Shares exactly this content on the client portal (after the admin reviewed it). */
export async function shareReport(db, content, by) {
  const existing = await getClientReport(db, content.client.id, content.period)
  const row = { client_id: content.client.id, period: content.period, status: 'shared', content, shared_at: new Date().toISOString(), shared_by: by || null, updated_at: new Date().toISOString() }
  const q = existing
    ? db.from(CLIENT_REPORTS_TABLE).update(row).eq('id', existing.id)
    : db.from(CLIENT_REPORTS_TABLE).insert(row)
  const { data, error } = await q.select('*').single()
  if (error) throw error
  return data
}

/** Takes it off the portal again: back to draft. */
export async function unshareReport(db, id) {
  const { data, error } = await db.from(CLIENT_REPORTS_TABLE).update({ status: 'draft', shared_at: null, updated_at: new Date().toISOString() }).eq('id', id).select('*').single()
  if (error) throw error
  return data
}

/** Shared reports the portal user may see. */
export async function listSharedForPortal(db, clientId) {
  const { data, error } = await db.from(CLIENT_REPORTS_TABLE).select('id,period,content,shared_at').eq('client_id', clientId).eq('status', 'shared').order('period', { ascending: false }).limit(24)
  if (error) return []
  return data || []
}

/**
 * Month close: one DRAFT per client that had completed services last month. Nothing is shared —
 * the admin reviews and shares by hand. Clients that already have a row for the month are skipped.
 */
export async function createMonthDrafts(db, period) {
  const { from, to } = monthRange(period)
  const probe = await db.from(CLIENT_REPORTS_TABLE).select('client_id').eq('period', period)
  if (probe.error) return { period, skipped: missingTable(probe.error) ? 'client_reports table missing' : probe.error.message }
  const have = new Set((probe.data || []).map(r => r.client_id))
  const { data: rows, error } = await db.from('jobs').select('client_id').eq('status', 'completed').gte('scheduled_date', from).lte('scheduled_date', to).not('client_id', 'is', null).limit(10000)
  if (error) throw error
  const ids = [...new Set((rows || []).map(r => r.client_id))].filter(id => !have.has(id))
  if (!ids.length) return { period, created: 0 }
  const { data: clients } = await db.from('clients').select('id,company_name').in('id', ids)
  let created = 0
  for (const client of clients || []) {
    try {
      const content = await loadClientReport(db, client, period)
      if (!content.totals.services) continue
      const { error: insErr } = await db.from(CLIENT_REPORTS_TABLE).insert({ client_id: client.id, period, status: 'draft', content })
      if (!insErr) created++
    } catch (e) {
      console.error('[client-report-draft]', client.id, e?.message || e)
    }
  }
  return { period, created }
}
