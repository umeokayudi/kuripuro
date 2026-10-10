// Sales insights: where each client is in the funnel, quote approval and price per item,
// region, what clients answer, and a compact digest the AI reads to explain why deals close.
// Pure functions over the /api/sales-data payload (already scoped with scopeData).

export const BOARD_STAGES = ['approach', 'followup', 'quote', 'negotiation', 'won', 'lost']
export const MEDIA_PLATFORMS = ['google_ads', 'meta_ads', 'tiktok_ads', 'line_ads', 'yahoo_ads', 'x_ads', 'youtube_ads', 'seo', 'flyer', 'other']
const BRAND = { google_ads: 'Google Ads', meta_ads: 'Meta Ads (Facebook / Instagram)', tiktok_ads: 'TikTok Ads', line_ads: 'LINE Ads', yahoo_ads: 'Yahoo! Ads', x_ads: 'X (Twitter) Ads', youtube_ads: 'YouTube Ads' }
export const platformLabel = (key, lang) => BRAND[key] || ({ seo: lang === 'ja' ? 'SEO・自然検索' : 'SEO / organic', flyer: lang === 'ja' ? 'チラシ' : 'Flyer', total: lang === 'ja' ? '合計' : 'Total' }[key]) || (lang === 'ja' ? 'その他' : 'Other')

const day = value => String(value || '').slice(0, 10)
const monthOf = value => day(value).slice(0, 7)
const inMonths = (value, range) => { const m = monthOf(value); return Boolean(m) && m >= range.from && m <= range.to }
const sum = (rows, pick) => rows.reduce((total, row) => total + Number(pick(row) || 0), 0)
const avg = values => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null)
const ratio = (a, b) => (b ? a / b * 100 : null)
const daysBetween = (a, b) => Math.round((Date.parse(`${day(b)}T00:00:00Z`) - Date.parse(`${day(a)}T00:00:00Z`)) / 86_400_000)
const DECIDED = ['accepted', 'declined']
const isSent = quote => Boolean(quote.sent_at) || ['sent', 'accepted', 'declined', 'expired'].includes(quote.status)
const quoteDay = quote => quote.sent_at || quote.created_at

/** Prefecture from a Japanese address ("東京都港区…" → "東京都"). */
export function regionFromAddress(address) {
  const match = String(address || '').match(/(東京都|北海道|(?:京都|大阪)府|[^\s0-9０-９]{2,3}県)/)
  return match ? match[1] : null
}

export const regionOf = (lead, quote) => String(lead?.region || '').trim() || regionFromAddress(lead?.address) || regionFromAddress(quote?.address) || '—'

const latestContact = (leadId, touchpoints) => touchpoints
  .filter(row => row.lead_id === leadId)
  .sort((a, b) => String(b.happened_at).localeCompare(String(a.happened_at)) || String(b.created_at).localeCompare(String(a.created_at)))[0] || null

/**
 * Funnel board: every client in its current stage. Open stages show everyone;
 * won/lost only show deals closed in the window so the columns stay readable.
 */
export function stageBoard(scoped, range, today, sellers = []) {
  const sellerName = id => sellers.find(row => row.id === id)?.full_name || ''
  const quotesFor = id => scoped.quotes.filter(row => row.lead_id === id)
  return BOARD_STAGES.map(stage => {
    const leads = scoped.leads.filter(lead => lead.stage === stage && (!['won', 'lost'].includes(stage) || inMonths(lead.closed_at || lead.updated_at, range)))
    const cards = leads.map(lead => {
      const last = latestContact(lead.id, scoped.touchpoints)
      const quotes = quotesFor(lead.id)
      const sinceChange = daysBetween(lead.updated_at || lead.first_contact_date || today, today)
      return {
        id: lead.id,
        name: lead.site_name || lead.company_name || '—',
        company: lead.company_name,
        seller: sellerName(lead.salesperson_id),
        region: regionOf(lead, quotes[0]),
        value: Number(lead.expected_monthly || 0) || Number(quotes[0]?.total || 0),
        quoteStatus: quotes[0]?.status || null,
        lastContact: last?.happened_at || lead.last_contact_date || null,
        lastTag: last?.response_tag || null,
        lastResponse: last?.client_response || null,
        sentiment: last?.sentiment || null,
        next: lead.next_followup_date || null,
        overdue: Boolean(lead.next_followup_date && lead.next_followup_date < today && !['won', 'lost'].includes(stage)),
        daysInStage: Number.isFinite(sinceChange) && sinceChange >= 0 ? sinceChange : null,
        lostReason: lead.lost_reason || null,
      }
    }).sort((a, b) => Number(b.overdue) - Number(a.overdue) || String(a.next || '9999').localeCompare(String(b.next || '9999')))
    return { stage, count: cards.length, value: sum(cards, c => c.value), cards }
  })
}

