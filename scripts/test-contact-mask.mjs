import assert from 'node:assert/strict'
import { maskPhone, maskEmail, phoneOwner } from '../src/lib/contactMask.js'
import { SETUP_PREFIX, isSetupPassword, newSetupToken, setupLink, readSetupLink, passwordProblem, setupPassword } from '../src/lib/passwordLink.js'

assert.equal(maskPhone('090-1234-5678'), '090-****-5678')
assert.equal(maskPhone('09012345678'), '090****5678')
assert.equal(maskPhone('+81 90 1234 5678'), '+81 9* **** 5678')
assert.equal(maskPhone(''), '')
assert.equal(maskPhone('123'), '•••')
assert.equal(maskEmail('hanako@email.com'), 'ha***@email.com')
assert.equal(maskEmail('a@x.jp'), 'a***@x.jp')
assert.equal(maskEmail('nope'), '•••')

const people = [{ id: 'e1', name: 'Ana', phone: '090-1234-5678' }, { id: 's1', name: 'Bia', phone: '' }]
assert.equal(phoneOwner(people, '09012345678')?.name, 'Ana')
assert.equal(phoneOwner(people, '+81 90 1234 5678')?.name, 'Ana', '+81 is the same number')
assert.equal(phoneOwner(people, '090-1234-5678', 'e1'), null, 'own number is fine')
assert.equal(phoneOwner(people, '090-9999-0000'), null)
assert.equal(phoneOwner(people, ''), null)

const t = newSetupToken()
assert.match(t, /^[a-z0-9]{20,64}$/)
assert.ok(isSetupPassword(setupPassword(t)) && setupPassword(t).startsWith(SETUP_PREFIX))
const link = setupLink('employee', ' Ana@X.jp ', t, 'https://k.app')
assert.ok(link.startsWith('https://k.app/set-password?'))
assert.deepEqual(readSetupLink(link.split('?')[1]), { kind: 'employee', email: 'ana@x.jp', token: t })
assert.equal(readSetupLink('k=admin&e=a@b&t=' + t), null, 'only employee/client links')
assert.equal(readSetupLink('k=client&e=a@b&t=short'), null)
assert.equal(passwordProblem('1234567'), 'short')
assert.equal(passwordProblem('setup:abcdefgh'), 'invalid')
assert.equal(passwordProblem('abcdefgh', 'abcdefgX'), 'mismatch')
assert.equal(passwordProblem('abcdefgh', 'abcdefgh'), null)
console.log('contact mask + password link: ok')
