// v1.0.174 · Próximo turno: total time + ideal start
import assert from 'node:assert/strict'
import { estimateShift, fmtDur } from '../src/lib/shiftEstimate.js'

const OTP = '7138f082-0d38-43e4-bd77-00c4598690b3'
const j = (id, title, extra = {}) => ({ id, title, client_id: OTP, scheduled_date: '2026-11-07', scheduled_time: '00:30', status: 'assigned', ...extra })
const h = (id, title, d, start, min) => {
  const s = new Date(`${d}T${start}:00+09:00`)
  return { id, title, status: 'completed', started_at: s.toISOString(), completed_at: new Date(s.getTime() + min * 60000).toISOString() }
}
const jobs = [j('a', 'Nyu Sakana Yakio — Basic'), j('b', 'Nyu Sakana Yakio — AC'), j('c', 'Sakana Yakio Honten — Basic'), j('d', 'Kodama Shinbashi — Basic')]
const hist = [
  h('x', 'Nyu Sakana Yakio — Basic', '2026-11-01', '01:00', 55),
  h('y', 'Nyu Sakana Yakio — Basic', '2026-11-03', '01:00', 65),
  h('z', 'Sakana Yakio Honten — Deep', '2026-11-02', '03:00', 90),
  h('w', 'Kodama Shinbashi — Basic', '2026-11-04', '02:00', 0.2), // 12 s: ignored
]
const e = estimateShift(jobs, hist)
assert.equal(e.perJob.get('a').source, 'service'); assert.equal(e.perJob.get('a').minutes, 60)
assert.equal(e.perJob.get('b').source, 'store')
assert.equal(e.perJob.get('d').source, 'planned')
assert.equal(e.travelMin, 30) // 3 stores → 2 moves
assert.equal(e.totalMin, 360)
assert.equal(e.deadline, '10:00')
assert.equal(e.idealStart, '03:30') // 10:00 − 6h − 30 min
assert.equal(e.tight, false)

// too long → start as soon as the route opens
const long = estimateShift([j('p', 'A — Deep', { description: 'deep clean' }), j('q', 'B — Deep'), j('r', 'C — Deep')], [
  h('1', 'A — Deep', '2026-11-01', '01:00', 240), h('2', 'B — Deep', '2026-11-01', '05:00', 240), h('3', 'C — Deep', '2026-11-01', '09:00', 240)])
assert.equal(long.tight, true); assert.equal(long.idealStart, '00:30')

// normal start-time shift → probable end
const day = estimateShift([{ id: 's', title: 'Atomic Bar — Basic', scheduled_date: '2026-11-07', scheduled_time: '20:00', status: 'assigned' }], [h('t', 'Atomic Bar — Basic', '2026-11-01', '20:00', 47)])
assert.equal(day.idealStart, null); assert.equal(day.start, '20:00'); assert.equal(day.end, '20:50')

assert.equal(fmtDur(220), '3h40'); assert.equal(fmtDur(50), '50 min'); assert.equal(fmtDur(120), '2h')
assert.equal(estimateShift([], []), null)
console.log('✓ shift estimate')
