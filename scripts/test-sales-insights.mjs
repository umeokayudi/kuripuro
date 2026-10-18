import assert from 'node:assert/strict'
import { rangeFor, scopeData } from '../src/lib/salesKpi.js'
import {
  aiDigest, mediaPerformance, normalizePlatform, priceBands, quoteStats, regionBreakdown, regionFromAddress, responseBreakdown,
  sellerScorecard, stageBoard, suggestSeller, weekdayTiming,
} from '../src/lib/salesInsights.js'

const today = '2026-10-09'
const range = rangeFor('3m', today)

assert.equal(regionFromAddress('東京都港区六本木1-1'), '東京都')
assert.equal(regionFromAddress('大阪府大阪市北区'), '大阪府')
assert.equal(regionFromAddress('神奈川県横浜市'), '神奈川県')
assert.equal(regionFromAddress('Rua A, 123'), null)
assert.equal(normalizePlatform('Meta (Instagram)'), 'meta_ads')
assert.equal(normalizePlatform('TikTok'), 'tiktok_ads')
assert.equal(normalizePlatform('google_ads'), 'google_ads')
assert.equal(normalizePlatform('YouTube'), 'youtube_ads')
assert.equal(normalizePlatform('チラシ'), 'flyer')

const data = {
  leads: [
    { id: 'l1', salesperson_id: 's1', stage: 'won', address: '東京都港区', first_contact_date: '2026-09-01', closed_at: '2026-10-05T00:00:00Z', expected_monthly: 50000 },
    { id: 'l2', salesperson_id: 's1', stage: 'lost', region: '神奈川県', first_contact_date: '2026-10-01', closed_at: '2026-10-06T00:00:00Z', lost_reason: 'Preço' },
    { id: 'l3', salesperson_id: 's1', stage: 'quote', address: '東京都渋谷区', first_contact_date: '2026-10-02', next_followup_date: '2026-10-05', updated_at: '2026-10-04T00:00:00Z' },
    { id: 'l4', salesperson_id: 's2', stage: 'followup', region: '神奈川県', first_contact_date: '2026-10-03', next_followup_date: '2026-10-20', updated_at: '2026-10-08T00:00:00Z' },
    { id: 'l5', salesperson_id: null, stage: 'approach', address: '東京都新宿区', first_contact_date: '2026-10-08' },
  ],
  quotes: [
    { id: 'q1', salesperson_id: 's1', lead_id: 'l1', status: 'accepted', total: 60000, created_at: '2026-09-20', sent_at: '2026-09-21T00:00:00Z', decided_at: '2026-09-25T00:00:00Z', items: [{ description: 'Coifa', quantity: 1, unit_price: 20000, total: 20000 }, { description: 'Piso', quantity: 2, unit_price: 20000, total: 40000 }] },
    { id: 'q2', salesperson_id: 's1', lead_id: 'l2', status: 'declined', total: 120000, created_at: '2026-10-02', sent_at: '2026-10-02T00:00:00Z', decided_at: '2026-10-06T00:00:00Z', decision_reason: 'Caro', items: [{ description: 'coifa ', quantity: 1, unit_price: 40000, total: 40000 }] },
    { id: 'q3', salesperson_id: 's1', lead_id: 'l3', status: 'sent', total: 90000, created_at: '2026-10-04', sent_at: '2026-10-04T00:00:00Z', items: [] },
    { id: 'q4', salesperson_id: 's1', lead_id: 'l3', status: 'draft', total: 1, created_at: '2026-10-04', items: [] },
  ],
  approaches: [{ id: 'a1', salesperson_id: 's1', work_date: '2026-10-01', outcome: 'meeting_scheduled' }],
  reports: [{ id: 'r1', salesperson_id: 's1', work_date: '2026-10-01', ai_report: 'x' }],
  contracts: [],
  touchpoints: [
    { id: 't1', lead_id: 'l2', salesperson_id: 's1', happened_at: '2026-10-05', response_tag: 'price_high', client_response: 'Muito caro', sentiment: 'negative' }, // Monday
    { id: 't2', lead_id: 'l1', salesperson_id: 's1', happened_at: '2026-09-22', response_tag: 'interested', sentiment: 'positive' }, // Tuesday
    { id: 't3', lead_id: 'l3', salesperson_id: 's1', happened_at: '2026-10-06', response_tag: 'price_high' }, // Tuesday
  ],
  goals: [],
}
const all = scopeData(data, '')

