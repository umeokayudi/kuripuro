#!/usr/bin/env node
// v1.0.115 · "how was it?" message at the end of a job
import { rateMessage, rateJobId, stripRateMarker } from '../src/lib/clientRatingAsk.js'
import { chatPreview } from '../src/lib/chatContent.js'
const assert = (c, m) => { if (!c) throw new Error(m) }
const msg = rateMessage({ id: 'job-1', title: 'Shinbashi — Basic Cleaning', scheduled_date: '2026-10-30' })
assert(rateJobId(msg) === 'job-1', 'marker')
assert(!stripRateMarker(msg).includes('#rate'), 'stripped')
assert(stripRateMarker(msg).startsWith('✅ Shinbashi 10/30'), 'place + day')
assert(!chatPreview(msg).includes('#rate'), 'preview hides marker')
assert(rateJobId('oi') === null, 'plain text')
console.log('client rating ask: ok')
