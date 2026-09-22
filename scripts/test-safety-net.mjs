#!/usr/bin/env node
/**
 * Fast regression tests — no DB writes. Run on every CI build.
 */
import { readFileSync } from 'fs'
import { kuripuroEn, kuripuroJa } from '../src/i18n/kuripuro.js'
import { escapeHtml } from '../src/lib/escapeHtml.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function assertKeyParity(enObj, jaObj, label) {
  const enKeys = Object.keys(enObj || {}).sort()
  const jaKeys = Object.keys(jaObj || {}).sort()
  const missingJa = enKeys.filter(k => !jaKeys.includes(k))
  const extraJa = jaKeys.filter(k => !enKeys.includes(k))
  assert(missingJa.length === 0, `${label} JA missing: ${missingJa.join(', ')}`)
  assert(extraJa.length === 0, `${label} JA extra: ${extraJa.join(', ')}`)
}

function testI18nClientKeys() {
  const enKeys = Object.keys(kuripuroEn.client || {}).sort()
  assert(enKeys.length > 20, `en client keys: ${enKeys.length}`)
  assertKeyParity(kuripuroEn.client, kuripuroJa.client, 'client')
  assertKeyParity(kuripuroEn.employee, kuripuroJa.employee, 'employee')
  assertKeyParity(kuripuroEn.dashboard, kuripuroJa.dashboard, 'dashboard')
  assertKeyParity(kuripuroEn.jobs, kuripuroJa.jobs, 'jobs')
  assert(kuripuroJa.client.portal, 'ja client.portal')
  assert(kuripuroEn.client.portal, 'en client.portal')
  assert(kuripuroJa.employee?.wrongDeepDay, 'ja employee.wrongDeepDay')
  assert(kuripuroEn.employee.noShiftToday, 'en employee.noShiftToday')
  assert(kuripuroEn.employee.gpsTooFar, 'en employee.gpsTooFar')
  assert(kuripuroJa.employee.gpsTooFar, 'ja employee.gpsTooFar')
  assert(kuripuroEn.live.folga, 'en live.folga')
  assert(kuripuroJa.live.folga, 'ja live.folga')
  assertKeyParity(kuripuroEn.live, kuripuroJa.live, 'live')
  assert(kuripuroEn.dashboard.liveFolga, 'en dashboard.liveFolga')
assert(kuripuroJa.dashboard.liveNow, 'ja dashboard.liveNow')
assert(kuripuroJa.dashboard.noTodayJobs, 'ja dashboard.noTodayJobs')
}

function testEscapeHtml() {
  assert(escapeHtml('<script>') === '&lt;script&gt;', 'escape < >')
  assert(escapeHtml('A & B') === 'A &amp; B', 'escape &')
  assert(escapeHtml(null) === '', 'null safe')
}

function testEmployeePortalPhotoStability() {
  const portal = readFileSync('src/pages/EmployeePortal.jsx', 'utf8')
  assert(!/const JobModal\s*=/.test(portal), 'JobModal must not be defined inside EmployeePortal')
  assert(!/const JobPhoto\s*=/.test(portal), 'JobPhoto must not be defined inside EmployeePortal')
  assert(!/setClock\(new Date\(\)\)/.test(portal), 'clock tick must not re-render EmployeePortal')
  assert(portal.includes('EmployeeJobModal'), 'uses extracted EmployeeJobModal')
  assert(portal.includes('EmpLiveDate'), 'isolated live date')
  assert(portal.includes('EmpLiveTime'), 'isolated live time')
  const modal = readFileSync('src/components/EmployeeJobModal.jsx', 'utf8')
  assert(modal.includes('PhotoLightbox'), 'completed job photos open still lightbox')
  assert(modal.includes('onPhotoClick'), 'photos are tappable')
  const auth = readFileSync('src/hooks/useAuth.jsx', 'utf8')
  assert(auth.includes('findEmployeeForLogin'), 'employee login uses case-insensitive matcher')
}

function testNoHooksViolationPatterns() {
  const files = [
    'src/pages/ClientPortal.jsx',
    'src/pages/EmployeePortal.jsx',
    'src/pages/LiveTracking.jsx',
    'src/pages/AdminChat.jsx',
    'src/components/JobPhotos.jsx',
    'src/components/EmployeeJobModal.jsx',
    'src/components/PhotoLightbox.jsx',
  ]
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const earlyReturn = src.match(/\n\s+if\s*\([^)]+\)\s*\{\s*\n\s+return\s*\(/)
    const hooksAfter = /useEffect[\s\S]{0,200}useState\(/.test(src)
    if (earlyReturn && hooksAfter) {
      throw new Error(`${file}: possible hooks after early return`)
    }
  }
}

function testBuildOutput() {
  const indexHtml = readFileSync('dist/index.html', 'utf8')
  assert(indexHtml.includes('/assets/index-'), 'dist/index.html has main bundle')
}

async function main() {
  console.log('=== Safety net tests ===\n')
  testI18nClientKeys()
  console.log('✅ i18n client keys (EN/JA parity)')
  testEscapeHtml()
  console.log('✅ escapeHtml')
  testEmployeePortalPhotoStability()
  console.log('✅ employee portal photo stability')
  testNoHooksViolationPatterns()
  console.log('✅ hooks order static check')
  testBuildOutput()
  console.log('✅ build output exists')
  console.log('\n✅ All safety net tests passed')
}

main().catch(err => {
  console.error('\n❌', err.message)
  process.exit(1)
})
