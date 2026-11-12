// v1.0.217 · Canal da Equipe — node scripts/test-team-channel.mjs
import assert from 'node:assert/strict'
import { autoChannels, inChannel, myChannels, setMember, normalizeMembers, showsCovers, channelOfPath, textPushText, messagePath, isChannelPath, requestPath, buildMessage, buildCoverCards, cantGoCandidates, requestStillOpen, jobBrief, takeCantGoPatch, coverPushText, prevMonth, cleanText, sortMessages, dmKey, isDmKey, managersOf, dmOther } from '../src/lib/teamChannel.js'

const today = '2026-11-12'
const J = (id, extra = {}) => ({ id: `${id}`.padEnd(8, '0') + '-0000-4000-8000-000000000000', title: 'Kodama Kinshicho — Deep Clean (Range Hood)', client_name: 'OTP', scheduled_date: today, scheduled_time: '01:00:00', status: 'assigned', employee_id: null, spot_status: 'pending', value: 30000, ...extra })

// paths: sortable by time, only channel paths accepted by the push route
const p = messagePath(new Date('2026-11-12T03:00:00Z'), 'ab12cd')
assert.equal(p, 'team-channel/c/limpeza/2026-11/1794452400000_ab12cd.json')
assert.ok(isChannelPath('team-channel/msgs/2026-11/1794452400000_ab12cd.json')) // v1.0.217 history
assert.equal(messagePath(new Date('2026-11-12T03:00:00Z'), 'x', 'vendas').split('/')[2], 'vendas')
assert.ok(!isChannelPath('team-channel/c/clientes/2026-11/1794452400000_ab.json'))
assert.equal(messagePath(new Date('2026-11-30T16:00:00Z'), 'x').split('/')[3], '2026-12') // Tokyo month
assert.ok(isChannelPath(p))
assert.ok(isChannelPath(requestPath('11111111-1111-4111-8111-111111111111')))
assert.ok(!isChannelPath('jobs/abc/ja_fiz.json'))
assert.ok(!isChannelPath('team-channel/../employee-faces/x.json'))
assert.equal(prevMonth('2026-01'), '2025-12')
assert.equal(cleanText('  oi\r\n\n\n\nok  '), 'oi\n\nok')

// a message never carries money: only store/service/day/time of the job
const m = buildMessage({ kind: 'cover', author: { role: 'admin', id: 'a1', name: 'Umeoka' }, job: J(1), now: '2026-11-12T03:00:00Z' })
assert.deepEqual(Object.keys(m.job).sort(), ['date', 'id', 'service', 'store', 'time'])
assert.equal(m.job.store, 'Kodama Kinshicho')
assert.equal(m.job.time, '01:00')
assert.ok(!JSON.stringify(m).includes('30000'))
assert.throws(() => buildMessage({ kind: 'text', text: '  ', author: { role: 'employee', id: 'e1' } }))
assert.throws(() => buildMessage({ kind: 'text', text: 'x', author: { role: 'client', id: 'c1' } }))
assert.deepEqual(sortMessages([{ at: '2', author: {}, kind: 't' }, { at: '1', author: {}, kind: 't' }, null]).map(x => x.at), ['1', '2'])

// cover cards: open offers + "não posso ir" still with the requester
const gui = { id: 'gui', name: 'Guilherme' }
const reqOpen = { job_id: J(2).id, from: gui, status: 'open', reason: 'doente', at: '2026-11-12T01:00:00Z' }
const jobs = { [J(2).id]: J(2, { employee_id: 'gui', employee_name: 'Guilherme', spot_status: null, scheduled_time: '00:30' }) }
const cards = buildCoverCards({
  openJobs: [J(1), J(3, { scheduled_date: '2026-11-11' }), J(4, { employee_id: 'x' })],
  requests: [reqOpen], jobsById: jobs, today, me: { role: 'employee', id: 'gab' }, fitOf: () => ({ ok: true, reason: 'ok' }),
})
assert.deepEqual(cards.map(c => c.kind), ['cant_go', 'free']) // 00:30 before 01:00; past day + taken job left out
assert.ok(cards.every(c => c.canTake))
// the requester cannot take own card; sees it as mine
const own = buildCoverCards({ requests: [reqOpen], jobsById: jobs, today, me: { role: 'employee', id: 'gui' }, fitOf: () => ({ ok: true, reason: 'ok' }) })
assert.equal(own[0].mine, true); assert.equal(own[0].canTake, false)
// admin never takes (only sees / decides)
assert.ok(buildCoverCards({ openJobs: [J(1)], today, me: { role: 'admin', id: 'a1' } }).every(c => !c.canTake))
// role does not fit → no button; day off → button (confirm in the UI)
assert.equal(buildCoverCards({ openJobs: [J(1)], today, me: { role: 'employee', id: 'gab' }, fitOf: () => ({ ok: false, reason: 'role' }) })[0].canTake, false)
assert.equal(buildCoverCards({ openJobs: [J(1)], today, me: { role: 'employee', id: 'gab' }, fitOf: () => ({ ok: false, reason: 'off' }) })[0].canTake, true)

