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

// ───────────── v1.0.247 · any client + AI texts (edit wins, hard rules on every text) ─────────────
const { autoTexts, aiFacts, isClientJob, checklistOf, tasksOf } = await import('../src/lib/deepMonthReport.js')
const { resolveTexts, safeAiText } = await import('../src/lib/monthReportText.js')

// OTP via the generic path gives the same numbers as before
const rOtp = buildDeepMonthReport({ month: '2026-11', jobs, media, notes, client: { id: OTP, name: 'On The Planet' } })
assert.deepEqual([rOtp.total.programmed, rOtp.total.done, rOtp.visits.length], [4, 3, 1], 'OTP through the client selector = same report')

// another client (Atomic Bar–like): client_id wins, name only for rows without client_id
const ATOMIC = 'bf3f7ab5-24c4-4ec1-b25f-d91becb166de'
const atomic = { id: ATOMIC, name: 'Atomic Bar' }
const aj = (id, title, date, status, extra = {}) => ({ id, title, client_id: ATOMIC, client_name: 'Atomic Bar', scheduled_date: date, scheduled_time: '00:30', status, value: 88888, employee_pay: 4321, ...extra })
const ajobs = [
  aj('x1', 'Atomic Bar — Deep Clean (Range Hood, Grease Trap, AC Cleaning)', '2026-11-09', 'completed', {
    started_at: '2026-11-09T05:28:48Z', completed_at: '2026-11-09T09:58:00Z',
    checklist_template: 'Range Hood — limpeza completa (filtros, duto, superficie)\nGrease Trap — esvaziado e higienizado\nAC Cleaning — filtros e unidade interna\nLuzes apagadas',
    checklist_total: 4, checklist_done: 3, checklist_missed_items: 'Luzes apagadas', notes_employee: 'Coifa com muita gordura. Levou 4 horas.',
  }),
  aj('x2', 'Atomic Bar — Deep Clean (Coleta de lixo)', '2026-11-13', 'completed'),
  aj('x3', 'Atomic Bar — Deep Clean (Range Hood)', '2026-11-16', 'assigned'),
  aj('x4', 'Atomic Bar — Deep Clean (Coleta de lixo)', '2026-11-06', 'cancelled'),
  aj('x5', 'Atomic Bar — Basic Cleaning', '2026-11-09', 'completed'),
  { ...aj('x6', 'Atomic Bar — Deep Clean (Grating)', '2026-11-10', 'completed'), client_id: null }, // old row: by name
  { ...aj('x7', 'Atomic Bar — Deep Clean (Grating)', '2026-11-10', 'completed'), client_id: 'other' }, // other client, same name
  job('o1', 'Tooda — Deep Clean (Grease Trap)', '2026-11-11', 'completed'),
]
assert.ok(isClientJob(ajobs[5], atomic) && !isClientJob(ajobs[6], atomic) && !isClientJob(ajobs[7], atomic))
const amedia = new Map([
  ['x1', [{ path: 'jobs/x1/start_0.jpg', kind: 'photo', section: 'before' }, { path: 'jobs/x1/start_1.jpg', kind: 'photo', section: 'before' }, { path: 'jobs/x1/end_0.jpg', kind: 'photo', section: 'after' }]],
  ['x6', [{ path: 'jobs/x6/start_0.jpg', kind: 'photo', section: 'before' }]],
])
const ra = buildDeepMonthReport({ month: '2026-11', jobs: [...ajobs, ...jobs], media: amedia, client: atomic })
assert.deepEqual([ra.total.programmed, ra.total.done, ra.visits.length], [4, 3, 1], 'Atomic: 4 programmed, 3 done, 1 with both photos')
assert.deepEqual(ra.excluded.map(x => [x.job.id, x.reasons.join()]), [['x6', 'no_after'], ['x2', 'no_before,no_after']], 'excluded by date, with the reasons')
assert.equal(ra.visits[0].store, 'Atomic Bar')
assert.deepEqual(tasksOf(ajobs[0]).map(t => t.id), ['range_hood', 'grease_trap', 'ac'])
const ck = checklistOf(ajobs[0])
assert.deepEqual([ck.recorded, ck.done, ck.total, ck.missed], [true, 3, 4, ['Luzes apagadas']])
assert.ok(!/4 horas/.test(ra.visits[0].workerNote) && /gordura/.test(ra.visits[0].workerNote), 'worker note loses the duration sentence')

