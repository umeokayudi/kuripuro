import { requireActiveSalesSession, salesDb } from './_salesSession.js'
import { geminiGenerate } from './_gemini.js'

const LEAD_FIELDS = new Set([
  'company_name', 'company_kana', 'site_name', 'address', 'phone', 'email', 'website', 'industry',
  'locations_count', 'contact_name', 'contact_title', 'contact_phone', 'contact_email', 'contact_line_id',
  'first_contact_date', 'last_contact_date', 'next_followup_date', 'source', 'needs', 'still_needed',
  'decision_maker', 'expected_monthly', 'expected_start', 'competitor', 'notes', 'interest', 'stage', 'lost_reason', 'region', 'marketing_channel_id', 'marketing_campaign_id', 'business_card_object_path',
])

function safeLead(input) {
  const out = {}
  for (const [key, value] of Object.entries(input || {})) if (LEAD_FIELDS.has(key)) out[key] = value
  if (out.company_name != null) out.company_name = String(out.company_name).trim().slice(0, 200)
  if (out.marketing_channel_id === '') out.marketing_channel_id = null
  if (out.marketing_campaign_id === '') out.marketing_campaign_id = null
  for (const key of ['first_contact_date', 'last_contact_date', 'next_followup_date', 'expected_start']) {
    if (out[key] === '') out[key] = null
  }
  if (out.region != null) out.region = String(out.region).trim().slice(0, 80) || null
  if (!out.region && out.address) out.region = regionFromAddress(out.address)
  out.updated_at = new Date().toISOString()
  return out
}

// Prefecture from a Japanese address ("東京都港区…" → "東京都"), so region KPIs work without extra typing.
export function regionFromAddress(address) {
  const match = String(address || '').match(/(東京都|北海道|(?:京都|大阪)府|[^\s0-9０-９]{2,3}県)/)
  return match ? match[1] : null
}

const CONTACT_CHANNELS = new Set(['visit', 'phone', 'line', 'email', 'meeting', 'other'])
const RESPONSE_TAGS = new Set(['interested', 'asked_quote', 'price_high', 'has_vendor', 'timing', 'need_approval', 'no_need', 'no_answer', 'other'])
const SENTIMENTS = new Set(['positive', 'neutral', 'negative'])
const count = v => (v === '' || v == null ? null : Math.round(num(v)))
const GOAL_FIELDS = ['approaches', 'contacts', 'leads', 'quotes', 'contracts', 'revenue']
const APPROACH_FIELDS = ['lead_id', 'work_date', 'place', 'company_name', 'site_name', 'contact_name', 'contact_title', 'contact_phone', 'contact_email', 'meishi_photo_url', 'notes', 'followup_note', 'followup_date', 'followup_status', 'outcome', 'travel_cost', 'duration_minutes', 'hours_spent', 'meeting_transcript', 'meeting_summary', 'ai_next_step', 'audio_object_path']
const REPORT_FIELDS = ['work_date', 'hours_worked', 'started_at', 'ended_at', 'areas', 'summary', 'travel_cost']
const pick = (input, fields) => Object.fromEntries(fields.filter(key => input?.[key] !== undefined).map(key => [key, input[key] === '' ? null : input[key]]))
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))

function num(v, min = 0) {
  const n = Number(v)
  if (!Number.isFinite(n) || n < min) throw new Error('Há um valor numérico inválido.')
  return n
}

function commission(base, type, value) {
  return type === 'percent' ? Math.round(base * value) / 100 : value
}

function todayTokyo() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
}

function jsonError(res, status, message) { return res.status(status).json({ error: message }) }

// What the seller did on one day, from the records themselves.
async function dayStats(db, sellerId, day) {
  const [approachesRes, contactsRes, quotesRes, leadsRes] = await Promise.all([
    db.from('sales_field_approaches').select('place,company_name,site_name,outcome,notes,meeting_summary,followup_date,travel_cost').eq('salesperson_id', sellerId).eq('work_date', day).limit(200),
    db.from('sales_touchpoints').select('lead_id,channel,body,client_response,response_tag,sentiment,next_followup_date').eq('salesperson_id', sellerId).eq('happened_at', day).limit(300),
    db.from('mitsumori').select('quote_number,company_name,total,status,sent_at,created_at').eq('salesperson_id', sellerId).or(`sent_at.gte.${day}T00:00:00+09:00,created_at.gte.${day}T00:00:00+09:00`).limit(100),
    db.from('sales_leads').select('id,company_name,site_name,first_contact_date,next_followup_date,stage').eq('salesperson_id', sellerId).not('stage', 'in', '(won,lost)').limit(500),
  ])
  for (const r of [approachesRes, contactsRes, quotesRes, leadsRes]) if (r.error) throw r.error
  const approaches = approachesRes.data || []
  const contacts = contactsRes.data || []
  const quotes = (quotesRes.data || []).filter(q => String(q.sent_at || q.created_at || '').slice(0, 10) <= day)
  const leads = leadsRes.data || []
  const outcomes = {}
  for (const row of approaches) if (row.outcome) outcomes[row.outcome] = (outcomes[row.outcome] || 0) + 1
  const answers = {}
  for (const row of contacts) if (row.response_tag) answers[row.response_tag] = (answers[row.response_tag] || 0) + 1
  return {
    approaches: approaches.length,
    contacts: contacts.length,
    new_leads: leads.filter(l => l.first_contact_date === day).length,
    quotes_sent: quotes.filter(q => q.sent_at).length,
    quotes_value: quotes.reduce((n, q) => n + Number(q.total || 0), 0),
    meetings: outcomes.meeting_scheduled || 0,
    closed: outcomes.closed || 0,
    outcomes,
    answers,
    overdue_followups: leads.filter(l => l.next_followup_date && l.next_followup_date < day).length,
    next_followups: leads.filter(l => l.next_followup_date && l.next_followup_date > day).sort((a, b) => a.next_followup_date.localeCompare(b.next_followup_date)).slice(0, 8).map(l => `${l.next_followup_date} ${l.site_name || l.company_name}`),
    travel: approaches.reduce((n, a) => n + Number(a.travel_cost || 0), 0),
    areas: [...new Set(approaches.map(a => String(a.place || '').trim()).filter(Boolean))].slice(0, 12),
    visits: approaches.slice(0, 25).map(a => ({ place: a.site_name || a.company_name || a.place, outcome: a.outcome || '', note: String(a.meeting_summary || a.notes || '').slice(0, 240) })),
    client_answers: contacts.filter(c => c.client_response || c.response_tag).slice(0, 25).map(c => ({ tag: c.response_tag || '', said: String(c.client_response || '').slice(0, 240) })),
  }
}

