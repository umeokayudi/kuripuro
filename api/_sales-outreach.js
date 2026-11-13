// v1.0.234 · Sales outreach: base of target companies, today's call queue and meeting-request e-mails.
// No new table: a target company is a sales_leads row with stage 'target' (kept out of the funnel
// until somebody shows interest), every call or e-mail is a sales_touchpoints row.
//   GET  /api/sales-data?action=outreach                       → { targets, queue, email }
//   POST /api/sales-data { action: 'targets-import', rows }     → adds companies to the base (no duplicates)
//   POST /api/sales-data { action: 'call-result', lead_id, result, note }
//   POST /api/sales-data { action: 'outreach-email', lead_ids, subject, body, dry_run }
//   GET  /api/sales?route=optout&t=<signed>                     → the company leaves the e-mail list
// E-mails are only really sent with SALES_EMAIL_MODE=live + RESEND_API_KEY + SALES_EMAIL_FROM
// (an address on the separate sales domain). Otherwise the call answers with what WOULD be sent.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { QUOTE_ISSUER } from '../src/lib/quoteIssuer.js'
import { callPriority, CALL_RESULTS, normalizeTargetRow, targetKey, fillTemplate } from '../src/lib/salesOutreach.js'

const OPEN = ['target', 'approach', 'followup', 'quote', 'negotiation']
const LEAD_COLS = 'id,stage,company_name,site_name,address,region,industry,phone,email,website,contact_name,contact_title,contact_phone,contact_email,interest,source,notes,salesperson_id,first_contact_date,last_contact_date,next_followup_date,created_at,updated_at'
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
}
function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const fail = (status, message) => Object.assign(new Error(message), { status })

export function emailSettings() {
  const from = String(process.env.SALES_EMAIL_FROM || '').trim()
  const limit = Math.max(1, Math.min(500, Number(process.env.SALES_EMAIL_DAILY_LIMIT) || 30))
  const live = process.env.SALES_EMAIL_MODE === 'live' && !!process.env.RESEND_API_KEY && EMAIL_RE.test(from.replace(/^.*<|>.*$/g, ''))
  return { from, limit, live, domain: (from.match(/@([^>\s]+)/) || [])[1] || '' }
}

function optoutSecret() {
  return process.env.SALES_SESSION_SECRET || ''
}
export function optoutToken(leadId) {
  return `${leadId}.${createHmac('sha256', optoutSecret()).update(`optout:${leadId}`).digest('base64url').slice(0, 24)}`
}
function readOptout(token) {
  const [id, sig] = String(token || '').split('.')
  if (!id || !sig || !optoutSecret()) return null
  const good = Buffer.from(optoutToken(id).split('.')[1])
  const got = Buffer.from(sig)
  return good.length === got.length && timingSafeEqual(good, got) ? id : null
}

