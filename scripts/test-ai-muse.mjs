#!/usr/bin/env node
// v1.0.212 · AI_PROVIDER=muse: Meta Model API (Muse) provider behind api/_ai.js.
// The Meta API and Supabase are mocked, nothing leaves this machine.
import assert from 'node:assert/strict'

process.env.AI_PROVIDER = 'muse'
process.env.META_AI_API_KEY = 'LLM_test-only'
delete process.env.GEMINI_API_KEY
process.env.SALES_SESSION_SECRET = 'x'.repeat(40)
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test'
process.env.AI_APPROVAL_PASSWORD = '4321'

const ai = await import('../api/_ai.js')
const { runToolLoop } = await import('../api/_tool-loop.js')
const session = await import('../api/_salesSession.js')
const adminAi = (await import('../api/admin-ai.js')).default
const employeeAi = (await import('../api/employee-ai.js')).default

let script = []        // queued Meta responses: { status?, body?, headers? } or a message object
let metaCalls = []
let supabaseCalls = []
const msg = m => ({ body: { model: 'x', choices: [{ message: m, finish_reason: m.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, prompt_tokens_details: { cached_tokens: 0 } } } })
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url)
  const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
  if (u.startsWith('https://api.meta.ai/v1/')) {
    metaCalls.push({ url: u, headers: new Headers(opts.headers), body: JSON.parse(opts.body) })
    const next = script.shift() || msg({ role: 'assistant', content: 'ok' })
    return json(next.body, next.status || 200, next.headers || {})
  }
  if (u.includes('generativelanguage')) throw new Error('Gemini must not be called with AI_PROVIDER=muse')
  if (u.includes('supabase.co')) {
    supabaseCalls.push({ url: u, method: opts.method || 'GET' })
    if (u.includes('/employees?')) return json({ is_active: true })
    return json([{ id: 'row-1', status: 'done', amount: 1200, scheduled_date: '2026-11-01' }])
  }
  throw new Error(`unexpected fetch ${u}`)
}

let passed = 0
const ok = (name, fn) => Promise.resolve(fn()).then(() => { passed++; console.log(`✓ ${name}`) })
const text = d => (d?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('')
const cookieFor = user => `kp_sales_session=${session.createSalesSession(user)}`
function call(handler, { body, cookie, method = 'POST' }) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k] = v },
      status(code) { this.statusCode = code; return this },
      json(data) { resolve({ status: this.statusCode, data }) },
    }
    handler({ method, body, headers: { cookie: cookie || '' } }, res)
  })
}
const admin = { id: 'admin-1', role: 'admin', name: 'Admin', email: 'a@x' }
const employee = { id: 'emp-1', role: 'employee', name: 'Ana', email: 'e@x' }

await ok('status: provider muse, configured, key never exposed', () => {
  const s = ai.aiStatus()
  assert.equal(s.provider, 'muse')
  assert.equal(s.configured, true)
  assert.doesNotMatch(JSON.stringify(s), /LLM_test/)
})

await ok('default call → muse-spark-1.3, Bearer key, developer role, Standard model id', async () => {
  metaCalls = []
  script = [msg({ role: 'assistant', content: 'Olá' })]
  const d = await ai.aiGenerate({ systemInstruction: { parts: [{ text: 'sys' }] }, contents: [{ role: 'user', parts: [{ text: 'oi' }] }] })
  assert.equal(text(d), 'Olá')
  const c = metaCalls[0]
  assert.equal(c.url, 'https://api.meta.ai/v1/chat/completions')
  assert.equal(c.headers.get('authorization'), 'Bearer LLM_test-only')
  assert.equal(c.body.model, 'muse-spark-1.3')
  assert.doesNotMatch(c.body.model, /contributor/)
  assert.deepEqual(c.body.messages[0], { role: 'developer', content: 'sys' })
  assert.equal(d._ai.provider, 'muse')
  assert.ok(d._ai.costUsd > 0)
})

