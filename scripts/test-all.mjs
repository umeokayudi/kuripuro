#!/usr/bin/env node
import { spawnSync } from 'child_process'

const steps = [
  ['npm run lint', 'lint'],
  ['npm run build', 'build'],
  ['npm run test:salary-calc', 'salary-calc'],
  ['npm run test:safety-net', 'safety-net'],
  ['npm run test:deep-clean', 'deep-clean'],
  ['npm run test:portal-auth', 'portal-auth'],
  ['npm run test:add-service', 'add-service'],
  ['npm run test:add-service-options', 'add-service-options'],
  ['npm run test:past-service', 'past-service'],
  ['npm run test:job-overdue', 'job-overdue'],
  ['npm run test:employee-pay', 'employee-pay'],
  ['npm run test:admin-mobile', 'admin-mobile'],
  ['npm run test:account', 'account'],
  ['npm run test:employee-login', 'employee-login'],
  ['npm run test:body-scroll-lock', 'body-scroll-lock'],
  ['npm run test:job-gps', 'job-gps'],
  ['npm run test:photo-ai', 'photo-ai'],
  ['npm run test:client-portal', 'client-portal'],
  ['npm run test:schedule-assign', 'schedule-assign'],
  ['npm run test:app-dialog', 'app-dialog'],
  ['npm run test:progress-split', 'progress-split'],
]

console.log('=== KuriPuro full test suite ===\n')

for (const [cmd, name] of steps) {
  console.log(`--- ${name} ---`)
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit', env: process.env })
  if (r.status !== 0) {
    console.error(`\n❌ Failed: ${name}`)
    process.exit(r.status || 1)
  }
  console.log('')
}

console.log('✅ All test suites passed')
