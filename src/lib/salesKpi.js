// Sales and marketing KPIs: evolution by month, funnel, follow-up health and closing.
// Pure functions over the /api/sales-data dashboard payload, shared by the admin
// pages, the seller portal and scripts/test-sales-kpi.mjs.

import { followupQueue } from './salesFollowup.js'

export const OPEN_STAGES = ['approach', 'followup', 'quote', 'negotiation']
export const STAGE_ORDER = ['approach', 'followup', 'quote', 'negotiation', 'won']
// Chance of closing by stage, used for the weighted pipeline.
export const STAGE_WEIGHT = { approach: 0.1, followup: 0.2, quote: 0.4, negotiation: 0.6, won: 1, lost: 0 }
export const RANGE_KEYS = ['month', '3m', '6m', 'year', '12m']

const day = value => String(value || '').slice(0, 10)
const monthOf = value => day(value).slice(0, 7)
const sum = (rows, pickValue) => rows.reduce((total, row) => total + Number(pickValue(row) || 0), 0)
const ratio = (a, b) => (b ? a / b * 100 : null)

export function addMonths(month, n) {
  const [y, m] = String(month).split('-').map(Number)
  const index = y * 12 + (m - 1) + n
  return `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`
}

export function monthsBetween(from, to) {
  const out = []
  for (let m = from; m <= to && out.length < 120; m = addMonths(m, 1)) out.push(m)
  return out
}

/** Month window for a range key, plus the same-length window right before it. */
export function rangeFor(key, today) {
  const current = monthOf(today)
  const span = { month: 1, '3m': 3, '6m': 6, '12m': 12 }[key]
  let from = span ? addMonths(current, 1 - span) : `${current.slice(0, 4)}-01`
  if (key === 'year') from = `${current.slice(0, 4)}-01`
  const months = monthsBetween(from, current)
  const prevTo = addMonths(from, -1)
  const prevFrom = addMonths(from, -months.length)
  return { key, from, to: current, months, prev: { from: prevFrom, to: prevTo, months: monthsBetween(prevFrom, prevTo) } }
}

const inMonths = (value, range) => {
  const m = monthOf(value)
  return Boolean(m) && m >= range.from && m <= range.to
}

export const leadStart = lead => day(lead.first_contact_date || lead.created_at)
export const leadClosed = lead => day(lead.closed_at || lead.updated_at || lead.last_contact_date)
const isActiveContract = row => ['active', 'approved'].includes(row.status)
const contractDate = row => row.reviewed_at || row.submitted_at || row.created_at

/** Restrict the dashboard payload to one seller (or everyone when id is empty). */
export function scopeData(data, salespersonId) {
  const mine = row => !salespersonId || row.salesperson_id === salespersonId
  return {
    leads: (data?.leads || []).filter(mine),
    quotes: (data?.quotes || []).filter(mine),
    approaches: (data?.approaches || []).filter(mine),
    reports: (data?.reports || []).filter(mine),
    contracts: (data?.contracts || []).filter(mine),
    touchpoints: (data?.touchpoints || []).filter(mine),
    goals: (data?.goals || []).filter(row => !salespersonId || row.salesperson_id === salespersonId),
  }
}

/** Monthly value of a won lead: its approved contract, else the expected amount. */
export function leadRevenue(lead, contracts) {
  const contract = (contracts || []).find(row => row.lead_id === lead.id && isActiveContract(row))
  return Number(contract?.client_monthly_total || lead.expected_monthly || 0)
}

