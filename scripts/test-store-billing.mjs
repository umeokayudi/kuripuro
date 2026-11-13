#!/usr/bin/env node
// v1.0.256 · contract = fixed monthly per store; deep inside the fixed; invoice one line per store.
import { contracts, afterDataChange } from './fixtures-otp-contracts-2026-11-13.mjs'
import { groupByStore } from '../src/lib/money.js'
import { buildStoreLines, monthlyTotals, buildContractLine } from '../src/lib/invoiceAutomation.js'

const assert = (c, m) => { if (!c) throw new Error(m) }
const active = list => list.filter(c => c.is_active)
const total = list => groupByStore(list).reduce((s, g) => s + g.monthly, 0)

assert(total(contracts) === 1199800, `today's saved values give ¥1.199.800 (${total(contracts)})`)
assert(total(afterDataChange) === 898000, `after the data change the header is ¥898.000 (${total(afterDataChange)})`)

const lines = buildStoreLines(active(afterDataChange), [])
const sum = lines.reduce((s, l) => s + l.total, 0)
assert(lines.length === 11 && sum === 898000, `11 store lines = ¥898.000 (${lines.length} / ${sum})`)
assert(!lines.some(l => /deep/i.test(l.description)), 'no deep line')
assert(lines.find(l => l.description === 'Kodama Kinshicho').total === 120000 && lines.find(l => l.description === 'Ibushio').total === 15000, 'store lines = fixed')
const tt = monthlyTotals(lines, 10, 'excl')
assert(tt.subtotal === 898000 && tt.tax === 89800 && tt.total === 987800, `+ tax = ¥987.800 (${tt.total})`)

// on-demand item (no visits planned) still bills its executions; per-visit clients with a saved total are unchanged
const avulso = { location_name: 'OTP — AC Cleaning', billing_type: 'per_visit', price_per_visit: 5000, monthly_revenue: 0, visits_per_month: 0 }
assert(buildContractLine(avulso, [{ id: 'j1', title: 'OTP — AC Cleaning', location_name: 'OTP — AC Cleaning', status: 'completed' }]).total === 5000, 'avulso billed per execution')
const atomic = { location_name: 'Atomic Bar', billing_type: 'per_visit', price_per_visit: 37500, monthly_revenue: 150000, visits_per_month: 4 }
const jobs = [1, 2, 3, 4, 5].map(i => ({ id: `a${i}`, title: 'Atomic Bar', status: 'completed' }))
assert(buildContractLine(atomic, jobs).total === 187500, 'Atomic Bar (per visit, saved total) still billed per completed visit')
console.log('store billing: ok')
