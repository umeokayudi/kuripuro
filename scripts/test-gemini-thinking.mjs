#!/usr/bin/env node
// The AI asks Gemini to think briefly, and still answers when a model rejects that setting.
// Gemini is mocked, nothing leaves this machine.
import assert from 'node:assert/strict'
process.env.GEMINI_API_KEY = 'k'
const bodies = []
let reject = false
globalThis.fetch = async (url, opts) => {
  const j = (b, s = 200) => new Response(JSON.stringify(b), { status: s })
  if (String(url).includes('/models?')) return j({ models: [{ name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] }] })
  const body = JSON.parse(opts.body); bodies.push(body)
  if (reject && body.generationConfig?.thinkingConfig) return j({ error: { code: 400, message: 'thinking_level is not supported', status: 'INVALID_ARGUMENT' } }, 400)
  return j({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] })
}
const { geminiGenerate } = await import('../api/_gemini.js')
await geminiGenerate({ contents: [] }, { lowThinking: true })
assert.deepEqual(bodies[0].generationConfig.thinkingConfig, { thinkingLevel: 'low' })
await geminiGenerate({ contents: [] })
assert.equal(bodies[1].generationConfig, undefined)
reject = true
const r = await geminiGenerate({ contents: [] }, { lowThinking: true, timeoutMs: 5000 })
assert.equal(r.candidates[0].content.parts[0].text, 'ok')
assert.equal(bodies.length, 4)
console.log('✓ low thinking sent, plain request without it, retried when rejected')
