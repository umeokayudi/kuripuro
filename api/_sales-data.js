import { requireActiveSalesSession, salesDb } from './_salesSession.js'
import { geminiGenerate } from './_gemini.js'
import { sellerCommissionSummary, quoteCommissionState } from '../src/lib/contractCommission.js'
import { serviceOffers } from '../src/lib/facilityModel.js'
import { quoteSellerFor } from '../src/lib/quoteSeller.js'
import { estimateMinimum, signMinimum, readMinimum } from './_quoteMinimum.js'

const LEAD_FIELDS = new Set([
  'company_name', 'company_kana', 'site_name', 'address', 'phone', 'email', 'website', 'industry',
  'locations_count', 'contact_name', 'contact_title', 'contact_phone', 'contact_email', 'contact_line_id',
  'first_contact_date', 'last_contact_date', 'next_followup_date', 'source', 'needs', 'still_needed',
  'decision_maker', 'expected_monthly', 'expected_start', 'competitor', 'notes', 'interest', 'stage', 'lost_reason', 'region', 'marketing_channel_id', 'marketing_campaign_id', 'business_card_object_path',
  'gps_lat', 'gps_lng', 'gps_accuracy', 'gps_captured_at', 'maps_url',
])
// Added by sql/2026-10-15_vendedor_gps_marketing.sql. Until it runs, saving a lead
// keeps working and the location goes into the notes instead.
const LEAD_GEO_FIELDS = ['gps_lat', 'gps_lng', 'gps_accuracy', 'gps_captured_at', 'maps_url']
const missingColumn = error => error && (error.code === 'PGRST204' || error.code === '42703' || /column/i.test(String(error.message || '')))
const isMapsLink = value => /^https:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(String(value || '').trim())

function geoNote(payload) {
  const parts = []
  if (payload.gps_lat != null && payload.gps_lng != null) parts.push(`GPS ${Number(payload.gps_lat).toFixed(5)},${Number(payload.gps_lng).toFixed(5)}${payload.gps_accuracy ? ` (±${Math.round(payload.gps_accuracy)} m)` : ''}`)
  if (payload.maps_url) parts.push(`Maps ${payload.maps_url}`)
  return parts.length ? `📍 ${parts.join(' · ')}` : ''
}

async function writeLead(db, payload, { id, own } = {}) {
  const run = row => {
    if (!id) return db.from('sales_leads').insert(row).select().single()
    let query = db.from('sales_leads').update(row).eq('id', id)
    if (own) query = query.eq('salesperson_id', own)
    return query.select().maybeSingle()
  }
  const first = await run(payload)
  if (!missingColumn(first.error) || !LEAD_GEO_FIELDS.some(key => key in payload)) return first
  const fallback = { ...payload }
  const note = geoNote(payload)
  for (const key of LEAD_GEO_FIELDS) delete fallback[key]
  if (note && !String(fallback.notes || '').includes(note)) fallback.notes = [fallback.notes, note].filter(Boolean).join('\n')
  return run(fallback)
}

