// Run: npx esbuild scripts/test-work-report.mjs --bundle --platform=node --format=esm --define:import.meta.env={} --outfile=/tmp/t.mjs && node /tmp/t.mjs
import { blankReport, quoteMoney, applyDraft, reportHtml, summaryOf, buildPeriodReport, reportVisibleTo, periodMediaCount } from '../src/lib/workReport.js'
let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }

const job = { id: 'job-1', title: 'Bacana Ginza — 業務用エアコン分解洗浄', client_id: 'cli-1', scheduled_date: '2026-10-26', employee_name: 'Alexandre Yudi Umeoka' }
const r = blankReport({ mode: 'simple', job, client: { id: 'cli-1', company_name: 'バッカーナ株式会社', manager_name: 'サナエ' } })
ok(r.location === 'Bacana Ginza' && r.title === '業務用エアコン分解洗浄', 'place and service come from the job title')
ok(r.fields.lead === 'Alexandre Yudi Umeoka' && r.contact_name === 'サナエ', 'lead = employee, contact = manager')
ok(r.status === 'draft' && r.job_ids[0] === 'job-1', 'new report is a draft linked to the job')

const m = quoteMoney({ subtotal: '140,000', tax_rate: 10 })
ok(m && m.tax === 14000 && m.total === 154000, 'quote 140,000 + 10% = 154,000')
ok(quoteMoney({ subtotal: '' }) === null, 'empty amount = not shown')

const d = applyDraft(r, { summary: 'いつも大変お世話になっております。', steps: ['養生', ' ', '分解'], parts: [{ name: 'ドレンパン', level: 'weird' }], recommendations: [] })
ok(d.summary.startsWith('いつも') && d.steps.length === 2, 'AI draft fills text, drops empty steps')
ok(d.parts[0].level === 'medium', 'unknown level falls back to medium')
ok(Array.isArray(d.recommendations) && d.recommendations.length === 0, 'empty AI list keeps the old one')

const simple = reportHtml({ ...d, quote: { number: '129', subtotal: 140000, tax_rate: 10, label: '7台' }, notices: '<script>x</script>' })
ok(simple.includes('作業報告書｜業務用エアコン分解洗浄') && !simple.includes('154,000') && !simple.includes('140,000'), 'client html has the title and never the amount')
ok(!simple.includes('<script>x') && simple.includes('&lt;script&gt;'), 'user text is escaped')
ok(!simple.includes('部位別ビフォー・アフター比較'), 'simple report hides the parts table')
const det = reportHtml({ ...d, mode: 'detailed', parts: [{ name: 'ドレンパン', level: 'heavy', before: '黒カビ', why: '水漏れ', after: '除去' }] })
ok(det.includes('部位別ビフォー・アフター比較') && det.includes('重度'), 'detailed report shows the parts table')
const s = summaryOf(d)
ok(!('notes_raw' in s) && s.job_id === 'job-1', 'index summary carries no notes')

