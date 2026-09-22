#!/usr/bin/env node
import {
  employeeToSession,
  pickByNormalizedEmail,
  pickEmployeeForLogin,
} from '../src/lib/employeeLogin.js'
import { hashPassword, passwordMatches, isHashedPassword } from '../src/lib/passwordMatch.js'
import { elapsedSecondsFromStart, formatHms } from '../src/lib/employeePay.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

console.log('=== Employee login + photo-stability helpers ===\n')

const staff = [
  { id: 'g', full_name: 'Guilherme Silva', email: 'Guilherme@Kuripuro.com', password: 'secret12', is_active: true, score: 90 },
  { id: 'a', full_name: 'Alexandre Costa', email: 'alexandre@kuripuro.com', password: 'secret12', is_active: true },
  { id: 'x', full_name: 'Inactive Person', email: 'old@kuripuro.com', password: 'secret12', is_active: false },
  { id: 'd1', full_name: 'Daniel One', email: 'd1@kuripuro.com', password: 'twin', is_active: true },
  { id: 'd2', full_name: 'Daniel Two', email: 'd2@kuripuro.com', password: 'twin', is_active: true },
]

assert(pickEmployeeForLogin(staff, 'guilherme@kuripuro.com', 'secret12')?.id === 'g', 'lowercase email vs mixed-case DB')
assert(pickEmployeeForLogin(staff, '  GUILHERME@KURIPURO.COM ', 'secret12')?.id === 'g', 'email case + trim')
assert(pickEmployeeForLogin(staff, 'Guilherme Silva', 'secret12')?.id === 'g', 'full name login')
assert(pickEmployeeForLogin(staff, 'guilherme', 'secret12')?.id === 'g', 'unique first name')
assert(!pickEmployeeForLogin(staff, 'guilherme@kuripuro.com', 'wrong'), 'wrong password')
assert(!pickEmployeeForLogin(staff, 'old@kuripuro.com', 'secret12'), 'inactive skipped')
assert(!pickEmployeeForLogin(staff, 'Daniel', 'twin'), 'duplicate first name is not unique')
assert(pickEmployeeForLogin(staff, 'Daniel Two', 'twin')?.id === 'd2', 'full name still unique among twins')
assert(!pickEmployeeForLogin(staff, '', 'secret12'), 'empty login')
assert(!pickEmployeeForLogin(staff, 'guilherme', ''), 'empty password')

const hashed = { ...staff[0], password: hashPassword('secret12') }
assert(isHashedPassword(hashed.password), 'hash prefix')
assert(passwordMatches(hashed.password, 'secret12'), 'hash matches plaintext given')
assert(!passwordMatches(hashed.password, 'wrong'), 'hash rejects wrong')
assert(pickEmployeeForLogin([hashed, staff[1]], 'guilherme@kuripuro.com', 'secret12')?.id === 'g', 'login with hashed password')
assert(pickEmployeeForLogin(staff, 'guilherme@kuripuro.com', 'secret12')?.id === 'g', 'legacy plaintext still works')
assert(passwordMatches('secret12', 'secret12'), 'legacy plaintext match never rewrites')
assert(hashPassword('abc') === 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'sha256 abc')

const session = employeeToSession(staff[0])
assert(session.role === 'employee' && session.name === 'Guilherme Silva' && session.email === 'Guilherme@Kuripuro.com', 'session shape')

assert(pickByNormalizedEmail([{ email: 'Admin@KuriPuro.com', id: 1 }], 'admin@kuripuro.com')?.id === 1, 'admin email case')
assert(!pickByNormalizedEmail([{ email: 'a@x.com' }], 'b@x.com'), 'no admin match')

assert(formatHms(3661) === '01:01:01', 'hms format')
assert(formatHms(-3) === '00:00:00', 'hms clamps')
assert(elapsedSecondsFromStart('2026-09-18T00:00:00.000Z', Date.parse('2026-09-18T00:00:10.000Z')) === 10, 'elapsed from start')
assert(elapsedSecondsFromStart(null) === 0, 'elapsed empty')

console.log('✅ Employee login matcher + elapsed helpers')
