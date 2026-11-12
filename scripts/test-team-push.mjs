// v1.0.217 · push route of the Canal da Equipe (no real push sent) — node scripts/test-team-push.mjs
import assert from 'node:assert/strict'
import { handleTeam } from '../api/_push.js'

const res = () => { const r = { code: 0, body: null, status(c) { r.code = c; return r }, json(b) { r.body = b; return r } }; return r }
const log = new Set()
const db = {
  from(t) {
    const q = {
      insert(row) { if (t === 'push_log') { if (log.has(row.dedupe_key)) return Promise.resolve({ error: { code: '23505' } }); log.add(row.dedupe_key) } return Promise.resolve({ error: null }) },
      update() { return { eq: () => Promise.resolve({}) } },
      select() { return q }, eq() { return q }, in() { return q }, limit() { return Promise.resolve({ data: [], error: null }) },
      maybeSingle() { return Promise.resolve({ data: { id: 'j', title: 'Kodama — Basic', scheduled_date: '2026-11-12', scheduled_time: '01:00' } }) },
    }
    return q
  },
}
const now = new Date().toISOString()
const path = 'team-channel/msgs/2026-11/1794452400000_ab12cd.json'
let r = res(); await handleTeam({ body: { path: 'employee-faces/x.json' } }, r, { db, readFile: async () => ({}) })
assert.equal(r.code, 400)
r = res(); await handleTeam({ body: { path } }, r, { db, readFile: async () => ({ kind: 'text', at: now, author: { id: 'a' } }) })
assert.equal(r.body.skipped, 'not-a-request')
r = res(); await handleTeam({ body: { path } }, r, { db, readFile: async () => ({ kind: 'cover', at: '2026-01-01T00:00:00Z', author: { id: 'a' } }) })
assert.equal(r.body.skipped, 'old')
r = res(); await handleTeam({ body: { path } }, r, { db, readFile: async () => ({ kind: 'cover', at: now, author: { id: 'a' }, job: { store: 'Kodama' } }) })
assert.equal(r.body.sent, 0); assert.ok(log.has(`team:${path}`))
r = res(); await handleTeam({ body: { path } }, r, { db, readFile: async () => ({ kind: 'cover', at: now, author: { id: 'a' } }) })
assert.equal(r.body.skipped, 'duplicate')
const req = 'team-channel/requests/11111111-1111-4111-8111-111111111111.json'
r = res(); await handleTeam({ body: { path: req } }, r, { db, readFile: async () => ({ job_id: 'j', status: 'cancelled', at: now, from: { id: 'g' } }) })
assert.equal(r.body.skipped, 'not-a-request')
r = res(); await handleTeam({ body: { path: req } }, r, { db, readFile: async () => ({ job_id: 'j', status: 'open', at: now, from: { id: 'g', name: 'Gui' } }) })
assert.equal(r.body.sent, 0)
console.log('team push ok')
