#!/usr/bin/env node
import {
  MIN_LOGIN_PASSWORD,
  validateEmail,
  validateNewPassword,
  buildCredentialPatch,
  pickOwnAdmin,
  filterCredentialRows,
} from '../src/lib/accountCredentials.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

console.log('=== Account credentials unit tests ===\n')

assert(MIN_LOGIN_PASSWORD === 6, 'min length 6')
assert(validateEmail('').error === 'email_required', 'empty email')
assert(validateEmail('not-an-email').error === 'invalid_email', 'invalid email')
assert(validateEmail(' Admin@KuriPuro.com ').value === 'admin@kuripuro.com', 'normalize email')

assert(validateNewPassword('').value === null, 'optional empty password')
assert(validateNewPassword('', { required: true }).error === 'password_required', 'required empty')
assert(validateNewPassword('123').error === 'password_too_short', 'too short')
assert(validateNewPassword('secret1').value === 'secret1', 'ok password')

const own = buildCredentialPatch({
  currentEmail: 'admin@kuripuro.com',
  storedPassword: 'oldpass',
  submittedCurrent: 'wrong',
  newPassword: 'newpass',
  requireCurrent: true,
})
assert(own.error === 'wrong_current_password', 'own change needs current password')

const okOwn = buildCredentialPatch({
  currentEmail: 'admin@kuripuro.com',
  storedPassword: 'oldpass',
  submittedCurrent: 'oldpass',
  newEmail: 'hq@kuripuro.com',
  newPassword: 'newpass',
})
assert(okOwn.ok && okOwn.patch.email === 'hq@kuripuro.com' && okOwn.patch.password === 'newpass', `own patch ${JSON.stringify(okOwn)}`)

const sameEmail = buildCredentialPatch({
  currentEmail: 'admin@kuripuro.com',
  storedPassword: 'oldpass',
  submittedCurrent: 'oldpass',
  newEmail: 'admin@kuripuro.com',
})
assert(sameEmail.error === 'nothing_to_update', 'same email is no-op')

const adminEdit = buildCredentialPatch({
  currentEmail: 'staff@kuripuro.com',
  storedPassword: 'x',
  newPassword: 'staff99',
  requireCurrent: false,
})
assert(adminEdit.ok && adminEdit.patch.password === 'staff99' && !adminEdit.patch.email, 'admin can set staff password without current')

const mismatch = buildCredentialPatch({
  currentEmail: 'admin@kuripuro.com',
  storedPassword: 'oldpass',
  submittedCurrent: 'oldpass',
  newPassword: 'newpass',
  confirmPassword: 'other',
})
assert(mismatch.error === 'password_mismatch', 'confirm must match')

const matched = buildCredentialPatch({
  currentEmail: 'admin@kuripuro.com',
  storedPassword: 'oldpass',
  submittedCurrent: 'oldpass',
  newPassword: 'newpass',
  confirmPassword: 'newpass',
})
assert(matched.ok && matched.patch.password === 'newpass', 'matching confirm is ok')

const picked = pickOwnAdmin(
  [{ id: 'a', email: 'hq@kuripuro.com' }, { id: 'b', email: 'admin@kuripuro.com' }],
  { id: 'b', email: 'admin@kuripuro.com' },
)
assert(picked?.id === 'b', 'pick own admin by id')
assert(pickOwnAdmin([{ id: 'a', email: 'hq@kuripuro.com' }], { id: 'z', email: 'missing@x.com' }) === null, 'no fallback to first admin')

const filtered = filterCredentialRows(
  [{ full_name: 'Andre', email: 'a@x.com', is_active: false }, { full_name: 'Guilherme', email: 'g@x.com', is_active: true }],
  'gui',
  { activeOnly: true },
)
assert(filtered.length === 1 && filtered[0].full_name === 'Guilherme', 'search + active filter')

console.log('✅ Account credential tests passed')