function safeLead(input) {
  const out = {}
  for (const [key, value] of Object.entries(input || {})) if (LEAD_FIELDS.has(key)) out[key] = value
  if (out.company_name != null) out.company_name = String(out.company_name).trim().slice(0, 200)
  if (out.marketing_channel_id === '') out.marketing_channel_id = null
  if (out.marketing_campaign_id === '') out.marketing_campaign_id = null
  for (const key of ['first_contact_date', 'last_contact_date', 'next_followup_date', 'expected_start']) {
    if (out[key] === '') out[key] = null
  }
  for (const key of ['gps_lat', 'gps_lng', 'gps_accuracy']) {
    if (key in out) out[key] = out[key] === '' || out[key] == null || !Number.isFinite(Number(out[key])) ? null : Number(out[key])
  }
  if (out.gps_lat != null && Math.abs(out.gps_lat) > 90) out.gps_lat = null
  if (out.gps_lng != null && Math.abs(out.gps_lng) > 180) out.gps_lng = null
  if ('gps_captured_at' in out) out.gps_captured_at = out.gps_captured_at ? String(out.gps_captured_at).slice(0, 40) : null
  if ('maps_url' in out) out.maps_url = String(out.maps_url || '').trim().slice(0, 600) || null
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

// Marketing logins see every lead's source and stage (to measure channels), not the
// sellers' private contact details, and no seller pay.
const MARKETING_LEAD_COLUMNS = 'id,stage,company_name,site_name,region,source,salesperson_id,marketing_channel_id,marketing_campaign_id,first_contact_date,last_contact_date,closed_at,created_at,updated_at,expected_monthly'

async function loadMarketingDashboard(db, user) {
  const since = `${Number(todayTokyo().slice(0, 4)) - 1}-01`
  const [leadsRes, contractsRes, peopleRes, notificationsRes, channelsRes, campaignsRes, spendRes, goalsRes] = await Promise.all([
    db.from('sales_leads').select(MARKETING_LEAD_COLUMNS).order('updated_at', { ascending: false }).limit(2000),
    db.from('sales_contract_submissions').select('id,lead_id,salesperson_id,status,company_name,site_name,client_monthly_total,base_monthly_amount,created_at,reviewed_at').order('created_at', { ascending: false }).limit(1000),
    db.from('salespeople').select('id,full_name,is_active').order('full_name'),
    db.from('sales_notifications').select('*').eq('audience', 'seller').eq('salesperson_id', user.id).is('read_at', null).order('created_at', { ascending: false }).limit(100),
    db.from('marketing_channels').select('id,name,channel_type,platform,is_active').eq('is_active', true).order('name'),
    db.from('marketing_campaigns').select('id,channel_id,name,objective,budget,starts_on,ends_on,status').order('created_at', { ascending: false }),
    db.from('marketing_spend').select('*').order('spent_on', { ascending: false }).limit(2000),
    db.from('marketing_goals').select('*').gte('period_month', since).order('period_month', { ascending: false }),
  ])
  const failed = [leadsRes, peopleRes, notificationsRes, channelsRes, campaignsRes, spendRes, goalsRes].find(r => r.error)
  if (failed) throw failed.error
  // A missing optional column on contracts must not hide the whole portal.
  const contracts = contractsRes.error ? [] : (contractsRes.data || [])
  const leads = leadsRes.data || []
  const spend = spendRes.data || []
  const campaigns = (campaignsRes.data || []).map(campaign => {
    const relatedLeads = leads.filter(row => row.marketing_campaign_id === campaign.id)
    const campaignSpend = spend.filter(row => row.campaign_id === campaign.id).reduce((sum, row) => sum + Number(row.amount || 0), 0)
    const conversions = relatedLeads.filter(row => row.stage === 'won').length
    return { ...campaign, spend: campaignSpend, leads: relatedLeads.length, conversions, cost_per_lead: relatedLeads.length ? campaignSpend / relatedLeads.length : 0, customer_acquisition_cost: conversions ? campaignSpend / conversions : 0 }
  })
  return { user, today: todayTokyo(), leads, contracts, salespeople: peopleRes.data || [], notifications: notificationsRes.data || [], marketing: { channels: channelsRes.data || [], campaigns, spend, goals: goalsRes.data || [] } }
}

// Quote requests clients send from their portal (client_requests, request_type 'quote').
// A seller sees the ones of the clients they look after (clients.salesperson_id) plus the
// ones they already sent. The company sets the base price, the seller adds an extra on top
// that becomes their commission (sql/2026-10-17_orcamento_vendedor.sql). Until that SQL
// runs the list is simply empty.
const QUOTE_REQUEST_COLUMNS = 'id,client_id,location_name,description,preferred_date,status,ticket_number,created_at,request_type,category,quote_amount,quote_note,quote_status,quoted_at,decided_at,salesperson_id,base_amount,seller_markup,priced_at,commission_paid_at'

async function loadQuoteRequests(db, user, isAdmin) {
  try {
    const [clientsRes, contractsRes] = await Promise.all([
      db.from('clients').select('id,company_name,salesperson_id'),
      db.from('service_contracts').select('client_id,location_name,salesperson_id').not('salesperson_id', 'is', null),
    ])
    if (clientsRes.error) return []
    const clients = clientsRes.data || []
    const contracts = contractsRes.error ? [] : (contractsRes.data || [])
    const { data, error } = await db.from('client_requests').select(QUOTE_REQUEST_COLUMNS).eq('request_type', 'quote').order('created_at', { ascending: false }).limit(300)
    if (error) return []
    const byId = new Map(clients.map(c => [c.id, c]))
    // v1.0.70 · The seller is found the same way everywhere (request → client → store contract),
    // so a store whose seller is only on its contract still reaches that seller.
    return (data || [])
      .map(row => ({ ...row, client_name: byId.get(row.client_id)?.company_name || '', account_seller_id: quoteSellerFor(row, byId.get(row.client_id), contracts) }))
      .filter(row => isAdmin || row.account_seller_id === user.id)
  } catch {
    return []
  }
}

/**
 * v1.0.77 · Clients (and their stores) a seller can send a new quote to: the ones they look after
 * on the client account or on a store contract. Admin gets every active client.
 */
async function loadQuoteClients(db, user, isAdmin) {
  try {
    const [clientsRes, contractsRes] = await Promise.all([
      db.from('clients').select('id,company_name,salesperson_id,is_active').order('company_name'),
      db.from('service_contracts').select('client_id,location_name,salesperson_id,is_active'),
    ])
    if (clientsRes.error) return []
    const contracts = contractsRes.error ? [] : (contractsRes.data || [])
    const base = name => String(name || '').split(/\s+[-—–]\s+/)[0].trim()
    return (clientsRes.data || []).filter(c => c.is_active !== false).map(c => {
      const own = contracts.filter(k => k.client_id === c.id && k.is_active !== false)
      const stores = [...new Set(own.map(k => base(k.location_name)).filter(Boolean))]
      const mine = isAdmin || c.salesperson_id === user.id || own.some(k => k.salesperson_id === user.id)
      return mine ? { id: c.id, company_name: c.company_name, stores } : null
    }).filter(Boolean)
  } catch {
    return []
  }
}

/** Seller of one request (request → client account → store contract). */
async function sellerOfRequest(db, row) {
  const [{ data: client }, { data: contracts }] = await Promise.all([
    db.from('clients').select('id,company_name,salesperson_id').eq('id', row.client_id).maybeSingle(),
    db.from('service_contracts').select('client_id,location_name,salesperson_id').eq('client_id', row.client_id).not('salesperson_id', 'is', null),
  ])
  return { client, sellerId: quoteSellerFor(row, client, contracts || []) }
}

async function loadDashboard(db, user) {
  if (user.role === 'salesperson' && user.team === 'marketing') return loadMarketingDashboard(db, user)
  const isAdmin = user.role === 'admin'
  const id = user.id
  const scope = q => isAdmin ? q : q.eq('salesperson_id', id)
  const [leadsRes, quotesRes, approachesRes, reportsRes, submissionsRes, peopleRes, rulesRes, notificationsRes, channelsRes, campaignsRes, spendRes, touchpointsRes, goalsRes, marketingGoalsRes] = await Promise.all([
    scope(db.from('sales_leads').select('*').order('updated_at', { ascending: false }).limit(500)),
    scope(db.from('mitsumori').select('id,salesperson_id,lead_id,quote_number,status,total,subtotal,created_at,company_name,valid_until,sent_at,decided_at,decision_reason,frequency,items:mitsumori_items(description,quantity,unit_price,total)').order('created_at', { ascending: false }).limit(500)),
    scope(db.from('sales_field_approaches').select('*').order('work_date', { ascending: false }).limit(1000)),
    scope(db.from('sales_day_reports').select('*').order('work_date', { ascending: false }).limit(500)),
    scope(db.from('sales_contract_submissions').select('*').order('created_at', { ascending: false }).limit(500)),
    isAdmin ? db.from('salespeople').select('id,full_name,email,phone,is_active,created_at,team').order('full_name').then(r => r.error ? db.from('salespeople').select('id,full_name,email,phone,is_active,created_at').order('full_name') : r) : Promise.resolve({ data: [] }),
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
  // Contracts the seller brought in (spot = one-off commission, fixed location = monthly commission).
  const [spotCommRes, fixedCommRes, quoteRequests, quoteClients] = await Promise.all([
    scope(db.from('spot_contracts').select('id,contract_number,location_name,client_name,service_date,status,price,tax_rate,price_includes_tax,salesperson_id,salesperson_name,commission_type,commission_value,commission_amount,commission_paid_at').eq('is_active', true).not('salesperson_id', 'is', null).order('service_date', { ascending: false }).limit(1000)),
    scope(db.from('service_contracts').select('id,client_id,location_name,service_type,monthly_revenue,is_active,salesperson_id,commission_type,commission_value,commission_amount').eq('is_active', true).not('salesperson_id', 'is', null).limit(1000)),
    loadQuoteRequests(db, user, isAdmin),
    loadQuoteClients(db, user, isAdmin),
  ])
  // Missing columns (SQL not applied yet) must not take the whole dashboard down.
  const spotCommissions = spotCommRes.error ? [] : (spotCommRes.data || [])
  const fixedCommissions = fixedCommRes.error ? [] : (fixedCommRes.data || [])
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
      ...(() => {
        const c = sellerCommissionSummary(spotCommissions.filter(row => row.salesperson_id === person.id), fixedCommissions.filter(row => row.salesperson_id === person.id))
        return { spot_commission_due: c.earned, spot_commission_paid: c.paid, spot_commission_pending: c.pending, fixed_commission_monthly: c.monthly }
      })(),
      ...(() => {
        const own = quoteRequests.filter(row => row.salesperson_id === person.id)
        const sum = state => own.filter(row => quoteCommissionState(row) === state).reduce((n, row) => n + Number(row.seller_markup || 0), 0)
        return { quote_commission_due: sum('earned'), quote_commission_paid: sum('paid'), quote_commission_pending: sum('pending') }
      })(),
      commission_pending: ownContracts.filter(row => ['active', 'approved'].includes(row.status)).reduce((sum, row) => sum + Number(row.commission_amount || 0), 0),
      hours_this_month: reports.filter(row => row.salesperson_id === person.id && String(row.work_date || '').startsWith(todayTokyo().slice(0, 7))).reduce((sum, row) => sum + Number(row.hours_worked || 0), 0),
    }
  })
  const facilityOffers = await loadFacilityOffers(db, isAdmin ? null : [...new Set(fixedCommissions.filter(row => row.salesperson_id === id).map(row => row.client_id).filter(Boolean))])
  const channels = channelsRes.data || []
  const campaigns = campaignsRes.data || []
  const spend = spendRes.data || []
  const marketing = campaigns.map(campaign => {
    const relatedLeads = leads.filter(row => row.marketing_campaign_id === campaign.id)
    const campaignSpend = spend.filter(row => row.campaign_id === campaign.id).reduce((sum, row) => sum + Number(row.amount || 0), 0)
    const conversions = relatedLeads.filter(row => row.stage === 'won').length
    return { ...campaign, spend: campaignSpend, leads: relatedLeads.length, conversions, cost_per_lead: relatedLeads.length ? campaignSpend / relatedLeads.length : 0, customer_acquisition_cost: conversions ? campaignSpend / conversions : 0 }
  })
  return { user, today: todayTokyo(), leads, quotes, approaches, reports, contracts: submissions, salespeople: people, commissionRules: rulesRes.data || [], notifications: notificationsRes.data || [], metrics, marketing: { channels, campaigns: marketing, spend, goals: marketingGoalsRes.data || [] }, touchpoints: touchpointsRes.data || [], goals: goalsRes.data || [], contractCommissions: { spot: spotCommissions, fixed: fixedCommissions }, quoteRequests, quoteClients, facilityOffers }
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
  if (action === 'deal') return loadDeal(db, user, String(query.lead_id || ''))
  throw Object.assign(new Error('Ação de leitura inválida.'), { status: 400 })
}

