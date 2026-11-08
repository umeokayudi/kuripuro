// v1.0.188 · the app reloads itself only for a newer published version
import assert from 'node:assert/strict'
import { versionOfBuild, compareVersions, isNewerBuild } from '../src/lib/appUpdate.js'

assert.equal(versionOfBuild('2026-11-08-v1.0.188'), 'v1.0.188')
assert.equal(versionOfBuild(''), null)
assert.equal(compareVersions('v1.0.188', 'v1.0.187'), 1)
assert.equal(compareVersions('v1.0.99', 'v1.0.100'), -1)
assert.equal(compareVersions('v1.0.188', 'v1.0.188'), 0)
assert.equal(isNewerBuild('2026-11-09-v1.0.189', 'v1.0.188'), true)
assert.equal(isNewerBuild('2026-11-08-v1.0.188', 'v1.0.188'), false)
assert.equal(isNewerBuild('2026-11-07-v1.0.187', 'v1.0.188'), false) // older server (rollback): no loop
assert.equal(isNewerBuild(undefined, 'v1.0.188'), false)
console.log('app-update OK')