const itemKey = text => String(text || '').trim().replace(/\s+/g, ' ').toLowerCase()

/** Quotes sent in the window: approval, value, time to answer and price per item. */
export function quoteStats(scoped, range) {
  const quotes = scoped.quotes.filter(row => isSent(row) && inMonths(quoteDay(row), range))
  const accepted = quotes.filter(row => row.status === 'accepted')
  const declined = quotes.filter(row => row.status === 'declined')
  const open = quotes.filter(row => !DECIDED.includes(row.status) && row.status !== 'expired')
  const decisionDays = quotes.filter(row => DECIDED.includes(row.status) && row.decided_at)
    .map(row => daysBetween(quoteDay(row), row.decided_at)).filter(n => Number.isFinite(n) && n >= 0)
  const unitPrices = rows => rows.flatMap(row => (row.items || []).map(item => Number(item.unit_price || 0)).filter(n => n > 0))
  const itemCount = rows => rows.reduce((n, row) => n + (row.items || []).length, 0)

  const items = new Map()
  for (const quote of quotes) for (const item of quote.items || []) {
    const key = itemKey(item.description)
    if (!key) continue
    const row = items.get(key) || { item: String(item.description).trim(), quotes: 0, quantity: 0, value: 0, prices: [], acceptedPrices: [], declinedPrices: [], accepted: 0, declined: 0 }
    const price = Number(item.unit_price || 0)
    row.quotes += 1
    row.quantity += Number(item.quantity || 0)
    row.value += Number(item.total || price * Number(item.quantity || 0))
    if (price > 0) row.prices.push(price)
    if (quote.status === 'accepted') { row.accepted += 1; if (price > 0) row.acceptedPrices.push(price) }
    if (quote.status === 'declined') { row.declined += 1; if (price > 0) row.declinedPrices.push(price) }
    items.set(key, row)
  }
  const byItem = [...items.values()].map(row => ({
    item: row.item, quotes: row.quotes, quantity: row.quantity, value: row.value,
    avgPrice: avg(row.prices), avgAccepted: avg(row.acceptedPrices), avgDeclined: avg(row.declinedPrices),
    acceptance: ratio(row.accepted, row.accepted + row.declined),
  })).sort((a, b) => b.quotes - a.quotes || b.value - a.value)

  const reasons = {}
  for (const row of declined) { const key = String(row.decision_reason || '').trim() || '—'; reasons[key] = (reasons[key] || 0) + 1 }

  return {
    sent: quotes.length,
    accepted: accepted.length,
    declined: declined.length,
    open: open.length,
    acceptance: ratio(accepted.length, accepted.length + declined.length),
    value: sum(quotes, row => row.total),
    avgTotal: avg(quotes.map(row => Number(row.total || 0))),
    avgAcceptedTotal: avg(accepted.map(row => Number(row.total || 0))),
    avgDeclinedTotal: avg(declined.map(row => Number(row.total || 0))),
    avgItemPrice: avg(unitPrices(quotes)),
    avgAcceptedItemPrice: avg(unitPrices(accepted)),
    avgDeclinedItemPrice: avg(unitPrices(declined)),
    itemsPerQuote: quotes.length ? Math.round(itemCount(quotes) / quotes.length * 10) / 10 : null,
    avgDecisionDays: decisionDays.length ? Math.round(avg(decisionDays)) : null,
    byItem,
    priceBands: priceBands(quotes),
    declineReasons: Object.entries(reasons).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
  }
}

/** Approval rate by quote size, to show which price range sells best. */
export function priceBands(quotes) {
  const decided = quotes.filter(row => DECIDED.includes(row.status) && Number(row.total) > 0)
  if (decided.length < 2) return []
  const totals = decided.map(row => Number(row.total)).sort((a, b) => a - b)
  const cut = q => totals[Math.min(totals.length - 1, Math.floor(totals.length * q))]
  const edges = [...new Set([totals[0], cut(1 / 3), cut(2 / 3), totals[totals.length - 1] + 1])].sort((a, b) => a - b)
  const bands = []
  for (let i = 0; i < edges.length - 1; i++) {
    const rows = decided.filter(row => Number(row.total) >= edges[i] && Number(row.total) < edges[i + 1])
    if (!rows.length) continue
    const won = rows.filter(row => row.status === 'accepted').length
    bands.push({ from: edges[i], to: edges[i + 1] - (i === edges.length - 2 ? 1 : 0), quotes: rows.length, accepted: won, acceptance: ratio(won, rows.length) })
  }
  return bands
}

