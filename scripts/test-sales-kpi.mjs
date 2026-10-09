import assert from 'node:assert/strict'
import {
  addMonths, attributionCoverage, budgetPacing, channelPerformance, closingStats, delta, followupHealth,
  funnel, goalAttainment, leaderboard, marketingSeries, monthlySeries, periodTotals, pipeline, rangeFor, scopeData, sourceBreakdown,
} from '../src/lib/salesKpi.js'

const today = '2026-10-09'

assert.equal(addMonths('2026-01', -1), '2025-12')
assert.equal(addMonths('2026-11', 3), '2027-02')
const r3 = rangeFor('3m', today)
assert.deepEqual(r3.months, ['2026-08', '2026-09', '2026-10'])
assert.deepEqual(r3.prev.months, ['2026-05', '2026-06', '2026-07'])
assert.equal(rangeFor('year', today).from, '2026-01')
assert.equal(rangeFor('month', today).prev.from, '2026-09')

const data = {
  leads: [
    { id: 'l1', salesperson_id: 's1', stage: 'won', first_contact_date: '2026-09-01', closed_at: '2026-10-05T03:00:00Z', expected_monthly: 50000, source: 'Instagram', marketing_channel_id: 'c1' },
    { id: 'l2', salesperson_id: 's1', stage: 'lost', first_contact_date: '2026-10-01', closed_at: '2026-10-06T00:00:00Z', lost_reason: 'Preço' },
    { id: 'l3', salesperson_id: 's1', stage: 'quote', first_contact_date: '2026-10-02', expected_monthly: 80000, next_followup_date: '2026-10-12' },
    { id: 'l4', salesperson_id: 's2', stage: 'followup', first_contact_date: '2026-10-03', expected_monthly: 30000, next_followup_date: '2026-10-01' },
    { id: 'l5', salesperson_id: 's2', stage: 'approach', first_contact_date: '2026-08-10', marketing_campaign_id: 'k1' },
  ],
  quotes: [{ id: 'q1', salesperson_id: 's1', lead_id: 'l1', total: 60000, created_at: '2026-09-20' }, { id: 'q2', salesperson_id: 's1', lead_id: 'l3', total: 90000, created_at: '2026-10-04' }],
  approaches: [{ id: 'a1', salesperson_id: 's1', work_date: '2026-10-01', travel_cost: 500 }, { id: 'a2', salesperson_id: 's1', work_date: '2026-10-02' }, { id: 'a3', salesperson_id: 's2', work_date: '2026-10-03' }],
  reports: [{ id: 'r1', salesperson_id: 's1', work_date: '2026-10-01', hours_worked: 4, travel_cost: 1000 }],
  contracts: [{ id: 'k', salesperson_id: 's1', lead_id: 'l1', status: 'approved', client_monthly_total: 55000, reviewed_at: '2026-10-05T03:00:00Z' }],
  touchpoints: [
    { id: 't1', lead_id: 'l1', salesperson_id: 's1', happened_at: '2026-09-10' },
    { id: 't2', lead_id: 'l1', salesperson_id: 's1', happened_at: '2026-09-25' },
    { id: 't3', lead_id: 'l3', salesperson_id: 's1', happened_at: '2026-10-04' },
  ],
  goals: [{ salesperson_id: 's1', period_month: '2026-10', approaches: 4, contacts: 0, leads: 2, quotes: 0, contracts: 1, revenue: 110000 }],
}

const month = rangeFor('month', today)
const s1 = scopeData(data, 's1')
const t = periodTotals(s1, month)
assert.equal(t.approaches, 2)
assert.equal(t.leads, 2)
assert.equal(t.quotes, 1)
assert.equal(t.wins, 1)
assert.equal(t.losses, 1)
assert.equal(t.winRate, 50)
assert.equal(t.revenue, 55000, 'revenue comes from the approved contract, like the goals')
assert.equal(t.wonValue, 55000)
assert.equal(t.travel, 1500)
assert.equal(t.approachesPerHour, 0.5)

