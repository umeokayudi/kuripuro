// v1.0.213 · E-mail de confirmação com relatórios, por cliente (liga/desliga no cadastro).
//
// Gatilho 1 (dia, automático): o banco já avisa /api/push?op=event quando um job muda de status
// (sql/2026-10-25_push_notificacoes.sql). Quando o ÚLTIMO serviço regular do cliente naquele dia
// chega a um estado final (concluído ou "não feito"), monta UM e-mail com todos os serviços do dia.
// Gatilho 2 (spot): spot concluído → um e-mail daquele spot.
//
// Sem SQL novo: configuração, marcas de "já enviado" e registro ficam no Storage (service-photos):
//   client-email/settings.json                    { clients: { <id>: { enabled, lang, since, by, at } } }
//   client-email/sent/<clientId>/<date>.json      marca do dia (criada sem upsert = trava contra duplicado)
//   client-email/sent/<clientId>/spot-<job>.json  marca do spot
//   client-email/log/<stamp>-<id>.json            registro: data/hora, cliente, gatilho, destinatários, status
//   client-email/out/<id>.pdf | .html             o que foi (ou seria) enviado
//
// MODO DE TESTE (padrão): nada sai para cliente. Só envia de verdade com CLIENT_EMAIL_MODE=live e
// RESEND_API_KEY na Vercel. Em teste, CLIENT_EMAIL_TEST_TO (opcional) recebe a cópia no lugar do cliente.
//
// Rotas (/api/client-email → /api/sales?route=client-email), todas só para admin:
//   GET  ?op=settings   configuração + modo
//   POST ?op=toggle     { clientId, enabled, lang }
//   GET  ?op=log        últimos envios
//   POST ?op=resend     { clientId, date } ou { jobId } (spot) — "Reenviar relatório do dia"
//   POST ?op=preview    { clientId, date } ou { jobId } — monta sem enviar
import { randomBytes } from 'node:crypto'
import { salesDb } from './_salesSession.js'
import { requireAdmin } from './_auth.js'
import { buildReportPdf } from './_client-email-pdf.js'
import { buildClientEmail, serviceLine, clientRecipients, EMAIL_LANGS } from '../src/lib/clientEmailContent.js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://fxsakrshmldmkdmbevna.supabase.co'
const BUCKET = 'service-photos'
const ROOT = 'client-email'
const PORTAL_URL = process.env.PUBLIC_APP_URL || 'https://kuripuro.vercel.app'
const OFFICE = { email: process.env.CLIENT_EMAIL_REPLY_TO || 'umeokagroup@gmail.com', phone: '070-9073-2909' }
const MAX_PDF = 15 * 1024 * 1024
const FINAL = new Set(['completed', 'cancelled', 'canceled', 'not_done'])

const JOB_COLS = 'id,title,description,client_id,client_name,employee_name,scheduled_date,scheduled_time,sequence_order,status,started_at,completed_at,job_category,photo_start_url,photo_end_url'

export function emailMode() {
  return process.env.CLIENT_EMAIL_MODE === 'live' && process.env.RESEND_API_KEY ? 'live' : 'test'
}

const jstDate = (d = new Date()) => new Date(new Date(d).getTime() + 9 * 3600_000).toISOString().slice(0, 10)

