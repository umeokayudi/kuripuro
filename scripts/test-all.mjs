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
  ['npm run test:past-service', 'past-service'],
  ['npm run test:job-overdue', 'job-overdue'],
  ['npm run test:employee-pay', 'employee-pay'],
  ['npm run test:invoice', 'invoice'],
  ['npm run test:period', 'period'],
  ['npm run test:report-analytics', 'report-analytics'],
  ['npm run test:sales', 'sales'],
  ['npm run test:salesperson', 'salesperson'],
  ['npm run test:admin-layout', 'admin-layout'],
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
