// v1.0.149 · "Precisa de atenção": one job in one row only, waiting rows apart, resolved rows leave at once
import assert from 'node:assert/strict'
import { staleNotListed, withoutResolved, isWaiting } from '../src/lib/attentionActions.js'

const exc = [
  { id: 'covered:a1', kind: 'covered', jobId: 'a1' },
  { id: 'incomplete:a2', kind: 'incomplete', jobId: 'a2' },
  { id: 'paid_unconfirmed:x', kind: 'paid_unconfirmed', waiting: true },
]
assert.deepEqual(staleNotListed(['a1', 'a2', 'a3', 'a4'], exc), ['a3', 'a4'], 'covered / incomplete are not counted again as old jobs')
assert.equal(withoutResolved(exc, new Set(['covered:a1'])).length, 2)
assert.equal(exc.filter(isWaiting).length, 1)
assert.ok(isWaiting({ kind: 'paid_unconfirmed' }))
console.log('attention: all passed')
