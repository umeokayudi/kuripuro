#!/usr/bin/env node
// Automatic payroll close: cron window, never re-closes an existing period, writes auto_closed.
// Uses an in-memory fake of the Supabase client (no real database).
import handler, { runPayrollClose } from '../api/_payroll-close.js'
import { previousPeriod } from '../src/lib/salaryClose.js'

function assert(cond, msg) { if (!cond) throw new Error(msg) }

function fakeDb(tables) {
  const writes = []
  const from = (table) => {
    const filters = []
    let op = 'select', payload = null
    const rows = () => (tables[table] || []).filter(r => filters.every(f => f(r)))
    const q = {
      select: () => q,
      eq: (k, v) => { filters.push(r => r[k] === v); return q },
      gte: (k, v) => { filters.push(r => r[k] >= v); return q },
      lte: (k, v) => { filters.push(r => r[k] <= v); return q },
      order: () => q,
      limit: () => q,
      upsert: (p) => { op = 'upsert'; payload = p; return q },
      insert: (p) => { op = 'insert'; payload = p; return q },
      update: (p) => { op = 'update'; payload = p; return q },
      maybeSingle: () => Promise.resolve({ data: rows()[0] || null, error: null }),
      then: (ok, bad) => {
        if (op !== 'select') writes.push({ table, op, payload })
        return Promise.resolve({ data: op === 'select' ? rows() : null, error: null }).then(ok, bad)
      },
    }
    return q
  }
  return { from, writes }
}

function res() {
  const r = { code: 0, body: null }
  r.status = (c) => { r.code = c; return r }
  r.json = (b) => { r.body = b; return r }
  return r
}

const run = async (db, day) => ({ code: 200, body: await runPayrollClose(db, day) })

process.env.CRON_SECRET = 'test-secret'

const emp = { id: 'e1', full_name: 'Ana', is_active: true, salary_type: 'per_job', job_bonus_rate: 100 }
const jobs = [
  { employee_id: 'e1', status: 'completed', scheduled_date: '2026-09-03', value: 5000 },
  { employee_id: 'e1', status: 'completed', scheduled_date: '2026-09-30', value: 3000 },
  { employee_id: 'e1', status: 'completed', scheduled_date: '2026-10-01', value: 9999 },
]

let current

// 1. Wrong secret is refused
{ const r = res(); await handler({ method: 'GET', headers: { authorization: 'Bearer nope' } }, r); assert(r.code === 401, 'secret') }

assert(previousPeriod('2026-01-01') === '2025-12', 'january wraps to december')
assert(previousPeriod('2026-10-01') === '2026-09', 'previous month')

// 2. Day 12: outside window, nothing written
current = fakeDb({ salary_periods: [], employees: [emp], jobs, salary_payments: [] })
let r = await run(current, '2026-10-12')
assert(r.body.skipped === 'outside closing window' && current.writes.length === 0, 'window: ' + JSON.stringify(r.body))

// 3. Day 1: closes September as auto_closed, only September jobs counted
current = fakeDb({ salary_periods: [], employees: [emp], jobs, salary_payments: [] })
r = await run(current, '2026-10-01')
assert(r.code === 200 && r.body.period === '2026-09', 'closed: ' + JSON.stringify(r.body))
const periodWrite = current.writes.find(w => w.table === 'salary_periods')
assert(periodWrite.payload.status === 'auto_closed', 'auto status')
const slip = current.writes.find(w => w.table === 'salary_statements')
assert(slip.payload.base_salary === 8000, 'base from september jobs only: ' + slip.payload.base_salary)
const pay = current.writes.find(w => w.table === 'salary_payments')
assert(pay.payload.payment_date === '2026-10-15' && pay.payload.amount === 8000, 'payment row')

// 4. Reopened by the admin: cron leaves it alone
current = fakeDb({ salary_periods: [{ period: '2026-09', status: 'open' }], employees: [emp], jobs, salary_payments: [] })
r = await run(current, '2026-10-02')
assert(r.body.skipped === 'already open' && current.writes.length === 0, 'reopen respected')

console.log('payroll close: all checks passed')