/** Totals for one window of months. */
export function periodTotals(scoped, range) {
  const wins = scoped.leads.filter(lead => lead.stage === 'won' && inMonths(leadClosed(lead), range))
  const losses = scoped.leads.filter(lead => lead.stage === 'lost' && inMonths(leadClosed(lead), range))
  const contracts = scoped.contracts.filter(row => isActiveContract(row) && inMonths(contractDate(row), range))
  const quotes = scoped.quotes.filter(row => inMonths(row.created_at, range))
  const reports = scoped.reports.filter(row => inMonths(row.work_date, range))
  const approaches = scoped.approaches.filter(row => inMonths(row.work_date, range))
  const hours = sum(reports, row => row.hours_worked)
  // Same rule as the monthly goals: approved/active contracts by review date.
  const revenue = sum(contracts, row => row.client_monthly_total)
  return {
    approaches: approaches.length,
    contacts: scoped.touchpoints.filter(row => inMonths(row.happened_at, range)).length,
    leads: scoped.leads.filter(lead => inMonths(leadStart(lead), range)).length,
    quotes: quotes.length,
    quoteValue: sum(quotes, row => row.total),
    wins: wins.length,
    losses: losses.length,
    contracts: contracts.length,
    revenue,
    wonValue: sum(wins, lead => leadRevenue(lead, scoped.contracts)),
    hours,
    travel: sum(reports, row => row.travel_cost) + sum(approaches, row => row.travel_cost),
    winRate: ratio(wins.length, wins.length + losses.length),
    approachToWin: ratio(wins.length, approaches.length),
    avgDeal: wins.length ? sum(wins, lead => leadRevenue(lead, scoped.contracts)) / wins.length : null,
    approachesPerHour: hours ? approaches.length / hours : null,
  }
}

/** One row per month: the evolution chart and the goal history. */
export function monthlySeries(scoped, months, sellerCount = 1) {
  return months.map(month => {
    const totals = periodTotals(scoped, { from: month, to: month })
    const goals = scoped.goals.filter(row => row.period_month === month)
    const goal = goals.length ? Object.fromEntries(['approaches', 'contacts', 'leads', 'quotes', 'contracts', 'revenue'].map(key => [key, sum(goals, row => row[key])])) : null
    return { month, ...totals, goal, attainment: goalAttainment(totals, goal), sellers: sellerCount }
  })
}

/** Average % of the month's goals reached (each capped at 100). */
export function goalAttainment(totals, goal) {
  if (!goal) return null
  const pairs = [['approaches', totals.approaches], ['contacts', totals.contacts], ['leads', totals.leads], ['quotes', totals.quotes], ['contracts', totals.contracts], ['revenue', totals.revenue]]
    .filter(([key]) => Number(goal[key]) > 0)
  if (!pairs.length) return null
  return Math.round(pairs.reduce((total, [key, value]) => total + Math.min(100, value / Number(goal[key]) * 100), 0) / pairs.length)
}

/**
 * Cohort funnel: of the leads that started in the window, how many got a contact,
 * reached a quote, and were won. Approaches in the window sit on top.
 */
export function funnel(scoped, range) {
  const cohort = scoped.leads.filter(lead => inMonths(leadStart(lead), range))
  const contacted = new Set(scoped.touchpoints.map(row => row.lead_id))
  const quoted = new Set(scoped.quotes.map(row => row.lead_id).filter(Boolean))
  const reached = (lead, stage) => STAGE_ORDER.indexOf(lead.stage) >= STAGE_ORDER.indexOf(stage)
  const steps = [
    { key: 'approaches', value: scoped.approaches.filter(row => inMonths(row.work_date, range)).length },
    { key: 'leads', value: cohort.length },
    { key: 'contacted', value: cohort.filter(lead => contacted.has(lead.id) || reached(lead, 'followup') || lead.stage === 'lost').length },
    { key: 'quoted', value: cohort.filter(lead => quoted.has(lead.id) || reached(lead, 'quote')).length },
    { key: 'won', value: cohort.filter(lead => lead.stage === 'won').length },
  ]
  return steps.map((step, i) => ({ ...step, fromPrev: i > 1 ? ratio(step.value, steps[i - 1].value) : null, fromLeads: i ? ratio(step.value, steps[1].value) : null }))
}

const median = values => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const daysBetween = (a, b) => Math.round((Date.parse(`${day(b)}T00:00:00Z`) - Date.parse(`${day(a)}T00:00:00Z`)) / 86_400_000)

