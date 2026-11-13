// v1.0.179 · Sincronizar Google Agenda (route /api/google/:op → /api/sales?route=google&op=:op).
// Vercel Hobby allows 12 functions, so this lives behind api/sales.js like the other helpers.
//
// Import: events of the connected Google calendars → AI reads them → drafts the admin reviews →
//   jobs. Already imported / ignored events are remembered in google_calendar_links.
// Export: every job goes into the Google Calendar of the person doing it (and of admins that
//   chose "all"), always tagged with the company ("[JBM] …"), updated when the job changes and
//   removed when it is cancelled.
// Tokens: refresh tokens are AES-256-GCM encrypted with a key derived from SALES_SESSION_SECRET
//   and only the service role can read the tables (RLS on, no policies).
import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'
import { salesDb, readSalesSession, salesSessionConfigured } from './_salesSession.js'
import { aiGenerate, aiConfigured } from './_ai.js'
import {
  DEFAULT_SETTINGS, AUTO_IMPORT_MODES, normalizeEvent, isKuripuroEvent, heuristicDraft, finishDraft,
  draftToJobRow, draftProblems, jobToGoogleEvent, jobHash, jobGoneFromAgenda, DEEP_TASK_LABELS,
} from '../src/lib/googleAgendaSync.js'

const SCOPES = 'openid email https://www.googleapis.com/auth/calendar'
const CAL = 'https://www.googleapis.com/calendar/v3'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MISSING_TABLE = /google_calendar_\w+|does not exist|schema cache/i

const first = v => Array.isArray(v) ? v[0] : v
const tokyoToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
const addDays = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10) }

function googleConfigured() { return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) }
function origin(req) {
  const host = req.headers?.['x-forwarded-host'] || req.headers?.host || 'kuripuro.vercel.app'
  const proto = req.headers?.['x-forwarded-proto'] || 'https'
  return `${proto}://${host}`
}
const redirectUri = req => process.env.GOOGLE_REDIRECT_URI || `${origin(req)}/api/google/callback`