// a request stops being a card when the job moved, started or passed
assert.equal(requestStillOpen(reqOpen, { ...jobs[J(2).id], employee_id: 'gab' }, today), false)
assert.equal(requestStillOpen(reqOpen, { ...jobs[J(2).id], status: 'in_progress' }, today), false)
assert.equal(requestStillOpen(reqOpen, { ...jobs[J(2).id], scheduled_date: '2026-11-11' }, today), false)
assert.equal(requestStillOpen({ ...reqOpen, status: 'taken' }, jobs[J(2).id], today), false)

// own jobs that can ask for cover: assigned, not started, today+, not already asked
const mine = cantGoCandidates([J(2, { employee_id: 'gui' }), J(5, { employee_id: 'gui', status: 'in_progress' }), J(6, { employee_id: 'gui', scheduled_date: '2026-11-13' })], 'gui', today, [reqOpen])
assert.deepEqual(mine.map(j => j.id), [J(6).id])

// take patch changes only who does it (never value, pay, date)
assert.deepEqual(Object.keys(takeCantGoPatch(J(2), { id: 'gab', name: 'Gabriel' })).sort(), ['employee_id', 'employee_name'])
assert.ok('spot_status' in takeCantGoPatch(J(2, { job_category: 'spot' }), { id: 'gab', name: 'Gabriel' }))

// push text
assert.match(coverPushText({ kind: 'cant_go', author: gui, job: jobBrief(J(2)) }, 'pt').title, /Guilherme precisa de cobertura/)
assert.match(coverPushText({ kind: 'cover', job: jobBrief(J(1)) }, 'pt').body, /Kodama Kinshicho · Deep Clean \(Range Hood\) · 12\/11 · 01:00/)