/** Leads, quotes and wins per region (prefecture). */
export function regionBreakdown(scoped, range) {
  const groups = new Map()
  const bump = (region, key, n = 1) => {
    const row = groups.get(region) || { region, leads: 0, quotes: 0, wins: 0, losses: 0, value: 0 }
    row[key] += n
    groups.set(region, row)
  }
  const leadById = new Map(scoped.leads.map(lead => [lead.id, lead]))
  for (const lead of scoped.leads) {
    const region = regionOf(lead)
    if (inMonths(lead.first_contact_date || lead.created_at, range)) bump(region, 'leads')
    if (lead.stage === 'won' && inMonths(lead.closed_at || lead.updated_at, range)) { bump(region, 'wins'); bump(region, 'value', Number(lead.expected_monthly || 0)) }
    if (lead.stage === 'lost' && inMonths(lead.closed_at || lead.updated_at, range)) bump(region, 'losses')
  }
  for (const quote of scoped.quotes.filter(row => isSent(row) && inMonths(quoteDay(row), range))) bump(regionOf(leadById.get(quote.lead_id), quote), 'quotes')
  return [...groups.values()].map(row => ({ ...row, winRate: ratio(row.wins, row.wins + row.losses) }))
    .filter(row => row.leads || row.quotes || row.wins || row.losses)
    .sort((a, b) => b.leads - a.leads || b.wins - a.wins)
}

/** What clients answer most, and how often clients giving each answer end up signing. */
export function responseBreakdown(scoped, range) {
  const rows = scoped.touchpoints.filter(row => row.response_tag && inMonths(row.happened_at, range))
  const stageOf = new Map(scoped.leads.map(lead => [lead.id, lead.stage]))
  const groups = new Map()
  for (const row of rows) {
    const group = groups.get(row.response_tag) || { tag: row.response_tag, count: 0, leads: new Set(), examples: [] }
    group.count += 1
    group.leads.add(row.lead_id)
    if (row.client_response && group.examples.length < 3) group.examples.push(row.client_response)
    groups.set(row.response_tag, group)
  }
  const sentiments = { positive: 0, neutral: 0, negative: 0 }
  for (const row of scoped.touchpoints.filter(r => r.sentiment && inMonths(r.happened_at, range))) sentiments[row.sentiment] = (sentiments[row.sentiment] || 0) + 1
  const total = rows.length
  const tags = [...groups.values()].map(group => {
    const leads = [...group.leads]
    const won = leads.filter(id => stageOf.get(id) === 'won').length
    const closed = leads.filter(id => ['won', 'lost'].includes(stageOf.get(id))).length
    return { tag: group.tag, count: group.count, share: ratio(group.count, total), leads: leads.length, winRate: ratio(won, closed), examples: group.examples }
  }).sort((a, b) => b.count - a.count)
  return { total, tags, sentiments, logged: scoped.touchpoints.filter(r => inMonths(r.happened_at, range)).length }
}

/** Contacts and positive answers by weekday (0 = Sunday), to spot the best day to call. */
export function weekdayTiming(scoped, range) {
  const out = Array.from({ length: 7 }, (_, weekday) => ({ weekday, contacts: 0, positive: 0 }))
  for (const row of scoped.touchpoints.filter(r => inMonths(r.happened_at, range))) {
    const weekday = new Date(`${day(row.happened_at)}T00:00:00Z`).getUTCDay()
    if (!Number.isFinite(weekday)) continue
    out[weekday].contacts += 1
    if (row.sentiment === 'positive' || ['interested', 'asked_quote'].includes(row.response_tag)) out[weekday].positive += 1
  }
  return out.map(row => ({ ...row, positiveRate: ratio(row.positive, row.contacts) }))
}

const round = n => (n == null ? null : Math.round(n))

/**
 * Compact, anonymised-enough digest for the AI: aggregates plus recent client answers.
 * Kept small so the prompt stays well under the model limit.
 */