// ── signing / encryption ────────────────────────────────────────────────────────────────────
function secret() {
  const v = process.env.SALES_SESSION_SECRET
  if (!v || v.length < 32) throw new Error('SALES_SESSION_SECRET deve ter pelo menos 32 caracteres.')
  return v
}
function signPayload(obj) {
  const p = Buffer.from(JSON.stringify(obj)).toString('base64url')
  return `${p}.${createHmac('sha256', secret()).update(`gcal:${p}`).digest('base64url')}`
}
function readSigned(token) {
  const [p, s, extra] = String(token || '').split('.')
  if (!p || !s || extra) return null
  const a = Buffer.from(createHmac('sha256', secret()).update(`gcal:${p}`).digest('base64url'))
  const b = Buffer.from(s)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const data = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'))
    return data.exp && data.exp > Date.now() / 1000 ? data : null
  } catch { return null }
}
const encKey = () => createHash('sha256').update(`gcal-token:${secret()}`).digest()
export function encryptToken(plain) {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', encKey(), iv)
  const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()])
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${data.toString('base64url')}`
}
export function decryptToken(value) {
  const [v, iv, tag, data] = String(value || '').split('.')
  if (v !== 'v1' || !iv || !tag || !data) return null
  try {
    const d = createDecipheriv('aes-256-gcm', encKey(), Buffer.from(iv, 'base64url'))
    d.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8')
  } catch { return null }
}
function safeEquals(left, right) {
  const a = Buffer.from(String(left || '')), b = Buffer.from(String(right || ''))
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}

// ── Google HTTP ─────────────────────────────────────────────────────────────────────────────
async function gfetch(url, { token, method = 'GET', body, form } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const resp = await fetch(url, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: body ? JSON.stringify(body) : form ? new URLSearchParams(form).toString() : undefined,
      signal: controller.signal,
    })
    const text = await resp.text()
    let json = null
    try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text } }
    if (!resp.ok) {
      const err = new Error(json?.error?.message || json?.error_description || json?.error || `Google ${resp.status}`)
      err.status = resp.status
      throw err
    }
    return json
  } finally { clearTimeout(timer) }
}

async function accessToken(account) {
  const refresh = decryptToken(account.refresh_token_enc)
  if (!refresh) throw new Error('Conexão com o Google perdida. Conecte a conta de novo.')
  const data = await gfetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    form: { client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: refresh, grant_type: 'refresh_token' },
  })
  return data.access_token
}

async function listCalendars(token) {
  const data = await gfetch(`${CAL}/users/me/calendarList?minAccessRole=reader&maxResults=100`, { token })
  return (data.items || []).map(c => ({ id: c.id, summary: c.summaryOverride || c.summary || c.id, primary: Boolean(c.primary), writable: ['owner', 'writer'].includes(c.accessRole) }))
}

async function listEvents(token, calendarId, from, to) {
  const out = []
  let pageToken = ''
  do {
    const qs = new URLSearchParams({
      timeMin: `${from}T00:00:00+09:00`, timeMax: `${to}T23:59:59+09:00`,
      singleEvents: 'true', orderBy: 'startTime', maxResults: '250', showDeleted: 'false',
      ...(pageToken ? { pageToken } : {}),
    })
    const data = await gfetch(`${CAL}/calendars/${encodeURIComponent(calendarId)}/events?${qs}`, { token })
    out.push(...(data.items || []))
    pageToken = data.nextPageToken || ''
  } while (pageToken && out.length < 1000)
  return out
}

// ── DB helpers ──────────────────────────────────────────────────────────────────────────────
async function loadSettings(db) {
  const { data, error } = await db.from('google_calendar_settings').select('*').eq('id', 1).maybeSingle()
  if (error) throw error
  return { ...DEFAULT_SETTINGS, ...(data || {}) }
}
const publicAccount = a => {
  const { refresh_token_enc, ...rest } = a
  return { ...rest, connected: Boolean(refresh_token_enc) }
}

async function context(db) {
  const [{ data: locations }, { data: contracts }, { data: employees }, { data: clients }] = await Promise.all([
    db.from('locations').select('id,name,address,client_id,is_active'),
    db.from('service_contracts').select('id,location_name,location_address,client_id,is_active'),
    db.from('employees').select('id,full_name,email,is_active').eq('is_active', true),
    db.from('clients').select('id,company_name'),
  ])
  const places = new Map()
  const k = n => String(n || '').replace(/\s+(—|-)\s+.*$/, '').trim().toLowerCase()
  for (const l of locations || []) if (l.is_active !== false && !places.has(k(l.name))) places.set(k(l.name), { id: l.id, name: l.name.replace(/\s+(—|-)\s+.*$/, '').trim(), address: l.address || '', client_id: l.client_id })
  for (const c of contracts || []) {
    if (c.is_active === false || !c.location_name || places.has(k(c.location_name))) continue
    places.set(k(c.location_name), { id: `sc:${c.id}`, name: c.location_name.replace(/\s+(—|-)\s+.*$/, '').trim(), address: c.location_address || '', client_id: c.client_id })
  }
  return { places: [...places.values()], employees: employees || [], clients: clients || [] }
}

function sessionOf(req, res, roles) {
  if (!salesSessionConfigured()) { res.status(503).json({ error: 'Configure SUPABASE_SERVICE_ROLE_KEY e SALES_SESSION_SECRET no servidor.' }); return null }
  const user = readSalesSession(req)
  if (!user || !roles.includes(user.role)) { res.status(401).json({ error: 'Sua sessão expirou. Saia e entre de novo.' }); return null }
  return user
}

// ── AI ──────────────────────────────────────────────────────────────────────────────────────
async function aiDrafts(events, ctx) {
  if (!events.length || !aiConfigured()) return null
  const places = ctx.places.slice(0, 250).map(p => ({ id: p.id, name: p.name, address: p.address?.slice(0, 80) || '', client_id: p.client_id }))
  const employees = ctx.employees.map(e => ({ id: e.id, name: e.full_name }))
  const items = events.map(e => ({
    key: e.key, summary: e.summary, location: e.location, description: e.description.slice(0, 600),
    date: e.date, time: e.time, end_time: e.end_time, all_day: e.all_day, attendees: e.attendees,
    calendar_owner: e.owner_kind === 'employee' ? { employee_id: e.owner_id, name: e.owner_name } : { admin: e.owner_name },
  }))
  const prompt = `Você organiza a agenda de uma empresa de limpeza de restaurantes no Japão (KuriPuro).
Para CADA evento do Google Agenda abaixo, diga se é um serviço de limpeza e monte o serviço.
Regras:
- Use SOMENTE ids das listas. Se o local não está na lista, deixe location_id null e escreva o nome em place_name.
- employee_id: a pessoa citada no evento; se ninguém for citado e o dono da agenda for funcionário, use o dono.
- cleaning_type "deep" para limpeza pesada/deep clean/coifa/caixa de gordura etc., senão "basic". deep_tasks só destes ids: ${Object.keys(DEEP_TASK_LABELS).join(', ')}.
- job_category "spot" só se for serviço avulso/urgente/único com valor próprio; contrato/rotina = "regular".
- value: valor em ienes só se estiver escrito no evento, senão 0.
- is_job false para reuniões, compromissos pessoais, feriados, aniversários etc.
- description: resumo curto em português do que fazer (com detalhes úteis do evento). instructions: acesso/chave/observações, se houver.
- confidence 0..1. reason: uma frase curta em português.
Responda JSON: {"drafts":[{"key","is_job","confidence","reason","place_name","location_id","client_id","address","cleaning_type","deep_tasks","employee_id","date","time","end_time","job_category","value","description","instructions"}]}

