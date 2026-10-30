#!/usr/bin/env node
// v1.0.109 · money from one source (pure, no database).
import { contractMonthly, contractGross, contractIssues, groupByStore, monthlyByClient, invoiceMonth, isBilled, billedInMonth, teamCostByClient, marginPct } from '../src/lib/money.js'

const assert = (c, m) => { if (!c) throw new Error(m) }

const perVisit = { client_id: 'otp', location_name: 'Shinbashi', billing_type: 'per_visit', visits_per_month: 12, price_per_visit: 8000, monthly_revenue: 96000 }
const fixed = { client_id: 'otp', location_name: 'Shinbashi — Deep', billing_type: 'fixed_monthly', fixed_monthly: 50000, discount_percent: 10, visits_per_month: 2 }
const junk = { client_id: 'otp', location_name: 'Tooda', billing_type: 'per_visit', visits_per_month: 0, price_per_visit: 5000, service_type: 'Deep Clean' }
assert(contractGross(perVisit) === 96000 && contractMonthly(perVisit) === 96000, 'visits × price')
assert(contractGross(fixed) === 50000 && contractMonthly(fixed) === 45000, 'fixed with discount')
assert(contractIssues(junk).includes('zero_visits') && contractIssues(junk).includes('generic_deep'), 'junk item flagged')
assert(contractIssues({ ...perVisit, monthly_revenue: 90000 }).includes('stored_mismatch'), 'stored total that differs is flagged')
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

console.log('money: ok')
