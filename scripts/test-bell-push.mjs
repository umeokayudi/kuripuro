#!/usr/bin/env node
// v1.0.171 · Every bell item becomes one clean push (title, body, screen), once only;
// first run or a burst → one summary. Supabase and the push service are mocked.
import assert from 'node:assert/strict'
import webpush from 'web-push'

const keys = webpush.generateVAPIDKeys()
process.env.VAPID_PUBLIC_KEY = keys.publicKey
process.env.VAPID_PRIVATE_KEY = keys.privateKey
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test'
process.env.SALES_SESSION_SECRET = 'x'.repeat(40)
process.env.PUSH_BELL_SECRET = 's3cret'

const { handleBell } = await import('../api/_push.js')
const { bellNotice, bellSummary } = await import('../src/lib/bellPush.js')

let passed = 0
const ok = async (name, fn) => { await fn(); passed++; console.log(`✓ ${name}`) }
const sent = []
webpush.sendNotification = async (sub, payload) => { sent.push({ endpoint: sub.endpoint, ...JSON.parse(payload) }) }

// tiny chainable fake of the Supabase client: push_log keys + admin subscriptions
function fakeDb(log = new Set()) {
  const subs = [{ id: 's1', endpoint: 'https://push/a', p256dh: 'p', auth: 'a', lang: 'pt', fail_count: 0 }, { id: 's2', endpoint: 'https://push/b', p256dh: 'p', auth: 'a', lang: 'ja', fail_count: 0 }]
  return {
    log,
    from(table) {
      const q = { table, filters: [] }
      const run = () => {
        if (table === 'push_subscriptions') return { data: subs, error: null }
        let keys = [...log]
        for (const [k, v] of q.filters) keys = k === 'in' ? keys.filter(x => v.includes(x)) : keys.filter(x => x.startsWith(v.replace('%', '')))
        return { data: keys.map(dedupe_key => ({ dedupe_key })), error: null }
      }
      const chain = {
        select() { return chain }, eq() { return chain }, limit() { return Promise.resolve(run()) },
        in(_c, v) { q.filters.push(['in', v]); return Promise.resolve(run()) },
        like(_c, v) { q.filters.push(['like', v]); return chain },
        insert(row) { if (log.has(row.dedupe_key)) return Promise.resolve({ error: { code: '23505' } }); log.add(row.dedupe_key); return Promise.resolve({ error: null }) },
        upsert(rows) { for (const r of [].concat(rows)) log.add(r.dedupe_key); return Promise.resolve({ error: null }) },
        update() { return { eq: () => Promise.resolve({ error: null }) } },
        delete() { return { eq: () => Promise.resolve({ error: null }) } },
      }
      return chain
    },
  }
}
const res = () => { const r = { code: 0, body: null, status(c) { r.code = c; return r }, json(b) { r.body = b; return r } }; return r }
const req = (query = {}) => ({ method: 'POST', query: { op: 'bell', ...query }, headers: { 'x-push-secret': 's3cret' } })

const ITEMS = [
  { id: 'late:j1', kind: 'late', date: '2026-11-06', place: 'Kodama Kinshicho', who: 'Guilherme', title: 'Basic Cleaning — x', minutes: 35 },
  { id: 'route-none:2026-11-06', kind: 'route_none', date: '2026-11-06', n: 4 },
  { id: 'otp-route:2026-11-06:e1', kind: 'route', date: '2026-11-06', who: 'Gabriel' },
  { id: 'free:2026-11-07:s1', kind: 'free_uncovered', date: '2026-11-07', place: 'Ginza', title: 'Deep Clean' },
  { id: 'eve-unconfirmed:2026-11-07:e2', kind: 'eve_unconfirmed', date: '2026-11-07', who: 'Letícia' },
  { id: 'impossible:2026-11-07:a:e1', kind: 'impossible', date: '2026-11-07', who: 'Alexandre', n: 6, deadline: '10:00' },
  { id: 'cant:2026-11-06:e3', kind: 'cant', date: '2026-11-06', who: 'André', stores: ['Bacana'] },
  { id: 'no_person:j2', kind: 'no_person', date: '2026-11-08', place: 'Atomic', title: 'Basic' },
  { id: 'nojob:2026-11-06:k', kind: 'no_job', date: '2026-11-06', place: 'OTP Shibuya', who: 'Gabriel' },
  { id: 'covered:j3', kind: 'covered', date: '2026-11-05', place: 'Ginza', who: 'A', by: 'B' },
  { id: 'incomplete:j4', kind: 'incomplete', date: '2026-11-04', place: 'Ginza', jobId: 'j4' },
  { id: 'problem:m1', kind: 'problem', text: 'Sem chave', who: 'Gabriel', employeeId: 'e1', jobId: 'j5' },
  { id: 'retro_review:j6', kind: 'retro_review', date: '2026-11-05', place: 'Ginza', jobId: 'j6' },
  { id: 'pay_undefined:j7', kind: 'pay_undefined', date: '2026-11-05', jobId: 'j7' },
  { id: 'long:j8', kind: 'long', minutes: 200, expected: 90, jobId: 'j8' },
  { id: 'no_photo:j9', kind: 'no_photo', jobId: 'j9' },
  { id: 'disputed:e1:2026-10', kind: 'disputed', period: '2026-10' },
  { id: 'group:incomplete', kind: 'incomplete', group: true, items: [{ jobId: 'a' }, { jobId: 'b' }, { jobId: 'c' }] },
  { id: 'qf-book-1', kind: 'to_book', name: 'Bacana', total: 33000, ref: 'req:1' },
  { id: 'qf-done-2', kind: 'flow_done', name: 'Bacana', total: 33000, ref: 'req:2' },
  { id: 'e1:2026-10', kind: 'payroll', period: '2026-10' },
  { id: 'fac:x', kind: 'offer', task_name: 'Filtro do ar', client_name: 'OTP', model_id: 'm1' },
  { id: 'spot-acc-j9', kind: 'taken', title: 'Spot — Ginza', who: 'Gabriel', date: '2026-11-06', time: '14:00' },
]

