// The Hello Kitty theme must match only Leticia's employee id.
import assert from 'node:assert/strict'
import { employeeThemeFor, LETICIA_EMPLOYEE_ID } from '../src/lib/employeeTheme.js'

assert.equal(employeeThemeFor({ id: LETICIA_EMPLOYEE_ID, role: 'employee', name: 'Leticia Nagaoka' }), 'hello-kitty')
assert.equal(employeeThemeFor({ id: 'other-id', role: 'employee', name: 'Leticia Nagaoka', email: 'leticia@kuripuro.com' }), null)
assert.equal(employeeThemeFor({ id: LETICIA_EMPLOYEE_ID, role: 'admin' }), null)
assert.equal(employeeThemeFor({ id: LETICIA_EMPLOYEE_ID, role: 'client' }), null)
assert.equal(employeeThemeFor({ id: 'toString', role: 'employee' }), null)
assert.equal(employeeThemeFor(null), null)
console.log('✅ employee theme only for Leticia')
