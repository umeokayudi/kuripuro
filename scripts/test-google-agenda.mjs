// v1.0.179 · pure checks for Google Agenda sync (no database, no Google).
import assert from 'node:assert/strict'
import {
  DEEP_TASK_LABELS, tokyoParts, normalizeEvent, heuristicDraft, finishDraft, draftToJobRow, draftProblems,
  tagTitle, jobToGoogleEvent, jobHash, isKuripuroEvent, matchEmployee,
} from '../src/lib/googleAgendaSync.js'
import { DEEP_TASKS } from '../src/lib/cleaningType.js'

// Same deep tasks as the New Job form.
assert.deepEqual(Object.fromEntries(DEEP_TASKS.map(t => [t.id, t.label])), DEEP_TASK_LABELS)

// Tokyo time from Google times.
assert.deepEqual(tokyoParts({ dateTime: '2026-11-07T00:30:00+09:00' }), { date: '2026-11-07', time: '00:30' })
assert.deepEqual(tokyoParts({ dateTime: '2026-11-06T15:30:00Z' }), { date: '2026-11-07', time: '00:30' })
assert.deepEqual(tokyoParts({ date: '2026-11-08' }), { date: '2026-11-08', time: '' })

const places = [
  { id: 'L1', name: 'Kodama Kinshicho', address: '錦糸町 1-2', client_id: 'C1' },
  { id: 'L2', name: 'Bacana', address: 'Shibuya', client_id: 'C2' },
]
const employees = [{ id: 'E1', full_name: 'Guilherme Souza' }, { id: 'E2', full_name: 'Letícia Ito' }, { id: 'E3', full_name: 'Gabriel Ito' }]
const clients = [{ id: 'C1', company_name: 'On The Planet' }, { id: 'C2', company_name: 'Bacana Inc' }]
const ctx = { places, employees, clients }
const account = { id: '11111111-1111-1111-1111-111111111111', owner_kind: 'employee', owner_id: 'E2', owner_name: 'Letícia Ito' }
const ev = normalizeEvent({
  id: 'abc', summary: 'Kodama Kinshicho limpeza pesada coifa + fritadeira - Guilherme',
  start: { dateTime: '2026-11-10T22:00:00+09:00' }, end: { dateTime: '2026-11-11T01:00:00+09:00' },
  location: '錦糸町', description: '<b>chave</b> no correio', updated: 'u1',
}, { account, calendar: { id: 'primary', summary: 'Letícia' } })
assert.equal(ev.key, `${account.id}|primary|abc`)
assert.equal(ev.description, 'chave  no correio')
assert.equal(ev.end_time, '') // ends next day → no same-day end

const d = heuristicDraft(ev, ctx)
assert.equal(d.location_id, 'L1')
assert.equal(d.client_name, 'On The Planet')
assert.equal(d.employee_id, 'E1') // named in the event beats the calendar owner
assert.equal(d.cleaning_type, 'deep')
assert.deepEqual(d.deep_tasks.sort(), ['fryer', 'range_hood'])
assert.deepEqual(draftProblems(d), [])
// Ambiguous surname "Ito" → nobody; the calendar owner is used.
assert.equal(matchEmployee(employees, 'faxina com Ito'), null)

// AI ids that do not exist never reach a job.
const bad = finishDraft({ ...d, employee_id: 'GHOST', location_id: 'NOPE', place_name: 'Bacana', deep_tasks: ['fryer', 'laser'] }, ctx)
assert.equal(bad.employee_id, null)
assert.equal(bad.location_id, 'L2')
assert.deepEqual(bad.deep_tasks, ['fryer'])
assert.deepEqual(draftProblems(bad), ['funcionário'])

const row = draftToJobRow({ ...d, end_time: '01:00' }, { companyTag: 'JBM', eventLink: 'https://g/x' })
assert.equal(row.title, 'Kodama Kinshicho — Deep Clean (Range Hood, Fryer)')
assert.equal(row.scheduled_date, '2026-11-10')
assert.equal(row.scheduled_time, '22:00')
assert.equal(row.status, 'assigned')
assert.match(row.description, /Importado do Google Agenda · JBM/)

// Company always marked, never twice.
assert.equal(tagTitle('Loja — Basic Cleaning', 'JBM'), '[JBM] Loja — Basic Cleaning')
assert.equal(tagTitle('[JBM] Loja', 'JBM'), '[JBM] Loja')

const job = { id: 'J1', title: 'Bacana — Basic Cleaning', scheduled_date: '2026-11-12', scheduled_time: '09:00', employee_name: 'Gabriel', address: 'Shibuya', description: 'Horário na agenda: 09:00–12:30', status: 'assigned' }
const body = jobToGoogleEvent(job, { company_tag: 'JBM', color_id: '9', default_hours: 2 })
assert.equal(body.summary, '[JBM] Bacana — Basic Cleaning')
assert.equal(body.start.dateTime, '2026-11-12T00:00:00.000Z')
assert.equal(body.end.dateTime, '2026-11-12T03:30:00.000Z') // end time from the imported window
assert.equal(body.extendedProperties.private.kuripuro_job, 'J1')
assert.ok(isKuripuroEvent(body)) // our own events are never imported back
const allDay = jobToGoogleEvent({ ...job, scheduled_time: '' }, { company_tag: 'JBM' })
assert.deepEqual([allDay.start.date, allDay.end.date], ['2026-11-12', '2026-11-13'])
assert.equal(jobHash(job), jobHash({ ...job }))
assert.notEqual(jobHash(job), jobHash({ ...job, scheduled_time: '10:00' }))

console.log('google agenda: ok')