export function aiDigest({ scoped, range, totals, closing, sellersRows = [], today }) {
  const q = quoteStats(scoped, range)
  const responses = responseBreakdown(scoped, range)
  return {
    period: `${range.from}..${range.to}`,
    today,
    totals: totals && {
      approaches: totals.approaches, contacts: totals.contacts, leads: totals.leads, quotes_sent: q.sent, quotes_accepted: q.accepted,
      quotes_declined: q.declined, quotes_open: q.open, wins: totals.wins, losses: totals.losses, win_rate_pct: round(totals.winRate),
      revenue_month: round(totals.revenue), hours: totals.hours,
    },
    quotes: {
      acceptance_pct: round(q.acceptance), avg_total: round(q.avgTotal), avg_accepted_total: round(q.avgAcceptedTotal), avg_declined_total: round(q.avgDeclinedTotal),
      avg_item_price: round(q.avgItemPrice), avg_accepted_item_price: round(q.avgAcceptedItemPrice), avg_declined_item_price: round(q.avgDeclinedItemPrice),
      avg_days_to_answer: q.avgDecisionDays, price_bands: q.priceBands.map(b => ({ from: round(b.from), to: round(b.to), quotes: b.quotes, acceptance_pct: round(b.acceptance) })),
      items: q.byItem.slice(0, 12).map(i => ({ item: i.item, quotes: i.quotes, avg_price: round(i.avgPrice), avg_accepted: round(i.avgAccepted), avg_declined: round(i.avgDeclined), acceptance_pct: round(i.acceptance) })),
      decline_reasons: q.declineReasons.slice(0, 8),
    },
    closing: closing && { median_days_to_close: closing.medianDays, contacts_per_win: closing.contactsPerWin, lost_reasons: closing.lostReasons.slice(0, 8) },
    regions: regionBreakdown(scoped, range).slice(0, 12).map(r => ({ region: r.region, leads: r.leads, quotes: r.quotes, wins: r.wins, losses: r.losses, win_rate_pct: round(r.winRate) })),
    client_answers: responses.tags.map(t => ({ answer: t.tag, times: t.count, share_pct: round(t.share), win_rate_pct: round(t.winRate), examples: t.examples.map(e => String(e).slice(0, 160)) })),
    sentiment: responses.sentiments,
    weekday: weekdayTiming(scoped, range).filter(w => w.contacts).map(w => ({ weekday: w.weekday, contacts: w.contacts, positive_pct: round(w.positiveRate) })),
    sellers: sellersRows.map(s => ({ name: s.name, approaches: s.approaches, contacts: s.contacts, quotes_sent: s.quotesSent, quotes_accepted: s.quotesAccepted, acceptance_pct: round(s.quoteAcceptance), wins: s.wins, losses: s.losses, win_rate_pct: round(s.winRate), revenue: round(s.revenue), top_answers: s.topAnswers })),
  }
}

// ---------- Media (paid ads) ----------

/** CPM, CPC, CTR, CPL, CPA, conversion and ROI per ad platform for the window. */
export function mediaPerformance(data, range) {
  const channels = data?.marketing?.channels || data?.channels || []
  const campaigns = data?.marketing?.campaigns || data?.campaigns || []
  const spend = data?.marketing?.spend || data?.spend || []
  const leads = data?.leads || []
  const contracts = data?.contracts || []
  const platformOf = new Map(channels.map(row => [row.id, normalizePlatform(row.platform) || normalizePlatform(row.name) || 'other']))
  const campaignChannel = new Map(campaigns.map(row => [row.id, row.channel_id]))
  const leadPlatform = lead => platformOf.get(lead.marketing_channel_id || campaignChannel.get(lead.marketing_campaign_id)) || null
  const revenueOf = lead => {
    const contract = contracts.find(row => row.lead_id === lead.id && ['active', 'approved'].includes(row.status))
    return Number(contract?.client_monthly_total || lead.expected_monthly || 0)
  }
  const groups = new Map()
  const group = key => {
    if (!groups.has(key)) groups.set(key, { platform: key, spend: 0, impressions: 0, clicks: 0, platformConversions: 0, leads: 0, wins: 0, revenue: 0 })
    return groups.get(key)
  }
  for (const row of spend.filter(r => inMonths(r.spent_on, range))) {
    const g = group(platformOf.get(campaignChannel.get(row.campaign_id)) || 'other')
    g.spend += Number(row.amount || 0)
    g.impressions += Number(row.impressions || 0)
    g.clicks += Number(row.clicks || 0)
    g.platformConversions += Number(row.conversions || 0)
  }
  for (const lead of leads) {
    const key = leadPlatform(lead)
    if (!key) continue
    if (inMonths(lead.first_contact_date || lead.created_at, range)) group(key).leads += 1
    if (lead.stage === 'won' && inMonths(lead.closed_at || lead.updated_at, range)) { group(key).wins += 1; group(key).revenue += revenueOf(lead) }
  }
  const rows = [...groups.values()].map(mediaRates).sort((a, b) => b.spend - a.spend || b.leads - a.leads)
  const total = mediaRates(rows.reduce((t, r) => {
    for (const k of ['spend', 'impressions', 'clicks', 'platformConversions', 'leads', 'wins', 'revenue']) t[k] += r[k]
    return t
  }, { platform: 'total', spend: 0, impressions: 0, clicks: 0, platformConversions: 0, leads: 0, wins: 0, revenue: 0 }))
  return { rows, total }
}

