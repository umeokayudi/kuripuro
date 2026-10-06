#!/usr/bin/env node
import {
  addTokyoDays,
  dateInRange,
  filterByPeriod,
  filterByPeriodKeepOpen,
  growthPct,
  growthWindows,
  monthBuckets,
  monthEnd,
  previousEqualRange,
  rangeForPreset,
  rollingWindow,
  sumInvoices,
} from '../src/lib/period.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const today = '2026-10-06'

const thisMonth = rangeForPreset('thisMonth', today)
assert(thisMonth.start === '2026-10-01' && thisMonth.end === today, 'thisMonth')

const last = rangeForPreset('lastMonth', today)
assert(last.start === '2026-09-01' && last.end === '2026-09-30', 'lastMonth')

const m3 = rangeForPreset('m3', today)
assert(m3.start === '2026-08-01' && m3.end === today, `m3 ${m3.start}`)

const m6 = rangeForPreset('m6', today)
assert(m6.start === '2026-05-01', `m6 ${m6.start}`)

const m9 = rangeForPreset('m9', today)
assert(m9.start === '2026-02-01', `m9 ${m9.start}`)

const m12 = rangeForPreset('m12', today)
assert(m12.start === '2025-11-01', `m12 ${m12.start}`)

assert(monthEnd('2026-02-10') === '2026-02-28', 'feb end')
assert(addTokyoDays('2026-10-01', -1) === '2026-09-30', 'add days')

const prev = previousEqualRange({ start: '2026-10-01', end: '2026-10-06' })
assert(prev.start === '2026-09-25' && prev.end === '2026-09-30', `prev ${prev.start} ${prev.end}`)

const w3 = rollingWindow(3, today)
assert(w3.current.start === '2026-08-01' && w3.current.end === today, 'roll current')
assert(w3.previous.end === '2026-07-31', `roll prev end ${w3.previous.end}`)
assert(w3.previous.start === '2026-05-01', `roll prev start ${w3.previous.start}`)

assert(growthPct(120, 100) === 20, 'growth 20')
assert(growthPct(80, 100) === -20, 'growth -20')
assert(growthPct(10, 0) === 100, 'from zero')
assert(growthPct(0, 0) === 0, 'zero zero')

assert(dateInRange('2026-08-15', '2026-08-01', '2026-10-06'), 'in range')
assert(!dateInRange('2026-07-31', '2026-08-01', '2026-10-06'), 'out range')
assert(!dateInRange('', '2026-08-01', '2026-10-06'), 'empty date')

const rows = [
  { status: 'sent', total: 100000, issue_date: '2026-08-10' },
  { status: 'paid', total: 50000, issue_date: '2026-09-12' },
  { status: 'draft', total: 90000, issue_date: '2026-09-20' },
  { status: 'paid', total: 25000, created_at: '2026-10-02T03:00:00Z' },
  { status: 'cancelled', total: 999, issue_date: '2026-10-03' },
]

assert(sumInvoices(rows, '2026-08-01', today, ['sent', 'paid']) === 175000, 'billed window')
assert(sumInvoices(rows, '2026-08-01', today, ['paid']) === 75000, 'received window')

const gw = growthWindows(rows, today)
assert(gw.length === 4, '4 windows')
assert(gw.map(x => x.months).join(',') === '3,6,9,12', 'months order')
assert(gw[0].billed === 175000, `3m billed ${gw[0].billed}`)
assert(gw[0].received === 75000, '3m received')

const buckets = monthBuckets(rows, 3, today)
assert(buckets.length === 3, '3 buckets')
assert(buckets[0].ym === '2026-08' && buckets[0].billed === 100000, 'aug bucket')
assert(buckets[1].ym === '2026-09' && buckets[1].received === 50000, 'sep received')
assert(buckets[2].ym === '2026-10' && buckets[2].received === 25000, 'oct received')

const scoped = filterByPeriod(rows, '2026-09-01', '2026-09-30', ['issue_date', 'created_at'])
assert(scoped.length === 2, `sep rows ${scoped.length}`)

const mixed = [
  { status: 'pending', created_at: '2025-01-01' },
  { status: 'done', created_at: '2026-10-02' },
  { status: 'done', created_at: '2025-02-01' },
]
const kept = filterByPeriodKeepOpen(mixed, '2026-10-01', today, ['created_at'], r => r.status === 'pending')
assert(kept.length === 2, `keep open ${kept.length}`)

console.log('✅ period filter / growth windows')
