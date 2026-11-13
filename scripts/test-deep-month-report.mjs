// v1.0.230 · Rules of the monthly Deep OTP report (pure logic, no network).
import assert from 'node:assert/strict'
import { buildDeepMonthReport, deepMonthReportHtml, safeNotes, storeOf, serviceOf } from '../src/lib/deepMonthReport.js'

const OTP = '7138f082-0d38-43e4-bd77-00c4598690b3'
const job = (id, title, date, status, extra = {}) => ({ id, title, client_id: OTP, client_name: 'On The Planet', scheduled_date: date, scheduled_time: '00:30', status, value: 99999, employee_pay: 1234, completed_at: '2026-11-03T05:59:00Z', ...extra })
const jobs = [
  job('a', 'Kodama Kinshicho — Deep Clean (Grease Trap)', '2026-11-03', 'completed', { started_at: '2026-11-03T04:12:00Z' }),
  job('b', 'Nyu Sakana Yakio — Deep Clean (AC Cleaning)', '2026-11-04', 'completed'),
  job('c', 'Ibushio - Deep Clean — グリストラップ', '2026-11-05', 'completed', { started_at: '2026-11-05T07:11:00Z' }),
  job('d', 'Tooda — Deep Clean (Range Hood)', '2026-11-26', 'assigned'),
  job('e', 'Tooda — Deep Clean (Grease Trap)', '2026-11-10', 'cancelled'),
  job('f', 'Tooda — Basic Cleaning', '2026-11-03', 'completed'),
  { ...job('g', 'Bacana — Deep Clean (AC)', '2026-11-03', 'completed'), client_id: 'x', client_name: 'Bacana' },
]
const media = new Map([
  ['a', [{ path: 'jobs/a/start_1.jpg', kind: 'photo', section: 'before' }, { path: 'jobs/a/end_1.jpg', kind: 'photo', section: 'after' }]],
  ['b', [{ path: 'jobs/b/end_1.jpg', kind: 'photo', section: 'after' }]],
  ['c', [{ path: 'jobs/c/start_1.jpg', kind: 'photo', section: 'before' }, { path: 'jobs/c/video_1.mp4', kind: 'video', section: 'after' }]],
])
const notes = new Map([['a', 'グリストラップを清掃しました。作業時間は2時間でした。料金は5000円です。次回もよろしくお願いします。']])
const r = buildDeepMonthReport({ month: '2026-11', jobs, media, notes })

assert.equal(r.total.programmed, 4, 'programmed = OTP deep not cancelled')
assert.equal(r.total.done, 3)
assert.equal(r.total.pct, 75)
assert.deepEqual(r.visits.map(v => v.id), ['a'], 'only completed with before AND after photo')
assert.deepEqual(r.excluded.map(x => [x.job.id, x.reasons.join()]), [['b', 'no_before'], ['c', 'no_after']], 'video is not an after photo')
assert.equal(r.visits[0].start, '13:12', 'start time in Tokyo')
assert.ok(!/2時間|5000|円/.test(r.visits[0].notes), 'notes never carry duration or money')
assert.ok(r.visits[0].notes.includes('グリストラップを清掃しました'))
assert.equal(r.days[2].count, 1)
assert.equal(storeOf({ title: 'Ibushio - Deep Clean — グリストラップ' }), 'Ibushio')
assert.equal(serviceOf({ title: 'Nyu Sakana Yakio — Deep Clean (AC Cleaning, Grating, Other)' }), 'AC Cleaning, Grating')

for (const lang of ['ja', 'pt', 'en']) {
  const html = deepMonthReportHtml(r, { lang, signer: 'X', issuer: {} })
  assert.ok(!/99999|1234|14:59|05:59|終了時刻|término|end time|¥/.test(html), `${lang}: no values / end time`)
  assert.ok(html.includes('13:12'), `${lang}: start time shown`)
  assert.ok(!/class="s">Nyu Sakana Yakio/.test(html), `${lang}: excluded visit has no detail section`)
  assert.equal((html.match(/class="visit"/g) || []).length, 1, `${lang}: one visit section`)
  assert.equal((html.match(/class="pg"/g) || []).length, 4, `${lang}: cover + summary + 1 detail + closing`)
}
assert.equal(safeNotes('Limpamos a coifa. Levou 3 horas.').text, 'Limpamos a coifa.')
console.log('deep-month-report: OK')
