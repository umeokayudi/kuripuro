#!/usr/bin/env node
// The AI tool loop answers every lookup Gemini asks for in one round and stays inside its
// time budget. Gemini is mocked, nothing leaves this machine.
import assert from 'node:assert/strict'

process.env.GEMINI_API_KEY = 'gemini-test'
const { runGeminiToolLoop } = await import('../api/_tool-loop.js')

let script = []
let geminiBodies = []
let delayMs = 0
globalThis.fetch = async (url, opts = {}) => {
  const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  if (String(url).includes('/models?')) return json({ models: [{ name: 'models/gemini-test', supportedGenerationMethods: ['generateContent'] }] })
  geminiBodies.push(JSON.parse(opts.body))
  if (delayMs) {
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, delayMs)
      opts.signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) })
    })
  }
  return json({ candidates: [{ content: { parts: script.shift() || [{ text: 'ok' }] } }] })
}

let passed = 0
const ok = async (name, fn) => { await fn(); passed++; console.log(`✓ ${name}`) }

await ok('several lookups in one Gemini turn are all answered in one round', async () => {
  script = [
    [
      { functionCall: { name: 'query_data', args: { table: 'employees', who: 'sasaki' } } },
      { functionCall: { name: 'query_data', args: { table: 'employees', who: 'alexandre' } } },
      { functionCall: { name: 'query_data', args: { table: 'clients', who: 'super bacana' } } },
    ],
    [{ text: 'Proposta pronta.' }],
  ]
  geminiBodies = []
  const ran = []
  const { reply, toolLog } = await runGeminiToolLoop({
    contents: [{ role: 'user', parts: [{ text: 'marca dia 25' }] }],
    executeTool: async (name, args) => { ran.push(args.who); return [{ id: args.who }] },
  })
  assert.equal(reply, 'Proposta pronta.')
  assert.deepEqual(ran.sort(), ['alexandre', 'sasaki', 'super bacana'])
  assert.equal(toolLog.length, 3)
  assert.equal(geminiBodies.length, 2, 'two model calls, not four')
  const answer = geminiBodies[1].contents.at(-1)
  assert.equal(answer.role, 'user')
  assert.equal(answer.parts.length, 3, 'one functionResponse per functionCall')
})

await ok('stops at the time budget and still answers', async () => {
  script = Array.from({ length: 20 }, () => [{ functionCall: { name: 'query_data', args: { table: 'jobs' } } }])
  geminiBodies = []
  delayMs = 400
  const started = Date.now()
  const { reply } = await runGeminiToolLoop({
    contents: [{ role: 'user', parts: [{ text: 'tudo' }] }],
    executeTool: async () => [],
    maxIterations: 20,
    budgetMs: 6000,
  })
  delayMs = 0
  assert.ok(Date.now() - started < 7000, 'finished inside the budget')
  assert.ok(reply && reply !== '(sem resposta)', `got a reply: ${reply}`)
})

await ok('out of time with canContinue: hands the work back, then the next call finishes it', async () => {
  const { packContinuation, readContinuation, mergeTurns } = await import('../api/_ai-guard.js')
  script = Array.from({ length: 20 }, () => [{ functionCall: { name: 'query_data', args: { table: 'jobs' } } }])
  geminiBodies = []
  delayMs = 400
  const base = mergeTurns([{ role: 'user', parts: [{ text: 'parte 1' }] }, { role: 'user', parts: [{ text: 'parte 2' }] }])
  assert.equal(base.length, 1, 'pieces sent in a row become one turn')
  assert.equal(base[0].parts.length, 2)
  const contents = [...base]
  const first = await runGeminiToolLoop({ contents, executeTool: async () => [{ id: 1 }], maxIterations: 20, budgetMs: 6000, canContinue: true })
  delayMs = 0
  assert.equal(first.incomplete, true)
  assert.equal(first.reply, '')
  const continuation = packContinuation(contents, base.length)
  assert.ok(continuation.length >= 2 && continuation[0].role === 'model')
  const back = readContinuation(JSON.parse(JSON.stringify(continuation)))
  assert.equal(back.length, continuation.length)
  assert.deepEqual(readContinuation([{ role: 'user', parts: [{ inlineData: { data: 'x' } }] }]), [], 'no files smuggled in')
  assert.deepEqual(readContinuation([{ role: 'system', parts: [] }]), [])
  script = [[{ text: 'Tudo pronto.' }]]
  geminiBodies = []
  const second = await runGeminiToolLoop({ contents: [...base, ...back], executeTool: async () => [], canContinue: true })
  assert.equal(second.reply, 'Tudo pronto.')
  assert.equal(geminiBodies[0].contents.length, base.length + back.length, 'the second call sees the earlier lookups')
})

console.log(`\n${passed} tool-loop tests passed`)
