#!/usr/bin/env node
import {
  SCHEDULE_TEMPLATES,
  pickEmployeeForTemplate,
  contractsForActiveEmployees,
} from '../src/lib/scheduleGenerator.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

console.log('=== Schedule assign (active staff) ===\n')

const staff = [
  { id: 'andré', full_name: 'André Silva', is_active: false },
  { id: 'alex', full_name: 'Alexandre Umeoka', is_active: true },
  { id: 'sasaki', full_name: 'Sasaki Kazuma', is_active: true },
  { id: 'gui', full_name: 'Guilherme Henrique', is_active: true },
]

assert(pickEmployeeForTemplate(staff.filter(e => e.is_active !== false), ['André Silva'])?.id === 'alex', 'inactive name falls back to first active')
assert(pickEmployeeForTemplate(staff.filter(e => e.is_active !== false), ['André Silva', 'Alexandre Umeoka'])?.id === 'alex', 'falls through to Alexandre')

const contracts = contractsForActiveEmployees(staff)
assert(contracts.length === SCHEDULE_TEMPLATES.length, `templates ${contracts.length}`)
assert(contracts.every(c => c.employeeId !== 'andré'), 'André never assigned')
assert(contracts.find(c => c.template === 'otp_basic')?.employeeId === 'alex', 'otp_basic → Alexandre')
assert(contracts.find(c => c.template === 'otp_deep_only')?.employeeId === 'sasaki', 'otp_deep_only → Sasaki')
assert(contracts.find(c => c.template === 'duskin_sunday')?.employeeId === 'gui', 'duskin → Guilherme')
assert(new Set(contracts.map(c => c.employeeId)).size === 3, 'one person per template while staff remains')

const onlyGui = contractsForActiveEmployees([{ id: 'gui', full_name: 'Guilherme Henrique', is_active: true }])
assert(onlyGui.length === 3 && onlyGui.every(c => c.employeeId === 'gui'), 'single active staff gets every template')

const none = contractsForActiveEmployees([{ id: 'andré', full_name: 'André Silva', is_active: false }])
assert(none.length === 0, 'all inactive → no contracts')

console.log('✅ active staff assignment (André skipped)')