// ── v1.0.221 · channels by area ──
const adm = { role: 'admin', id: 'a1', is_active: true }
const cleaner = { role: 'employee', id: 'e1', job_role: 'cleaner', is_active: true }
const noRole = { role: 'employee', id: 'e2', job_role: null, is_active: true }
const mkt = { role: 'employee', id: 'e3', job_role: 'MKT', is_active: true }
const seller = { role: 'salesperson', id: 's1', team: 'sales', is_active: true }
const mktSeller = { role: 'salesperson', id: 's2', team: 'marketing', is_active: true }
const gone = { role: 'employee', id: 'e9', job_role: 'cleaner', is_active: false }
const client = { role: 'client', id: 'c1', is_active: true }
let mem = normalizeMembers(null)
assert.deepEqual(myChannels(adm, mem), ['geral', 'limpeza', 'vendas', 'marketing'])
assert.deepEqual(myChannels(cleaner, mem), ['geral', 'limpeza'])
assert.deepEqual(myChannels(noRole, mem), ['geral', 'limpeza'])
assert.deepEqual(myChannels(mkt, mem), ['geral', 'marketing'])
assert.deepEqual(myChannels(seller, mem), ['geral', 'vendas'])
assert.deepEqual(myChannels(mktSeller, mem), ['geral', 'marketing'])
assert.deepEqual(myChannels(gone, mem), [])
assert.deepEqual(myChannels(client, mem), []) // a client never sees a channel
// verification of Bloco 1: admin adds the cleaner to Vendas → appears; removes → gone
mem = setMember(mem, 'vendas', cleaner, true)
assert.deepEqual(mem.channels.vendas.add, ['employee:e1'])
assert.deepEqual(myChannels(cleaner, mem), ['geral', 'limpeza', 'vendas'])
mem = setMember(mem, 'vendas', cleaner, false)
assert.deepEqual(mem.channels.vendas, { add: [], remove: [] })
assert.deepEqual(myChannels(cleaner, mem), ['geral', 'limpeza'])
// removing someone from a channel of their role
mem = setMember(mem, 'limpeza', cleaner, false)
assert.equal(inChannel(cleaner, 'limpeza', mem), false)
assert.equal(inChannel(adm, 'limpeza', mem), true) // admin keeps seeing (history preserved)
mem = setMember(mem, 'limpeza', cleaner, true)
assert.equal(inChannel(cleaner, 'limpeza', mem), true)
// the admin can't be removed; junk keys are dropped; a client can't be added
assert.equal(inChannel(adm, 'vendas', setMember(mem, 'vendas', adm, false)), true)
assert.deepEqual(normalizeMembers({ channels: { vendas: { add: ['client:c1', 'x', 'employee:e1'] }, zzz: {} } }).channels.vendas.add, ['employee:e1'])
assert.equal(inChannel(client, 'vendas', { channels: { vendas: { add: ['client:c1'] } } }), false)
// covers: Limpeza always, Geral only when mirrored
assert.equal(showsCovers('limpeza', mem), true)
assert.equal(showsCovers('geral', mem), false)
assert.equal(showsCovers('geral', { ...mem, mirrorCoversInGeral: true }), true)
assert.equal(showsCovers('vendas', { ...mem, mirrorCoversInGeral: true }), false)
assert.equal(channelOfPath('team-channel/c/vendas/2026-11/1_a.json'), 'vendas')
assert.equal(channelOfPath('team-channel/msgs/2026-11/1_a.json'), 'limpeza')
assert.equal(buildMessage({ text: 'oi', author: { role: 'salesperson', id: 's1' }, channel: 'vendas' }).channel, 'vendas')
assert.throws(() => buildMessage({ text: 'oi', author: { role: 'employee', id: 'e1' }, channel: 'clientes' }))
assert.match(textPushText({ channel: 'limpeza', author: { name: 'Gabriel' }, text: 'Cheguei' }, 'pt').title, /Limpeza · Gabriel/)
// v1.0.224 · private conversation with the gerência
{
  const U = n => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${n.repeat(12)}`
  const emp = { role: 'employee', id: U('1'), name: 'Gabriel', job_role: 'cleaner', is_active: true }
  const boss = { role: 'admin', id: U('4'), name: 'Umeoka', is_active: true }
  const lead = { role: 'employee', id: U('5'), name: 'Líder', job_role: 'leader', is_active: true }
  const other = { role: 'employee', id: U('2'), name: 'Guilherme', job_role: 'cleaner', is_active: true }
  const k = dmKey(emp, boss)
  assert.equal(k, dmKey(boss, emp)) // same conversation from both sides
  assert.equal(isDmKey(k), true)
  assert.equal(inChannel(emp, k, {}), true)
  assert.equal(inChannel(boss, k, {}), true)
  assert.equal(inChannel(other, k, {}), false) // a colleague never sees it
  assert.equal(inChannel({ ...boss, id: U('6') }, k, {}), false) // another admin neither
  assert.deepEqual(myChannels(emp, {}).includes(k), false) // never listed as a group
  const path = messagePath('2026-11-12T03:00:00Z', 'abc', k)
  assert.equal(isChannelPath(path), true)
  assert.equal(channelOfPath(path), k)
  assert.equal(buildMessage({ text: 'oi', author: emp, channel: k }).channel, k)
  assert.throws(() => buildMessage({ text: 'oi', author: other, channel: k })) // not a participant
  assert.throws(() => dmKey(emp, emp))
  assert.deepEqual(managersOf([emp, boss, lead, other, { ...lead, id: U('7'), is_active: false }], emp).map(p => p.name), ['Umeoka', 'Líder'])
  assert.equal(dmOther(k, emp, [boss]).name, 'Umeoka')
  assert.equal(textPushText({ channel: k, author: emp, text: 'Posso falar?' }).title, '💬 Gabriel')
}
console.log('team-channel ok')
