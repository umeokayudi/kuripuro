// Pure checks for the Agenda do Dia helpers (no database).
import assert from 'node:assert/strict'
import { moveInList, orderUpdates, checklistProgress, checklistUpdate, splitChecklist, timeState, expectedMinutes, contractForAgendaJob, progressSeries, bucketKey, storeName, sortByOrder, nextPendingJob } from '../src/lib/agenda.js'
import { buildPlaces, contractForPlace } from '../src/lib/places.js'
import { aiIssueRows, aiIssuesText } from '../src/lib/photoAi.js'

assert.deepEqual(moveInList(['a', 'b', 'c'], 'c', 0), ['c', 'a', 'b'])
assert.deepEqual(moveInList(['a', 'b', 'c'], 'a', 1), ['b', 'a', 'c'])
assert.deepEqual(moveInList(['a', 'b'], 'x', 9), ['a', 'b', 'x'])
assert.deepEqual(orderUpdates(['b', 'a'], { a: { sequence_order: 1 }, b: { sequence_order: 2 } }), [{ id: 'b', sequence_order: 1001 }, { id: 'a', sequence_order: 1002 }])
// Clock order unless someone reordered by hand (the 29/10 case: 00:30, 22:00, 20:00, 21:00).
{
  const day = [
    { id: 'a', scheduled_time: '00:30', sequence_order: 1, status: 'completed' },
    { id: 'b', scheduled_time: '22:00', sequence_order: 2, status: 'assigned' },
    { id: 'c', scheduled_time: '20:00', sequence_order: 3, status: 'assigned' },
    { id: 'd', scheduled_time: '21:00', sequence_order: 4, status: 'assigned' },
  ]
  assert.deepEqual(sortByOrder(day).map(j => j.id), ['a', 'c', 'd', 'b'])
  assert.equal(nextPendingJob(day).id, 'c')
  const manual = day.map(j => ({ ...j, sequence_order: { a: 1001, b: 1002, c: 1003, d: 1004 }[j.id] }))
  assert.deepEqual(sortByOrder(manual).map(j => j.id), ['a', 'b', 'c', 'd'])
  assert.equal(nextPendingJob(manual).id, 'b')
}

assert.deepEqual(splitChecklist('Varrer; Passar pano; Lixo'), ['Varrer', 'Passar pano', 'Lixo'])
assert.deepEqual(splitChecklist('- a\n- b\n\n3. c'), ['a', 'b', 'c'])
const items = ['A', 'B', 'C']
assert.equal(checklistProgress({ checklist_done: 1, checklist_missed_items: 'B, C' }, items).done, 1)
assert.equal(checklistProgress({ status: 'completed', checklist_done: 3 }, items).done, 3)
assert.equal(checklistProgress({}, items).done, 0)
assert.deepEqual(checklistUpdate([{ label: 'A', done: true }, { label: 'B', done: false }]), { checklist_total: 2, checklist_done: 1, checklist_missed_items: 'B' })

const start = new Date('2026-10-29T10:00:00+09:00')
const job = { status: 'in_progress', started_at: start.toISOString() }
assert.equal(timeState(job, 60, { tolerance_min: 30, cap_factor: 2 }, new Date(start.getTime() + 80 * 60000)).state, 'running')
assert.equal(timeState(job, 60, { tolerance_min: 30, cap_factor: 2 }, new Date(start.getTime() + 95 * 60000)).state, 'overrun')
assert.equal(timeState(job, 60, { tolerance_min: 30, cap_factor: 2 }, new Date(start.getTime() + 125 * 60000)).state, 'cap')

const contracts = [
  { id: 1, location_name: 'Ibushio', hours_per_visit: 3, is_active: true },
  { id: 2, location_name: 'Ibushio - Deep Clean', hours_per_visit: 8, is_active: true },
  { id: 3, location_name: 'Ibushio — AC Cleaning', hours_per_visit: 2, is_active: true },
]
assert.equal(contractForAgendaJob({ title: 'Ibushio — Basic Cleaning' }, contracts).id, 1)
assert.equal(contractForAgendaJob({ title: 'Ibushio — Deep Clean (Range Hood)' }, contracts).id, 2)
assert.equal(expectedMinutes({ title: 'Ibushio — Deep Clean' }, contracts[1]), 480)
assert.equal(expectedMinutes({ title: 'X — Basic Cleaning', expected_minutes: 45 }, null), 45)
assert.equal(storeName('Ibushio — AC Cleaning'), 'Ibushio')

assert.equal(bucketKey('2026-10-29', 'week'), '2026-10-26')
assert.equal(bucketKey('2026-10-29', 'month'), '2026-10')
const series = progressSeries([
  { id: 1, scheduled_date: '2026-10-01', status: 'completed' },
  { id: 2, scheduled_date: '2026-10-01', status: 'assigned' },
  { id: 3, scheduled_date: '2026-10-02', status: 'cancelled' },
], { unit: 'month', now: new Date('2026-10-29T12:00:00+09:00') })
assert.equal(series[0].done, 1)
assert.equal(series[0].late, 1)

const places = buildPlaces([{ id: 'l1', name: 'Ibushio', is_active: true }], [...contracts, { id: 4, location_name: 'Tooda', client_id: 'c', is_active: true }])
assert.equal(places.length, 2)
assert.equal(places.find(p => p.name === 'Ibushio').contracts.length, 3)
assert.equal(contractForPlace(places.find(p => p.name === 'Ibushio'), 'deep').id, 2)
assert.equal(contractForPlace(places.find(p => p.name === 'Ibushio'), 'basic').id, 1)
assert.ok(places.find(p => p.name === 'Tooda').fromContract)

assert.equal(aiIssuesText(['gordura, fogão => limpar', 'chão']), 'gordura, fogão => limpar; chão')
assert.deepEqual(aiIssueRows('gordura, fogão => limpar; chão'), [{ issue: 'gordura, fogão', fix: 'limpar' }, { issue: 'chão', fix: '' }])
console.log('agenda tests ok')