// v1.0.155 · client report of the month, by store
const OTP = { id: 'otp', company_name: 'On The Planet' }
const jobs = [
  { id: 'a1', client_id: 'otp', title: 'Nyu Sakana Yakio — 定期清掃', scheduled_date: '2026-10-03', status: 'completed', employee_name: 'Gabriel', started_at: '2026-10-03T01:05:00Z', completed_at: '2026-10-03T03:17:00Z', price: 18000 },
  { id: 'a2', client_id: 'otp', title: 'Nyu Sakana Yakio — Deep clean', scheduled_date: '2026-10-20', status: 'completed', employee_name: 'Guilherme', job_category: 'spot' },
  { id: 'b1', client_id: 'otp', title: 'Kodama Kinshicho — 定期清掃', scheduled_date: '2026-10-11', status: 'completed', employee_name: 'Letícia' },
  { id: 'c1', client_id: 'otp', title: 'Kodama Kinshicho — 定期清掃', scheduled_date: '2026-10-12', status: 'scheduled', employee_name: 'Letícia' },
  { id: 'd1', client_id: 'otp', title: 'Kodama Kinshicho — 定期清掃', scheduled_date: '2026-11-01', status: 'completed', employee_name: 'Letícia' },
]
const media = new Map([['a1', [{ path: 'jobs/a1/start_1.jpg', kind: 'photo', section: 'before' }, { path: 'jobs/a1/end_1.jpg', kind: 'photo', section: 'after' }, { path: 'jobs/a1/video_1.mp4', kind: 'video', section: 'after' }]]])
const pr = buildPeriodReport({ client: OTP, from: '2026-10-01', to: '2026-10-31', jobs, media, lang: 'ja' })
ok(pr.kind === 'period' && pr.stores.length === 2 && pr.stores.map(x => x.name).join() === 'Kodama Kinshicho,Nyu Sakana Yakio', 'October report = one section per store, completed services only')
ok(pr.stores[1].services.length === 2 && pr.stores[1].services[0].who === 'Gabriel' && pr.stores[1].services[1].type === 'spot', 'each service has date, type and who')
ok(periodMediaCount(pr) === 3, 'every photo and the video of the service come in by themselves')
const full = reportHtml(pr)
ok(full.includes('<video') && full.includes('店舗別まとめ'), 'html has the video and the store summary')
ok(!/18,?000|10:05|12:17|01:05|price|office_note/.test(full), 'client html has no value, no start/end time, no internal note')
const one = reportHtml(pr, { store: 'Nyu Sakana Yakio' })
ok(one.includes('Nyu Sakana Yakio') && !one.includes('Kodama Kinshicho'), 'store login sees only its own store')
const sum = { ...summaryOf(pr), status: 'sent' }
ok(reportVisibleTo(sum, { client_id: 'otp', location_name: 'Nyu Sakana Yakio' }), 'Nyu Sakana Yakio login sees the sent October report')
ok(!reportVisibleTo(sum, { client_id: 'otp', location_name: 'Other store' }), 'a store not in the report does not see it')
ok(!reportVisibleTo({ ...sum, status: 'draft' }, { client_id: 'otp', location_name: null }), 'drafts never reach the portal')
ok(!reportVisibleTo(sum, { client_id: 'someone-else' }), 'another client never sees it')

// v1.0.158 · one-tap reports
const q = { ...blankReport({ mode: 'simple', job: { ...jobs[0], signature_url: null } }), quick: true, checklist: [{ label: '床清掃', done: true }, { label: 'ゴミ回収', done: false }], signatures: { cleaner: { name: 'Gabriel', url: null }, owner: null } }
const qh = reportHtml(q)
ok(qh.includes('チェックリスト') && qh.includes('床清掃') && qh.includes('class="no"'), 'quick report shows the checklist, missed items marked')
ok(qh.includes('写真なし') && qh.includes('署名なし'), 'no photo / no signature is said, never blocks')
const q2 = reportHtml({ ...q, photos: [{ path: 'jobs/a1/start_1.jpg', section: 'before' }], signatures: { cleaner: { name: 'Gabriel', url: 'data:image/png;base64,AAA' }, owner: null } })
ok(!q2.includes('写真なし') && q2.includes('data:image/png;base64,AAA'), 'cleaner signature printed when saved on the job')
const day = { ...buildPeriodReport({ client: null, from: '2026-10-03', to: '2026-10-03', jobs: [...jobs, { ...jobs[2], id: 'b9', scheduled_date: '2026-10-03', status: 'in_progress' }], media, lang: 'ja', statuses: ['completed', 'in_progress'] }), quick: true, day: { employee_id: 'g', employee_name: 'Guilherme Henrique', date: '2026-10-03' }, title: '作業日報｜Guilherme Henrique', signatures: { cleaner: { name: 'Guilherme Henrique', url: 'data:image/png;base64,CLN' }, owner: null } }
const dh = reportHtml(day)
ok(dh.includes('担当者：Guilherme Henrique') && dh.includes('（未完了）') && dh.includes('data:image/png;base64,CLN'), 'day report: person, unfinished service tagged, cleaner signature at the end')
ok(dh.includes('責任者の承認待ち') && !dh.includes('OWNERSIG'), 'without "Aceitar e assinar" there is no owner signature')
const dh2 = reportHtml({ ...day, signatures: { ...day.signatures, owner: { name: 'Yudi', url: 'data:image/png;base64,OWNERSIG', at: '2026-10-03T12:00:00Z' } } })
ok(dh2.includes('OWNERSIG') && !dh2.includes('責任者の承認待ち'), 'after accepting, the owner signature is on the report')
ok(!/18,?000|10:05|12:17|01:05|price/.test(dh2), 'day report has no value and no start/end time')
const ds = summaryOf(day)
ok(ds.day?.employee_name === 'Guilherme Henrique' && ds.quick && !ds.accepted_at, 'summary carries day + not accepted (list Prontos)')
ok(!reportVisibleTo({ ...ds, status: 'sent' }, { client_id: 'otp' }), 'a day report (no client) never shows in a client portal')
process.exit(fail ? 1 : 0)