// One client's whole story for the client page: quotes, contract, and once the
// contract is active, the services done/scheduled and the invoices.
async function loadDeal(db, user, leadId) {
  const notFound = () => Object.assign(new Error('Cliente não encontrado nesta conta.'), { status: 404 })
  if (!leadId || (user.role === 'salesperson' && user.team === 'marketing')) throw notFound()
  let leadQuery = db.from('sales_leads').select('*').eq('id', leadId)
  if (user.role !== 'admin') leadQuery = leadQuery.eq('salesperson_id', user.id)
  const { data: lead, error } = await leadQuery.maybeSingle()
  if (error) throw error
  if (!lead) throw notFound()
  const [quotesRes, subsRes] = await Promise.all([
    db.from('mitsumori').select('id,quote_number,status,subtotal,tax_amount,total,tax_rate,issue_date,valid_until,frequency,hours_per_visit,expected_start,created_at,sent_at,decided_at,decision_reason,salesperson_id,items:mitsumori_items(description,quantity,unit_price,total)').eq('lead_id', lead.id).order('created_at', { ascending: false }),
    db.from('sales_contract_submissions').select('*').eq('lead_id', lead.id).order('created_at', { ascending: false }),
  ])
  if (quotesRes.error) throw quotesRes.error
  if (subsRes.error) throw subsRes.error
  const submissions = subsRes.data || []
  const serviceIds = submissions.map(r => r.service_contract_id).filter(Boolean)
  let services = []
  if (serviceIds.length) {
    const res = await db.from('service_contracts').select('id,client_id,location_name,location_address,service_type,billing_type,monthly_revenue,visits_per_month,hours_per_visit,days_of_week,billing_day,is_active,created_at').in('id', serviceIds)
    services = res.data || []
  }
  const clientId = services.find(r => r.client_id)?.client_id || null
  let client = null, jobs = [], invoices = []
  if (clientId) {
    const since = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10)
    const [clientRes, jobsRes, invRes] = await Promise.all([
      db.from('clients').select('id,company_name,contact_name,phone,email,address,monthly_revenue,is_active,created_at,manager_name,manager_phone,manager_email').eq('id', clientId).maybeSingle(),
      db.from('jobs').select('id,title,scheduled_date,scheduled_time,employee_name,status,started_at,completed_at,job_category').eq('client_id', clientId).gte('scheduled_date', since).order('scheduled_date', { ascending: false }).limit(80),
      db.from('faturas').select('id,period_start,period_end,issue_date,due_date,total,status,paid_at,payment_method').eq('client_id', clientId).order('issue_date', { ascending: false }).limit(24),
    ])
    client = clientRes.data || null
    jobs = jobsRes.error ? [] : (jobsRes.data || [])
    invoices = invRes.error ? [] : (invRes.data || [])
  }
  return { lead, quotes: quotesRes.data || [], submissions, services, client, jobs, invoices }
}