// approaches 2/4 = 50, leads 2/2 = 100, contracts 1/1 = 100, revenue 55000/110000 = 50 → 75
assert.equal(goalAttainment(t, data.goals[0]), 75)
assert.equal(goalAttainment(t, null), null)

const series = monthlySeries(s1, ['2026-09', '2026-10'])
assert.equal(series[0].leads, 1)
assert.equal(series[0].contacts, 2)
assert.equal(series[1].attainment, 75)
assert.equal(series[0].attainment, null)

// Cohort of leads started in Aug–Oct for everyone.
const f = funnel(scopeData(data, ''), r3)
assert.deepEqual(f.map(s => s.value), [3, 5, 4, 2, 1])
assert.equal(f[4].fromLeads, 20)
assert.equal(f[1].fromPrev, null)
assert.equal(f[3].fromPrev, 50)

const closing = closingStats(scopeData(data, ''), month)
assert.equal(closing.won, 1)
assert.equal(closing.medianDays, 34)
assert.equal(closing.contactsPerWin, 2)
assert.deepEqual(closing.lostReasons, [{ reason: 'Preço', count: 1 }])

const health = followupHealth(scopeData(data, ''), today)
assert.equal(health.open, 3)
assert.equal(health.overdue, 1)
assert.equal(health.onTrack, 1)

const pipe = pipeline(scopeData(data, ''))
assert.equal(pipe.count, 3)
assert.equal(pipe.value, 110000)
assert.equal(pipe.weighted, 80000 * 0.4 + 30000 * 0.2)

const sources = sourceBreakdown(scopeData(data, ''), r3, [{ id: 'c1', name: 'Instagram Ads' }])
assert.equal(sources.find(row => row.source === 'Instagram Ads').winRate, 100)

const board = leaderboard(data, [{ id: 's1', full_name: 'Ana' }, { id: 's2', full_name: 'Bruno' }], month)
assert.equal(board[0].name, 'Ana')
assert.equal(board[0].attainment, 75)
assert.equal(board[1].attainment, null)

assert.equal(delta(15, 10), 50)
assert.equal(delta(0, 0), 0)
assert.equal(delta(3, 0), null)
assert.equal(delta(null, 3), null)

const marketing = {
  ...data,
  marketing: {
    channels: [{ id: 'c1', name: 'Instagram Ads', channel_type: 'paid_ads' }, { id: 'c2', name: 'Flyers', channel_type: 'other' }],
    campaigns: [{ id: 'k1', channel_id: 'c2', name: 'Flyer Oct', budget: 20000, starts_on: '2026-10-01', ends_on: '2026-10-31', status: 'active' }, { id: 'k2', channel_id: 'c1', name: 'IG', budget: 0 }],
    spend: [{ campaign_id: 'k2', amount: 30000, spent_on: '2026-10-02' }, { campaign_id: 'k1', amount: 18000, spent_on: '2026-10-03' }],
  },
}
const channels = channelPerformance(marketing, r3)
const ig = channels.find(row => row.id === 'c1')
assert.equal(ig.spend, 30000)
assert.equal(ig.leads, 1)
assert.equal(ig.wins, 1)
assert.equal(ig.cac, 30000)
assert.equal(ig.revenue, 55000)
assert.equal(ig.roi, (55000 * 12 - 30000) / 30000 * 100)
const flyers = channels.find(row => row.id === 'c2')
assert.equal(flyers.leads, 1, 'lead tagged only with a campaign counts for that campaign\'s channel')

const ms = marketingSeries(marketing, ['2026-10'])
assert.equal(ms[0].spend, 48000)
assert.equal(ms[0].wins, 1)

const pacing = budgetPacing(marketing, today)
assert.equal(pacing.length, 1)
assert.equal(pacing[0].usedRate, 90)
assert.equal(pacing[0].elapsed, 29)
assert.equal(pacing[0].overPace, true)

const coverage = attributionCoverage(marketing, r3)
assert.equal(coverage.tagged, 2)
assert.equal(coverage.rate, 40)

console.log('✅ sales and marketing KPI rules OK')