const q = quoteStats(all, range)
assert.equal(q.sent, 3, 'drafts are not sent quotes')
assert.equal(q.accepted, 1)
assert.equal(q.declined, 1)
assert.equal(q.open, 1)
assert.equal(q.acceptance, 50)
assert.equal(q.avgItemPrice, 80000 / 3)
assert.equal(q.avgAcceptedItemPrice, 20000)
assert.equal(q.avgDeclinedItemPrice, 40000)
assert.equal(q.avgDecisionDays, 4)
const coifa = q.byItem.find(row => row.item.toLowerCase() === 'coifa')
assert.equal(coifa.quotes, 2, 'item names are grouped ignoring case and spaces')
assert.equal(coifa.avgAccepted, 20000)
assert.equal(coifa.avgDeclined, 40000)
assert.equal(coifa.acceptance, 50)
assert.deepEqual(q.declineReasons, [{ reason: 'Caro', count: 1 }])

const bands = priceBands(data.quotes)
assert.equal(bands.reduce((n, b) => n + b.quotes, 0), 2, 'bands cover every decided quote once')

const regions = regionBreakdown(all, range)
const tokyo = regions.find(r => r.region === '東京都')
assert.equal(tokyo.wins, 1)
assert.equal(tokyo.leads, 3)
assert.equal(regions.find(r => r.region === '神奈川県').losses, 1)

const answers = responseBreakdown(all, range)
assert.equal(answers.total, 3)
assert.equal(answers.tags[0].tag, 'price_high')
assert.equal(answers.tags[0].count, 2)
assert.equal(answers.tags[0].winRate, 0, 'price objections: the closed lead was lost')
assert.equal(answers.sentiments.negative, 1)

const week = weekdayTiming(all, range)
assert.equal(week[2].contacts, 2)
assert.equal(week[2].positive, 1)

const board = stageBoard(all, range, today, [{ id: 's1', full_name: 'Ana' }])
const quoteCol = board.find(col => col.stage === 'quote')
assert.equal(quoteCol.count, 1)
assert.equal(quoteCol.cards[0].overdue, true)
assert.equal(quoteCol.cards[0].lastTag, 'price_high')
assert.equal(quoteCol.cards[0].region, '東京都')
assert.equal(quoteCol.cards[0].seller, 'Ana')
assert.equal(board.find(col => col.stage === 'lost').cards[0].lostReason, 'Preço')

const card = sellerScorecard(scopeData(data, 's1'), range, today)
assert.equal(card.quotesSent, 3)
assert.equal(card.quotesAccepted, 1)
assert.equal(card.overdue, 1)
assert.equal(card.meetings, 1)
assert.equal(card.reportDays, 1)

const options = suggestSeller(data.leads[4], data, [{ id: 's1', full_name: 'Ana' }, { id: 's2', full_name: 'Bia' }], today)
assert.equal(options[0].id, 's1', 'seller who won in Tokyo is suggested for a Tokyo lead')
assert.equal(options[0].regionRate, 100)

const digest = aiDigest({ scoped: all, range, totals: { approaches: 1 }, closing: { medianDays: 4, contactsPerWin: 1, lostReasons: [] }, sellersRows: [], today })
assert.equal(digest.quotes.acceptance_pct, 50)
assert.ok(JSON.stringify(digest).length < 20000)

const marketing = {
  marketing: {
    channels: [{ id: 'c1', name: 'Insta', platform: 'Meta' }, { id: 'c2', name: 'TT', platform: 'tiktok_ads' }],
    campaigns: [{ id: 'k1', channel_id: 'c1' }, { id: 'k2', channel_id: 'c2' }],
    spend: [
      { campaign_id: 'k1', spent_on: '2026-10-01', amount: 10000, impressions: 20000, clicks: 200, conversions: 5 },
      { campaign_id: 'k2', spent_on: '2026-10-02', amount: 5000, impressions: 10000, clicks: 50 },
    ],
  },
  leads: [
    { id: 'm1', marketing_channel_id: 'c1', stage: 'won', first_contact_date: '2026-10-03', closed_at: '2026-10-08T00:00:00Z', expected_monthly: 10000 },
    { id: 'm2', marketing_campaign_id: 'k1', stage: 'followup', first_contact_date: '2026-10-04' },
  ],
  contracts: [],
}
const media = mediaPerformance(marketing, range)
const meta = media.rows.find(r => r.platform === 'meta_ads')
assert.equal(meta.cpm, 500)
assert.equal(meta.cpc, 50)
assert.equal(meta.ctr, 1)
assert.equal(meta.cpl, 5000)
assert.equal(meta.cpa, 10000)
assert.equal(meta.clickToLead, 1)
assert.equal(meta.leadToWin, 50)
assert.equal(meta.roi, (10000 * 12 - 10000) / 10000 * 100)
assert.equal(media.total.spend, 15000)
assert.equal(media.total.cpm, 500)
assert.equal(media.rows.find(r => r.platform === 'tiktok_ads').cpl, null)

console.log('✅ sales insights and media KPIs OK')
