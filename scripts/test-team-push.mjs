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
const people = async () => [{ role: 'employee', id: 'e1', job_role: 'cleaner', is_active: true }, { role: 'salesperson', id: 's1', team: 'sales', is_active: true }, { role: 'admin', id: 'a', is_active: true }]
let r = res(); await handleTeam({ body: { path: 'employee-faces/x.json' } }, r, { db, loadPeople: people, readFile: async () => ({}) })
assert.equal(r.code, 400)
r = res(); await handleTeam({ body: { path } }, r, { db, loadPeople: people, readFile: async () => ({ kind: 'took', at: now, author: { id: 'a' } }) })
assert.equal(r.body.skipped, 'not-pushed-kind')
r = res(); await handleTeam({ body: { path } }, r, { db, loadPeople: people, readFile: async () => ({ kind: 'cover', at: '2026-01-01T00:00:00Z', author: { id: 'a' } }) })
assert.equal(r.body.skipped, 'old')
r = res(); await handleTeam({ body: { path } }, r, { db, loadPeople: people, readFile: async () => ({ kind: 'cover', at: now, author: { id: 'a' }, job: { store: 'Kodama' } }) })
assert.equal(r.body.sent, 0); assert.ok(log.has(`team:${path}`))
r = res(); await handleTeam({ body: { path } }, r, { db, loadPeople: people, readFile: async () => ({ kind: 'cover', at: now, author: { id: 'a' } }) })
assert.equal(r.body.skipped, 'duplicate')
const req = 'team-channel/requests/11111111-1111-4111-8111-111111111111.json'
r = res(); await handleTeam({ body: { path: req } }, r, { db, loadPeople: people, readFile: async () => ({ job_id: 'j', status: 'cancelled', at: now, from: { id: 'g' } }) })
assert.equal(r.body.skipped, 'not-pushed-kind')
r = res(); await handleTeam({ body: { path: req } }, r, { db, loadPeople: people, readFile: async () => ({ job_id: 'j', status: 'open', at: now, from: { id: 'g', name: 'Gui' } }) })
assert.equal(r.body.sent, 0)
// v1.0.221 · someone else's message can't be pushed by an employee
const p2 = 'team-channel/c/vendas/2026-11/1794452400001_zz.json'
r = res(); await handleTeam({ body: { path: p2 } }, r, { db, loadPeople: people, who: { role: 'employee', user_id: 'e1' }, readFile: async () => ({ kind: 'text', text: 'oi', at: now, author: { id: 's1' } }) })
assert.equal(r.code, 403)
r = res(); await handleTeam({ body: { path: p2 } }, r, { db, loadPeople: people, who: { role: 'salesperson', user_id: 's1' }, readFile: async () => ({ kind: 'text', text: 'oi', at: now, author: { id: 's1' } }) })
assert.equal(r.body.ok, true)
// v1.0.224 · private conversation: only one of the two can push it
const E = '11111111-1111-4111-8111-111111111111', A = '44444444-4444-4444-8444-444444444444'
const dmP = `team-channel/dm/admin-${A}__employee-${E}/2026-11/1794452400002_dm.json`
r = res(); await handleTeam({ body: { path: dmP } }, r, { db, loadPeople: people, who: { role: 'employee', user_id: 'e9' }, readFile: async () => ({ kind: 'text', text: 'oi', at: now, author: { role: 'employee', id: 'e9' } }) })
assert.equal(r.code, 403)
r = res(); await handleTeam({ body: { path: dmP } }, r, { db, loadPeople: people, who: { role: 'employee', user_id: E }, readFile: async () => ({ kind: 'text', text: 'Posso falar?', at: now, author: { role: 'employee', id: E, name: 'Gabriel' } }) })
assert.equal(r.body.ok, true)
console.log('team push ok')
