// v1.0.204 · pollWhileVisible: skips ticks while hidden, catches up once when visible again, stops cleanly.
import assert from 'node:assert/strict'
const listeners = {}
globalThis.document = { visibilityState: 'visible', addEventListener: (e, f) => { listeners[e] = f }, removeEventListener: e => { delete listeners[e] } }
const { pollWhileVisible } = await import('../src/lib/visiblePoll.js')
let n = 0
const stop = pollWhileVisible(() => { n++ }, 20)
await new Promise(r => setTimeout(r, 70)); assert.ok(n >= 2, 'runs while visible')
document.visibilityState = 'hidden'; const before = n
await new Promise(r => setTimeout(r, 70)); assert.equal(n, before, 'paused while hidden')
document.visibilityState = 'visible'; listeners.visibilitychange(); assert.equal(n, before + 1, 'catches up once on return')
listeners.visibilitychange(); assert.equal(n, before + 1, 'no double catch-up')
stop(); const after = n
await new Promise(r => setTimeout(r, 50)); assert.equal(n, after, 'stopped'); assert.ok(!listeners.visibilitychange)
console.log('visible-poll OK')