LOCAIS: ${JSON.stringify(places)}
FUNCIONÁRIOS: ${JSON.stringify(employees)}
EVENTOS: ${JSON.stringify(items)}`
  const data = await aiGenerate({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
  }, { timeoutMs: 30000 })
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || ''
  try { return JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim()).drafts || [] } catch { return null }
}

/** Events → drafts (AI first, rules when the AI is missing or fails). */
async function buildDrafts(events, ctx, deadline) {
  const out = []
  for (let i = 0; i < events.length; i += 25) {
    const chunk = events.slice(i, i + 25)
    let ai = null
    if (Date.now() < deadline - 20000) { try { ai = await aiDrafts(chunk, ctx) } catch (e) { console.error('[google] ai', e?.message) } }
    const byKey = new Map((ai || []).map(d => [d.key, d]))
    for (const ev of chunk) {
      const base = heuristicDraft(ev, ctx)
      const got = byKey.get(ev.key)
      const draft = got ? finishDraft({ ...base, ...got, key: ev.key, source: 'ia' }, { ...ctx, event: ev }) : base
      out.push({ ...draft, event: ev, problems: draftProblems(draft) })
    }
  }
  return out
}

// ── import ──────────────────────────────────────────────────────────────────────────────────
async function newEvents(db, accounts, from, to, deadline) {
  const events = []
  const errors = []
  const { data: links } = await db.from('google_calendar_links').select('account_id,calendar_id,google_event_id,status,event_updated')
    .in('account_id', accounts.map(a => a.id))
  const known = new Map((links || []).map(l => [`${l.account_id}|${l.calendar_id}|${l.google_event_id}`, l]))
  for (const account of accounts) {
    if (Date.now() > deadline - 25000) break
    try {
      const token = await accessToken(account)
      const cals = (account.calendars || []).filter(c => c.import)
      for (const cal of cals) {
        for (const ev of await listEvents(token, cal.id, from, to)) {
          if (ev.status === 'cancelled' || isKuripuroEvent(ev)) continue
          const n = normalizeEvent(ev, { account, calendar: cal })
          const link = known.get(n.key)
          if (link && link.status !== 'pending') continue
          if (!n.date || !n.summary) continue
          events.push({ ...n, pending: Boolean(link) })
        }
      }
      await db.from('google_calendar_accounts').update({ last_import_at: new Date().toISOString(), last_error: null }).eq('id', account.id)
    } catch (e) {
      errors.push({ account: account.google_email, error: e.message })
      await db.from('google_calendar_accounts').update({ last_error: String(e.message).slice(0, 300) }).eq('id', account.id)
    }
  }
  return { events, errors }
}

async function savePending(db, drafts) {
  const rows = drafts.map(d => ({
    account_id: d.event.account_id, calendar_id: d.event.calendar_id, google_event_id: d.event.event_id,
    status: 'pending', draft: d, event_updated: d.event.updated, updated_at: new Date().toISOString(),
  }))
  for (let i = 0; i < rows.length; i += 200) {
    await db.from('google_calendar_links').upsert(rows.slice(i, i + 200), { onConflict: 'account_id,calendar_id,google_event_id' })
  }
}

async function createJobs(db, items, settings, ctx) {
  const created = []
  const failed = []
  for (const item of items) {
    const [accountId, calendarId, ...rest] = String(item.key || '').split('|')
    const eventId = rest.join('|')
    if (!UUID.test(accountId) || !calendarId || !eventId) { failed.push({ key: item.key, error: 'evento inválido' }); continue }
    const d = finishDraft({ ...item.draft, key: item.key }, ctx)
    const problems = draftProblems(d)
    if (problems.length) { failed.push({ key: item.key, error: `falta: ${problems.join(', ')}` }); continue }
    const { data: link } = await db.from('google_calendar_links').select('status,job_id')
      .eq('account_id', accountId).eq('calendar_id', calendarId).eq('google_event_id', eventId).maybeSingle()
    if (link?.status === 'imported' && link.job_id) { failed.push({ key: item.key, error: 'já importado' }); continue }
    const row = draftToJobRow(d, { companyTag: settings.company_tag, eventLink: item.draft?.event?.html_link || '' })
    const { data: job, error } = await db.from('jobs').insert(row).select().single()
    if (error) { failed.push({ key: item.key, error: error.message }); continue }
    await db.from('google_calendar_links').upsert({
      account_id: accountId, calendar_id: calendarId, google_event_id: eventId, status: 'imported', job_id: job.id,
      draft: null, updated_at: new Date().toISOString(),
    }, { onConflict: 'account_id,calendar_id,google_event_id' })
    created.push(job)
  }
  return { created, failed }
}

// ── export ──────────────────────────────────────────────────────────────────────────────────
async function exportJobs(db, accounts, settings, appUrl, deadline) {
  const today = tokyoToday()
  const from = addDays(today, -1)
  const to = addDays(today, Number(settings.days_ahead) || 60)
  const summary = []
  for (const account of accounts) {
    if (Date.now() > deadline - 8000) break
    const stats = { account: account.google_email, created: 0, updated: 0, removed: 0, errors: 0 }
    try {
      let q = db.from('jobs').select('id,title,client_name,employee_id,employee_name,scheduled_date,scheduled_time,address,description,instructions,status,job_category,spot_status')
        .gte('scheduled_date', from).lte('scheduled_date', to).order('scheduled_date').limit(800)
      if (account.owner_kind === 'employee' || account.export_scope !== 'all') q = q.eq('employee_id', account.owner_id)
      const { data: jobs, error } = await q
      if (error) throw error
      const cal = account.write_calendar_id || 'primary'
      const { data: links } = await db.from('google_calendar_links').select('id,job_id,status,calendar_id,google_event_id,job_hash').eq('account_id', account.id).in('status', ['exported', 'imported'])
      const exported = new Map((links || []).filter(l => l.status === 'exported' && l.job_id).map(l => [l.job_id, l]))
      // A job that came from this person's own Google event is already in their calendar.
      const cameFromHere = new Set((links || []).filter(l => l.status === 'imported' && l.job_id).map(l => l.job_id))
      const token = await accessToken(account)
      const inWindow = new Set()
      for (const job of jobs || []) {
        if (Date.now() > deadline - 6000) break
        inWindow.add(job.id)
        if (cameFromHere.has(job.id)) continue
        const link = exported.get(job.id)
        const gone = jobGoneFromAgenda(job)
        try {
          if (gone) {
            if (link) {
              await gfetch(`${CAL}/calendars/${encodeURIComponent(link.calendar_id)}/events/${encodeURIComponent(link.google_event_id)}`, { token, method: 'DELETE' }).catch(e => { if (e.status !== 404 && e.status !== 410) throw e })
              await db.from('google_calendar_links').delete().eq('id', link.id)
              stats.removed++
            }
            continue
          }
          const hash = jobHash(job, settings)
          if (link?.job_hash === hash) continue
          const body = jobToGoogleEvent(job, settings, { appUrl })
          if (link) {
            try {
              await gfetch(`${CAL}/calendars/${encodeURIComponent(link.calendar_id)}/events/${encodeURIComponent(link.google_event_id)}`, { token, method: 'PATCH', body })
              await db.from('google_calendar_links').update({ job_hash: hash, updated_at: new Date().toISOString() }).eq('id', link.id)
              stats.updated++
              continue
            } catch (e) {
              if (e.status !== 404 && e.status !== 410) throw e
              await db.from('google_calendar_links').delete().eq('id', link.id) // the person deleted it in Google → create again
            }
          }
          const ev = await gfetch(`${CAL}/calendars/${encodeURIComponent(cal)}/events`, { token, method: 'POST', body })
          await db.from('google_calendar_links').upsert({
            account_id: account.id, calendar_id: cal, google_event_id: ev.id, status: 'exported', job_id: job.id, job_hash: hash,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'account_id,calendar_id,google_event_id' })
          stats.created++
        } catch (e) {
          stats.errors++
          console.error('[google] export', account.google_email, job.id, e.message)
        }
      }
      // Job moved to another person: take it out of this person's calendar.
      for (const [jobId, link] of exported) {
        if (inWindow.has(jobId) || Date.now() > deadline - 4000) continue
        const { data: job } = await db.from('jobs').select('employee_id,scheduled_date,status').eq('id', jobId).maybeSingle()
        const stillMine = job && (account.export_scope === 'all' && account.owner_kind === 'admin' || job.employee_id === account.owner_id)
        const outOfWindow = job && (job.scheduled_date < from || job.scheduled_date > to)
        if (stillMine && outOfWindow) continue
        await gfetch(`${CAL}/calendars/${encodeURIComponent(link.calendar_id)}/events/${encodeURIComponent(link.google_event_id)}`, { token, method: 'DELETE' }).catch(() => {})
        await db.from('google_calendar_links').delete().eq('id', link.id)
        stats.removed++
      }
      await db.from('google_calendar_accounts').update({ last_export_at: new Date().toISOString(), last_error: stats.errors ? `${stats.errors} serviço(s) não foram para o Google` : null }).eq('id', account.id)
    } catch (e) {
      stats.errors++
      stats.error = e.message
      await db.from('google_calendar_accounts').update({ last_error: String(e.message).slice(0, 300) }).eq('id', account.id)
    }
    summary.push(stats)
  }
  return summary
}

/** Auto sync (cron / admin opening the app): import by the chosen mode + export. */
async function runAutoSync(db, appUrl, deadline) {
  const settings = await loadSettings(db)
  const { data: accounts, error } = await db.from('google_calendar_accounts').select('*')
  if (error) throw error
  const live = (accounts || []).filter(a => a.refresh_token_enc)
  const result = { imported: 0, pending: 0, exported: null, errors: [] }
  if (settings.auto_import !== 'off') {
    const today = tokyoToday()
    const { events, errors } = await newEvents(db, live.filter(a => a.import_enabled), today, addDays(today, Number(settings.days_ahead) || 60), deadline)
    result.errors.push(...errors)
    const fresh = events.filter(e => !e.pending).slice(0, 75)
    if (fresh.length) {
      const ctx = await context(db)
      const drafts = await buildDrafts(fresh, ctx, deadline)
      if (settings.auto_import === 'create') {
        const ready = drafts.filter(d => d.is_job && !d.problems.length && d.confidence >= 0.6)
        const { created } = await createJobs(db, ready.map(d => ({ key: d.key, draft: d })), settings, ctx)
        result.imported = created.length
        await savePending(db, drafts.filter(d => !ready.includes(d) && d.is_job))
        result.pending = drafts.filter(d => !ready.includes(d) && d.is_job).length
      } else {
        await savePending(db, drafts.filter(d => d.is_job))
        result.pending = drafts.filter(d => d.is_job).length
      }
      // Events the AI says are not work are remembered as ignored so they do not come back.
      const notWork = drafts.filter(d => !d.is_job).map(d => ({ account_id: d.event.account_id, calendar_id: d.event.calendar_id, google_event_id: d.event.event_id, status: 'ignored', updated_at: new Date().toISOString() }))
      if (notWork.length) await db.from('google_calendar_links').upsert(notWork, { onConflict: 'account_id,calendar_id,google_event_id' })
    }
  }
  if (settings.auto_export) result.exported = await exportJobs(db, live.filter(a => a.export_enabled), settings, appUrl, deadline)
  return result
}

// ── handlers ────────────────────────────────────────────────────────────────────────────────
async function status(req, res, user, db) {
  const settings = await loadSettings(db)
  let q = db.from('google_calendar_accounts').select('*').order('created_at')
  if (user.role === 'employee') q = q.eq('owner_kind', 'employee').eq('owner_id', user.id)
  const { data: accounts, error } = await q
  if (error) throw error
  let pending = []
  if (user.role === 'admin') {
    const { data } = await db.from('google_calendar_links').select('draft,account_id,calendar_id,google_event_id').eq('status', 'pending').order('created_at').limit(300)
    pending = (data || []).map(l => l.draft).filter(Boolean).filter(d => !d.event?.date || d.event.date >= addDays(tokyoToday(), -1))
  }
  const setup = user.role === 'admin' ? await setupStatus(db, accounts || []) : undefined
  res.status(200).json({ configured: googleConfigured(), redirectUri: redirectUri(req), settings, accounts: (accounts || []).map(publicAccount), pending, setup })
}

/**
 * v1.0.223 · what the admin "Integração Google Agenda" box shows: which server keys exist (names only,
 * never values) and how many people connected their own calendar. Read on every request, so once the
 * keys are in Vercel and the deploy restarts, the employee button turns on with no code change.
 */
export function setupChecks(env = process.env) {
  return [
    { name: 'GOOGLE_CLIENT_ID', ok: Boolean(env.GOOGLE_CLIENT_ID) },
    { name: 'GOOGLE_CLIENT_SECRET', ok: Boolean(env.GOOGLE_CLIENT_SECRET) },
    { name: 'SALES_SESSION_SECRET', ok: Boolean(env.SALES_SESSION_SECRET && env.SALES_SESSION_SECRET.length >= 32) },
  ]
}
async function setupStatus(db, accounts) {
  const live = accounts.filter(a => a.refresh_token_enc)
  const { count } = await db.from('employees').select('id', { count: 'exact', head: true }).eq('is_active', true)
  return {
    checks: setupChecks(),
    tables: true,
    employeesConnected: new Set(live.filter(a => a.owner_kind === 'employee').map(a => a.owner_id)).size,
    employeesTotal: count ?? null,
    adminConnected: live.filter(a => a.owner_kind === 'admin').length,
  }
}

function startUrl(req, who) {
  const state = signPayload({ ...who, exp: Math.floor(Date.now() / 1000) + 900, n: randomBytes(6).toString('base64url') })
  const qs = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(req), response_type: 'code', scope: SCOPES,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${qs}`
}