/** Time to close and effort per closed deal for deals closed in the window. */
export function closingStats(scoped, range) {
  const closed = scoped.leads.filter(lead => ['won', 'lost'].includes(lead.stage) && inMonths(leadClosed(lead), range))
  const won = closed.filter(lead => lead.stage === 'won')
  const days = won.map(lead => daysBetween(leadStart(lead), leadClosed(lead))).filter(n => Number.isFinite(n) && n >= 0)
  const contactsFor = lead => scoped.touchpoints.filter(row => row.lead_id === lead.id).length
  const lostReasons = {}
  for (const lead of closed.filter(row => row.stage === 'lost')) {
    const reason = String(lead.lost_reason || '').trim() || '—'
    lostReasons[reason] = (lostReasons[reason] || 0) + 1
  }
  return {
    won: won.length,
    lost: closed.length - won.length,
    medianDays: median(days),
    avgDays: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null,
    fastest: days.length ? Math.min(...days) : null,
    slowest: days.length ? Math.max(...days) : null,
    contactsPerWin: won.length ? Math.round(won.reduce((total, lead) => total + contactsFor(lead), 0) / won.length * 10) / 10 : null,
    lostReasons: Object.entries(lostReasons).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
  }
}

/** Follow-up discipline of the open pipeline today. */
export function followupHealth(scoped, today) {
  const queue = followupQueue(scoped.leads, today, scoped.touchpoints)
  const open = queue.length
  const onTrack = queue.filter(row => ['scheduled', 'soon', 'today'].includes(row.info.status)).length
  const since = queue.map(row => row.info.sinceContact).filter(n => n != null)
  return {
    open,
    onTrack,
    onTrackRate: ratio(onTrack, open),
    overdue: queue.filter(row => row.info.status === 'overdue').length,
    stale: queue.filter(row => row.info.status === 'stale').length,
    missing: queue.filter(row => row.info.status === 'missing').length,
    avgDaysSinceContact: since.length ? Math.round(since.reduce((a, b) => a + b, 0) / since.length) : null,
  }
}

/** Open pipeline by stage with plain and probability-weighted monthly value. */
export function pipeline(scoped) {
  const stages = OPEN_STAGES.map(stage => {
    const rows = scoped.leads.filter(lead => lead.stage === stage)
    const value = sum(rows, lead => lead.expected_monthly)
    return { stage, count: rows.length, value, weighted: value * STAGE_WEIGHT[stage] }
  })
  return { stages, count: sum(stages, s => s.count), value: sum(stages, s => s.value), weighted: sum(stages, s => s.weighted) }
}

/** Where leads come from and how each source converts. */
export function sourceBreakdown(scoped, range, channels = []) {
  const groups = new Map()
  const channelName = id => channels.find(row => row.id === id)?.name
  for (const lead of scoped.leads.filter(row => inMonths(leadStart(row), range))) {
    const key = channelName(lead.marketing_channel_id) || String(lead.source || '').trim() || '—'
    const group = groups.get(key) || { source: key, leads: 0, wins: 0, revenue: 0 }
    group.leads += 1
    if (lead.stage === 'won') { group.wins += 1; group.revenue += leadRevenue(lead, scoped.contracts) }
    groups.set(key, group)
  }
  return [...groups.values()].map(row => ({ ...row, winRate: ratio(row.wins, row.leads) })).sort((a, b) => b.leads - a.leads)
}

/** Seller ranking for the window. */
export function leaderboard(data, sellers, range) {
  return (sellers || []).map(person => {
    const scoped = scopeData(data, person.id)
    const totals = periodTotals(scoped, range)
    const goals = scoped.goals.filter(row => row.period_month >= range.from && row.period_month <= range.to)
    const goal = goals.length ? Object.fromEntries(['approaches', 'contacts', 'leads', 'quotes', 'contracts', 'revenue'].map(key => [key, sum(goals, row => row[key])])) : null
    return { id: person.id, name: person.full_name, active: person.is_active !== false, ...totals, attainment: goalAttainment(totals, goal) }
  }).sort((a, b) => b.revenue - a.revenue || b.wonValue - a.wonValue || b.wins - a.wins || b.contacts - a.contacts)
}

/** Percent change vs the previous window; null when there is nothing to compare. */
export function delta(current, previous) {
  if (current == null || previous == null) return null
  // Nothing to compare against: no fake +100%.
  if (!previous) return current ? null : 0
  return Math.round((current - previous) / Math.abs(previous) * 100)
}

// ---------- Marketing ----------

