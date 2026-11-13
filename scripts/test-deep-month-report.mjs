// v1.0.234 · monthly Deep report: numbers follow the contract, and the page never carries the
// finish time, the duration or any value.   npx vite-node scripts/test-deep-month-report.mjs [out.html]
import { writeFileSync } from 'node:fs'
import { deepMonthProgress } from '../src/lib/deepMonthProgress.js'
import { buildDeepMonthReport, deepMonthReportHtml, startTimeOf, serviceLabel } from '../src/lib/deepMonthReport.js'

let failed = 0
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const C = 'c1'
const clients = [{ id: C, company_name: 'Planeta Teste 株式会社', is_active: true }]
const contracts = [
  { id: 'k1', client_id: C, is_active: true, location_name: 'Loja Norte', service_type: 'Basic Cleaning', days_of_week: ['mon', 'wed'], price_per_visit: 9999, monthly_revenue: 987800 },
  { id: 'k2', client_id: C, is_active: true, location_name: 'Loja Norte — Deep Clean (Range Hood + AC + Grease Trap x2)', service_type: 'Deep Cleaning', days_of_week: [], visits_per_month: 1, price_per_visit: 55555 },
  { id: 'k3', client_id: C, is_active: true, location_name: 'Loja Sul', service_type: 'Basic Cleaning', days_of_week: ['tue'] },
  { id: 'k4', client_id: C, is_active: true, location_name: 'Loja Sul — Grease Trap', service_type: 'Deep Cleaning', days_of_week: [], visits_per_month: 2 },
]
const job = (id, title, date, status, extra = {}) => ({ id, client_id: C, client_name: clients[0].company_name, title, scheduled_date: date, scheduled_time: '23:30', status, value: 44444, employee_pay: 3333, ...extra })
const jobs = [
  job('j1', 'Loja Norte — Deep Clean (Range Hood)', '2026-10-05', 'completed', { started_at: '2026-10-05T14:40:00Z', completed_at: '2026-10-05T17:05:00Z' }),
  job('j2', 'Loja Norte — Deep Clean (Grease Trap)', '2026-10-12', 'completed', { started_at: '2026-10-12T15:10:00Z', completed_at: '2026-10-12T16:00:00Z' }),
  job('j3', 'Loja Norte — Deep Clean (AC)', '2026-10-20', 'assigned'),
  job('j4', 'Loja Sul — Grease Trap', '2026-10-08', 'completed', { completed_at: '2026-10-08T18:22:00Z' }),
  job('j5', 'Loja Sul — Grease Trap', '2026-10-22', 'cancelled'),
  job('j6', 'Loja Norte — Basic Cleaning', '2026-10-06', 'completed'),
]
const media = new Map([
  ['j1', [{ path: 'jobs/j1/start_0.jpg', kind: 'photo', section: 'before' }, { path: 'jobs/j1/end_0.jpg', kind: 'photo', section: 'after' }, { path: 'jobs/j1/end_1.jpg', kind: 'photo', section: 'after' }, { path: 'jobs/j1/video_0.mp4', kind: 'video', section: 'after' }]],
  ['j2', [{ path: 'jobs/j2/start_0.jpg', kind: 'photo', section: 'before' }]],
])
const progress = deepMonthProgress(contracts, clients, jobs)[0]
const report = buildDeepMonthReport({ progress, media, month: '2026-10', lang: 'pt' })
ok('expected follows the contract (Norte 4 + Sul 2)', report.totals.expected === 6, JSON.stringify(report.totals))
ok('done = completed only', report.totals.done === 3)
ok('scheduled and missing', report.totals.scheduled === 1 && report.totals.missing === 2)
ok('cancelled job is not in the report', !JSON.stringify(report).includes('j5'))
ok('basic cleaning is not in the report', !JSON.stringify(report).includes('j6'))
ok('start time is the real start, in Tokyo', startTimeOf(jobs[0]) === '23:40', startTimeOf(jobs[0]))
ok('without a real start, the booked time', startTimeOf(jobs[3]) === '23:30')
ok('service label in Portuguese', /Coifa|Exaustor/i.test(serviceLabel(jobs[0].title, 'pt')), serviceLabel(jobs[0].title, 'pt'))
const svc = report.stores.find(s => s.name === 'Loja Norte').services
ok('photos split before / after, videos left out', svc[0].before.length === 1 && svc[0].after.length === 2)
for (const lang of ['ja', 'pt', 'en']) {
  const html = deepMonthReportHtml(buildDeepMonthReport({ progress, media, month: '2026-10', lang }), { lang, photoUrl: p => `https://example.invalid/${p}`, issuedOn: '2026-11-01' })
  const body = html.replace(/<style>[\s\S]*?<\/style>/, '')
  ok(`${lang}: no value anywhere`, !/¥|￥|44444|55555|9999|987800|3333|円/.test(body))
  ok(`${lang}: no finish time or duration`, !/02:05|01:00|03:22|17:05|completed_at|終了|所要|término|duração|duration|finish/i.test(body.replace(/Este relatório[^<]*|本報告書[^<]*|This report[^<]*/g, '')))
  ok(`${lang}: has the start time and both stores`, body.includes('23:40') && body.includes('Loja Norte') && body.includes('Loja Sul'))
}
if (process.argv[2]) {
  const svg = (label, color) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${color}"/><text x="200" y="155" font-size="22" text-anchor="middle" fill="#fff" font-family="sans-serif">${label}</text></svg>`)}`
  writeFileSync(process.argv[2], deepMonthReportHtml(buildDeepMonthReport({ progress, media, month: '2026-10', lang: 'ja' }), { lang: 'ja', photoUrl: p => svg(p.split('/').pop(), /start/.test(p) ? '#8b95a7' : '#3b4a66'), issuedOn: '2026-11-01' }))
}
console.log(failed ? `\n${failed} failed` : '\nall good')
process.exit(failed ? 1 : 0)
