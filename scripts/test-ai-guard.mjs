#!/usr/bin/env node
// Admin AI writes wait for the approval password; employee AI stays in its own account.
// Gemini and Supabase are mocked, nothing leaves this machine.
import assert from 'node:assert/strict'

process.env.SALES_SESSION_SECRET = 'x'.repeat(40)
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test'
process.env.GEMINI_API_KEY = 'gemini-test'
process.env.AI_APPROVAL_PASSWORD = 'Autoriza#2026'

const guard = await import('../api/_ai-guard.js')
const session = await import('../api/_salesSession.js')
const adminAi = (await import('../api/admin-ai.js')).default
const employeeAi = (await import('../api/employee-ai.js')).default

let passed = 0
const ok = (name, fn) => Promise.resolve(fn()).then(() => { passed++; console.log(`✓ ${name}`) })

// ── fetch mock: Gemini script + Supabase log ──
let geminiScript = []
let supabaseCalls = []
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url)
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  if (u.includes('generativelanguage') && u.includes('/models?')) return json({ models: [{ name: 'models/gemini-test', supportedGenerationMethods: ['generateContent'] }] })
  if (u.includes('generativelanguage')) return json({ candidates: [{ content: { parts: [geminiScript.shift() || { text: 'ok' }] } }] })
  if (u.includes('supabase.co')) {
    supabaseCalls.push({ url: u, method: opts.method || 'GET' })
    if (u.includes('/employees?')) return json({ is_active: true })
    return json([{ id: 'row-1', status: 'pending', admin_note: 'segredo', amount: 1200, claim_date: '2026-10-01' }])
  }
  throw new Error(`unexpected fetch ${u}`)
}

function cookieFor(user) {
  return `kp_sales_session=${session.createSalesSession(user)}`
}

function call(handler, { body, cookie }) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k] = v },
      status(code) { this.statusCode = code; return this },
      json(data) { resolve({ status: this.statusCode, data }) },
    }
    handler({ method: 'POST', body, headers: { cookie: cookie || '' } }, res)
  })
}

const admin = { id: 'admin-1', role: 'admin', name: 'Admin', email: 'a@x' }
const employee = { id: 'emp-1', role: 'employee', name: 'Ana', email: 'e@x' }

await ok('pending rows hide the decision fields', () => {
  const [row] = guard.maskPendingRows([{ id: 1, status: 'pending', admin_note: 'no', amount: 5 }])
  assert.deepEqual(row, { status: 'waiting_for_admin', id: 1, amount: 5 })
  assert.equal(guard.maskPendingRows([{ id: 2, status: 'approved', admin_note: 'ok' }])[0].admin_note, 'ok')
})

await ok('history keeps only recent turns, starting with the user', () => {
  const msgs = Array.from({ length: 15 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: String(i) }))
  const out = guard.trimHistory(msgs)
  assert.ok(out.length <= guard.MAX_HISTORY)
  assert.equal(out[0].role, 'user')
})

await ok('approval token rejects tampering and other admins', () => {
  const token = guard.createApprovalToken('admin-1', [{ name: 'delete_data', table: 'jobs', filters: { id: 1 } }])
  assert.equal(guard.readApprovalToken(token, 'admin-1').length, 1)
  assert.equal(guard.readApprovalToken(token, 'admin-2'), null)
  const [p, s] = token.split('.')
  const forged = Buffer.from(JSON.stringify({ sub: 'admin-1', actions: [{ name: 'delete_data', table: 'employees', filters: { id: 9 } }], exp: 9e9 })).toString('base64url')
  assert.equal(guard.readApprovalToken(`${forged}.${s}`, 'admin-1'), null)
  assert.equal(guard.readApprovalToken(`${p}.bad`, 'admin-1'), null)
})

await ok('admin AI refuses without an admin session', async () => {
  const r = await call(adminAi, { body: { messages: [{ role: 'user', content: 'oi' }] } })
  assert.equal(r.status, 401)
  const r2 = await call(adminAi, { body: { messages: [{ role: 'user', content: 'oi' }] }, cookie: cookieFor(employee) })
  assert.equal(r2.status, 401)
})

let pending
await ok('admin AI proposes a change without writing it', async () => {
  supabaseCalls = []
  geminiScript = [
    { functionCall: { name: 'update_data', args: { table: 'jobs', filters: { id: 'job-9' }, changes: { status: 'cancelled' } } } },
    { text: 'Vou cancelar o serviço job-9. Autorize com a senha.' },
  ]
  const r = await call(adminAi, { body: { messages: [{ role: 'user', content: 'cancela o job-9' }] }, cookie: cookieFor(admin) })
  assert.equal(r.status, 200)
  assert.equal(supabaseCalls.filter(c => c.method !== 'GET').length, 0, 'nothing written yet')
  pending = r.data.pendingApproval
  assert.ok(pending?.token)
  assert.equal(pending.changes[0].kind, 'update')
  assert.match(pending.changes[0].text, /status: cancelled/)
})

await ok('wrong password does not write', async () => {
  supabaseCalls = []
  const r = await call(adminAi, { body: { authorize: pending.token, password: 'errada' }, cookie: cookieFor(admin) })
  assert.equal(r.status, 401)
  assert.equal(supabaseCalls.length, 0)
})

await ok('right password writes once, and the same authorization cannot run twice', async () => {
  supabaseCalls = []
  const r = await call(adminAi, { body: { authorize: pending.token, password: 'Autoriza#2026' }, cookie: cookieFor(admin) })
  assert.equal(r.status, 200)
  assert.equal(r.data.executed, 1)
  assert.equal(supabaseCalls.filter(c => c.method === 'PATCH').length, 1)
  const again = await call(adminAi, { body: { authorize: pending.token, password: 'Autoriza#2026' }, cookie: cookieFor(admin) })
  assert.equal(again.status, 410)
})

await ok('employee AI needs an employee session and ignores a forged employeeId', async () => {
  const anon = await call(employeeAi, { body: { messages: [{ role: 'user', content: 'oi' }], employeeId: 'emp-2' } })
  assert.equal(anon.status, 401)
  supabaseCalls = []
  geminiScript = [
    { functionCall: { name: 'query_my_data', args: { table: 'transport_claims', select: '*,employees(password,account_number)', filters: { employee_id: 'emp-2' } } } },
    { text: 'Seu pedido está aguardando o admin.' },
  ]
  const r = await call(employeeAi, { body: { messages: [{ role: 'user', content: 'meu reembolso?' }], employeeId: 'emp-2' }, cookie: cookieFor(employee) })
  assert.equal(r.status, 200)
  const q = supabaseCalls.find(c => c.url.includes('/transport_claims?'))
  assert.ok(q, 'queried claims')
  assert.match(q.url, /employee_id=eq\.emp-1/)
  assert.doesNotMatch(q.url, /emp-2/)
  assert.doesNotMatch(decodeURIComponent(q.url), /employees\(|password/)
})

console.log(`\n${passed} checks passed`)
