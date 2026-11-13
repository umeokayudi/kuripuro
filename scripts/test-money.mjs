#!/usr/bin/env node
// v1.0.109 · money from one source (pure, no database).
import { isEmbeddedItem, itemUnits, visitsInMonth, storeVisitReference, contractMonthly, contractGross, contractIssues, groupByStore, monthlyByClient, invoiceMonth, isBilled, billedInMonth, teamCostByClient, marginPct } from '../src/lib/money.js'

const assert = (c, m) => { if (!c) throw new Error(m) }

const perVisit = { client_id: 'otp', location_name: 'Shinbashi', billing_type: 'per_visit', visits_per_month: 12, price_per_visit: 8000, monthly_revenue: 96000 }
const fixed = { client_id: 'otp', location_name: 'Shinbashi — Deep', billing_type: 'fixed_monthly', fixed_monthly: 50000, discount_percent: 10, visits_per_month: 2 }
const junk = { client_id: 'otp', location_name: 'Tooda', billing_type: 'per_visit', visits_per_month: 0, price_per_visit: 5000, service_type: 'Deep Clean' }
assert(contractGross(perVisit) === 96000 && contractMonthly(perVisit) === 96000, 'saved monthly value')
// v1.0.256 · the monthly value is the SAVED monthly_revenue, never visits × price
assert(contractGross({ ...perVisit, monthly_revenue: 15000 }) === 15000, 'saved total wins over visits × price')
assert(contractGross({ ...perVisit, monthly_revenue: 0 }) === 0 && contractGross({ ...perVisit, monthly_revenue: null }) === 0, 'avulso/deep ¥0 stays out of the monthly total')
assert(contractIssues({ ...perVisit, monthly_revenue: 0 }).length === 0, 'avulso ¥0 with a price is not a problem')
assert(contractGross({ billing_type: 'fixed_monthly', fixed_monthly: 120000, visits_per_month: 30, price_per_visit: 4400, monthly_revenue: 120000 }) === 120000, 'fixed monthly')
assert(contractGross(fixed) === 50000 && contractMonthly(fixed) === 45000, 'fixed with discount')
assert(contractIssues(junk).includes('zero_visits') && contractIssues(junk).includes('generic_deep'), 'junk item flagged')
assert(!contractIssues({ ...perVisit, monthly_revenue: 90000 }).includes('stored_mismatch'), 'no more saved ≠ visits × price warning')
assert(contractIssues(perVisit).length === 0, 'clean contract')

const stores = groupByStore([perVisit, fixed, junk])
assert(stores.length === 2 && stores.find(s => s.store === 'Shinbashi').items.length === 2 && stores.find(s => s.store === 'Shinbashi').monthly === 141000, 'grouped by store')
assert(monthlyByClient([perVisit, fixed, junk, { ...perVisit, is_active: false }]).otp === 141000, 'client monthly = active contracts')

const fs = [
  { status: 'sent', total: 100, period_start: '2026-09-01', issue_date: '2026-10-02' },
  { status: 'draft', total: 50, period_start: '2026-09-01' },
  { status: 'paid', total: 30, issue_date: '2026-09-20' },
  { status: 'cancelled', total: 999, period_start: '2026-09-01' },
]
assert(invoiceMonth(fs[0]) === '2026-09' && !isBilled(fs[1]) && billedInMonth(fs, '2026-09') === 130, 'billed by period, drafts/cancelled out')

const employees = [{ id: 'e1', salary_type: 'fixed', fixed_salary: 200000 }]
const jobs = [
  { employee_id: 'e1', client_id: 'otp', status: 'completed', scheduled_date: '2026-09-02', started_at: '2026-09-02T00:00:00Z', completed_at: '2026-09-02T03:00:00Z' },
  { employee_id: 'e1', client_id: 'atomic', status: 'completed', scheduled_date: '2026-09-03', started_at: '2026-09-03T00:00:00Z', completed_at: '2026-09-03T01:00:00Z', job_category: 'spot', spot_value: 8000 },
]
const cost = teamCostByClient({ jobs, employees, month: '2026-09' })
assert(cost.otp === 150000 && cost.atomic === 50000 + 8000, `cost spread by minutes + spot (${JSON.stringify(cost)})`)
assert(marginPct(1000, null) === null && marginPct(1000, 250) === 75, 'margin never 100% with unknown cost')

// v1.0.256 · fixed monthly model
const k7 = { client_id: 'otp', location_name: 'Kodama Kinshicho', billing_type: 'fixed_monthly', fixed_monthly: 120000, monthly_revenue: 120000, visits_per_month: 30, price_per_visit: 4400, days_of_week: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'] }
const k7deep = { client_id: 'otp', location_name: 'Kodama Kinshicho - Deep Clean', billing_type: 'per_visit', price_per_visit: 5000, monthly_revenue: 0, visits_per_month: 4, days_of_week: ['Mon'] }
const avulso = { client_id: 'otp', location_name: 'OTP — AC Cleaning', billing_type: 'per_visit', price_per_visit: 5000, monthly_revenue: 0, visits_per_month: 0, days_of_week: [] }
assert(isEmbeddedItem(k7deep) && !isEmbeddedItem(avulso) && !isEmbeddedItem(k7), 'deep scheduled ¥0 = operational; avulso is not')
const g7 = groupByStore([k7, k7deep])[0]
assert(g7.monthly === 120000 && g7.units === 2, `store = its fixed, 1 unit per item (${g7.monthly}/${g7.units})`)
assert(itemUnits({ service_type: 'Floor polisher (polidora)' }) === 4 && itemUnits(k7) === 1, 'polisher counts 4')
assert(visitsInMonth(k7, '2026-11') === 30 && visitsInMonth(k7, '2026-12') === 31, '7-day store: 30 / 31 visits')
assert(visitsInMonth({ visits_per_month: 2, days_of_week: ['Sun'] }, '2026-11') === 2, '2×/month item keeps 2')
const r30 = storeVisitReference(g7, '2026-11'), r31 = storeVisitReference(g7, '2026-12')
assert(r30.fixed === 120000 && r31.fixed === 120000 && r30.perVisit === 4000 && r31.perVisit === 3871, `reference per visit changes, fixed does not (${r30.perVisit}/${r31.perVisit})`)
console.log('money: ok')
