// v1.0.226 · Contratos ativos (vendas, só leitura): valores mensais, vigência, próxima fatura, sem dados de funcionário.
import assert from 'node:assert/strict'
import { buildPortfolio, nextBilling, termEnd, PORTFOLIO_CONTRACT_COLUMNS } from '../src/lib/activePortfolio.js'

const clients = [{ id: 'atomic', company_name: 'Atomic Bar' }, { id: 'otp', company_name: 'On The Planet' }, { id: 'bac', company_name: 'K.K. Bacana' }]
const contracts = [
  { id: 'a1', client_id: 'atomic', location_name: 'Atomic Bar', service_type: 'Basic Cleaning', billing_type: 'per_visit', price_per_visit: '37500.00', visits_per_month: 4, monthly_revenue: '150000.00', discount_percent: '0', billing_day: null, created_at: '2026-06-14T00:00:00Z', is_active: true, contract_details: { start_date: null } },
  { id: 'o1', client_id: 'otp', location_name: 'Kodama Kinshicho', service_type: 'Basic Cleaning', billing_type: 'per_visit', price_per_visit: '4400.00', visits_per_month: 30, monthly_revenue: '132000.00', billing_day: 10, created_at: '2026-06-14T00:00:00Z', is_active: true, contract_details: {} },
  { id: 'o2', client_id: 'otp', location_name: 'Kodama Kinshicho - Deep Clean', service_type: 'Range Hood', billing_type: 'per_visit', price_per_visit: '5000.00', visits_per_month: 4, monthly_revenue: '20000.00', billing_day: 10, created_at: '2026-06-14T00:00:00Z', is_active: true, contract_details: {} },
  { id: 'o3', client_id: 'otp', location_name: 'OTP — AC Cleaning', service_type: 'AC Cleaning', billing_type: 'per_visit', price_per_visit: '5000.00', visits_per_month: 0, monthly_revenue: '0.00', created_at: '2026-08-18T00:00:00Z', is_active: true },
  { id: 'b1', client_id: 'bac', location_name: 'Super Bacana Ginza', service_type: 'Basic Cleaning', billing_type: 'fixed_monthly', fixed_monthly: '92', billing_day: 10, created_at: '2026-11-11T00:00:00Z', is_active: true, contract_details: { start_date: '2026-11-16', worker_payment: 999 } },
  { id: 'x', client_id: 'otp', location_name: 'Old', billing_type: 'fixed_monthly', fixed_monthly: 1, is_active: false },
]
const list = buildPortfolio(contracts, clients, '2026-11-13')
const by = Object.fromEntries(list.map(g => [g.company, g]))
assert.equal(by['Atomic Bar'].monthly, 150000)
assert.equal(by['On The Planet'].monthly, 132000 + 20000)
assert.equal(by['On The Planet'].locations.length, 3, 'inactive contract left out')
assert.equal(by['On The Planet'].start, '2026-06-14')
assert.equal(by['On The Planet'].termEnd, '2027-06-13')
assert.equal(by['On The Planet'].nextInvoice, '2026-11-30')
assert.equal(by['On The Planet'].nextDue, '2026-12-10')
assert.equal(by['K.K. Bacana'].monthly, 92)
assert.equal(by['K.K. Bacana'].started, false)
assert.equal(by['K.K. Bacana'].nextInvoice, '2026-11-30')
assert.equal(list[0].company, 'On The Planet', 'biggest first')
// nothing about employees leaves the builder
const json = JSON.stringify(list)
for (const bad of ['worker_payment', 'employee_pay', 'salary', 'contract_details']) assert.ok(!json.includes(bad), bad)
assert.ok(!/contract_details|worker|employee|salary|commission/.test(PORTFOLIO_CONTRACT_COLUMNS))
assert.deepEqual(nextBilling('2026-12-05', 10), { invoice: '2026-12-31', due: '2027-01-10', period: '2026-12' })
assert.equal(nextBilling('2027-01-20', 31).due, '2027-02-28')
assert.equal(termEnd('2025-03-01', '2026-11-13'), '2027-02-28')
assert.equal(termEnd('', '2026-11-13'), '')
console.log('active portfolio: ok')
