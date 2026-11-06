#!/usr/bin/env node
// Web Push: who receives each event, once only, and in their language.
// Supabase and the push service are mocked, nothing leaves this machine.
import assert from 'node:assert/strict'
import webpush from 'web-push'

const keys = webpush.generateVAPIDKeys()
process.env.VAPID_PUBLIC_KEY = keys.publicKey
process.env.VAPID_PRIVATE_KEY = keys.privateKey
process.env.SALES_SESSION_SECRET = 'x'.repeat(40)
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test'

const { default: push, noticesFor } = await import('../api/_push.js')
const { createSalesSession } = await import('../api/_salesSession.js')

let passed = 0
const ok = async (name, fn) => { await fn(); passed++; console.log(`✓ ${name}`) }

// ── in-memory Supabase REST ──
const db = { rows: {}, log: new Set(), subs: [] }
const sent = []
webpush.sendNotification = async (sub, payload) => {
  if (sub.endpoint.includes('gone')) { const e = new Error('gone'); e.statusCode = 410; throw e }
  sent.push({ endpoint: sub.endpoint, ...JSON.parse(payload) })
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url)
  const table = u.pathname.split('/').pop()
  const method = init.method || 'GET'
  const eq = k => u.searchParams.get(k)?.replace(/^eq\./, '')
  if (table === 'push_log') {
    if (method === 'POST') {
      const row = JSON.parse(init.body)
      if (db.log.has(row.dedupe_key)) return json({ code: '23505', message: 'duplicate key' }, 409)
      db.log.add(row.dedupe_key); return json(null, 201)
    }
    return json(null, 204)
  }
  if (table === 'push_subscriptions') {
    if (method === 'GET') {
      return json(db.subs.filter(s => (!eq('role') || s.role === eq('role')) && (!eq('user_id') || s.user_id === eq('user_id')) && (!eq('client_id') || s.client_id === eq('client_id'))))
    }
    if (method === 'DELETE') { db.subs = db.subs.filter(s => s.id !== eq('id') && s.endpoint !== eq('endpoint')); return json(null, 204) }
    if (method === 'POST') { const row = JSON.parse(init.body); db.subs = db.subs.filter(s => s.endpoint !== row.endpoint); db.subs.push({ id: `s${db.subs.length + 9}`, ...row }); return json(null, 201) }
    return json(null, 204)
  }
  if (table === 'client_users') return json(eq('id') === 'cu-1' ? { id: 'cu-1', client_id: 'cl-1', is_active: true } : null)
  return json(db.rows[`${table}:${eq('id')}`] || null)
}

const call = async (op, body, cookie) => {
  const out = {}
  const res = { status(code) { out.status = code; return this }, json(data) { out.body = data; return this } }
  await push({ method: 'POST', query: { op }, body, headers: cookie ? { cookie } : {} }, res)
  return out
}

db.subs.push(
  { id: 'a1', endpoint: 'https://push.test/admin1', p256dh: 'p', auth: 'a', role: 'admin', user_id: 'ad-1', lang: 'pt' },
  { id: 'e1', endpoint: 'https://push.test/emp1', p256dh: 'p', auth: 'a', role: 'employee', user_id: 'em-1', lang: 'en' },
  { id: 'e2', endpoint: 'https://push.test/gone', p256dh: 'p', auth: 'a', role: 'employee', user_id: 'em-1', lang: 'en' },
  { id: 'c1', endpoint: 'https://push.test/cli1', p256dh: 'p', auth: 'a', role: 'client', user_id: 'cu-1', client_id: 'cl-1', lang: 'ja' },
)

await ok('employee message goes to admins, in Portuguese', async () => {
  db.rows['messages:m1'] = { id: 'm1', employee_id: 'em-1', employee_name: 'Letícia', sender: 'employee', content: 'Cheguei no local' }
  const r = await call('event', { table: 'messages', op: 'INSERT', id: 'm1' })
  assert.equal(r.status, 200)
  assert.deepEqual(sent.map(s => s.endpoint), ['https://push.test/admin1'])
  assert.equal(sent[0].title, '💬 Letícia')
  assert.equal(sent[0].body, 'Cheguei no local')
})

await ok('same event twice is sent once', async () => {
  sent.length = 0
  const r = await call('event', { table: 'messages', op: 'INSERT', id: 'm1' })
  assert.equal(r.body.results[0].skipped, 'duplicate')
  assert.equal(sent.length, 0)
})

await ok('admin reply goes to that employee; dead subscription is removed', async () => {
  db.rows['messages:m2'] = { id: 'm2', employee_id: 'em-1', sender: 'admin', content: 'Ok, obrigado' }
  await call('event', { table: 'messages', op: 'INSERT', id: 'm2' })
  assert.deepEqual(sent.map(s => s.endpoint), ['https://push.test/emp1'])
  assert.equal(sent[0].url, '/?tab=chat')
  assert.ok(!db.subs.some(s => s.id === 'e2'))
})

