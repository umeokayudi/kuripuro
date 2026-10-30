#!/usr/bin/env node
// v1.0.110 · one exception queue for the owner (pure builder) + test-data rule + score only with evaluations.
import { buildExceptions } from '../src/lib/exceptionQueue.js'
import { isTestName } from '../src/lib/testData.js'
import { scoreOf, byScore } from '../src/lib/employeeScore.js'
import { shouldAskForgot, employeeSlipState, problemMessage, problemJobId } from '../src/lib/fieldExec.js'

const assert = (c, m) => { if (!c) throw new Error(m) }
const today = '2026-10-30'
const now = new Date('2026-10-30T12:00:00+09:00')
const jobs = [
  { id: 'late', title: 'Shinbashi — Basic', employee_id: 'e1', employee_name: 'Guilherme', status: 'assigned', scheduled_date: today, scheduled_time: '09:00' },
  { id: 'soon', title: 'Tooda — Basic', employee_id: 'e1', employee_name: 'Guilherme', status: 'assigned', scheduled_date: today, scheduled_time: '11:50' },
  { id: 'nobody', title: 'Atomic — Basic', status: 'assigned', scheduled_date: '2026-10-31', scheduled_time: '10:00' },
  { id: 'missed', title: 'Ebisu — Basic', employee_id: 'e2', employee_name: 'Ana', status: 'assigned', scheduled_date: '2026-10-28', scheduled_time: '10:00' },
  { id: 'nophoto', title: 'Ginza — Basic', employee_id: 'e2', employee_name: 'Ana', status: 'completed', scheduled_date: '2026-10-29', started_at: '2026-10-29T01:00:00Z', completed_at: '2026-10-29T02:00:00Z' },
  { id: 'long', title: 'Shinbashi — Basic', employee_id: 'e2', employee_name: 'Ana', status: 'completed', scheduled_date: '2026-10-29', started_at: '2026-10-29T01:00:00Z', completed_at: '2026-10-29T06:00:00Z', photo_end_url: 'x', photo_ai_score: 90 },
  { id: 'ai', title: 'Ginza — Basic', employee_id: 'e2', employee_name: 'Ana', status: 'completed', scheduled_date: '2026-10-30', started_at: '2026-10-30T01:00:00Z', completed_at: '2026-10-30T02:00:00Z', photo_end_url: 'x' },
  { id: 'test', title: 'Teste — Basic', employee_id: 'e9', employee_name: 'Teste Funcionário', status: 'assigned', scheduled_date: today, scheduled_time: '08:00' },
  { id: 'cancel', title: 'X — Basic', status: 'cancelled', scheduled_date: today },
]
const contracts = [{ location_name: 'Shinbashi', hours_per_visit: 2 }]
const payroll = { autoClosed: [{ period: '2026-09' }], disputed: [{ id: 's1', employee_name: 'Kenji', period: '2026-09' }], paidUnconfirmed: [] }
const rows = buildExceptions({ jobs, contracts, payroll, today, now })
const kinds = Object.fromEntries(rows.map(r => [r.jobId || r.kind, r.kind]))
assert(kinds.late === 'late' && kinds.soon === undefined, 'late after 30 min only')
assert(kinds.nobody === 'no_person', 'no person tomorrow')
assert(kinds.missed === 'incomplete', 'never started = incomplete')
assert(kinds.nophoto === 'no_photo', 'done without photo')
assert(kinds.long === 'long', '5h on a 2h contract = more than 2×')
assert(kinds.ai === 'ai_waiting', 'photo waiting for AI')
assert(!rows.some(r => r.jobId === 'test' || r.jobId === 'cancel'), 'tests and cancelled hidden')
assert(buildExceptions({ jobs, contracts, today, now, hideTests: false }).some(r => r.jobId === 'test'), 'tests shown when the filter is off')
assert(rows[0].kind === 'late' && rows[rows.length - 1].kind === 'ai_waiting', 'most urgent first')
assert(rows.some(r => r.kind === 'payroll_review') && rows.some(r => r.kind === 'disputed'), 'payroll items in the same queue')

assert(isTestName('Teste Funcionário') && isTestName('test client') && !isTestName('Testa Ramen') && !isTestName('Guilherme'), 'test names')

const evaluated = new Set(['e1'])
assert(scoreOf({ id: 'e1', score: 85 }, evaluated) === 85 && scoreOf({ id: 'e2', score: 100 }, evaluated) === null, 'score only with evaluations')
const order = [{ id: 'e2', full_name: 'Ana' }, { id: 'e1', full_name: 'Zé', score: 70 }].sort(byScore(evaluated)).map(e => e.id)
assert(order.join() === 'e1,e2', 'rated people first in the ranking')
// v1.0.112 · field execution
assert(!shouldAskForgot({ elapsedSec: 89 * 60, plannedMin: 60 }) && shouldAskForgot({ elapsedSec: 90 * 60, plannedMin: 60 }) && !shouldAskForgot({ elapsedSec: 999 * 60, plannedMin: 60, asked: true }), 'forgot-to-finish after planned + 30')
assert(employeeSlipState({}, null) === 'to_confirm' && employeeSlipState({ employee_confirmed_at: 'x' }, null) === 'confirmed' && employeeSlipState({ employee_confirmed_at: 'x' }, { status: 'paid' }) === 'paid' && employeeSlipState({ employee_disputed_at: 'x' }, null) === 'disputed', 'payslip states')
const msg = problemMessage({ place: 'Shinbashi', date: today, text: 'Torneira quebrada', jobId: 'abc-123' })
assert(problemJobId(msg) === 'abc-123', 'problem marker')
const withProblem = buildExceptions({ jobs: [], problems: [{ id: 'm1', employee_id: 'e1', employee_name: 'Ana', content: msg, created_at: today + 'T03:00:00Z' }], today, now })
assert(withProblem[0].kind === 'problem' && withProblem[0].place === `Shinbashi (${today})` && withProblem[0].text === 'Torneira quebrada' && withProblem[0].jobId === 'abc-123', 'reported problem in the queue')
console.log('exception queue OK')