function mediaRates(g) {
  return {
    ...g,
    cpm: g.impressions ? g.spend / g.impressions * 1000 : null,
    cpc: g.clicks ? g.spend / g.clicks : null,
    ctr: ratio(g.clicks, g.impressions),
    cpl: g.leads ? g.spend / g.leads : null,
    // CPA = cost per signed contract (customer acquired).
    cpa: g.wins ? g.spend / g.wins : null,
    clickToLead: ratio(g.leads, g.clicks),
    leadToWin: ratio(g.wins, g.leads),
    roi: g.spend ? (g.revenue * 12 - g.spend) / g.spend * 100 : null,
    roas: g.spend ? g.revenue * 12 / g.spend : null,
  }
}

/** Map free-text platform names ("Meta", "Instagram広告", "Google") to one key. */
export function normalizePlatform(value) {
  const v = String(value || '').toLowerCase().trim()
  if (!v) return null
  if (MEDIA_PLATFORMS.includes(v)) return v
  if (/tiktok/.test(v)) return 'tiktok_ads'
  if (/meta|facebook|instagram|insta|fb/.test(v)) return 'meta_ads'
  if (/youtube/.test(v)) return 'youtube_ads'
  if (/google|adwords/.test(v)) return 'google_ads'
  if (/line/.test(v)) return 'line_ads'
  if (/yahoo/.test(v)) return 'yahoo_ads'
  if (/^x$|twitter|x ads|x広告/.test(v)) return 'x_ads'
  if (/seo|organic|検索/.test(v)) return 'seo'
  if (/flyer|チラシ|panfleto|poster/.test(v)) return 'flyer'
  return 'other'
}

// ---------- Team ----------

/** Per-seller scorecard for the window: approaches, quotes sent/accepted, contracts, discipline. */
export function sellerScorecard(scoped, range, today) {
  const q = quoteStats(scoped, range)
  const r = responseBreakdown(scoped, range)
  const openLeads = scoped.leads.filter(lead => !['won', 'lost'].includes(lead.stage))
  return {
    quotesSent: q.sent,
    quotesAccepted: q.accepted,
    quotesDeclined: q.declined,
    quoteAcceptance: q.acceptance,
    avgItemPrice: q.avgItemPrice,
    openLeads: openLeads.length,
    overdue: openLeads.filter(lead => lead.next_followup_date && lead.next_followup_date < today).length,
    meetings: scoped.approaches.filter(row => row.outcome === 'meeting_scheduled' && inMonths(row.work_date, range)).length,
    topAnswers: r.tags.slice(0, 3).map(tag => tag.tag),
    reportDays: scoped.reports.filter(row => inMonths(row.work_date, range) && (row.ai_report || row.summary || row.hours_worked)).length,
  }
}

/**
 * Who should take a new lead: best close rate in the lead's region (then source),
 * minus a penalty for open workload and overdue follow-ups. Returns ranked options.
 */
export function suggestSeller(lead, data, sellers, today) {
  const region = regionOf(lead)
  const source = String(lead.marketing_channel_id || lead.source || '')
  const options = (sellers || []).filter(person => person.is_active !== false).map(person => {
    const mine = (data?.leads || []).filter(row => row.salesperson_id === person.id && row.id !== lead.id)
    const closed = rows => rows.filter(row => ['won', 'lost'].includes(row.stage))
    const rate = rows => { const c = closed(rows); return c.length ? c.filter(row => row.stage === 'won').length / c.length : null }
    const inRegion = mine.filter(row => regionOf(row) === region)
    const inSource = mine.filter(row => String(row.marketing_channel_id || row.source || '') === source)
    const open = mine.filter(row => !['won', 'lost'].includes(row.stage)).length
    const overdue = mine.filter(row => !['won', 'lost'].includes(row.stage) && row.next_followup_date && row.next_followup_date < today).length
    const regionRate = rate(inRegion)
    const sourceRate = rate(inSource)
    const overall = rate(mine)
    const base = regionRate ?? sourceRate ?? overall ?? 0.2
    const score = base * 100 - open * 1.5 - overdue * 4 + (closed(inRegion).length >= 3 ? 5 : 0)
    return { id: person.id, name: person.full_name, score: Math.round(score), regionRate: regionRate == null ? null : Math.round(regionRate * 100), regionDeals: closed(inRegion).length, overall: overall == null ? null : Math.round(overall * 100), open, overdue }
  })
  return options.sort((a, b) => b.score - a.score)
}