function plainDayReport({ seller, date, started, ended, hours, stats, note }) {
  const lines = [
    `${seller || ''} · ${date} · ${started || '?'}–${ended} (${hours}h)`,
    `Abordagens: ${stats.approaches} · Contatos: ${stats.contacts} · Novos leads: ${stats.new_leads} · Reuniões marcadas: ${stats.meetings} · Orçamentos enviados: ${stats.quotes_sent} · Fechamentos: ${stats.closed}`,
    stats.areas.length ? `Locais: ${stats.areas.join(', ')}` : '',
    stats.overdue_followups ? `Follow-ups atrasados: ${stats.overdue_followups}` : 'Follow-ups em dia.',
    stats.next_followups.length ? `Próximos follow-ups: ${stats.next_followups.join(' · ')}` : '',
    note ? `Observação do vendedor: ${note}` : '',
  ]
  return lines.filter(Boolean).join('\n')
}

// End-of-day report the admin reads. Falls back to a plain summary if the AI is unavailable.
async function writeDayReport(input) {
  const fallback = plainDayReport(input)
  const lang = input.language === 'ja' ? 'Japanese' : input.language === 'en' ? 'English' : 'Portuguese'
  try {
    const result = await geminiGenerate({
      contents: [{ role: 'user', parts: [{ text: `Write the end-of-day report of a cleaning-services salesperson for their manager, in ${lang}. Use only the data below. Sections: 1) Day in numbers (one line), 2) Visits and what happened (bullets, one per place), 3) What clients answered and objections, 4) Follow-ups: overdue and next, 5) Points of attention for the manager (max 3, only if supported by the data). Short, factual, no invented names or amounts.
DATA:
${JSON.stringify({ seller: input.seller, date: input.date, start: input.started, end: input.ended, hours: input.hours, seller_note: input.note, ...input.stats }).slice(0, 30000)}` }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 900 },
    })
    const text = result?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim()
    return text ? `${text}\n\n—\n${fallback}` : fallback
  } catch (error) {
    console.error('[sales-day-report]', error?.message || error)
    return fallback
  }
}

async function loadDashboard(db, user) {
  const isAdmin = user.role === 'admin'
  const id = user.id
  const scope = q => isAdmin ? q : q.eq('salesperson_id', id)
  const [leadsRes, quotesRes, approachesRes, reportsRes, submissionsRes, peopleRes, rulesRes, notificationsRes, channelsRes, campaignsRes, spendRes, touchpointsRes, goalsRes, marketingGoalsRes] = await Promise.all([
    scope(db.from('sales_leads').select('*').order('updated_at', { ascending: false }).limit(500)),
    scope(db.from('mitsumori').select('id,salesperson_id,lead_id,quote_number,status,total,subtotal,created_at,company_name,valid_until,sent_at,decided_at,decision_reason,frequency,items:mitsumori_items(description,quantity,unit_price,total)').order('created_at', { ascending: false }).limit(500)),
    scope(db.from('sales_field_approaches').select('*').order('work_date', { ascending: false }).limit(1000)),
    scope(db.from('sales_day_reports').select('*').order('work_date', { ascending: false }).limit(500)),
    scope(db.from('sales_contract_submissions').select('*').order('created_at', { ascending: false }).limit(500)),
    isAdmin ? db.from('salespeople').select('id,full_name,email,phone,is_active,created_at').order('full_name') : Promise.resolve({ data: [] }),
    isAdmin ? db.from('sales_commission_rules').select('*') : db.from('sales_commission_rules').select('*').eq('salesperson_id', id),
    isAdmin ? db.from('sales_notifications').select('*').eq('audience', 'admin').is('read_at', null).order('created_at', { ascending: false }).limit(100)
      : db.from('sales_notifications').select('*').eq('audience', 'seller').eq('salesperson_id', id).is('read_at', null).order('created_at', { ascending: false }).limit(100),
    db.from('marketing_channels').select('id,name,channel_type,platform,is_active').eq('is_active', true).order('name'),
    (isAdmin ? db.from('marketing_campaigns').select('id,channel_id,name,objective,budget,starts_on,ends_on,status') : db.from('marketing_campaigns').select('id,channel_id,name,objective,status').eq('status', 'active')).order('created_at', { ascending: false }),
    isAdmin ? db.from('marketing_spend').select('*').order('spent_on', { ascending: false }).limit(1000) : Promise.resolve({ data: [] }),
    scope(db.from('sales_touchpoints').select('id,lead_id,salesperson_id,event_type,happened_at,channel,said_by,body,client_response,response_tag,sentiment,next_followup_date,created_at').order('happened_at', { ascending: false }).limit(3000)),
    scope(db.from('sales_goals').select('*').gte('period_month', `${Number(todayTokyo().slice(0, 4)) - 1}-01`).order('period_month', { ascending: false })),
    isAdmin ? db.from('marketing_goals').select('*').gte('period_month', `${Number(todayTokyo().slice(0, 4)) - 1}-01`).order('period_month', { ascending: false }) : Promise.resolve({ data: [] }),
  ])
  const failed = [leadsRes, quotesRes, approachesRes, reportsRes, submissionsRes, rulesRes, notificationsRes, channelsRes, campaignsRes, spendRes, touchpointsRes, goalsRes, marketingGoalsRes].find(r => r.error)
  if (failed) throw failed.error
  const leads = leadsRes.data || []
  const quotes = quotesRes.data || []
  const approaches = approachesRes.data || []
  const reports = reportsRes.data || []
  const submissions = submissionsRes.data || []
  const people = peopleRes.data || []
  const sellers = isAdmin ? people : [{ id, full_name: user.name, email: user.email }]
  const metrics = sellers.map(person => {
    const ownLeads = leads.filter(row => row.salesperson_id === person.id)
    const ownApproaches = approaches.filter(row => row.salesperson_id === person.id)
    const ownQuotes = quotes.filter(row => row.salesperson_id === person.id)
    const ownContracts = submissions.filter(row => row.salesperson_id === person.id)
    const won = ownLeads.filter(row => row.stage === 'won').length
    const active = ownContracts.filter(row => row.status === 'active' || row.status === 'approved').length
    const quoteTotal = ownQuotes.reduce((sum, row) => sum + Number(row.total || 0), 0)
    return {
      salesperson_id: person.id,
      full_name: person.full_name,
      leads: ownLeads.length,
      approaches: ownApproaches.length,
      quotes: ownQuotes.length,
      quote_average: ownQuotes.length ? quoteTotal / ownQuotes.length : 0,
      won,
      active_contracts: active,
      conversion_rate: ownApproaches.length ? won / ownApproaches.length * 100 : 0,
      followups_due: ownLeads.filter(row => row.next_followup_date && row.next_followup_date <= todayTokyo() && !['won', 'lost'].includes(row.stage)).length,
      reports: reports.filter(row => row.salesperson_id === person.id).length,
      commission_pending: ownContracts.filter(row => ['active', 'approved'].includes(row.status)).reduce((sum, row) => sum + Number(row.commission_amount || 0), 0),
      hours_this_month: reports.filter(row => row.salesperson_id === person.id && String(row.work_date || '').startsWith(todayTokyo().slice(0, 7))).reduce((sum, row) => sum + Number(row.hours_worked || 0), 0),
    }
  })
  const channels = channelsRes.data || []
  const campaigns = campaignsRes.data || []
  const spend = spendRes.data || []
  const marketing = campaigns.map(campaign => {
    const relatedLeads = leads.filter(row => row.marketing_campaign_id === campaign.id)
    const campaignSpend = spend.filter(row => row.campaign_id === campaign.id).reduce((sum, row) => sum + Number(row.amount || 0), 0)
    const conversions = relatedLeads.filter(row => row.stage === 'won').length
    return { ...campaign, spend: campaignSpend, leads: relatedLeads.length, conversions, cost_per_lead: relatedLeads.length ? campaignSpend / relatedLeads.length : 0, customer_acquisition_cost: conversions ? campaignSpend / conversions : 0 }
  })
  return { user, today: todayTokyo(), leads, quotes, approaches, reports, contracts: submissions, salespeople: people, commissionRules: rulesRes.data || [], notifications: notificationsRes.data || [], metrics, marketing: { channels, campaigns: marketing, spend, goals: marketingGoalsRes.data || [] }, touchpoints: touchpointsRes.data || [], goals: goalsRes.data || [] }
}

async function getAction(db, user, action, query = {}) {
  if (action === 'dashboard') return loadDashboard(db, user)
  if (action === 'quote-items') {
    const { data: quote, error: quoteError } = await db.from('mitsumori').select('id,salesperson_id').eq('id', String(query.id || '')).maybeSingle()
    if (quoteError) throw quoteError
    if (!quote || (user.role !== 'admin' && quote.salesperson_id !== user.id)) throw Object.assign(new Error('Orçamento não encontrado nesta conta.'), { status: 404 })
    const { data, error } = await db.from('mitsumori_items').select('*').eq('mitsumori_id', quote.id)
    if (error) throw error
    return { items:data || [] }
  }
  throw Object.assign(new Error('Ação de leitura inválida.'), { status: 400 })
}

async function postAction(db, user, body, res) {
  const today = todayTokyo()
  const { action } = body || {}
  const admin = user.role === 'admin'
  const own = user.id

  if (action === 'create-salesperson') {
    if (!admin) return jsonError(res, 403, 'Somente admin pode criar vendedor.')
    const { full_name, email, password, phone = '' } = body
    if (!String(full_name || '').trim() || !String(email || '').trim() || String(password || '').length < 10) return jsonError(res, 400, 'Informe nome, e-mail e senha com pelo menos 10 caracteres.')
    const { hashSalesPassword } = await import('./_salesSession.js')
    const { data, error } = await db.from('salespeople').insert({ full_name: String(full_name).trim(), email: String(email).trim().toLowerCase(), password_hash: hashSalesPassword(password), phone: String(phone).trim(), is_active: true }).select('id,full_name,email,phone,is_active').single()
    if (error) throw error
    return { salesperson: data }
  }

  if (action === 'set-salesperson-active') {
    if (!admin) return jsonError(res, 403, 'Somente admin pode alterar acesso.')
    const { error } = await db.from('salespeople').update({ is_active: Boolean(body.is_active) }).eq('id', body.salesperson_id)
    if (error) throw error
    return { success: true }
  }

  if (action === 'set-commission-rule') {
    if (!admin) return jsonError(res, 403, 'Somente admin pode definir comissão padrão.')
    if (!['percent', 'fixed'].includes(body.commission_type)) return jsonError(res, 400, 'Tipo de comissão inválido.')
    const value = num(body.commission_value)
    const { data, error } = await db.from('sales_commission_rules').upsert({ salesperson_id: body.salesperson_id, commission_type: body.commission_type, commission_value: value, percent_basis: body.percent_basis === 'contract_total' ? 'contract_total' : 'base_monthly', updated_by: own, updated_at: new Date().toISOString() }, { onConflict: 'salesperson_id' }).select().single()
    if (error) throw error
    return { rule: data }
  }

  if (action === 'save-marketing-channel') {
    if (!admin) return jsonError(res, 403, 'Somente admin pode editar canais de marketing.')
    const name = String(body.name || '').trim().slice(0, 120)
    if (!name) return jsonError(res, 400, 'Informe o nome do canal.')
    const payload = { name, channel_type: body.channel_type || 'other', platform: String(body.platform || '').slice(0, 120), is_active: body.is_active !== false }
    const query = body.id ? db.from('marketing_channels').update(payload).eq('id', body.id) : db.from('marketing_channels').insert(payload)
    const { data, error } = await query.select().single()
    if (error) throw error
    return { channel: data }
  }

  if (action === 'save-marketing-campaign') {
    if (!admin) return jsonError(res, 403, 'Somente admin pode editar campanhas.')
    if (!String(body.name || '').trim() || !body.channel_id) return jsonError(res, 400, 'Informe nome e canal.')
    const payload = { channel_id: body.channel_id, name: String(body.name).trim().slice(0, 180), objective: String(body.objective || '').slice(0, 2000), budget: num(body.budget || 0), starts_on: body.starts_on || null, ends_on: body.ends_on || null, status: body.status || 'active' }
    const query = body.id ? db.from('marketing_campaigns').update(payload).eq('id', body.id) : db.from('marketing_campaigns').insert(payload)
    const { data, error } = await query.select().single()
    if (error) throw error
    return { campaign: data }
  }

  if (action === 'record-marketing-spend') {
    if (!admin) return jsonError(res, 403, 'Somente admin pode registrar investimento em marketing.')
    const amount = num(body.amount)
    const { data, error } = await db.from('marketing_spend').insert({ campaign_id: body.campaign_id, spent_on: body.spent_on || today, amount, impressions: count(body.impressions), clicks: count(body.clicks), conversions: count(body.conversions), description: String(body.description || '').slice(0, 500) }).select().single()
    if (error) throw error
    return { spend: data }
  }

  if (action === 'save-lead') {
    const payload = safeLead(body.lead)
    if (!payload.company_name) return jsonError(res, 400, 'Informe a empresa/restaurante.')
    if (admin && body.salesperson_id) payload.salesperson_id = body.salesperson_id
    if (!admin) payload.salesperson_id = own
    if (!admin && ['won', 'lost'].includes(payload.stage)) payload.stage = 'followup'
    if (body.id) {
      let query = db.from('sales_leads').update(payload).eq('id', body.id)
      if (!admin) query = query.eq('salesperson_id', own)
      const { data, error } = await query.select().maybeSingle()
      if (error) throw error
      if (!data) return jsonError(res, 404, 'Lead não encontrado nesta conta.')
      return { lead: data }
    }
    if (!payload.first_contact_date) payload.first_contact_date = today
    if (!payload.last_contact_date) payload.last_contact_date = payload.first_contact_date
    const { data, error } = await db.from('sales_leads').insert(payload).select().single()
    if (error) throw error
    return { lead: data }
  }

  if (action === 'log-contact') {
    const input = body.contact || {}
    const happenedAt = isDay(input.happened_at) ? input.happened_at : today
    if (happenedAt > today) return jsonError(res, 400, 'A data do contato não pode ser no futuro.')
    const channel = CONTACT_CHANNELS.has(input.channel) ? input.channel : 'other'
    const next = input.next_followup_date ? String(input.next_followup_date) : null
    if (next && (!isDay(next) || next < happenedAt)) return jsonError(res, 400, 'O próximo follow-up deve ser depois do contato.')
    let leadQuery = db.from('sales_leads').select('id,salesperson_id,stage,last_contact_date,first_contact_date').eq('id', input.lead_id)
    if (!admin) leadQuery = leadQuery.eq('salesperson_id', own)
    const { data: lead, error: leadErr } = await leadQuery.maybeSingle()
    if (leadErr) throw leadErr
    if (!lead) return jsonError(res, 404, 'Lead não encontrado nesta conta.')
    const { data: touchpoint, error } = await db.from('sales_touchpoints').insert({
      lead_id: lead.id,
      salesperson_id: admin ? (lead.salesperson_id || null) : own,
      event_type: 'contact',
      happened_at: happenedAt,
      channel,
      said_by: String(user.name || '').slice(0, 120),
      body: String(input.body || '').slice(0, 3000),
      client_response: String(input.client_response || '').slice(0, 3000) || null,
      response_tag: RESPONSE_TAGS.has(input.response_tag) ? input.response_tag : null,
      sentiment: SENTIMENTS.has(input.sentiment) ? input.sentiment : null,
      next_followup_date: next,
    }).select().single()
    if (error) throw error
    const patch = { next_followup_date: next, updated_at: new Date().toISOString() }
    if (!lead.last_contact_date || happenedAt >= lead.last_contact_date) patch.last_contact_date = happenedAt
    if (!lead.first_contact_date || happenedAt < lead.first_contact_date) patch.first_contact_date = happenedAt
    if (lead.stage === 'approach') patch.stage = 'followup'
    const { data: updated, error: updateErr } = await db.from('sales_leads').update(patch).eq('id', lead.id).select().single()
    if (updateErr) throw updateErr
    return { touchpoint, lead: updated }
  }

  if (action === 'save-goal') {
    if (!admin) return jsonError(res, 403, 'Somente admin pode definir metas.')
    const month = String(body.period_month || '')
    if (!/^\d{4}-\d{2}$/.test(month)) return jsonError(res, 400, 'Mês inválido.')
    if (!body.salesperson_id) return jsonError(res, 400, 'Escolha o vendedor.')
    const row = { salesperson_id: body.salesperson_id, period_month: month, updated_by: own, updated_at: new Date().toISOString() }
    for (const key of GOAL_FIELDS) row[key] = key === 'revenue' ? num(body.goal?.[key] || 0) : Math.round(num(body.goal?.[key] || 0))
    const { data, error } = await db.from('sales_goals').upsert(row, { onConflict: 'salesperson_id,period_month' }).select().single()
    if (error) throw error
    return { goal: data }
  }

  if (action === 'save-marketing-goal') {
    if (!admin) return jsonError(res, 403, 'Somente admin pode definir metas de marketing.')
    const month = String(body.period_month || '')
    if (!/^\d{4}-\d{2}$/.test(month)) return jsonError(res, 400, 'Mês inválido.')
    const goal = body.goal || {}
    const row = { period_month: month, updated_by: own, updated_at: new Date().toISOString() }
    for (const key of ['leads', 'won']) row[key] = Math.max(0, Math.round(num(goal[key] || 0)))
    for (const key of ['spend', 'max_cpl', 'revenue']) row[key] = Math.max(0, num(goal[key] || 0))
    const { data, error } = await db.from('marketing_goals').upsert(row, { onConflict: 'period_month' }).select().single()
    if (error) throw error
    return { goal: data }
  }

  if (action === 'assign-lead') {
    if (!admin) return jsonError(res, 403, 'Somente admin pode atribuir leads.')
    const { data: lead, error } = await db.from('sales_leads').update({ salesperson_id: body.salesperson_id || null, assigned_at: body.salesperson_id ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('id', body.lead_id).select('id,company_name,site_name,source,next_followup_date').maybeSingle()
    if (error) throw error
    if (lead && body.salesperson_id) {
      await db.from('sales_notifications').insert({ salesperson_id: body.salesperson_id, audience: 'seller', event_type: 'lead_assigned', title: 'Novo lead para você', body: [lead.site_name || lead.company_name, body.note ? String(body.note).slice(0, 500) : ''].filter(Boolean).join(' · '), lead_id: lead.id, sender_name: String(user.name || '').slice(0, 120) })
    }
    return { success: true }
  }

  if (action === 'save-approach') {
    const row = { ...pick(body.approach, APPROACH_FIELDS), salesperson_id: admin ? (body.approach?.salesperson_id || null) : own, work_date: body.approach?.work_date || today, created_at: new Date().toISOString() }
    for (const key of ['place', 'company_name', 'site_name', 'contact_name', 'contact_title', 'contact_phone', 'contact_email', 'notes', 'followup_note', 'outcome', 'meeting_transcript', 'meeting_summary', 'ai_next_step', 'meishi_photo_url', 'followup_status']) if (row[key] === null) row[key] = ''
    if (row.lead_id && !admin) {
      const { data: ownedLead } = await db.from('sales_leads').select('id').eq('id', row.lead_id).eq('salesperson_id', own).maybeSingle()
      if (!ownedLead) row.lead_id = null
    }
    for (const key of ['travel_cost', 'duration_minutes', 'hours_spent']) row[key] = num(row[key] || 0)
    const { data, error } = await db.from('sales_field_approaches').insert(row).select().single()
    if (error) throw error
    // What happened at the visit moves the client forward in the funnel (never backwards, never to won/lost).
    const stageFor = { meeting_scheduled: 'followup', talked: 'followup', quote_sent: 'quote', negotiating: 'negotiation' }[row.outcome]
    if (row.lead_id && stageFor) {
      const order = ['approach', 'followup', 'quote', 'negotiation']
      const { data: current } = await db.from('sales_leads').select('stage').eq('id', row.lead_id).maybeSingle()
      if (current && order.indexOf(current.stage) > -1 && order.indexOf(current.stage) < order.indexOf(stageFor)) await db.from('sales_leads').update({ stage: stageFor, updated_at: new Date().toISOString() }).eq('id', row.lead_id)
    }
    if (row.outcome === 'closed' && row.salesperson_id) await db.from('sales_notifications').insert({ salesperson_id: row.salesperson_id, audience: 'admin', event_type: 'seller_closed', title: 'Vendedor informou fechamento', body: [row.site_name || row.company_name || row.place, user.name].filter(Boolean).join(' · '), lead_id: row.lead_id || null, sender_name: String(user.name || '').slice(0, 120) })
    const noticeForSeller = row.salesperson_id ? db.from('sales_notifications').insert({ salesperson_id: row.salesperson_id, audience: 'seller', event_type: 'approach_saved', title: 'Abordagem registrada', body: row.company_name || row.place || '', lead_id: row.lead_id || null }) : Promise.resolve()
    await noticeForSeller
    return { approach: data }
  }

  if (action === 'save-quote') {
    const input = body.quote || {}
    const { data: lead, error: leadErr } = await db.from('sales_leads').select('id,company_name,site_name,address,phone,email,contact_name,contact_title,contact_phone,contact_email,source,salesperson_id').eq('id', input.lead_id).maybeSingle()
    if (leadErr) throw leadErr
    if (!lead || (!admin && lead.salesperson_id !== own)) return jsonError(res, 404, 'Lead não encontrado nesta conta.')
    const items = Array.isArray(input.items) ? input.items.filter(item => String(item.description || '').trim()).slice(0, 80) : []
    if (!items.length) return jsonError(res, 400, 'Adicione ao menos um item ao orçamento.')
    const cleanItems = items.map(item => {
      const quantity = num(item.quantity || 1)
      const unitPrice = num(item.unit_price || 0)
      return { description: String(item.description).trim().slice(0, 500), quantity, unit_price: unitPrice, total: Math.round(quantity * unitPrice) }
    })
    const subtotal = cleanItems.reduce((sum, item) => sum + item.total, 0)
    const taxRate = Math.round(Math.max(0, Math.min(100, num(input.tax_rate ?? 10))))
    const taxAmount = Math.round(subtotal * taxRate / 100)
    const prefix = `KPQ-${String(input.issue_date || today).slice(0, 7).replace('-', '')}-`
    const { data: existingNumbers, error: numbersErr } = await db.from('mitsumori').select('quote_number').like('quote_number', `${prefix}%`).limit(500)
    if (numbersErr) throw numbersErr
    let max = 0
    for (const row of existingNumbers || []) {
      const sequence = Number(String(row.quote_number || '').slice(prefix.length))
      if (Number.isInteger(sequence) && sequence > max) max = sequence
    }
    const quote_number = `${prefix}${String(max + 1).padStart(3, '0')}`
    const quotePayload = {
      lead_id: lead.id, salesperson_id: admin ? (input.salesperson_id || lead.salesperson_id || null) : own,
      company_name: lead.company_name, site_name: lead.site_name || '', address: lead.address || '',
      phone: lead.phone || '', email: lead.email || '', contact_name: lead.contact_name || '', contact_title: lead.contact_title || '',
      contact_phone: lead.contact_phone || '', contact_email: lead.contact_email || '', source: lead.source || '',
      issue_date: input.issue_date || today, valid_until: input.valid_until || null, tax_rate: taxRate,
      subtotal, tax_amount: taxAmount, total: subtotal + taxAmount,
      notes: String(input.notes || '').slice(0, 5000),
    }
    let quote
    if (input.id) {
      const { data: current, error: currentError } = await db.from('mitsumori').select('id,salesperson_id,status,quote_number').eq('id', input.id).maybeSingle()
      if (currentError) throw currentError
      if (!current || (!admin && current.salesperson_id !== own)) return jsonError(res, 404, 'Orçamento não encontrado nesta conta.')
      if (!['draft', 'pending'].includes(current.status)) return jsonError(res, 409, 'Este orçamento não pode mais ser editado.')
      const { data, error } = await db.from('mitsumori').update(quotePayload).eq('id', input.id).select().single()
      if (error) throw error
      quote = data
      const { error: clearError } = await db.from('mitsumori_items').delete().eq('mitsumori_id', quote.id)
      if (clearError) throw clearError
    } else {
      const { data, error } = await db.from('mitsumori').insert({ ...quotePayload, quote_number, status:'draft' }).select().single()
      if (error) throw error
      quote = data
    }
    const { error: itemError } = await db.from('mitsumori_items').insert(cleanItems.map(item => ({ ...item, mitsumori_id: quote.id })))
    if (itemError) {
      if (!input.id) await db.from('mitsumori').delete().eq('id', quote.id)
      throw itemError
    }
    return { quote, items: cleanItems }
  }

  if (action === 'save-interest') {
    const interest = String(body.interest || '').slice(0, 3000)
    if (body.lead_id) {
      let query = db.from('sales_leads').update({ interest, updated_at:new Date().toISOString() }).eq('id', body.lead_id)
      if (!admin) query = query.eq('salesperson_id', own)
      const { error } = await query
      if (error) throw error
    }
    if (body.quote_id) {
      let query = db.from('mitsumori').update({ interest }).eq('id', body.quote_id)
      if (!admin) query = query.eq('salesperson_id', own)
      const { error } = await query
      if (error) throw error
    }
    return { success:true }
  }

  if (action === 'set-quote-status') {
    const allowed = admin ? ['draft','sent','accepted','declined','expired'] : ['draft','sent','accepted','declined']
    if (!allowed.includes(body.status)) return jsonError(res, 400, 'Status de orçamento inválido.')
    if (!admin) {
      // Sellers move a quote forward only; once sent it cannot be reopened for editing.
      const { data: current } = await db.from('mitsumori').select('status').eq('id', body.id).eq('salesperson_id', own).maybeSingle()
      const next = { draft: ['sent'], pending: ['sent'], sent: ['accepted', 'declined'] }[current?.status || ''] || []
      if (!next.includes(body.status)) return jsonError(res, 409, 'Este orçamento não pode voltar para esse status.')
    }
    const patch = { status:body.status }
    if (['accepted', 'declined'].includes(body.status) && body.decision_reason !== undefined) patch.decision_reason = String(body.decision_reason || '').slice(0, 1000) || null
    let query = db.from('mitsumori').update(patch).eq('id', body.id)
    if (!admin) query = query.eq('salesperson_id', own)
    const { data: quote, error } = await query.select('id,lead_id,status').maybeSingle()
    if (error) throw error
    if (!quote) return jsonError(res, 404, 'Orçamento não encontrado nesta conta.')
    if (admin && quote.lead_id && ['accepted','declined'].includes(body.status)) {
      await db.from('sales_leads').update({ stage:body.status === 'accepted' ? 'won' : 'lost', ...(body.status === 'declined' && patch.decision_reason ? { lost_reason:patch.decision_reason } : {}), last_contact_date:today, updated_at:new Date().toISOString() }).eq('id', quote.lead_id)
    }
    return { quote }
  }

  if (action === 'delete-quote') {
    let query = db.from('mitsumori').delete().eq('id', body.id)
    if (!admin) query = query.eq('salesperson_id', own).in('status', ['draft','pending'])
    const { data, error } = await query.select('id').maybeSingle()
    if (error) throw error
    if (!data) return jsonError(res, 404, 'Orçamento não encontrado ou bloqueado.')
    return { success:true }
  }

  if (action === 'save-report') {
    const row = { ...pick(body.report, REPORT_FIELDS), salesperson_id: admin ? (body.report?.salesperson_id || own) : own, updated_at: new Date().toISOString() }
    if (!row.work_date) row.work_date = today
    for (const key of ['started_at', 'ended_at', 'areas', 'summary']) if (row[key] === null) row[key] = ''
    row.travel_cost = num(row.travel_cost || 0)
    row.hours_worked = num(row.hours_worked || 0)
    const { data, error } = await db.from('sales_day_reports').upsert(row, { onConflict: 'salesperson_id,work_date' }).select().single()
    if (error) throw error
    return { report: data }
  }

  if (action === 'submit-contract') {
    if (admin) return jsonError(res, 403, 'A proposta deve ser enviada pelo acesso do vendedor.')
    const input = body.contract || {}
    const { data: lead, error: leadErr } = await db.from('sales_leads').select('id,company_name,site_name,address,contact_name,salesperson_id').eq('id', input.lead_id).eq('salesperson_id', own).maybeSingle()
    if (leadErr) throw leadErr
    if (!lead) return jsonError(res, 404, 'Lead não encontrado nesta conta.')
    const pdfPath = String(input.signed_pdf_object_path || '')
    if (!pdfPath.startsWith(`contracts/${own}/`) || !pdfPath.endsWith('.pdf')) return jsonError(res, 400, 'Anexe o PDF do contrato assinado antes de enviar.')
    const billingType = input.billing_type === 'per_visit' ? 'per_visit' : 'fixed_monthly'
    const unitPrice = num(input.price_per_visit || 0)
    const visitsPerMonth = Math.round(num(input.visits_per_month || 0))
    const base = billingType === 'per_visit' ? unitPrice * visitsPerMonth : num(input.base_monthly_amount)
    const commissionType = input.commission_type
    if (!['percent', 'fixed'].includes(commissionType)) return jsonError(res, 400, 'Escolha comissão percentual ou fixa.')
    const rate = num(input.commission_value)
    if (commissionType === 'percent' && rate > 100) return jsonError(res, 400, 'A comissão percentual deve ser de até 100%.')
    const extra = commission(base, commissionType, rate)
    const payload = {
      salesperson_id: own, lead_id: lead.id, quote_id: input.quote_id || null, status: 'pending_review',
      company_name: lead.company_name, site_name: String(input.site_name || lead.site_name || lead.company_name),
      address: String(input.address || lead.address || ''), contact_name: String(input.contact_name || lead.contact_name || ''),
      service_type: String(input.service_type || 'Basic Cleaning'), billing_type: billingType,
      base_monthly_amount: base, commission_type: commissionType, commission_value: rate,
      commission_amount: extra, client_monthly_total: base + extra,
      price_per_visit: unitPrice, visits_per_month: visitsPerMonth,
      hours_per_visit: num(input.hours_per_visit || 2), days_of_week: Array.isArray(input.days_of_week) ? input.days_of_week.filter(x => typeof x === 'string').slice(0, 7) : [],
      billing_day: Math.min(28, Math.max(1, Math.round(num(input.billing_day || 10)))), tax_rate: Math.round(num(input.tax_rate ?? 10)),
      signed_pdf_object_path: pdfPath, signed_pdf_name: String(input.signed_pdf_name || 'signed-contract.pdf').slice(0, 160),
      submitted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }
    const { data, error } = await db.from('sales_contract_submissions').insert(payload).select().single()
    if (error) throw error
    await db.from('sales_notifications').insert([
      { salesperson_id: own, audience: 'seller', event_type: 'contract_submitted', title: 'Contrato enviado para aprovação', body: lead.company_name, lead_id: lead.id, contract_submission_id: data.id },
      { salesperson_id: null, audience: 'admin', event_type: 'contract_review', title: 'Novo contrato para revisar', body: `${lead.company_name} · ¥${Math.round(base + extra).toLocaleString()}/mês`, lead_id: lead.id, contract_submission_id: data.id },
    ])
    return { contract: data }
  }

  if (action === 'review-contract') {
    if (!admin) return jsonError(res, 403, 'Somente admin pode revisar contratos.')
    const status = body.status
    if (!['approved', 'changes_requested', 'rejected'].includes(status)) return jsonError(res, 400, 'Decisão inválida.')
    const { data: row, error: getErr } = await db.from('sales_contract_submissions').select('*').eq('id', body.id).maybeSingle()
    if (getErr) throw getErr
    if (!row || !['pending_review', 'changes_requested'].includes(row.status)) return jsonError(res, 409, 'Este contrato não está aguardando revisão.')
    let serviceContractId = null
    let finalStatus = status
    if (status === 'approved') {
      const { data: lead } = await db.from('sales_leads').select('company_name,contact_name,phone,email,address').eq('id', row.lead_id).maybeSingle()
      let { data: client, error: clientErr } = await db.from('clients').select('id').ilike('company_name', row.company_name).limit(1).maybeSingle()
      if (clientErr) throw clientErr
      if (!client) {
        const result = await db.from('clients').insert({
          company_name: row.company_name, contact_name: row.contact_name || lead?.contact_name || '',
          phone: lead?.phone || '', email: lead?.email || '', address: row.address || lead?.address || '',
          service_type: row.service_type, monthly_revenue: row.client_monthly_total, is_active: true,
        }).select('id').single()
        if (result.error) throw result.error
        client = result.data
      }
      const { data: existingService } = await db.from('service_contracts').select('id').eq('client_id', client.id).eq('location_name', row.site_name).limit(1).maybeSingle()
      if (existingService) {
        serviceContractId = existingService.id
      } else {
      const visits = row.billing_type === 'per_visit' ? row.visits_per_month : 0
      const { data: service, error: contractErr } = await db.from('service_contracts').insert({
        client_id: client.id, location_name: row.site_name, location_address: row.address || '', service_type: row.service_type,
        billing_type: row.billing_type, price_per_visit: row.billing_type === 'per_visit' && visits ? row.client_monthly_total / visits : 0,
        fixed_monthly: row.billing_type === 'fixed_monthly' ? row.client_monthly_total : 0,
        monthly_revenue: row.client_monthly_total, visits_per_month: visits, hours_per_visit: row.hours_per_visit,
        days_of_week: row.days_of_week, billing_day: row.billing_day, tax_rate: row.tax_rate, is_active: true,
        billing_notes: `Aprovado via portal comercial. Base: ¥${row.base_monthly_amount}; comissão extra aprovada: ¥${row.commission_amount}.`,
      }).select('id').single()
      if (contractErr) throw contractErr
      serviceContractId = service.id
      }
      const { data: activeServices, error: revenueErr } = await db.from('service_contracts').select('monthly_revenue').eq('client_id', client.id).eq('is_active', true)
      if (revenueErr) throw revenueErr
      const monthlyRevenue = (activeServices || []).reduce((sum, service) => sum + Number(service.monthly_revenue || 0), 0)
      await db.from('clients').update({ monthly_revenue: monthlyRevenue }).eq('id', client.id)
      finalStatus = 'active'
      await db.from('sales_leads').update({ stage: 'won', last_contact_date: today, updated_at: new Date().toISOString() }).eq('id', row.lead_id)
    }
    const { error } = await db.from('sales_contract_submissions').update({ status: finalStatus, admin_note: String(body.admin_note || '').slice(0, 3000), reviewed_by: user.id, reviewed_at: new Date().toISOString(), service_contract_id: serviceContractId, updated_at: new Date().toISOString() }).eq('id', row.id)
    if (error) throw error
    await db.from('sales_notifications').insert({ salesperson_id: row.salesperson_id, audience: 'seller', event_type: finalStatus, title: finalStatus === 'active' ? 'Contrato aprovado e ativo' : finalStatus === 'changes_requested' ? 'Ajustes solicitados no contrato' : 'Contrato não aprovado', body: String(body.admin_note || ''), lead_id: row.lead_id, contract_submission_id: row.id })
    return { success: true, status: finalStatus, service_contract_id: serviceContractId }
  }

  if (action === 'send-message') {
    if (!admin) return jsonError(res, 403, 'Somente admin pode enviar mensagens.')
    const title = String(body.title || '').trim().slice(0, 160)
    const text = String(body.body || '').trim().slice(0, 3000)
    if (!title && !text) return jsonError(res, 400, 'Escreva a mensagem.')
    const kind = ['message', 'alert', 'praise'].includes(body.kind) ? body.kind : 'message'
    let sellerIds = Array.isArray(body.salesperson_ids) ? body.salesperson_ids.map(String).filter(Boolean).slice(0, 200) : []
    if (body.to === 'all_sellers') {
      const { data: people, error: peopleErr } = await db.from('salespeople').select('id').eq('is_active', true)
      if (peopleErr) throw peopleErr
      sellerIds = (people || []).map(row => row.id)
    }
    const base = { event_type: kind, title: title || (kind === 'alert' ? 'Alerta' : 'Mensagem'), body: text, lead_id: body.lead_id || null, sender_name: String(user.name || '').slice(0, 120) }
    const rows = sellerIds.map(id => ({ ...base, salesperson_id: id, audience: 'seller' }))
    // Managers (admin / marketing) read admin-audience messages in the sales and marketing pages.
    if (body.to === 'managers' || body.include_managers) rows.push({ ...base, salesperson_id: null, audience: 'admin' })
    if (!rows.length) return jsonError(res, 400, 'Escolha para quem enviar.')
    const { error } = await db.from('sales_notifications').insert(rows)
    if (error) throw error
    return { sent: rows.length }
  }

  if (action === 'start-day') {
    if (admin) return jsonError(res, 403, 'O início do dia é registrado pelo vendedor.')
    const now = new Date()
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
    const { data: existing } = await db.from('sales_day_reports').select('*').eq('salesperson_id', own).eq('work_date', today).maybeSingle()
    if (existing?.started_at && !existing.closed_at) return { report: existing }
    const row = { salesperson_id: own, work_date: today, started_at: existing?.started_at || time, start_location: String(body.location || '').slice(0, 80) || existing?.start_location || null, closed_at: null, updated_at: now.toISOString() }
    const { data, error } = await db.from('sales_day_reports').upsert(row, { onConflict: 'salesperson_id,work_date' }).select().single()
    if (error) throw error
    return { report: data }
  }

  if (action === 'end-day') {
    if (admin) return jsonError(res, 403, 'O fim do dia é registrado pelo vendedor.')
    const now = new Date()
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
    const { data: existing } = await db.from('sales_day_reports').select('*').eq('salesperson_id', own).eq('work_date', today).maybeSingle()
    const started = existing?.started_at || ''
    const minutes = /^\d{2}:\d{2}$/.test(started) ? (Number(time.slice(0, 2)) * 60 + Number(time.slice(3))) - (Number(started.slice(0, 2)) * 60 + Number(started.slice(3))) : 0
    const hours = Math.max(0, Math.round(minutes / 60 * 100) / 100)
    const stats = await dayStats(db, own, today)
    const report = await writeDayReport({ seller: user.name, date: today, started, ended: time, hours, stats, note: String(body.note || '').slice(0, 2000), language: body.language })
    const row = {
      salesperson_id: own, work_date: today, started_at: started, ended_at: time, hours_worked: hours || Number(existing?.hours_worked || 0),
      end_location: String(body.location || '').slice(0, 80) || null, travel_cost: num(body.travel_cost ?? existing?.travel_cost ?? 0),
      areas: stats.areas.join(', ').slice(0, 500), summary: String(body.note || existing?.summary || '').slice(0, 2000),
      ai_report: report, day_stats: stats, closed_at: now.toISOString(), updated_at: now.toISOString(),
    }
    const { data, error } = await db.from('sales_day_reports').upsert(row, { onConflict: 'salesperson_id,work_date' }).select().single()
    if (error) throw error
    await db.from('sales_notifications').insert({ salesperson_id: own, audience: 'admin', event_type: 'day_report', title: `Relatório do dia · ${user.name || ''}`.trim(), body: `${today} · ${started || '?'}–${time} · ${stats.approaches} abordagens · ${stats.contacts} contatos · ${stats.quotes_sent} orçamentos`, sender_name: String(user.name || '').slice(0, 120), dedupe_key: `admin:day:${own}:${today}:${now.getTime()}` })
    return { report: data }
  }

  if (action === 'read-notification') {
    let query = db.from('sales_notifications').update({ read_at: new Date().toISOString() })
    query = body.all ? query.is('read_at', null) : query.eq('id', body.id)
    if (admin && body.all) query = query.eq('audience', 'admin')
    if (!admin) query = query.eq('salesperson_id', own).eq('audience', 'seller')
    const { error } = await query
    if (error) throw error
    return { success: true }
  }
  return jsonError(res, 400, 'Ação não reconhecida.')
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const user = await requireActiveSalesSession(req, res)
  if (!user) return
  try {
    const db = salesDb()
    if (req.method === 'GET') {
      const result = await getAction(db, user, String(req.query?.action || 'dashboard'), req.query || {})
      return res.status(200).json(result)
    }
    if (req.method === 'POST') {
      const result = await postAction(db, user, req.body || {}, res)
      if (res.writableEnded) return
      return res.status(200).json(result)
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    console.error('[sales-data]', error?.message || error)
    return res.status(error.status || 500).json({ error: error.status ? error.message : 'Falha ao processar operação comercial.' })
  }
}