// One e-mail = one login. The sign-in checks admins and employees before sellers,
// so a seller sharing their e-mail could never reach the Sales portal.
async function emailTakenByOtherLogin(db, email, sellerId = null) {
  const [adm, emp, seller] = await Promise.all([
    db.from('admins').select('id').eq('email', email).limit(1).maybeSingle(),
    db.from('employees').select('id').eq('email', email).limit(1).maybeSingle(),
    db.from('salespeople').select('id').eq('email', email).limit(1).maybeSingle(),
  ])
  return Boolean(adm.data || emp.data || (seller.data && seller.data.id !== sellerId))
}

async function postAction(db, user, body, res) {
  const today = todayTokyo()
  const { action } = body || {}
  const admin = user.role === 'admin'
  const marketer = user.role === 'salesperson' && user.team === 'marketing'
  const own = user.id

  if (action === 'create-salesperson') {
    if (!admin) return jsonError(res, 403, 'Somente admin pode criar vendedor.')
    const { full_name, email, phone = '' } = body
    // The login form trims what is typed, so store the trimmed password too.
    const password = String(body.password || '').trim()
    if (!String(full_name || '').trim() || !String(email || '').trim() || password.length < 10) return jsonError(res, 400, 'Informe nome, e-mail e senha com pelo menos 10 caracteres.')
    if (await emailTakenByOtherLogin(db, String(email).trim().toLowerCase())) return jsonError(res, 409, 'Este e-mail já é usado por outro login (admin, funcionário ou vendedor).')
    const { hashSalesPassword } = await import('./_salesSession.js')
    const { data, error } = await db.from('salespeople').insert({ full_name: String(full_name).trim(), email: String(email).trim().toLowerCase(), password_hash: hashSalesPassword(password), phone: String(phone).trim(), is_active: true }).select('id,full_name,email,phone,is_active').single()
    if (error) throw error
    if (body.team === 'marketing') {
      const teamRes = await db.from('salespeople').update({ team: 'marketing' }).eq('id', data.id)
      if (teamRes.error) return { salesperson: data, warning: 'Rode o SQL 2026-10-15 para separar marketing de vendas.' }
      data.team = 'marketing'
    }
    return { salesperson: data }
  }

  if (action === 'set-salesperson-active') {
    if (!admin) return jsonError(res, 403, 'Somente admin pode alterar acesso.')
    const { error } = await db.from('salespeople').update({ is_active: Boolean(body.is_active) }).eq('id', body.salesperson_id)
    if (error) throw error
    return { success: true }
  }

  if (action === 'update-salesperson') {
    if (!admin) return jsonError(res, 403, 'Somente admin pode editar vendedor.')
    const patch = {}
    if (body.full_name !== undefined) {
      if (!String(body.full_name).trim()) return jsonError(res, 400, 'Informe o nome.')
      patch.full_name = String(body.full_name).trim()
    }
    if (body.email !== undefined) {
      const email = String(body.email).trim().toLowerCase()
      if (!email.includes('@')) return jsonError(res, 400, 'E-mail inválido.')
      if (await emailTakenByOtherLogin(db, email, body.salesperson_id)) return jsonError(res, 409, 'Este e-mail já é usado por outro login (admin, funcionário ou vendedor).')
      patch.email = email
    }
    if (body.phone !== undefined) patch.phone = String(body.phone || '').trim()
    if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active)
    if (body.team !== undefined) patch.team = body.team === 'marketing' ? 'marketing' : 'sales'
    if (String(body.password || '').trim()) {
      if (String(body.password).trim().length < 10) return jsonError(res, 400, 'A senha do vendedor precisa de pelo menos 10 caracteres.')
      const { hashSalesPassword } = await import('./_salesSession.js')
      patch.password_hash = hashSalesPassword(String(body.password).trim())
    }
    if (!Object.keys(patch).length) return jsonError(res, 400, 'Nada para salvar.')
    let { data, error } = await db.from('salespeople').update(patch).eq('id', body.salesperson_id).select('id,full_name,email,phone,is_active').single()
    if (missingColumn(error) && 'team' in patch) {
      // team column not created yet: save everything else.
      delete patch.team
      if (!Object.keys(patch).length) return jsonError(res, 400, 'Rode o SQL 2026-10-15 para separar marketing de vendas.')
      ;({ data, error } = await db.from('salespeople').update(patch).eq('id', body.salesperson_id).select('id,full_name,email,phone,is_active').single())
    }
    if (error) {
      if (error.code === '23505') return jsonError(res, 409, 'Este e-mail já está em uso.')
      throw error
    }
    return { salesperson: data }
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
    if (!admin && !marketer) return jsonError(res, 403, 'Somente admin ou marketing pode editar canais de marketing.')
    const name = String(body.name || '').trim().slice(0, 120)
    if (!name) return jsonError(res, 400, 'Informe o nome do canal.')
    const payload = { name, channel_type: body.channel_type || 'other', platform: String(body.platform || '').slice(0, 120), is_active: body.is_active !== false }
    const query = body.id ? db.from('marketing_channels').update(payload).eq('id', body.id) : db.from('marketing_channels').insert(payload)
    const { data, error } = await query.select().single()
    if (error) throw error
    return { channel: data }
  }

  if (action === 'save-marketing-campaign') {
    if (!admin && !marketer) return jsonError(res, 403, 'Somente admin ou marketing pode editar campanhas.')
    if (!String(body.name || '').trim() || !body.channel_id) return jsonError(res, 400, 'Informe nome e canal.')
    const payload = { channel_id: body.channel_id, name: String(body.name).trim().slice(0, 180), objective: String(body.objective || '').slice(0, 2000), budget: num(body.budget || 0), starts_on: body.starts_on || null, ends_on: body.ends_on || null, status: body.status || 'active' }
    const query = body.id ? db.from('marketing_campaigns').update(payload).eq('id', body.id) : db.from('marketing_campaigns').insert(payload)
    const { data, error } = await query.select().single()
    if (error) throw error
    return { campaign: data }
  }

  if (action === 'record-marketing-spend') {
    if (!admin && !marketer) return jsonError(res, 403, 'Somente admin ou marketing pode registrar investimento em marketing.')
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
    // v1.0.96 · sellers may close a deal straight from Contact ("won" → Contract step, still approved by the office).
    if (!admin && payload.stage === 'lost') payload.stage = 'followup'
    if (payload.maps_url && !isMapsLink(payload.maps_url)) return jsonError(res, 400, 'Cole um link do Google Maps (google.com/maps ou maps.app.goo.gl).')
    // Every lead a seller registers carries the business card photo and where they were.
    if (!admin && !body.id) {
      if (!String(payload.business_card_object_path || '').startsWith(`cards/${own}/`)) return jsonError(res, 400, 'Tire a foto do cartão de visita (business card) antes de salvar o lead.')
      if (payload.gps_lat == null || payload.gps_lng == null) return jsonError(res, 400, 'Ative a localização (GPS) para registrar o lead.')
    }
    if (body.id) {
      const { data, error } = await writeLead(db, payload, { id: body.id, own: admin ? null : own })
      if (error) throw error
      if (!data) return jsonError(res, 404, 'Lead não encontrado nesta conta.')
      return { lead: data }
    }
    if (!payload.first_contact_date) payload.first_contact_date = today
    if (!payload.last_contact_date) payload.last_contact_date = payload.first_contact_date
    const { data, error } = await writeLead(db, payload)
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
    if (!admin && !marketer) return jsonError(res, 403, 'Somente admin ou marketing pode definir metas de marketing.')
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
    // Sellers send their own clients; an admin can also prepare one for the seller.
    // Without the signed PDF it is saved as a draft (step "generate contract"), and
    // attaching the signed PDF later sends it to the admin for approval.
    const input = body.contract || {}
    let leadQuery = db.from('sales_leads').select('id,company_name,site_name,address,contact_name,salesperson_id').eq('id', input.lead_id)
    if (!admin) leadQuery = leadQuery.eq('salesperson_id', own)
    const { data: lead, error: leadErr } = await leadQuery.maybeSingle()
    if (leadErr) throw leadErr
    if (!lead) return jsonError(res, 404, 'Lead não encontrado nesta conta.')
    if (admin && !lead.salesperson_id) return jsonError(res, 400, 'Atribua um vendedor a este cliente antes de gerar o contrato.')
    const pdfPath = String(input.signed_pdf_object_path || '')
    const signed = Boolean(pdfPath)
    if (signed && (!pdfPath.startsWith(`contracts/${own}/`) || !pdfPath.endsWith('.pdf'))) return jsonError(res, 400, 'Anexe o PDF do contrato assinado antes de enviar.')
    const ownerId = admin ? lead.salesperson_id : own
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
      salesperson_id: ownerId, lead_id: lead.id, quote_id: input.quote_id || null, status: signed ? 'pending_review' : 'draft',
      company_name: lead.company_name, site_name: String(input.site_name || lead.site_name || lead.company_name),
      address: String(input.address || lead.address || ''), contact_name: String(input.contact_name || lead.contact_name || ''),
      service_type: String(input.service_type || 'Basic Cleaning'), billing_type: billingType,
      base_monthly_amount: base, commission_type: commissionType, commission_value: rate,
      commission_amount: extra, client_monthly_total: base + extra,
      price_per_visit: unitPrice, visits_per_month: visitsPerMonth,
      hours_per_visit: num(input.hours_per_visit || 2), days_of_week: Array.isArray(input.days_of_week) ? input.days_of_week.filter(x => typeof x === 'string').slice(0, 7) : [],
      billing_day: Math.min(28, Math.max(1, Math.round(num(input.billing_day || 10)))), tax_rate: Math.round(num(input.tax_rate ?? 10)),
      signed_pdf_object_path: signed ? pdfPath : null, signed_pdf_name: signed ? String(input.signed_pdf_name || 'signed-contract.pdf').slice(0, 160) : null,
      submitted_at: signed ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
    }
    let data, error
    if (input.id) {
      // Edit a draft (or one the admin sent back) instead of creating a second contract.
      let q = db.from('sales_contract_submissions').update(payload).eq('id', input.id).in('status', ['draft', 'changes_requested'])
      if (!admin) q = q.eq('salesperson_id', own)
      ;({ data, error } = await q.select().maybeSingle())
      if (!error && !data) return jsonError(res, 409, 'Este contrato já foi enviado e não pode mais ser editado.')
    } else {
      ;({ data, error } = await db.from('sales_contract_submissions').insert(payload).select().single())
    }
    if (error) throw error
    if (!signed) return { contract: data }
    await db.from('sales_notifications').insert([
      { salesperson_id: ownerId, audience: 'seller', event_type: 'contract_submitted', title: 'Contrato enviado para aprovação', body: lead.company_name, lead_id: lead.id, contract_submission_id: data.id },
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
      // The seller who closed it is paid commission on this location (monthly).
      await db.from('service_contracts').update({ salesperson_id: row.salesperson_id, commission_type: row.commission_type, commission_value: row.commission_value, commission_amount: Number(row.commission_amount || 0) }).eq('id', serviceContractId).is('salesperson_id', null)
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

  if (action === 'price-client-quote') {
    // Admin sets the company price. With a seller on the account it goes to the seller,
    // who adds their extra and sends it; `direct` sends it to the client as is.
    if (!admin) return jsonError(res, 403, 'Somente admin define o preço da empresa.')
    const base = num(body.base_amount)
    if (!base) return jsonError(res, 400, 'Informe o preço da empresa.')
    const { data: row, error: rowErr } = await db.from('client_requests').select('id,client_id,quote_status,request_type,location_name,category,description,salesperson_id').eq('id', String(body.id || '')).maybeSingle()
    if (rowErr) throw rowErr
    if (!row || row.request_type !== 'quote') return jsonError(res, 404, 'Pedido de orçamento não encontrado.')
    if (['accepted', 'declined'].includes(row.quote_status)) return jsonError(res, 409, 'O cliente já respondeu este orçamento.')
    const found = await sellerOfRequest(db, row)
    const client = found.client
    const sellerId = body.direct ? null : found.sellerId
    const note = String(body.note || '').trim().slice(0, 1000) || null
    const now = new Date().toISOString()
    const patch = sellerId
      ? { base_amount: base, priced_at: now, quote_status: 'priced', salesperson_id: sellerId, seller_markup: null, quote_note: note }
      : { base_amount: base, priced_at: now, quote_status: 'quoted', quoted_at: now, quote_amount: base, seller_markup: 0, quote_note: note }
    const { data, error } = await db.from('client_requests').update(patch).eq('id', row.id).select().single()
    if (error) throw error
    if (sellerId) {
      const place = [client?.company_name, row.location_name].filter(Boolean).join(' · ')
      await db.from('sales_notifications').insert({ salesperson_id: sellerId, audience: 'seller', event_type: 'quote_priced', title: 'Orçamento pronto para você enviar', body: `${place} · ${row.category || String(row.description || '').slice(0, 80)} · base ¥${Math.round(base).toLocaleString()}`, sender_name: String(user.name || '').slice(0, 120) })
    }
    return { request: data, to_seller: Boolean(sellerId) }
  }

  if (action === 'send-client-quote') {
    // Seller sends the quote to the client: company price + their extra (= their commission).
    if (marketer) return jsonError(res, 403, 'Sem permissão.')
    const markup = num(body.markup || 0)
    const { data: row, error: rowErr } = await db.from('client_requests').select('id,client_id,quote_status,request_type,base_amount,salesperson_id,location_name,category').eq('id', String(body.id || '')).maybeSingle()
    if (rowErr) throw rowErr
    if (!row || row.request_type !== 'quote') return jsonError(res, 404, 'Pedido de orçamento não encontrado.')
    const { client, sellerId: owner } = await sellerOfRequest(db, row)
    if (!admin && owner !== own) return jsonError(res, 403, 'Este cliente é de outro vendedor.')
    // v1.0.77 · Without the company price yet, the seller may send with the AI minimum (signed).
    const waiting = !row.quote_status || row.quote_status === 'requested'
    const aiMin = waiting && body.min_token ? readMinimum(body.min_token, own) : null
    if (waiting && body.min_token && (!aiMin || aiMin.k !== 'req' || aiMin.id !== row.id)) return jsonError(res, 409, 'O valor mínimo expirou. Calcule de novo.')
    if (!aiMin && (row.quote_status !== 'priced' || !Number(row.base_amount))) return jsonError(res, 409, 'A empresa ainda não definiu o preço deste orçamento.')
    const base = aiMin ? Number(aiMin.min) : Number(row.base_amount)
    if (markup > base * 10) return jsonError(res, 400, 'O valor a mais está alto demais. Confira o número.')
    const sellerId = admin ? owner : own
    const note = String(body.note || '').trim().slice(0, 1000) || null
    const now = new Date().toISOString()
    let update = db.from('client_requests').update({
      ...(aiMin ? { base_amount: base, priced_at: now } : {}),
      seller_markup: markup, quote_amount: base + markup, salesperson_id: sellerId,
      quote_status: 'quoted', quoted_at: now, ...(note ? { quote_note: note } : {}),
    }).eq('id', row.id)
    update = aiMin ? update.or('quote_status.is.null,quote_status.eq.requested') : update.eq('quote_status', 'priced')
    const { data, error } = await update.select().maybeSingle()
    if (error) throw error
    if (!data) return jsonError(res, 409, 'Este orçamento já foi enviado.')
    await db.from('sales_notifications').insert({ salesperson_id: sellerId, audience: 'admin', event_type: 'quote_sent', title: aiMin ? 'Vendedor enviou orçamento direto (mínimo da IA)' : 'Vendedor enviou orçamento ao cliente', body: `${[client?.company_name, row.location_name].filter(Boolean).join(' · ')} · ¥${Math.round(base + markup).toLocaleString()} (empresa ¥${Math.round(base).toLocaleString()}${aiMin ? ' pela IA' : ''} + vendedor ¥${Math.round(markup).toLocaleString()})`, sender_name: String(user.name || '').slice(0, 120) })
    return { request: data }
  }

  if (action === 'quote-ai-minimum') {
    // v1.0.77 · AI minimum company price, for a client request (id) or a new quote (client + store + service).
    if (marketer) return jsonError(res, 403, 'Sem permissão.')
    let job, ref
    if (body.id) {
      const { data: row, error: rowErr } = await db.from('client_requests').select('id,client_id,quote_status,request_type,location_name,category,description,salesperson_id').eq('id', String(body.id)).maybeSingle()
      if (rowErr) throw rowErr
      if (!row || row.request_type !== 'quote') return jsonError(res, 404, 'Pedido de orçamento não encontrado.')
      if (['quoted', 'accepted', 'declined'].includes(row.quote_status)) return jsonError(res, 409, 'Este orçamento já foi enviado.')
      const { sellerId } = await sellerOfRequest(db, row)
      if (!admin && sellerId !== own) return jsonError(res, 403, 'Este cliente é de outro vendedor.')
      job = { clientId: row.client_id, locationName: row.location_name, category: row.category, description: [row.description, body.details].filter(Boolean).join(' · ') }
      ref = { k: 'req', id: row.id }
    } else {
      const clientId = String(body.client_id || '')
      const category = String(body.category || '').trim().slice(0, 120)
      if (!clientId || !category) return jsonError(res, 400, 'Escolha o cliente e o serviço.')
      const location = String(body.location_name || '').trim().slice(0, 200) || null
      const { sellerId } = await sellerOfRequest(db, { client_id: clientId, location_name: location })
      if (!admin && sellerId !== own) {
        const { data: mine } = await db.from('service_contracts').select('id').eq('client_id', clientId).eq('salesperson_id', own).limit(1)
        if (!mine?.length) return jsonError(res, 403, 'Este cliente é de outro vendedor.')
      }
      job = { clientId, locationName: location, category, description: String(body.description || '').slice(0, 1000) }
      ref = { k: 'new', cid: clientId, loc: location, cat: category }
    }
    const estimate = await estimateMinimum(db, job)
    return { ...estimate, token: signMinimum({ ...ref, min: estimate.min, uid: own }) }
  }

  if (action === 'create-client-quote') {
    // v1.0.77 · Seller creates a quote for one of their clients and sends it at once:
    // AI minimum (company) + seller's extra (commission). The client accepts it in the portal.
    if (marketer) return jsonError(res, 403, 'Sem permissão.')
    const aiMin = readMinimum(body.min_token, own)
    const clientId = String(body.client_id || '')
    const location = String(body.location_name || '').trim().slice(0, 200) || null
    const category = String(body.category || '').trim().slice(0, 120)
    if (!aiMin || aiMin.k !== 'new' || aiMin.cid !== clientId || (aiMin.loc || null) !== location || aiMin.cat !== category) return jsonError(res, 409, 'O valor mínimo expirou ou o pedido mudou. Calcule de novo.')
    const markup = num(body.markup || 0)
    const base = Number(aiMin.min)
    if (markup > base * 10) return jsonError(res, 400, 'O valor a mais está alto demais. Confira o número.')
    const { client, sellerId: owner } = await sellerOfRequest(db, { client_id: clientId, location_name: location })
    const sellerId = admin ? owner : own
    const now = new Date().toISOString()
    const note = String(body.note || '').trim().slice(0, 1000) || null
    const { data, error } = await db.from('client_requests').insert({
      client_id: clientId, location_name: location, category,
      description: String(body.description || '').trim().slice(0, 1000) || category,
      preferred_date: isDay(body.preferred_date) ? body.preferred_date : null,
      status: 'pending', ticket_number: `KP-${Date.now().toString(36).toUpperCase().slice(-6)}`,
      request_type: 'quote', quote_status: 'quoted', salesperson_id: sellerId,
      base_amount: base, seller_markup: markup, quote_amount: base + markup, priced_at: now, quoted_at: now, quote_note: note,
    }).select().single()
    if (error) throw error
    await db.from('sales_notifications').insert({ salesperson_id: sellerId, audience: 'admin', event_type: 'quote_sent', title: 'Vendedor criou e enviou orçamento (mínimo da IA)', body: `${[client?.company_name, location].filter(Boolean).join(' · ')} · ${category} · ¥${Math.round(base + markup).toLocaleString()} (empresa ¥${Math.round(base).toLocaleString()} pela IA + vendedor ¥${Math.round(markup).toLocaleString()})`, sender_name: String(user.name || '').slice(0, 120) })
    return { request: data }
  }

  if (action === 'assign-client-quote') {
    // v1.0.70 · Admin picks the seller of a client quote request (and, if asked, of the whole client).
    if (!admin) return jsonError(res, 403, 'Somente admin escolhe o vendedor.')
    const sellerId = String(body.salesperson_id || '') || null
    const { data: row, error: rowErr } = await db.from('client_requests').select('id,client_id,quote_status,request_type,location_name,category,description').eq('id', String(body.id || '')).maybeSingle()
    if (rowErr) throw rowErr
    if (!row || row.request_type !== 'quote') return jsonError(res, 404, 'Pedido de orçamento não encontrado.')
    if (['quoted', 'accepted', 'declined'].includes(row.quote_status)) return jsonError(res, 409, 'Este orçamento já foi enviado ao cliente.')
    const { data, error } = await db.from('client_requests').update({ salesperson_id: sellerId }).eq('id', row.id).select().single()
    if (error) throw error
    if (body.whole_client && row.client_id) {
      const { error: clientErr } = await db.from('clients').update({ salesperson_id: sellerId }).eq('id', row.client_id)
      if (clientErr) throw clientErr
    }
    if (sellerId) {
      const { data: client } = await db.from('clients').select('company_name').eq('id', row.client_id).maybeSingle()
      await db.from('sales_notifications').insert({ salesperson_id: sellerId, audience: 'seller', event_type: 'quote_assigned', title: 'Novo pedido de orçamento de cliente', body: `${[client?.company_name, row.location_name].filter(Boolean).join(' · ')} · ${row.category || String(row.description || '').slice(0, 80)}`, sender_name: String(user.name || '').slice(0, 120) })
    }
    return { request: data }
  }

  if (action === 'quote-flow-notice') {
    // v1.0.70 · Accepted quote → scheduled / done + invoice sent: tells the seller of that client.
    if (!admin) return jsonError(res, 403, 'Sem permissão.')
    const sellerId = String(body.salesperson_id || '')
    const title = String(body.title || '').slice(0, 160)
    if (!sellerId || !title) return { skipped: true }
    await db.from('sales_notifications').insert({ salesperson_id: sellerId, audience: 'seller', event_type: String(body.event_type || 'quote_flow').slice(0, 40), title, body: String(body.body || '').slice(0, 500), sender_name: String(user.name || '').slice(0, 120) })
    return { success: true }
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

// Smart Facility: limpezas/manutenções atrasadas ou vencendo nas lojas dos clientes do vendedor (admin: todas).
// Sem tabelas de facility (SQL não aplicado) → lista vazia, sem derrubar o painel.
async function loadFacilityOffers(db, clientIds) {
  if (clientIds && !clientIds.length) return []
  try {
    let mq = db.from('facility_models').select('id,client_id,location_name,name,layout,status').eq('status', 'approved')
    if (clientIds) mq = mq.in('client_id', clientIds)
    const { data: models, error } = await mq
    if (error || !models?.length) return []
    const ids = models.map(m => m.id)
    const cids = [...new Set(models.map(m => m.client_id))]
    const [logsRes, recsRes, clientsRes] = await Promise.all([
      db.from('facility_service_log').select('model_id,element_id,service,service_date').in('model_id', ids).order('service_date', { ascending: false }).limit(3000),
      db.from('facility_recommendations').select('model_id,element_id,service').in('model_id', ids).eq('status', 'pending'),
      db.from('clients').select('id,company_name,contact_name,phone').in('id', cids),
    ])
    const clients = new Map((clientsRes.data || []).map(c => [c.id, c]))
    const offered = new Set((recsRes.data || []).map(r => `${r.model_id}:${r.element_id}:${String(r.service || '').toLowerCase()}`))
    return serviceOffers(models, logsRes.data || []).map(r => {
      const c = clients.get(r.client_id) || {}
      return { ...r, client_name: c.company_name || '', contact_name: c.contact_name || '', phone: c.phone || '', offered: offered.has(`${r.model_id}:${r.element_id}:${r.task_name.toLowerCase()}`) }
    })
  } catch {
    return []
  }
}
