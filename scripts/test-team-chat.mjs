// Employee chat list: own leader first, own team, coworkers, then the office (diretoria).
import assert from 'node:assert/strict'
import { buildChatSections, threadWith, teamUnreadTotal, initials, OFFICE_KEY } from '../src/lib/teamChat.js'

const employees = [
  { id: 'me', full_name: 'Ana Souza', leader_id: 'lead', is_active: true },
  { id: 'lead', full_name: 'Bruno Lima', job_role: 'leader', is_active: true },
  { id: 'sub', full_name: 'Carla Dias', leader_id: 'me', is_active: true },
  { id: 'co', full_name: 'Davi Reis', leader_id: 'lead', is_active: true },
  { id: 'off', full_name: 'Edu Old', is_active: false },
]
const teamMessages = [
  { id: 't1', from_employee_id: 'co', to_employee_id: 'me', content: 'oi', read: false, created_at: '2026-10-22T01:00:00Z' },
  { id: 't2', from_employee_id: 'me', to_employee_id: 'co', content: 'olá', read: true, created_at: '2026-10-22T01:05:00Z' },
  { id: 't3', from_employee_id: 'sub', to_employee_id: 'lead', content: 'not mine', read: false, created_at: '2026-10-22T02:00:00Z' },
]
const officeMessages = [{ id: 'o1', sender: 'admin', content: 'hello', read: false, created_at: '2026-10-21T00:00:00Z' }]

const s = buildChatSections({ me: { id: 'me' }, employees, teamMessages, officeMessages, teamReady: true })
assert.equal(s.leader.id, 'lead')
assert.deepEqual(s.team.map(x => x.id), ['sub'])
assert.deepEqual(s.colleagues.map(x => x.id), ['co'], 'inactive people and the leader are not coworkers')
assert.equal(s.colleagues[0].unread, 1)
assert.equal(s.colleagues[0].last.content, 'olá')
assert.equal(s.office.key, OFFICE_KEY)
assert.equal(s.office.unread, 1)

const t = threadWith(teamMessages, 'me', 'co')
assert.deepEqual(t.map(m => [m.id, m.mine]), [['t1', false], ['t2', true]])
assert.equal(teamUnreadTotal(teamMessages, 'me'), 1)

const none = buildChatSections({ me: { id: 'me' }, employees, teamMessages, officeMessages, teamReady: false })
assert.equal(none.leader, null)
assert.equal(none.colleagues.length, 0)

const noLeader = buildChatSections({ me: { id: 'co2' }, employees: [...employees, { id: 'co2', full_name: 'Fe', is_active: true }], teamMessages: [], officeMessages: [], teamReady: true })
assert.equal(noLeader.leader, null)
assert.equal(noLeader.team.length, 0)

assert.equal(initials('Ana Maria Souza'), 'AS')
assert.equal(initials(''), '?')
console.log('team-chat: ok')