await ok('every bell kind gives a clean title, body and screen in pt/en/ja', async () => {
  for (const lang of ['pt', 'en', 'ja']) for (const x of ITEMS) {
    const n = bellNotice(x, lang)
    assert.ok(n.title && n.title.length <= 80, `${x.kind} title`)
    assert.ok(n.url.startsWith('/'), `${x.kind} url`)
    assert.ok(!/undefined|null|NaN|\[object/.test(`${n.title} ${n.body} ${n.url}`), `${x.kind} ${lang}: ${n.title} | ${n.body} | ${n.url}`)
    assert.equal(n.tag, `bell-${x.id}`)
  }
  assert.equal(bellNotice(ITEMS[0], 'pt').url, '/live')
  assert.match(bellNotice(ITEMS[0], 'pt').title, /Atrasado · Kodama Kinshicho/)
  assert.equal(bellNotice(ITEMS[13], 'pt').url, '/jobs?search=j7')
  assert.match(bellSummary(ITEMS, 'pt').title, /23 itens novos/)
})

const snap = items => async () => ({ groups: [{ key: 'late', items }, { key: 'dayoff', items: [{ id: 'off1', kind: 'dayoff' }] }, { key: 'waiting', notCounted: true, items: [{ id: 'w1', kind: 'paid_unconfirmed' }] }], count: items.length })

await ok('wrong secret is refused', async () => {
  const r = res(); await handleBell({ ...req(), headers: { 'x-push-secret': 'no' } }, r, { snapshot: snap([]), db: fakeDb() })
  assert.equal(r.code, 401)
})

await ok('first run: one summary to every admin phone, nothing repeated after', async () => {
  const db = fakeDb(); sent.length = 0
  const r = res(); await handleBell(req(), r, { snapshot: snap(ITEMS.slice(0, 2)), db })
  assert.equal(r.body.summary, 2); assert.equal(sent.length, 2)
  assert.match(sent.find(s => s.endpoint.endsWith('/a')).title, /2 itens novos/)
  assert.equal(sent.find(s => s.endpoint.endsWith('/a')).action, 'Abrir')
  assert.ok(db.log.has('bell:late:j1')); assert.ok(!db.log.has('bell:off1'), 'day-off goes by the instant trigger'); assert.ok(!db.log.has('bell:w1'), 'waiting is not pushed')
  sent.length = 0
  const r2 = res(); await handleBell(req(), r2, { snapshot: snap(ITEMS.slice(0, 2)), db })
  assert.equal(r2.body.sent, 0); assert.equal(sent.length, 0)
})

await ok('a new item later: its own notification, in each phone language', async () => {
  const db = fakeDb(new Set(['bell:late:j1'])); sent.length = 0
  const r = res(); await handleBell(req(), r, { snapshot: snap([ITEMS[0], ITEMS[7]]), db })
  assert.equal(sent.length, 2)
  assert.match(sent.find(s => s.endpoint.endsWith('/a')).title, /Sem pessoa · Atomic/)
  assert.match(sent.find(s => s.endpoint.endsWith('/b')).title, /担当なし/)
  assert.equal(sent[0].url, '/schedule')
})

await ok('burst of 5+ new items → one summary', async () => {
  const db = fakeDb(new Set(['bell:x'])); sent.length = 0
  const r = res(); await handleBell(req(), r, { snapshot: snap(ITEMS.slice(0, 6)), db })
  assert.equal(r.body.summary, 6); assert.equal(sent.length, 2)
})

await ok('dry run lists without sending', async () => {
  const db = fakeDb(new Set(['bell:x'])); sent.length = 0
  const r = res(); await handleBell(req({ dry: '1' }), r, { snapshot: snap(ITEMS.slice(0, 3)), db })
  assert.equal(r.body.preview.length, 3); assert.equal(sent.length, 0); assert.equal(db.log.size, 1)
})

console.log(`\n${passed} bell push checks passed`)