await ok('day off approved reaches the employee, not on unrelated edits', async () => {
  sent.length = 0
  db.rows['employee_availability:o1'] = { id: 'o1', employee_id: 'em-1', employee_name: 'Letícia', date: '2026-11-03', kind: 'off', status: 'approved' }
  await call('event', { table: 'employee_availability', op: 'UPDATE', id: 'o1', old: { status: 'pending' } })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].title, '✅ Day off approved')
  assert.equal(noticesFor('employee_availability', 'UPDATE', { ...db.rows['employee_availability:o1'], status: 'pending' }, {}).length, 0)
})

await ok('admin chat reply to a client arrives in Japanese', async () => {
  sent.length = 0
  db.rows['client_messages:c1'] = { id: 'c1', client_id: 'cl-1', client_user_id: 'cu-1', sender: 'admin', content: '明日伺います' }
  await call('event', { table: 'client_messages', op: 'INSERT', id: 'c1' })
  assert.deepEqual(sent.map(s => s.endpoint), ['https://push.test/cli1'])
  assert.equal(sent[0].title, '💬 KuriPuroからのメッセージ')
})

await ok('invoice sent and job completed notify the client company', async () => {
  const fat = noticesFor('faturas', 'UPDATE', { id: 'f1', client_id: 'cl-1', status: 'sent', total: 33000 }, { status: 'draft' })
  assert.equal(fat[0].to.clientId, 'cl-1')
  assert.match(fat[0].msg('ja').body, /33,000/)
  assert.equal(noticesFor('faturas', 'UPDATE', { id: 'f1', client_id: 'cl-1', status: 'paid' }, { status: 'sent' }).length, 0)
  const job = noticesFor('jobs', 'UPDATE', { id: 'j1', client_id: 'cl-1', status: 'completed', title: '店舗清掃' }, { status: 'in_progress' })
  assert.equal(job.length, 1)
})

await ok('schedule generator burst: one "new job" per employee per 10 minutes', async () => {
  const future = '2099-01-01'
  const a = noticesFor('jobs', 'INSERT', { id: 'j2', employee_id: 'em-1', status: 'assigned', scheduled_date: future }, {})
  const b = noticesFor('jobs', 'INSERT', { id: 'j3', employee_id: 'em-1', status: 'assigned', scheduled_date: future }, {})
  assert.equal(a[0].key, b[0].key)
  assert.equal(noticesFor('jobs', 'INSERT', { id: 'j4', employee_id: 'em-1', status: 'assigned', scheduled_date: '2000-01-01' }, {}).length, 0)
})

await ok('quote request reaches admin and the store seller; quote ready reaches the client', async () => {
  const n = noticesFor('client_requests', 'INSERT', { id: 'q1', client_id: 'cl-1', request_type: 'quote', salesperson_id: 'sp-1', location_name: '渋谷店' }, {})
  assert.deepEqual(n.map(x => x.to.role), ['admin', 'salesperson'])
  const q = noticesFor('client_requests', 'UPDATE', { id: 'q1', client_id: 'cl-1', client_user_id: 'cu-1', request_type: 'quote', quote_status: 'quoted' }, { quote_status: 'priced' })
  assert.equal(q[0].to.id, 'cu-1')
})

await ok('seller notices from the app are forwarded to that seller', async () => {
  const n = noticesFor('sales_notifications', 'INSERT', { id: 'n1', audience: 'seller', salesperson_id: 'sp-1', title: 'Novo lead', body: 'Ramen Taro' }, {})
  assert.equal(n[0].to.id, 'sp-1')
  assert.equal(n[0].msg('pt').title, 'Novo lead')
})

await ok('subscribe: admin from cookie, client only when the login exists', async () => {
  const cookie = `kp_sales_session=${createSalesSession({ id: 'ad-2', role: 'admin', name: 'A', email: 'a@x' })}`
  const sub = { endpoint: 'https://push.test/new', keys: { p256dh: 'p', auth: 'a' } }
  let r = await call('subscribe', { subscription: sub, role: 'employee', user_id: 'em-1', lang: 'pt' }, cookie)
  assert.equal(r.status, 200)
  const saved = db.subs.find(s => s.endpoint === 'https://push.test/new')
  assert.equal(saved.role, 'admin') // the cookie wins over whatever the page claims
  assert.equal(saved.user_id, 'ad-2')
  r = await call('subscribe', { subscription: { ...sub, endpoint: 'https://push.test/c2' }, role: 'client', user_id: 'nobody' })
  assert.equal(r.status, 401)
  r = await call('subscribe', { subscription: { ...sub, endpoint: 'https://push.test/c2' }, role: 'client', user_id: 'cu-1', lang: 'ja' })
  assert.equal(r.status, 200)
  assert.equal(db.subs.find(s => s.endpoint === 'https://push.test/c2').client_id, 'cl-1')
  r = await call('subscribe', { subscription: { ...sub, endpoint: 'https://push.test/x' }, role: 'employee', user_id: 'em-1' })
  assert.equal(r.status, 401) // employees need their login cookie
})

await ok('unknown table or op is refused', async () => {
  const r = await call('event', { table: 'admins', op: 'INSERT', id: 'x' })
  assert.equal(r.status, 400)
})

console.log(`\n${passed} push checks passed`)
