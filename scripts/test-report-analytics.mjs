#!/usr/bin/env node
import { rangeForPreset, sumInvoices, previousEqualRange, growthPct } from '../src/lib/period.js'
import {
  filterInvoices,
  invoiceKpis,
  jobKpis,
  filterJobs,
  revenueSeries,
  jobSeries,
  buildTimeBuckets,
  bucketGrain,
  rankClients,
  statusSlices,
  isOverdueInvoice,
  clientInsight,
} from '../src/lib/reportAnalytics.js'
import { generateReportPdf } from '../src/lib/reportPdf.js'
import { kuripuroEn, kuripuroJa } from '../src/i18n/kuripuro.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const today = '2026-10-06'
const rows = [
  { id: '1', status: 'sent', total: 100000, issue_date: '2026-08-10', client_id: 'c1', client_name: 'A', due_date: '2026-08-20' },
  { id: '2', status: 'paid', total: 50000, issue_date: '2026-09-12', client_id: 'c2', client_name: 'B', due_date: '2026-10-01' },
  { id: '3', status: 'draft', total: 90000, issue_date: '2026-09-20', client_id: 'c1', client_name: 'A' },
  { id: '4', status: 'paid', total: 25000, created_at: '2026-10-02T03:00:00Z', client_id: 'c2', client_name: 'B' },
  { id: '5', status: 'cancelled', total: 999, issue_date: '2026-10-03', client_id: 'c1' },
  { id: '6', status: 'sent', total: 40000, issue_date: '2026-10-04', client_id: 'c1', client_name: 'A', due_date: '2026-10-01' },
]

const { start, end } = rangeForPreset('m3', today)
assert(start === '2026-08-01' && end === today, 'm3 range')

const billed = sumInvoices(rows, start, end, ['sent', 'paid'])
const current = filterInvoices(rows, { start, end, today })
const prev = previousEqualRange({ start, end })
const previous = filterInvoices(rows, { start: prev.start, end: prev.end, today })
const k = invoiceKpis(current, previous, today)
assert(k.billed === billed, `kpi billed ${k.billed} vs ${billed}`)
assert(k.received === sumInvoices(rows, start, end, ['paid']), `received ${k.received}`)
assert(k.toCollect === 140000, `toCollect ${k.toCollect}`)
assert(k.cancelled === 999, `cancelled ${k.cancelled}`)
assert(k.overdue === 140000, `overdue ${k.overdue}`)
assert(k.billedGrowth === growthPct(k.billed, k.billedPrev), 'growth matches')

const overdueOnly = filterInvoices(rows, { start, end, status: 'overdue', today })
assert(overdueOnly.length === 2, `overdue rows ${overdueOnly.length}`)
assert(isOverdueInvoice(rows[5], today) === true, 'oct sent overdue')
assert(isOverdueInvoice(rows[1], today) === false, 'paid not overdue')

const buckets = buildTimeBuckets(start, end, 'month')
assert(buckets.length === 3, `months ${buckets.length}`)
const series = revenueSeries(current, buckets)
const seriesSum = series.reduce((s, x) => s + x.value, 0)
assert(seriesSum === k.billed, `series ${seriesSum} vs billed ${k.billed}`)

assert(bucketGrain('2026-10-01', '2026-10-06') === 'day', 'day grain')
assert(bucketGrain('2026-08-01', today) === 'week', 'week grain')
assert(bucketGrain('2026-01-01', today) === 'month', 'month grain')

const ranked = rankClients(current, [{ id: 'c1', company_name: 'Alpha' }, { id: 'c2', company_name: 'Beta' }])
assert(ranked[0].name === 'Alpha', ranked[0].name)
assert(ranked[0].value === ranked[0].billed, 'value alias')
assert(ranked[0].billed >= ranked[1].billed, 'sorted desc')

const slices = statusSlices(current, today)
assert(slices.find(s => s.key === 'received').value === k.received, 'slice received')
assert(slices.find(s => s.key === 'cancelled').value === 999, 'slice cancelled')
const pendingNet = slices.find(s => s.key === 'pending').value
assert(pendingNet + slices.find(s => s.key === 'overdue').value === k.toCollect, 'pending+overdue = sent')

const jobs = [
  { id: 'j1', status: 'completed', scheduled_date: '2026-09-10', client_id: 'c1', location_name: 'Shop A', cleaning_type: 'regular', value: 3000 },
  { id: 'j2', status: 'completed', scheduled_date: '2026-10-02', client_id: 'c1', location_name: 'Shop A', job_category: 'deep', value: 8000 },
  { id: 'j3', status: 'assigned', scheduled_date: '2026-10-05', client_id: 'c2', location_name: 'Shop B' },
]
const cj = filterJobs(jobs, { start, end })
const jk = jobKpis(cj, [])
assert(jk.services === 2, `services ${jk.services}`)
const js = jobSeries(cj, buckets)
assert(js.reduce((s, x) => s + x.value, 0) === 2, 'job series count')

const insight = clientInsight('c1', current, cj, [{ id: 'c1', company_name: 'Alpha' }], { start, end })
assert(insight.name === 'Alpha', insight.name)
assert(insight.services === 2, insight.services)
assert(insight.monthly.length === 3, 'monthly buckets')

const todayR = rangeForPreset('today', today)
assert(todayR.start === today && todayR.end === today, 'today')
const week = rangeForPreset('thisWeek', today)
assert(week.start === '2026-10-05' && week.end === today, `week ${week.start}`)

const enK = Object.keys(kuripuroEn.reports).sort()
const jaK = Object.keys(kuripuroJa.reports).sort()
assert(enK.join() === jaK.join(), `reports i18n ${enK.filter(k => !jaK.includes(k))} / ${jaK.filter(k => !enK.includes(k))}`)
assert(kuripuroEn.invoices.statuses.draft && kuripuroJa.invoices.statuses.draft, 'invoice status labels')
assert(kuripuroEn.period.thisWeek && kuripuroJa.period.thisWeek, 'period week')

const doc = generateReportPdf({
  title: 'Report — 2026/10 — All clients',
  subtitle: `${start} – ${end}`,
  filtersLine: 'Period: 3 months',
  kpis: [{ label: 'Billed', value: '¥215,000' }],
  revenue: series,
  ranking: ranked,
  services: js,
  slices: slices.map(s => ({ ...s, label: s.key })),
  invoices: current.map(r => ({ date: r.issue_date, client: r.client_name, status: r.status, total: r.total })),
  generatedAt: '2026-10-06 12:00',
})
assert(typeof doc.save === 'function', 'jspdf doc')

console.log('✅ report analytics / pdf')
