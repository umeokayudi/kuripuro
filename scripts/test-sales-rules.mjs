#!/usr/bin/env node
// v1.0.116 · Sales: follow-up alert rule, closed value = quote value, unassigned leads
import { followupAlert, followupAlerts, alertRuleCounts } from '../src/lib/salesFollowup.js'
import { dealValue, unassignedOpenLeads } from '../src/lib/salesInsights.js'
import { contractDraftFromQuote } from '../src/lib/quoteContract.js'
const assert = (c, m) => { if (!c) throw new Error(m) }
const today = '2026-10-30'
const lead = (id, extra = {}) => ({ id, stage: 'followup', last_contact_date: '2026-10-28', ...extra })
// 14+ days without contact, even with a next date set
assert(followupAlert(lead('a', { last_contact_date: '2026-10-10', next_followup_date: '2026-11-05' }), today)?.reasons.join() === 'no_contact', '14 days')
assert(followupAlert(lead('b', { last_contact_date: '2026-10-20' }), today) === null, '10 days is fine')
// overdue next date alone is NOT an alert any more
assert(followupAlert(lead('c', { next_followup_date: '2026-10-25' }), today) === null, 'overdue date alone')
// sent quote past validity
const q = [{ lead_id: 'd', status: 'sent', valid_until: '2026-10-29', total: 50000 }]
assert(followupAlert(lead('d'), today, { quotes: q })?.reasons.join() === 'quote_expired', 'expired quote')
// approved quote past validity without contract → alert even when won; with contract → none
const qa = [{ lead_id: 'e', status: 'accepted', valid_until: '2026-10-01', total: 80000 }]
assert(followupAlert(lead('e', { stage: 'won' }), today, { quotes: qa })?.reasons.join() === 'quote_expired', 'approved expired')
assert(followupAlert(lead('e', { stage: 'won' }), today, { quotes: qa, contracts: [{ lead_id: 'e' }] }) === null, 'has contract')
assert(followupAlert(lead('f', { stage: 'lost', last_contact_date: '2026-01-01' }), today) === null, 'lost')
const all = followupAlerts([lead('a', { last_contact_date: '2026-10-10' }), lead('d', { last_contact_date: '2026-10-01' })], today, { quotes: q })
assert(all[0].lead.id === 'd' && alertRuleCounts(all).quoteExpired === 1 && alertRuleCounts(all).noContact === 2, 'counts')
// closed value = accepted quote value
assert(dealValue({ id: 'x', expected_monthly: 30000 }, [{ lead_id: 'x', status: 'accepted', total: 88000, created_at: '2026-10-01' }, { lead_id: 'x', status: 'sent', total: 99000, created_at: '2026-10-05' }]) === 88000, 'accepted wins')
assert(dealValue({ id: 'x', expected_monthly: 30000 }, [{ lead_id: 'x', status: 'sent', total: 99000 }]) === 99000, 'latest quote')
assert(dealValue({ id: 'x', expected_monthly: 30000 }, []) === 30000, 'expected fallback')
// unassigned = open leads without seller (same list for the box and the pipeline filter)
assert(unassignedOpenLeads([{ id: 1 }, { id: 2, salesperson_id: 's' }, { id: 3, stage: 'won' }]).length === 1, 'unassigned open')
// contract draft from an approved quote
const draft = contractDraftFromQuote({ id: 'm1', quote_number: 'Q-12', company_name: 'K.K. Bacana', subtotal: 100000, total: 110000, tax_rate: 10, hours_per_visit: 3, frequency: '週2回', salesperson_id: 's1' }, { site_name: 'Bacana Ebisu', address: '渋谷区恵比寿1-1' })
assert(draft.location_name === 'Bacana Ebisu' && draft.billing_type === 'fixed_monthly' && draft.fixed_monthly === 100000 && draft.price_includes_tax === false && draft.hours_per_visit === 3 && draft.salesperson_id === 's1' && draft.notes.includes('Q-12'), 'draft')
console.log('sales rules: ok')