async function connect(req, res, db) {
  if (!googleConfigured()) return res.status(503).send(page('Google ainda não configurado', 'O administrador precisa colocar GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no Vercel.'))
  const invite = first(req.query?.t)
  if (invite) {
    const data = readSigned(invite)
    if (!data || data.k !== 'employee' || !UUID.test(data.i)) return res.status(400).send(page('Link vencido', 'Peça um link novo ao escritório.'))
    return res.redirect(302, startUrl(req, { k: 'employee', i: data.i, nm: data.nm, ret: 'done' }))
  }
  const user = readSalesSession(req)
  if (!user || !['admin', 'employee'].includes(user.role)) return res.redirect(302, '/login')
  if (user.role === 'employee') return res.redirect(302, startUrl(req, { k: 'employee', i: user.id, nm: user.name, ret: 'employee' }))
  const emp = String(first(req.query?.employee) || '')
  if (UUID.test(emp)) {
    const { data: e } = await db.from('employees').select('id,full_name').eq('id', emp).maybeSingle()
    if (!e) return res.status(404).send(page('Funcionário não encontrado', ''))
    return res.redirect(302, startUrl(req, { k: 'employee', i: e.id, nm: e.full_name, ret: 'admin' }))
  }
  return res.redirect(302, startUrl(req, { k: 'admin', i: user.id, nm: user.name || user.email, ret: 'admin' }))
}