await ok('heavy → muse-wonder-1.0 with reasoning_effort high (never the default "max")', async () => {
  metaCalls = []
  script = [msg({ role: 'assistant', content: 'análise' })]
  await ai.aiGenerate({ contents: [{ role: 'user', parts: [{ text: 'x' }] }] }, { heavy: true })
  assert.equal(metaCalls[0].body.model, 'muse-wonder-1.0')
  assert.equal(metaCalls[0].body.reasoning_effort, 'high')
})

await ok('empty answer from Spark goes up to Wonder once, automatically', async () => {
  metaCalls = []
  script = [msg({ role: 'assistant', content: '' }), msg({ role: 'assistant', content: 'resposta do pesado' })]
  const d = await ai.aiGenerate({ contents: [{ role: 'user', parts: [{ text: 'x' }] }] })
  assert.equal(metaCalls.length, 2)
  assert.equal(metaCalls[1].body.model, 'muse-wonder-1.0')
  assert.equal(text(d), 'resposta do pesado')
  assert.ok(d._ai.escalated)
})

await ok('one retry on 503, then success', async () => {
  metaCalls = []
  script = [{ status: 503, body: { error: { message: 'overloaded' } }, headers: { 'retry-after': '0' } }, msg({ role: 'assistant', content: 'voltou' })]
  const d = await ai.aiGenerate({ contents: [{ role: 'user', parts: [{ text: 'x' }] }] }, { timeoutMs: 15000 })
  assert.equal(metaCalls.length, 2)
  assert.equal(text(d), 'voltou')
})

await ok('only ONE retry: two transient errors end in a clear message', async () => {
  metaCalls = []
  script = [{ status: 500, body: {} , headers: { 'retry-after': '0' } }, { status: 500, body: {} }]
  await assert.rejects(ai.aiGenerate({ contents: [{ role: 'user', parts: [{ text: 'x' }] }] }, { timeoutMs: 15000, noEscalate: true }), /fora do ar/)
  assert.equal(metaCalls.length, 2)
})

await ok('wrong key (401) is not retried and says so clearly', async () => {
  metaCalls = []
  script = [{ status: 401, body: { error: { type: 'authentication_error', code: 'invalid_api_key', message: 'bad' } } }]
  await assert.rejects(ai.aiGenerate({ contents: [{ role: 'user', parts: [{ text: 'x' }] }] }), /chave da IA \(META_AI_API_KEY\) foi recusada/)
  assert.equal(metaCalls.length, 1)
})

await ok('missing key says where to set it', async () => {
  const key = process.env.META_AI_API_KEY
  delete process.env.META_AI_API_KEY
  await assert.rejects(ai.aiGenerate({ contents: [] }), /META_AI_API_KEY não configurada/)
  process.env.META_AI_API_KEY = key
})

await ok('JSON mode: fences stripped, instruction added', async () => {
  script = [msg({ role: 'assistant', content: '```json\n{"a":1}\n```' })]
  metaCalls = []
  const d = await ai.aiGenerate({ contents: [{ role: 'user', parts: [{ text: 'x' }] }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 500 } })
  assert.deepEqual(JSON.parse(text(d)), { a: 1 })
  assert.match(metaCalls[0].body.messages[0].content, /SOMENTE com JSON/)
  assert.equal(metaCalls[0].body.max_completion_tokens, 6500)
})