/** Spend, leads, wins and revenue per month for the marketing evolution chart. */
export function marketingSeries(data, months) {
  const spend = data?.marketing?.spend || data?.spend || []
  const leads = (data?.leads || []).filter(lead => lead.marketing_campaign_id || lead.marketing_channel_id)
  const contracts = data?.contracts || []
  return months.map(month => {
    const range = { from: month, to: month }
    const monthSpend = sum(spend.filter(row => inMonths(row.spent_on, range)), row => row.amount)
    const monthLeads = leads.filter(lead => inMonths(leadStart(lead), range)).length
    const wins = leads.filter(lead => lead.stage === 'won' && inMonths(leadClosed(lead), range))
    const revenue = sum(wins, lead => leadRevenue(lead, contracts))
    return { month, spend: monthSpend, leads: monthLeads, wins: wins.length, revenue, cpl: monthLeads ? monthSpend / monthLeads : null, cac: wins.length ? monthSpend / wins.length : null }
  })
}

/** Channel table: spend, leads, conversion, CPL, CAC, revenue and return for the window. */
export function channelPerformance(data, range) {
  const channels = data?.marketing?.channels || data?.channels || []
  const campaigns = data?.marketing?.campaigns || data?.campaigns || []
  const spend = data?.marketing?.spend || data?.spend || []
  const leads = data?.leads || []
  const contracts = data?.contracts || []
  const campaignChannel = new Map(campaigns.map(row => [row.id, row.channel_id]))
  const channelOf = lead => lead.marketing_channel_id || campaignChannel.get(lead.marketing_campaign_id) || null
  return channels.map(channel => {
    const channelSpend = sum(spend.filter(row => campaignChannel.get(row.campaign_id) === channel.id && inMonths(row.spent_on, range)), row => row.amount)
    const channelLeads = leads.filter(lead => channelOf(lead) === channel.id && inMonths(leadStart(lead), range))
    const wins = leads.filter(lead => channelOf(lead) === channel.id && lead.stage === 'won' && inMonths(leadClosed(lead), range))
    const revenue = sum(wins, lead => leadRevenue(lead, contracts))
    return {
      id: channel.id,
      name: channel.name,
      type: channel.channel_type,
      spend: channelSpend,
      leads: channelLeads.length,
      wins: wins.length,
      conversion: ratio(wins.length, channelLeads.length),
      cpl: channelLeads.length ? channelSpend / channelLeads.length : null,
      cac: wins.length ? channelSpend / wins.length : null,
      revenue,
      // First-year value of the contracts won vs what the channel cost.
      roi: channelSpend ? (revenue * 12 - channelSpend) / channelSpend * 100 : null,
      paybackMonths: wins.length && revenue ? Math.round(channelSpend / revenue * 10) / 10 : null,
    }
  }).sort((a, b) => b.leads - a.leads || b.spend - a.spend)
}

/** Budget used per campaign against how much of its period has passed. */
export function budgetPacing(data, today) {
  const campaigns = data?.marketing?.campaigns || data?.campaigns || []
  const spend = data?.marketing?.spend || data?.spend || []
  return campaigns.filter(row => Number(row.budget) > 0).map(row => {
    const used = sum(spend.filter(item => item.campaign_id === row.id), item => item.amount)
    let elapsed = null
    if (row.starts_on && row.ends_on) {
      const total = Math.max(1, daysBetween(row.starts_on, row.ends_on) + 1)
      elapsed = Math.max(0, Math.min(100, Math.round((daysBetween(row.starts_on, today) + 1) / total * 100)))
    }
    const usedRate = Math.round(used / Number(row.budget) * 100)
    return { id: row.id, name: row.name, status: row.status, budget: Number(row.budget), used, usedRate, elapsed, overPace: elapsed != null && usedRate > elapsed + 15 }
  })
}

/** Share of leads in the window that carry a channel or campaign. */
export function attributionCoverage(data, range) {
  const leads = (data?.leads || []).filter(lead => inMonths(leadStart(lead), range))
  const tagged = leads.filter(lead => lead.marketing_campaign_id || lead.marketing_channel_id).length
  return { leads: leads.length, tagged, rate: ratio(tagged, leads.length) }
}