function page(title, text) {
  const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<body style="font-family:system-ui,sans-serif;background:#f4f6fb;margin:0;display:grid;place-items:center;min-height:100vh;padding:16px">
<div style="background:#fff;border-radius:16px;padding:28px;max-width:420px;box-shadow:0 4px 20px #0001;text-align:center">
<div style="font-size:42px">📅</div><h2 style="margin:8px 0">${esc(title)}</h2><p style="color:#555">${esc(text)}</p>
<a href="/" style="display:inline-block;margin-top:8px;background:#2563eb;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">Abrir KuriPuro</a></div></body>`
}

async function callback(req, res, db) {
  const state = readSigned(first(req.query?.state))
  if (!state) return res.status(400).send(page('Link vencido', 'Tente conectar de novo.'))
  if (req.query?.error) return res.status(400).send(page('Conexão cancelada', 'Nada foi conectado.'))
  const tokens = await gfetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    form: { code: first(req.query?.code), client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri(req), grant_type: 'authorization_code' },
  })
  const info = await gfetch('https://openidconnect.googleapis.com/v1/userinfo', { token: tokens.access_token })
  const email = String(info.email || '').toLowerCase()
  if (!email) throw new Error('Google não informou o e-mail')
  const cals = await listCalendars(tokens.access_token)
  const { data: existing } = await db.from('google_calendar_accounts').select('id,calendars,refresh_token_enc').eq('owner_kind', state.k).eq('owner_id', state.i).eq('google_email', email).maybeSingle()
  const before = new Map((existing?.calendars || []).map(c => [c.id, c]))
  const calendars = cals.map(c => ({ ...c, import: before.has(c.id) ? Boolean(before.get(c.id).import) : c.primary }))
  // Google only sends a refresh token on the first consent; keep the old one if this time it did not.
  const refresh = tokens.refresh_token ? encryptToken(tokens.refresh_token) : existing?.refresh_token_enc
  if (!refresh) return res.status(400).send(page('Falta permissão', 'Remova o acesso do KuriPuro em myaccount.google.com/permissions e conecte de novo.'))
  const row = {
    owner_kind: state.k, owner_id: state.i, owner_name: state.nm || '', google_email: email, refresh_token_enc: refresh,
    calendars, updated_at: new Date().toISOString(), last_error: null,
    ...(existing ? {} : { export_scope: state.k === 'admin' ? 'all' : 'mine', write_calendar_id: 'primary' }),
  }
  const { error } = await db.from('google_calendar_accounts').upsert(row, { onConflict: 'owner_kind,owner_id,google_email' })
  if (error) throw error
  if (state.ret === 'admin') return res.redirect(302, `/google-agenda?connected=${encodeURIComponent(email)}`)
  return res.status(200).send(page('Google Agenda conectada ✓', `${email} — seus serviços da KuriPuro vão aparecer na sua agenda, sempre marcados com a empresa. Pode fechar esta página.`))
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  try { return JSON.parse(req.body || '{}') } catch { return {} }
}

export default async function google(req, res) {
  const op = String(first(req.query?.op) || '')
  const appUrl = origin(req)
  let db
  try {
    db = salesDb()
    if (op === 'cron') {
      const configured = process.env.CRON_SECRET
      if (!configured || !safeEquals(req.headers.authorization, `Bearer ${configured}`)) return res.status(401).json({ error: 'Unauthorized' })
      return res.status(200).json(await runAutoSync(db, 'https://kuripuro.vercel.app', Date.now() + 55000))
    }
    if (op === 'connect') return await connect(req, res, db)
    if (op === 'callback') return await callback(req, res, db)

    const user = sessionOf(req, res, ['admin', 'employee'])
    if (!user) return
    if (op === 'status') return await status(req, res, user, db)
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const body = await readBody(req)

    if (op === 'account') {
      const { data: acc } = await db.from('google_calendar_accounts').select('*').eq('id', String(body.id || '')).maybeSingle()
      if (!acc || (user.role !== 'admin' && !(acc.owner_kind === 'employee' && acc.owner_id === user.id))) return res.status(404).json({ error: 'Conta não encontrada' })
      const patch = { updated_at: new Date().toISOString() }
      if (typeof body.import_enabled === 'boolean') patch.import_enabled = body.import_enabled
      if (typeof body.export_enabled === 'boolean') patch.export_enabled = body.export_enabled
      if (['mine', 'all'].includes(body.export_scope) && acc.owner_kind === 'admin') patch.export_scope = body.export_scope
      if (Array.isArray(body.import_calendars)) patch.calendars = (acc.calendars || []).map(c => ({ ...c, import: body.import_calendars.includes(c.id) }))
      if (typeof body.write_calendar_id === 'string' && (acc.calendars || []).some(c => c.id === body.write_calendar_id && c.writable !== false)) patch.write_calendar_id = body.write_calendar_id
      if (body.refresh_calendars) {
        const cals = await listCalendars(await accessToken(acc))
        const before = new Map((acc.calendars || []).map(c => [c.id, c]))
        patch.calendars = cals.map(c => ({ ...c, import: before.has(c.id) ? Boolean(before.get(c.id).import) : false }))
      }
      const { data, error } = await db.from('google_calendar_accounts').update(patch).eq('id', acc.id).select().single()
      if (error) throw error
      return res.status(200).json({ account: publicAccount(data) })
    }
    if (op === 'disconnect') {
      const { data: acc } = await db.from('google_calendar_accounts').select('*').eq('id', String(body.id || '')).maybeSingle()
      if (!acc || (user.role !== 'admin' && !(acc.owner_kind === 'employee' && acc.owner_id === user.id))) return res.status(404).json({ error: 'Conta não encontrada' })
      const refresh = decryptToken(acc.refresh_token_enc)
      if (refresh) await gfetch('https://oauth2.googleapis.com/revoke', { method: 'POST', form: { token: refresh } }).catch(() => {})
      await db.from('google_calendar_accounts').delete().eq('id', acc.id)
      return res.status(200).json({ ok: true })
    }

    // v1.0.187 · the employee sends their own services to their Google Calendar now.
    if (op === 'my-sync') {
      if (user.role !== 'employee') return res.status(403).json({ error: 'Só para funcionário.' })
      const settings = await loadSettings(db)
      const { data: mine, error } = await db.from('google_calendar_accounts').select('*').eq('owner_kind', 'employee').eq('owner_id', user.id)
      if (error) throw error
      const live = (mine || []).filter(a => a.refresh_token_enc && a.export_enabled)
      if (!live.length) return res.status(400).json({ error: 'Conecte sua conta Google primeiro.' })
      return res.status(200).json({ exported: await exportJobs(db, live, settings, appUrl, Date.now() + 50000) })
    }

    if (user.role !== 'admin') return res.status(403).json({ error: 'Só o administrador.' })

    if (op === 'settings') {
      const patch = { id: 1, updated_by: user.name || user.email || user.id, updated_at: new Date().toISOString() }
      if (typeof body.company_tag === 'string') patch.company_tag = body.company_tag.replace(/[[\]]/g, '').trim().slice(0, 30)
      if (AUTO_IMPORT_MODES.includes(body.auto_import)) patch.auto_import = body.auto_import
      if (typeof body.auto_export === 'boolean') patch.auto_export = body.auto_export
      if (/^([1-9]|1[01])$/.test(String(body.color_id ?? ''))) patch.color_id = String(body.color_id)
      if (Number(body.days_ahead) >= 7 && Number(body.days_ahead) <= 180) patch.days_ahead = Math.round(Number(body.days_ahead))
      if (Number(body.default_hours) > 0 && Number(body.default_hours) <= 12) patch.default_hours = Number(body.default_hours)
      const { data, error } = await db.from('google_calendar_settings').upsert(patch).select().single()
      if (error) throw error
      return res.status(200).json({ settings: { ...DEFAULT_SETTINGS, ...data } })
    }
    if (op === 'invite') {
      const id = String(body.employee_id || '')
      if (!UUID.test(id)) return res.status(400).json({ error: 'Funcionário inválido' })
      const { data: e } = await db.from('employees').select('id,full_name').eq('id', id).maybeSingle()
      if (!e) return res.status(404).json({ error: 'Funcionário não encontrado' })
      const t = signPayload({ k: 'employee', i: e.id, nm: e.full_name, exp: Math.floor(Date.now() / 1000) + 7 * 86400 })
      return res.status(200).json({ url: `${appUrl}/api/google/connect?t=${encodeURIComponent(t)}` })
    }
    if (op === 'preview') {
      const deadline = Date.now() + 52000
      const today = tokyoToday()
      const from = /^\d{4}-\d{2}-\d{2}$/.test(body.from || '') ? body.from : today
      const to = /^\d{4}-\d{2}-\d{2}$/.test(body.to || '') ? body.to : addDays(today, 60)
      if (to < from || (Date.parse(to) - Date.parse(from)) / 86400000 > 800) return res.status(400).json({ error: 'Período inválido (máximo 800 dias).' })
      let q = db.from('google_calendar_accounts').select('*').eq('import_enabled', true)
      if (Array.isArray(body.account_ids) && body.account_ids.length) q = q.in('id', body.account_ids.filter(id => UUID.test(id)))
      const { data: accounts, error } = await q
      if (error) throw error
      const live = (accounts || []).filter(a => a.refresh_token_enc)
      if (!live.length) return res.status(400).json({ error: 'Nenhuma conta Google conectada com importação ligada.' })
      const { events, errors } = await newEvents(db, live, from, to, deadline)
      // Events already analysed (waiting for review) keep their draft; only new ones go to the AI.
      const { data: stored } = await db.from('google_calendar_links').select('account_id,calendar_id,google_event_id,draft').eq('status', 'pending').in('account_id', live.map(a => a.id))
      const kept = new Map((stored || []).filter(l => l.draft).map(l => [`${l.account_id}|${l.calendar_id}|${l.google_event_id}`, l.draft]))
      const ctx = await context(db)
      const old = events.filter(e => kept.has(e.key)).map(e => {
        const d = finishDraft({ ...kept.get(e.key), key: e.key }, { ...ctx, event: e })
        return { ...d, event: e, problems: draftProblems(d) }
      })
      const fresh = events.filter(e => !kept.has(e.key))
      const max = 120
      const drafts = [...old, ...await buildDrafts(fresh.slice(0, max), ctx, deadline)]
      await savePending(db, drafts.filter(d => !kept.has(d.key)))
      drafts.sort((a, b) => `${a.event.date} ${a.event.time}`.localeCompare(`${b.event.date} ${b.event.time}`))
      return res.status(200).json({ drafts, total: events.length, more: Math.max(0, fresh.length - max), errors, from, to, context: { places: ctx.places, employees: ctx.employees.map(e => ({ id: e.id, full_name: e.full_name })), clients: ctx.clients } })
    }
    if (op === 'import') {
      const settings = await loadSettings(db)
      const ctx = await context(db)
      const items = (Array.isArray(body.items) ? body.items : []).slice(0, 200)
      const result = await createJobs(db, items, settings, ctx)
      return res.status(200).json(result)
    }
    if (op === 'ignore') {
      const keys = (Array.isArray(body.keys) ? body.keys : []).slice(0, 500)
      const rows = keys.map(k => String(k).split('|')).filter(p => UUID.test(p[0]) && p[1] && p[2])
        .map(([a, c, ...r]) => ({ account_id: a, calendar_id: c, google_event_id: r.join('|'), status: 'ignored', draft: null, updated_at: new Date().toISOString() }))
      if (rows.length) {
        const { error } = await db.from('google_calendar_links').upsert(rows, { onConflict: 'account_id,calendar_id,google_event_id' })
        if (error) throw error
      }
      return res.status(200).json({ ignored: rows.length })
    }
    if (op === 'sync') {
      return res.status(200).json(await runAutoSync(db, appUrl, Date.now() + 50000))
    }
    return res.status(404).json({ error: 'Google endpoint not found.' })
  } catch (error) {
    console.error('[google]', op, error?.message || error)
    const msg = String(error?.message || error)
    if (MISSING_TABLE.test(msg) && /google_calendar/.test(msg)) {
      return res.status(503).json({ error: 'Falta rodar o SQL sql/2026-11-06_google_agenda.sql no Supabase.', needsSql: true })
    }
    if (op === 'callback') return res.status(500).send(page('Não deu para conectar', msg.slice(0, 200)))
    return res.status(500).json({ error: msg.slice(0, 300) })
  }
}
