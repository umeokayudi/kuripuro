// Run: npx esbuild scripts/test-work-report.mjs --bundle --platform=node --format=esm --define:import.meta.env={} --outfile=/tmp/t.mjs && node /tmp/t.mjs
import { blankReport, quoteMoney, applyDraft, reportHtml, summaryOf } from '../src/lib/workReport.js'
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
ok(simple.includes('作業報告書｜業務用エアコン分解洗浄') && simple.includes('154,000円'), 'html has title and total with tax')
ok(!simple.includes('<script>x') && simple.includes('&lt;script&gt;'), 'user text is escaped')
ok(!simple.includes('部位別ビフォー・アフター比較'), 'simple report hides the parts table')
const det = reportHtml({ ...d, mode: 'detailed', parts: [{ name: 'ドレンパン', level: 'heavy', before: '黒カビ', why: '水漏れ', after: '除去' }] })
ok(det.includes('部位別ビフォー・アフター比較') && det.includes('重度'), 'detailed report shows the parts table')
const s = summaryOf(d)
ok(!('notes_raw' in s) && s.job_id === 'job-1', 'index summary carries no notes')
process.exit(fail ? 1 : 0)
