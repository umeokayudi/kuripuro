#!/usr/bin/env node
import {
  MIN_LOGIN_PASSWORD,
  validateEmail,
  validateNewPassword,
  buildCredentialPatch,
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

console.log('✅ Account credential tests passed')