// ── Storage ───────────────────────────────────────────────────────────────
function key() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY precisa estar configurada no servidor.')
  return k
}
const H = (extra = {}) => ({ apikey: key(), Authorization: `Bearer ${key()}`, ...extra })
const objUrl = path => `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`
export const publicUrl = path => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`

async function putFile(path, body, contentType, { upsert = true } = {}) {
  const r = await fetch(objUrl(path), { method: 'POST', headers: H({ 'Content-Type': contentType, 'x-upsert': upsert ? 'true' : 'false', 'cache-control': 'no-cache' }), body })
  if (r.ok) return true
  const detail = await r.text().catch(() => '')
  if (!upsert && (r.status === 409 || r.status === 400) && /exist|duplicate/i.test(detail)) return false
  throw new Error(`Storage ${r.status}: ${detail.slice(0, 160)}`)
}
const putJson = (path, obj, opts) => putFile(path, JSON.stringify(obj), 'application/json', opts)

async function getBuffer(path) {
  const r = await fetch(objUrl(path), { headers: H() })
  return r.ok ? Buffer.from(await r.arrayBuffer()) : null
}
async function getJson(path) {
  const b = await getBuffer(path).catch(() => null)
  if (!b) return null
  try { return JSON.parse(b.toString('utf8')) } catch { return null }
}
async function list(prefix, { limit = 200, desc = false } = {}) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST', headers: H({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefix, limit, sortBy: { column: 'name', order: desc ? 'desc' : 'asc' } }),
  })
  if (!r.ok) return []
  const rows = await r.json().catch(() => [])
  return (Array.isArray(rows) ? rows : []).filter(x => x?.name && x.id !== null)
}

// ── Settings ──────────────────────────────────────────────────────────────
export async function readSettings() {
  const s = await getJson(`${ROOT}/settings.json`)
  return { clients: {}, ...(s && typeof s === 'object' ? s : {}) }
}
const clientSetting = (settings, id) => settings.clients?.[id] || null

// ── Data for one e-mail ───────────────────────────────────────────────────
const isEliminated = async job => Boolean(await getJson(`jobs/${job.id}/eliminado.json`))

/** Notes written in the job's service report (作業報告書 特記事項). Nothing written → ''. */
async function reportNotes(jobId) {
  const ref = await getJson(`work-reports/_job/${jobId}.json`)
  if (!ref?.id) return ''
  const r = await getJson(`work-reports/${ref.id}/report.json`)
  return String(r?.notices || '').trim()
}

const normPath = p => {
  if (!p) return null
  const m = String(p).match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/service-photos\/([^?]+)/)
  return m ? decodeURIComponent(m[1]) : String(p).replace(/^\/+/, '')
}

/** Paths of before / after photos of a job (same rules as src/lib/workMedia.js). */
async function photoPaths(job) {
  const before = [], after = []
  const add = (arr, p) => { const n = normPath(p); if (n && !before.includes(n) && !after.includes(n)) arr.push(n) }
  for (const f of await list(`jobs/${job.id}/`, { limit: 200 })) {
    if (/^start_?\d*\.(jpe?g|png)$/i.test(f.name)) add(before, `jobs/${job.id}/${f.name}`)
    else if (/^(end_?\d*|retro\d*)\.(jpe?g|png)$/i.test(f.name)) add(after, `jobs/${job.id}/${f.name}`)
  }
  if (job.photo_start_url) add(before, job.photo_start_url)
  if (job.photo_end_url) add(after, job.photo_end_url)
  return { before, after }
}

async function photosFor(job, perSide) {
  const { before, after } = await photoPaths(job)
  const load = async paths => (await Promise.all(paths.slice(0, perSide).map(p => getBuffer(p).catch(() => null)))).filter(Boolean)
  return { before: await load(before), after: await load(after) }
}

const orderJobs = jobs => [...jobs].sort((a, b) =>
  String(a.scheduled_time || '').localeCompare(String(b.scheduled_time || '')) || (a.sequence_order ?? 999) - (b.sequence_order ?? 999) || String(a.title || '').localeCompare(String(b.title || ''), 'ja'))

/**
 * Splits the client's jobs of one day into what goes in the e-mail.
 * Pure (tests): `eliminated` = Set of job ids the office removed as mistakes (never shown).
 * Returns { pending, done, notDone } — pending > 0 means the day is not over yet.
 */
export function dayState(jobs, { eliminated = new Set() } = {}) {
  const regular = (jobs || []).filter(j => j.client_id && j.job_category !== 'spot' && !eliminated.has(j.id))
  return {
    pending: regular.filter(j => !FINAL.has(j.status)),
    done: orderJobs(regular.filter(j => j.status === 'completed')),
    notDone: orderJobs(regular.filter(j => j.status !== 'completed' && FINAL.has(j.status))),
  }
}

async function loadClient(db, clientId) {
  const { data, error } = await db.from('clients').select('id,company_name,contact_name,contact_person,manager_name,email,manager_email,is_active').eq('id', clientId).maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

async function dayJobs(db, clientId, date) {
  const { data, error } = await db.from('jobs').select(JOB_COLS).eq('client_id', clientId).eq('scheduled_date', date)
  if (error) throw new Error(error.message)
  const jobs = data || []
  const cancelled = jobs.filter(j => !['completed', 'assigned', 'in_progress'].includes(j.status))
  const flags = await Promise.all(cancelled.map(async j => [j.id, await isEliminated(j)]))
  return { jobs, eliminated: new Set(flags.filter(f => f[1]).map(f => f[0])) }
}

/** Builds subject/html/text + PDF for a set of finished jobs. Never sends. */
async function compose({ kind, client, date, done, notDone, lang }) {
  const L = EMAIL_LANGS.includes(lang) ? lang : 'ja'
  const services = await Promise.all(done.map(async j => serviceLine(j, { notes: await reportNotes(j.id).catch(() => ''), lang: L })))
  const notDoneLines = notDone.map(j => serviceLine(j, { lang: L }))
  const emailClient = { company_name: client.company_name, contact_name: client.manager_name || client.contact_name || client.contact_person || '' }

  let pdf = null, delivery = 'link', pdfError = ''
  for (const perSide of [3, 1]) {
    try {
      const withPhotos = await Promise.all(done.map(async (j, i) => ({ ...services[i], photos: await photosFor(j, perSide) })))
      const bytes = await buildReportPdf({ client: emailClient, date, services: withPhotos, notDone: notDoneLines, kind, lang: L })
      if (bytes.length <= MAX_PDF) { pdf = Buffer.from(bytes); delivery = 'pdf'; break }
      pdfError = `PDF grande demais (${Math.round(bytes.length / 1048576)} MB)`
    } catch (err) {
      pdfError = err?.message || 'PDF falhou'
      break
    }
  }
  const mail = buildClientEmail({ kind, client: emailClient, date, services, notDone: notDoneLines, delivery, portalUrl: PORTAL_URL, contact: OFFICE, lang: L })
  return { ...mail, pdf, delivery, pdfError, services, notDone: notDoneLines }
}

// ── Sending ───────────────────────────────────────────────────────────────
async function deliver({ to, subject, html, text, pdf, filename }) {
  const mode = emailMode()
  const testTo = String(process.env.CLIENT_EMAIL_TEST_TO || '').trim()
  if (mode !== 'live' && !(testTo && process.env.RESEND_API_KEY)) return { status: 'test', mode, reason: 'modo de teste: não enviado' }
  const recipients = mode === 'live' ? to : [testTo]
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.CLIENT_EMAIL_FROM || 'KuriPuro <onboarding@resend.dev>',
      to: recipients,
      reply_to: OFFICE.email,
      subject: mode === 'live' ? subject : `[TESTE → ${to.join(', ')}] ${subject}`,
      html, text,
      ...(pdf ? { attachments: [{ filename, content: pdf.toString('base64') }] } : {}),
    }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) return { status: 'failed', mode, reason: String(data?.message || data?.error || `Resend ${r.status}`).slice(0, 300) }
  return { status: mode === 'live' ? 'sent' : 'test', mode, reason: mode === 'live' ? '' : `modo de teste: cópia enviada só para ${testTo}`, provider_id: data?.id || null, sent_to: recipients }
}

const newId = () => `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`
const stamp = () => new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)

async function writeLog(entry) {
  const id = entry.id || newId()
  const row = { ...entry, id, at: entry.at || new Date().toISOString() }
  await putJson(`${ROOT}/log/${stamp()}-${id}.json`, row).catch(() => {})
  return row
}

/** Compose + send (or test) + log. `trigger`: 'day' | 'spot' | 'resend'. */
async function sendFor({ client, setting, kind, date, done, notDone, trigger, jobIds, by = 'auto', preview = false }) {
  const to = clientRecipients(client)
  const lang = setting?.lang || 'ja'
  const id = newId()
  const base = { id, client_id: client.id, client_name: client.company_name, trigger, kind, date, job_ids: jobIds, to, by }
  if (!to.length) return writeLog({ ...base, status: 'failed', reason: 'cliente sem e-mail cadastrado' })
  const mail = await compose({ kind, client, date, done, notDone, lang })
  const files = {}
  await putFile(`${ROOT}/out/${id}.html`, mail.html, 'text/html; charset=utf-8').then(() => { files.html_url = publicUrl(`${ROOT}/out/${id}.html`) }).catch(() => {})
  if (mail.pdf) await putFile(`${ROOT}/out/${id}.pdf`, mail.pdf, 'application/pdf').then(() => { files.pdf_url = publicUrl(`${ROOT}/out/${id}.pdf`) }).catch(() => {})
  const summary = { ...base, ...files, subject: mail.subject, delivery: mail.delivery, pdf_error: mail.pdfError || '', services: mail.services.length, not_done: mail.notDone.length }
  if (preview) return { ...summary, status: 'preview', mode: emailMode() }
  const filename = `sagyo-houkoku_${date}.pdf`
  let result
  try { result = await deliver({ to, subject: mail.subject, html: mail.html, text: mail.text, pdf: mail.pdf, filename }) } catch (err) { result = { status: 'failed', mode: emailMode(), reason: err?.message || 'erro no envio' } }
  return writeLog({ ...summary, ...result })
}

// ── Automatic triggers (called from the DB job event) ─────────────────────
/**
 * Called for every job status change. Never throws (the push notice must still go out).
 * Returns what happened, for logs/tests.
 */
export async function onJobEvent({ id, old } = {}, { db = salesDb() } = {}) {
  try {
    if (!id) return { skipped: 'no-id' }
    const { data: job, error } = await db.from('jobs').select(JOB_COLS).eq('id', id).maybeSingle()
    if (error) return { error: error.message }
    if (!job?.client_id || !FINAL.has(job.status)) return { skipped: 'not-final' }
    if (old && old.status && old.status === job.status) return { skipped: 'same-status' }
    const settings = await readSettings()
    const setting = clientSetting(settings, job.client_id)
    if (!setting?.enabled) return { skipped: 'client-off' }
    const since = setting.since || '0000-00-00'
    const client = await loadClient(db, job.client_id)
    if (!client) return { skipped: 'no-client' }

    if (job.job_category === 'spot') {
      if (job.status !== 'completed') return { skipped: 'spot-not-completed' }
      if (jstDate(job.completed_at || Date.now()) < since || String(job.scheduled_date || '') < since) return { skipped: 'before-enabled' }
      const claimed = await putJson(`${ROOT}/sent/${client.id}/spot-${job.id}.json`, { at: new Date().toISOString() }, { upsert: false })
      if (!claimed) return { skipped: 'already-sent' }
      return await sendFor({ db, client, setting, kind: 'spot', date: job.scheduled_date || jstDate(job.completed_at), done: [job], notDone: [], trigger: 'spot', jobIds: [job.id] })
    }

    const date = String(job.scheduled_date || '')
    if (!date || date < since) return { skipped: 'before-enabled' }
    const { jobs, eliminated } = await dayJobs(db, client.id, date)
    const st = dayState(jobs, { eliminated })
    if (st.pending.length) return { skipped: 'day-not-over', pending: st.pending.length }
    if (!st.done.length) return { skipped: 'nothing-done' }
    // Claim the day: only the first call creates the file; any later one (another job, a "Já fiz"
    // days later, a replayed event) stops here. Re-sending is the admin's "Reenviar" button.
    const claimed = await putJson(`${ROOT}/sent/${client.id}/${date}.json`, { at: new Date().toISOString(), job_ids: st.done.map(j => j.id) }, { upsert: false })
    if (!claimed) return { skipped: 'already-sent' }
    return await sendFor({ db, client, setting, kind: 'day', date, done: st.done, notDone: st.notDone, trigger: 'day', jobIds: [...st.done, ...st.notDone].map(j => j.id) })
  } catch (err) {
    console.error('[client-email]', err)
    return { error: err?.message || 'client-email failed' }
  }
}

// ── Admin routes ──────────────────────────────────────────────────────────
async function readLog(limit = 100) {
  const files = await list(`${ROOT}/log/`, { limit, desc: true })
  const rows = await Promise.all(files.map(f => getJson(`${ROOT}/log/${f.name}`)))
  return rows.filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at)))
}

async function manual(req, res, { preview }) {
  const db = salesDb()
  const { clientId, date, jobId } = req.body || {}
  const settings = await readSettings()
  if (jobId) {
    const { data: job } = await db.from('jobs').select(JOB_COLS).eq('id', jobId).maybeSingle()
    if (!job?.client_id) return res.status(404).json({ error: 'Serviço não encontrado.' })
    if (job.status !== 'completed') return res.status(400).json({ error: 'O serviço ainda não foi concluído.' })
    const client = await loadClient(db, job.client_id)
    const out = await sendFor({ db, client, setting: clientSetting(settings, client.id), kind: 'spot', date: job.scheduled_date, done: [job], notDone: [], trigger: 'resend', jobIds: [job.id], by: String(req.body?.by || 'admin').slice(0, 60), preview })
    return res.status(200).json({ ok: true, result: out })
  }
  if (!clientId || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return res.status(400).json({ error: 'Escolha o cliente e o dia.' })
  const client = await loadClient(db, clientId)
  if (!client) return res.status(404).json({ error: 'Cliente não encontrado.' })
  const { jobs, eliminated } = await dayJobs(db, client.id, date)
  const st = dayState(jobs, { eliminated })
  if (!st.done.length) return res.status(400).json({ error: 'Nenhum serviço regular concluído neste dia.' })
  const out = await sendFor({ db, client, setting: clientSetting(settings, client.id), kind: 'day', date, done: st.done, notDone: st.notDone, trigger: 'resend', jobIds: [...st.done, ...st.notDone].map(j => j.id), by: String(req.body?.by || 'admin').slice(0, 60), preview })
  if (!preview) await putJson(`${ROOT}/sent/${client.id}/${date}.json`, { at: new Date().toISOString(), resend: true }).catch(() => {})
  return res.status(200).json({ ok: true, result: out, pending: st.pending.length })
}

export default async function handler(req, res) {
  const op = String(req.query?.op || '')
  try {
    if (!(await requireAdmin(req, res))) return
    if (req.method === 'GET' && op === 'settings') {
      const settings = await readSettings()
      return res.status(200).json({ ok: true, settings, mode: emailMode(), testTo: process.env.CLIENT_EMAIL_TEST_TO ? 'set' : '' })
    }
    if (req.method === 'GET' && op === 'log') return res.status(200).json({ ok: true, log: await readLog(Number(req.query?.limit) || 100), mode: emailMode() })
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    if (op === 'toggle') {
      const { clientId, enabled, lang, by } = req.body || {}
      if (!clientId) return res.status(400).json({ error: 'clientId?' })
      const client = await loadClient(salesDb(), clientId)
      if (!client) return res.status(404).json({ error: 'Cliente não encontrado.' })
      if (enabled && !clientRecipients(client).length) return res.status(400).json({ error: 'Este cliente não tem e-mail cadastrado. Cadastre o e-mail antes de ligar.' })
      const settings = await readSettings()
      const prev = settings.clients[clientId] || {}
      settings.clients[clientId] = {
        enabled: !!enabled,
        lang: EMAIL_LANGS.includes(lang) ? lang : (prev.lang || 'ja'),
        // turning it on never sends old days: only days from today on count
        since: enabled ? (prev.enabled ? prev.since : jstDate()) : (prev.since || null),
        by: String(by || 'admin').slice(0, 60),
        at: new Date().toISOString(),
      }
      settings.updated_at = new Date().toISOString()
      await putJson(`${ROOT}/settings.json`, settings)
      return res.status(200).json({ ok: true, setting: settings.clients[clientId] })
    }
    if (op === 'resend') return await manual(req, res, { preview: false })
    if (op === 'preview') return await manual(req, res, { preview: true })
    return res.status(404).json({ error: 'Unknown op.' })
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'client-email failed' })
  }
}