async function loadOpen(db, user) {
  let q = db.from('sales_leads').select(LEAD_COLS).in('stage', OPEN).order('updated_at', { ascending: false }).limit(3000)
  // a seller works their own leads plus the shared base (targets nobody took yet)
  if (user.role !== 'admin') q = q.or(`salesperson_id.eq.${user.id},and(salesperson_id.is.null,stage.eq.target)`)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

async function recentTouches(db, leadIds, since) {
  if (!leadIds.length) return []
  const out = []
  for (let i = 0; i < leadIds.length; i += 150) {
    const { data, error } = await db.from('sales_touchpoints')
      .select('lead_id,event_type,happened_at,channel,response_tag,said_by,created_at')
      .in('lead_id', leadIds.slice(i, i + 150)).gte('happened_at', since).order('created_at', { ascending: false }).limit(3000)
    if (error) throw error
    out.push(...(data || []))
  }
  return out
}

export async function loadOutreach(db, user) {
  if (user.role === 'salesperson' && user.team === 'marketing') throw fail(403, 'Não disponível nesta conta.')
  const day = today()
  const leads = await loadOpen(db, user)
  const touches = await recentTouches(db, leads.map(l => l.id), addDays(day, -400))
  const byLead = new Map()
  for (const t of touches) { if (!byLead.has(t.lead_id)) byLead.set(t.lead_id, []); byLead.get(t.lead_id).push(t) }
  const optedOut = new Set(touches.filter(t => t.event_type === 'email_optout').map(t => t.lead_id))
  const rows = leads.map(l => {
    const list = byLead.get(l.id) || []
    const calls = list.filter(t => t.event_type === 'contact' && t.channel === 'phone')
    const mails = list.filter(t => t.event_type === 'email_outreach')
    return {
      ...l,
      calls: calls.length,
      last_call: calls[0] ? { date: calls[0].happened_at, tag: calls[0].response_tag, by: calls[0].said_by } : null,
      called_today: calls.some(t => t.happened_at === day),
      last_email: mails[0]?.happened_at || null,
      emails: mails.length,
      opted_out: optedOut.has(l.id),
    }
  })
  const queue = rows
    .filter(r => (r.phone || r.contact_phone) && !r.called_today && (!r.next_followup_date || r.next_followup_date <= day))
    .map(r => ({ ...r, priority: callPriority(r, day) }))
    .sort((a, b) => b.priority.score - a.priority.score || String(a.company_name).localeCompare(String(b.company_name)))
  const set = emailSettings()
  const sentToday = touches.filter(t => t.event_type === 'email_outreach' && t.happened_at === day).length
  return {
    today: day,
    targets: rows.filter(r => r.stage === 'target'),
    queue: queue.slice(0, 200),
    queue_total: queue.length,
    done_today: rows.filter(r => r.called_today).length,
    email: { configured: set.live, from: set.from, domain: set.domain, limit: set.limit, sent_today: sentToday, left_today: Math.max(0, set.limit - sentToday) },
    issuer: { name: QUOTE_ISSUER.company, address: QUOTE_ISSUER.address || '', phone: QUOTE_ISSUER.phone || '' },
  }
}

export async function importTargets(db, user, body) {
  const input = Array.isArray(body.rows) ? body.rows.slice(0, 1000) : []
  const rows = input.map(normalizeTargetRow).filter(r => r.company_name)
  if (!rows.length) throw fail(400, 'Nenhuma empresa na lista. Cada linha precisa pelo menos do nome.')
  const { data: existing, error } = await db.from('sales_leads').select('company_name,phone,site_name').limit(10000)
  if (error) throw error
  const seen = new Set((existing || []).map(targetKey))
  const fresh = []
  let duplicates = 0
  for (const r of rows) {
    const k = targetKey(r)
    if (seen.has(k)) { duplicates++; continue }
    seen.add(k)
    fresh.push({
      ...r, stage: 'target', source: r.source || 'base de empresas',
      // the admin may hand the list to one seller; a seller's own import stays in the shared base unless asked
      salesperson_id: user.role === 'admin' ? (body.salesperson_id || null) : (body.mine ? user.id : null),
      updated_at: new Date().toISOString(),
    })
  }
  let added = 0
  for (let i = 0; i < fresh.length; i += 200) {
    const { data, error: insErr } = await db.from('sales_leads').insert(fresh.slice(i, i + 200)).select('id')
    if (insErr) throw insErr
    added += (data || []).length
  }
  return { added, duplicates, total: rows.length }
}

export async function callResult(db, user, body) {
  const spec = CALL_RESULTS[body.result]
  if (!spec) throw fail(400, 'Resultado inválido.')
  const day = today()
  const { data: lead, error } = await db.from('sales_leads').select('id,stage,salesperson_id,first_contact_date,last_contact_date').eq('id', String(body.lead_id || '')).maybeSingle()
  if (error) throw error
  const admin = user.role === 'admin'
  const shared = lead && !lead.salesperson_id && lead.stage === 'target'
  if (!lead || (!admin && lead.salesperson_id !== user.id && !shared)) throw fail(404, 'Empresa não encontrada nesta conta.')
  const next = spec.days == null ? null : addDays(day, spec.days)
  const { error: tErr } = await db.from('sales_touchpoints').insert({
    lead_id: lead.id, salesperson_id: admin ? (lead.salesperson_id || null) : user.id, event_type: 'contact', happened_at: day,
    channel: 'phone', said_by: String(user.name || '').slice(0, 120),
    body: [spec.pt, String(body.note || '').trim().slice(0, 1000)].filter(Boolean).join(' — '),
    response_tag: spec.tag, sentiment: spec.sentiment, next_followup_date: next,
  })
  if (tErr) throw tErr
  const patch = { next_followup_date: next, last_contact_date: day, updated_at: new Date().toISOString() }
  if (!lead.first_contact_date) patch.first_contact_date = day
  // a company that answered with interest leaves the base and enters the funnel, with whoever called
  if (spec.promote) {
    if (lead.stage === 'target' || lead.stage === 'approach') patch.stage = 'followup'
    if (!lead.salesperson_id && !admin) { patch.salesperson_id = user.id; patch.assigned_at = new Date().toISOString() }
  }
  const { data: updated, error: uErr } = await db.from('sales_leads').update(patch).eq('id', lead.id).select(LEAD_COLS).single()
  if (uErr) throw uErr
  return { lead: updated, next_followup_date: next }
}

function emailHtml(text, optoutUrl, issuer) {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  return `<div style="font-family:-apple-system,'Hiragino Sans','Noto Sans JP',Segoe UI,sans-serif;font-size:15px;line-height:1.7;color:#111">${esc(text).replace(/\n/g, '<br>')}
<hr style="border:0;border-top:1px solid #e5e7eb;margin:28px 0 12px">
<p style="font-size:12px;color:#6b7280">${esc(issuer.name)}${issuer.address ? ` · ${esc(issuer.address)}` : ''}${issuer.phone ? ` · ${esc(issuer.phone)}` : ''}<br>
今後このようなご案内が不要な場合は <a href="${optoutUrl}">こちら</a> から配信停止できます。 / <a href="${optoutUrl}">Unsubscribe</a></p></div>`
}

export async function outreachEmail(db, user, body, req) {
  const ids = [...new Set((Array.isArray(body.lead_ids) ? body.lead_ids : []).map(String))].slice(0, 200)
  const subject = String(body.subject || '').trim().slice(0, 200)
  const text = String(body.body || '').trim().slice(0, 6000)
  if (!ids.length) throw fail(400, 'Escolha pelo menos uma empresa.')
  if (!subject || text.length < 20) throw fail(400, 'Escreva o assunto e o texto do e-mail.')
  const day = today()
  const set = emailSettings()
  const all = await loadOpen(db, user)
  const leads = all.filter(l => ids.includes(l.id))
  const touches = await recentTouches(db, leads.map(l => l.id), addDays(day, -400))
  const { data: todays, error } = await db.from('sales_touchpoints').select('id').eq('event_type', 'email_outreach').eq('happened_at', day).limit(1000)
  if (error) throw error
  let left = Math.max(0, set.limit - (todays || []).length)
  const origin = `https://${req.headers['x-forwarded-host'] || req.headers.host || 'kuripuro.vercel.app'}`
  const issuer = { name: QUOTE_ISSUER.company, address: QUOTE_ISSUER.address || '', phone: QUOTE_ISSUER.phone || '' }
  const results = []
  for (const lead of leads) {
    const to = String(lead.contact_email || lead.email || '').trim()
    const mine = touches.filter(t => t.lead_id === lead.id)
    const base = { lead_id: lead.id, company_name: lead.company_name, to }
    if (!EMAIL_RE.test(to)) { results.push({ ...base, status: 'skipped', reason: 'sem e-mail' }); continue }
    if (mine.some(t => t.event_type === 'email_optout')) { results.push({ ...base, status: 'skipped', reason: 'pediu para não receber' }); continue }
    if (mine.some(t => t.event_type === 'email_outreach' && t.happened_at >= addDays(day, -14))) { results.push({ ...base, status: 'skipped', reason: 'já recebeu nos últimos 14 dias' }); continue }
    if (left <= 0) { results.push({ ...base, status: 'skipped', reason: `limite de ${set.limit} por dia atingido` }); continue }
    const filled = { subject: fillTemplate(subject, lead, user), body: fillTemplate(text, lead, user) }
    if (body.dry_run || !set.live) { results.push({ ...base, status: 'preview', ...filled }); left--; continue }
    const optoutUrl = `${origin}/api/sales?route=optout&t=${encodeURIComponent(optoutToken(lead.id))}`
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: set.from, to: [to], subject: filled.subject, text: `${filled.body}\n\n--\n${issuer.name}\n配信停止 / Unsubscribe: ${optoutUrl}`,
          html: emailHtml(filled.body, optoutUrl, issuer), reply_to: user.email || undefined,
          headers: { 'List-Unsubscribe': `<${optoutUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        }),
      })
      if (!r.ok) { results.push({ ...base, status: 'failed', reason: `o serviço de e-mail respondeu ${r.status}` }); continue }
    } catch (e) { results.push({ ...base, status: 'failed', reason: e.message }); continue }
    left--
    await db.from('sales_touchpoints').insert({
      lead_id: lead.id, salesperson_id: user.role === 'admin' ? (lead.salesperson_id || null) : user.id, event_type: 'email_outreach',
      happened_at: day, channel: 'email', said_by: String(user.name || '').slice(0, 120), body: `${filled.subject}\n\n${filled.body}`.slice(0, 3000),
    })
    await db.from('sales_leads').update({ last_contact_date: day, updated_at: new Date().toISOString() }).eq('id', lead.id)
    results.push({ ...base, status: 'sent' })
  }
  return { live: set.live && !body.dry_run, results, sent: results.filter(r => r.status === 'sent').length, left_today: left, limit: set.limit }
}

const page = (title, text) => `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="font-family:-apple-system,'Hiragino Sans',sans-serif;background:#f6f7f9;color:#0b0f19;display:grid;place-items:center;min-height:100vh;margin:0">
<main style="background:#fff;border:1px solid #e7eaf0;border-radius:16px;padding:32px;max-width:420px;margin:16px"><h1 style="font-size:20px;margin:0 0 8px">${title}</h1><p style="margin:0;line-height:1.7;color:#4b5563">${text}</p></main></body></html>`

/** Public: the link at the bottom of every outreach e-mail. One click, no login. */
export default async function optoutHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const leadId = readOptout(Array.isArray(req.query?.t) ? req.query.t[0] : req.query?.t)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  if (!leadId) return res.status(400).send(page('リンクが無効です', 'このリンクは無効です。 / This link is not valid.'))
  try {
    const { salesDb } = await import('./_salesSession.js')
    const db = salesDb()
    const { data: lead } = await db.from('sales_leads').select('id,salesperson_id').eq('id', leadId).maybeSingle()
    if (lead) {
      const { data: already } = await db.from('sales_touchpoints').select('id').eq('lead_id', lead.id).eq('event_type', 'email_optout').limit(1)
      if (!(already || []).length) {
        await db.from('sales_touchpoints').insert({ lead_id: lead.id, salesperson_id: lead.salesperson_id || null, event_type: 'email_optout', happened_at: today(), channel: 'email', said_by: 'cliente', body: 'Pediu para não receber mais e-mails (link do e-mail).' })
      }
    }
    return res.status(200).send(page('配信を停止しました', '今後、当社からのご案内メールは送信されません。 / You will not receive these e-mails again.'))
  } catch {
    return res.status(500).send(page('エラー', 'しばらくしてからもう一度お試しください。 / Please try again later.'))
  }
}