// what the AI receives: no times, no durations, no values, no employee names
const facts = JSON.stringify(aiFacts(ra, { lang: 'pt', clientName: 'Atomic Bar', today: '2026-11-13' }))
assert.ok(!/88888|4321|05:28|14:28|09:58|18:58|started_at|completed_at|employee|horas|Levou/.test(facts), 'AI facts: nothing forbidden')
assert.ok(/Luzes apagadas/.test(facts) && /not_done_items/.test(facts), 'AI knows what was NOT done')

// texts: automatic fallback, AI wins over it, the admin's edit wins over the AI, rules on all three
for (const lang of ['ja', 'pt', 'en']) {
  const auto = autoTexts(ra, { lang, clientName: 'Atomic Bar', today: '2026-11-13' })
  assert.ok(auto.intro && auto.closing && auto.visits.x1, `${lang}: automatic texts exist`)
  for (const t of [auto.intro, auto.closing, auto.visits.x1]) assert.equal(safeAiText(t).removed, 0, `${lang}: automatic text breaks no rule: ${t}`)
  assert.ok(!/(cada visita|every visit|各訪問)/i.test(auto.closing), `${lang}: closing does not claim photos for visits that have none`)
}
const auto = autoTexts(ra, { lang: 'pt', clientName: 'Atomic Bar', today: '2026-11-13' })
const aiOut = {
  intro: 'Em novembro realizamos 3 limpezas profundas. O serviço começou às 14:28 e levou 4 horas. O valor foi de ¥30.000.',
  closing: 'Agradecemos a confiança.',
  visits: { x1: 'Limpamos a coifa, a caixa de gordura e o ar-condicionado.', ghost: 'visita inventada' },
}
const t1 = resolveTexts({ auto, ai: aiOut, edits: { visits: {} } })
assert.equal(t1.intro.source, 'ai')
assert.equal(t1.intro.text, 'Em novembro realizamos 3 limpezas profundas.', 'AI sentences with time/duration/value are dropped')
assert.ok(t1.intro.removed === 2)
assert.ok(!('ghost' in t1.visits), 'AI text of a visit that is not in the report is ignored')
const t2 = resolveTexts({ auto, ai: aiOut, edits: { closing: 'Entregamos tudo o que foi combinado. Terminou às 18:00.', visits: { x1: 'Texto do admin.' } } })
assert.deepEqual([t2.closing.source, t2.closing.text], ['edited', 'Entregamos tudo o que foi combinado.'], 'edit wins, still under the rules')
assert.deepEqual([t2.visits.x1.source, t2.visits.x1.text], ['edited', 'Texto do admin.'])
const t3 = resolveTexts({ auto, ai: { intro: '' }, edits: {} })
assert.equal(t3.intro.source, 'auto', 'AI empty → automatic text')
for (const lang of ['ja', 'pt', 'en']) {
  const html = deepMonthReportHtml(ra, { lang, clientName: 'Atomic Bar', signer: 'X', issuer: {}, texts: lang === 'pt' ? t2 : undefined })
  assert.ok(html.includes('Atomic Bar'), `${lang}: cover has the client name`)
  assert.ok(!/88888|4321|09:58|18:58|18:00|4 horas|¥|Terminou/.test(html), `${lang}: no values / end time / duration in the PDF`)
  assert.ok(html.includes('14:28'), `${lang}: start time shown (Tokyo)`)
  assert.equal((html.match(/class="visit"/g) || []).length, 1, `${lang}: only the visit with both photos`)
  assert.ok(html.includes('class="why"'), `${lang}: "what was done and why" block`)
  if (lang === 'pt') assert.ok(html.includes('Texto do admin.') && html.includes('Entregamos tudo o que foi combinado.'), 'pt: edited texts are the ones in the PDF')
}
// a client with no visit with both photos: summary + closing only
const rNone = buildDeepMonthReport({ month: '2026-11', jobs: ajobs, media: new Map(), client: atomic })
assert.equal((deepMonthReportHtml(rNone, { lang: 'ja', clientName: 'Atomic Bar', issuer: {} }).match(/class="pg"/g) || []).length, 3, 'no visits: cover + summary + closing')
console.log('client-month-report (v1.0.247): OK')