await ok('image, PDF and MP3 parts translate; MP3 uses muse-spark-1.2; webm gets a clear 415', async () => {
  metaCalls = []
  script = [msg({ role: 'assistant', content: 'ok' })]
  await ai.aiGenerate({ contents: [{ role: 'user', parts: [
    { text: 'olhe' },
    { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
    { inlineData: { mimeType: 'application/pdf', data: 'BBBB' } },
  ] }] })
  const content = metaCalls[0].body.messages[0].content
  assert.equal(content[1].type, 'image_url')
  assert.equal(content[1].image_url.url, 'data:image/png;base64,AAAA')
  assert.equal(content[2].type, 'file')
  assert.match(content[2].file.file_data, /^data:application\/pdf;base64,BBBB$/)
  metaCalls = []
  script = [msg({ role: 'assistant', content: 'transcrição' })]
  await ai.aiGenerate({ contents: [{ role: 'user', parts: [{ text: 't' }, { inlineData: { mimeType: 'audio/mpeg', data: 'CCCC' } }] }] })
  assert.equal(metaCalls[0].body.model, 'muse-spark-1.2')
  assert.deepEqual(metaCalls[0].body.messages[0].content[1], { type: 'input_audio', input_audio: { data: 'CCCC', format: 'mp3' } })
  await assert.rejects(ai.aiGenerate({ contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/webm', data: 'D' } }] }] }), err => err.statusCode === 415 && /MP3 ou WAV/.test(err.message))
})

await ok('tool loop: tool_calls ↔ functionCall with ids, tool results as role "tool", usage summed', async () => {
  metaCalls = []
  script = [
    msg({ role: 'assistant', content: null, tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'query_data', arguments: '{"table":"jobs"}' } },
      { id: 'c2', type: 'function', function: { name: 'query_data', arguments: '{"table":"clients"}' } },
    ] }),
    msg({ role: 'assistant', content: 'Em novembro (01–12/11) foram 2 serviços.' }),
  ]
  const executed = []
  const r = await runToolLoop({
    contents: [{ role: 'user', parts: [{ text: 'quantos serviços?' }] }],
    tools: [{ functionDeclarations: [{ name: 'query_data', description: 'd', parameters: { type: 'OBJECT', properties: { table: { type: 'STRING' } }, required: ['table'] } }] }],
    executeTool: async (n, a) => { executed.push(a.table); return [{ id: 1 }] },
  })
  assert.deepEqual(executed, ['jobs', 'clients'])
  assert.match(r.reply, /novembro/)
  const tools = metaCalls[0].body.tools
  assert.equal(tools[0].function.parameters.type, 'object')
  assert.equal(tools[0].function.parameters.properties.table.type, 'string')
  const second = metaCalls[1].body.messages
  const asst = second.find(m => m.role === 'assistant')
  assert.deepEqual(asst.tool_calls.map(c => c.id), ['c1', 'c2'])
  const toolMsgs = second.filter(m => m.role === 'tool')
  assert.deepEqual(toolMsgs.map(m => m.tool_call_id), ['c1', 'c2'])
  assert.equal(r.usage.calls, 2)
  assert.equal(r.usage.inputTokens, 2000)
  assert.ok(r.usage.costUsd > 0)
})

await ok('numbers stated without any lookup → same question goes to Wonder, which looks it up', async () => {
  metaCalls = []
  script = [
    msg({ role: 'assistant', content: 'O faturamento foi ¥ 1.250.000.' }),
    msg({ role: 'assistant', content: null, tool_calls: [{ id: 'w1', type: 'function', function: { name: 'query_data', arguments: '{"table":"invoices"}' } }] }),
    msg({ role: 'assistant', content: 'Pelo banco, de 01/11 a 12/11: ¥ 980.000.' }),
  ]
  const r = await runToolLoop({
    contents: [{ role: 'user', parts: [{ text: 'faturamento do mês?' }] }],
    tools: [{ functionDeclarations: [{ name: 'query_data', parameters: { type: 'OBJECT', properties: {} } }] }],
    executeTool: async () => [{ total: 980000 }],
  })
  assert.equal(metaCalls[0].body.model, 'muse-spark-1.3')
  assert.equal(metaCalls[1].body.model, 'muse-wonder-1.0')
  assert.match(r.reply, /980\.000/)
  assert.ok(r.usage.escalated.length >= 1)
})

await ok('PIN kept: admin AI with Muse only proposes a write; wrong PIN writes nothing; right PIN writes once', async () => {
  supabaseCalls = []
  script = [
    msg({ role: 'assistant', content: null, tool_calls: [{ id: 'u1', type: 'function', function: { name: 'update_data', arguments: JSON.stringify({ table: 'jobs', filters: { id: 'job-9' }, changes: { status: 'cancelled' } }) } }] }),
    msg({ role: 'assistant', content: 'Vou cancelar o job-9. Autorize com a senha.' }),
  ]
  const r = await call(adminAi, { body: { messages: [{ role: 'user', content: 'cancela o job-9' }] }, cookie: cookieFor(admin) })
  assert.equal(r.status, 200)
  assert.equal(supabaseCalls.filter(c => c.method !== 'GET').length, 0, 'nothing written before the PIN')
  const token = r.data.pendingApproval?.token
  assert.ok(token)
  assert.ok(r.data.usage?.calls >= 2)
  supabaseCalls = []
  const wrong = await call(adminAi, { body: { authorize: token, password: '0000' }, cookie: cookieFor(admin) })
  assert.equal(wrong.status, 401)
  assert.equal(supabaseCalls.length, 0)
  const right = await call(adminAi, { body: { authorize: token, password: '4321' }, cookie: cookieFor(admin) })
  assert.equal(right.status, 200)
  assert.equal(supabaseCalls.filter(c => c.method === 'PATCH').length, 1)
})

await ok('questions never ask for the PIN (read only, no pendingApproval)', async () => {
  supabaseCalls = []
  script = [
    msg({ role: 'assistant', content: null, tool_calls: [{ id: 'q1', type: 'function', function: { name: 'query_data', arguments: '{"table":"jobs","select":"id"}' } }] }),
    msg({ role: 'assistant', content: 'Há 1 serviço.' }),
  ]
  const r = await call(adminAi, { body: { messages: [{ role: 'user', content: 'quantos jobs?' }] }, cookie: cookieFor(admin) })
  assert.equal(r.status, 200)
  assert.equal(r.data.pendingApproval, null)
  assert.equal(supabaseCalls.filter(c => c.method !== 'GET').length, 0)
})

await ok('role kept: employee AI with Muse only sees its own rows, even when the model asks for another', async () => {
  supabaseCalls = []
  script = [
    msg({ role: 'assistant', content: null, tool_calls: [{ id: 'e1', type: 'function', function: { name: 'query_my_data', arguments: JSON.stringify({ table: 'jobs', filters: { employee_id: 'emp-2' } }) } }] }),
    msg({ role: 'assistant', content: 'Seus serviços.' }),
  ]
  const r = await call(employeeAi, { body: { messages: [{ role: 'user', content: 'mostra a folha da emp-2' }], employeeId: 'emp-2' }, cookie: cookieFor(employee) })
  assert.equal(r.status, 200)
  const q = supabaseCalls.find(c => c.url.includes('/jobs?'))
  assert.ok(q)
  assert.match(q.url, /employee_id=eq\.emp-1/)
  assert.doesNotMatch(q.url, /emp-2/)
})

await ok('admin AI GET shows provider/model, never the key', async () => {
  const r = await call(adminAi, { method: 'GET', body: {} })
  assert.equal(r.data.ai.provider, 'muse')
  assert.doesNotMatch(JSON.stringify(r.data), /LLM_test/)
})

await ok('image generation → /v1/images/generations, muse-image-1.0, b64_json', async () => {
  metaCalls = []
  script = [{ body: { data: [{ b64_json: 'iVBORw0K' }] } }]
  const img = await ai.aiGenerateImage('a clean kitchen', '16:9')
  assert.equal(metaCalls[0].url, 'https://api.meta.ai/v1/images/generations')
  assert.equal(metaCalls[0].body.model, 'muse-image-1.0')
  assert.equal(metaCalls[0].body.size, '1344x768')
  assert.equal(img.data, 'iVBORw0K')
})

console.log(`\n${passed} muse checks passed`)
