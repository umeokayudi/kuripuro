#!/usr/bin/env node
import { spawnSync } from 'child_process'

const steps = [
  ['npm run lint', 'lint'],
  ['npm run build', 'build'],
  ['npm run test:salary-calc', 'salary-calc'],
  ['npm run test:payroll-close', 'payroll-close'],
  ['npm run test:money', 'money'],
  ['npm run test:exception-queue', 'exception queue'],
  ['npm run test:ai-score', 'AI score with reasons'],
  ['npm run test:client-rating-ask', 'client rating ask'],
  ['npm run test:global-search', 'global-search'],
  ['npm run test:sales-followup', 'sales-followup'],
  ['npm run test:work-kpis', 'work-kpis'],
  ['npm run test:client-care', 'client-care'],
  ['npm run test:availability', 'availability'],
  ['npm run test:schedule', 'schedule generator'],
  ['npm run test:assign-flow', 'assign flow'],
  ['npm run test:sales-kpi', 'sales-kpi'],
  ['npm run test:sales-insights', 'sales-insights'],
  ['npm run test:sales-rules', 'sales rules (alert, closed value, quote→contract)'],
  ['npm run test:contact-mask', 'masked phone/e-mail, unique phone, set-password link'],
  ['npm run test:mitsumori', 'mitsumori'],
  ['npm run test:ai-guard', 'ai-guard'],
  ['npm run test:tool-loop', 'tool-loop'],
  ['npm run test:gemini-thinking', 'gemini-thinking'],
  ['npm run test:employee-ai-pay', 'employee-ai-pay'],
  ['npm run test:safety-net', 'safety-net'],
  ['npm run test:deep-clean', 'deep-clean'],
  ['npm run test:portal-auth', 'portal-auth'],
  ['npm run test:add-service', 'add-service'],
  ['npm run test:past-service', 'past-service'],
  ['npm run test:job-overdue', 'job-overdue'],
  ['npm run test:manual-close', 'manual-close'],
  ['npm run test:job-due-alert', 'job-due-alert'],
  ['npm run test:video-compress', 'video-compress'],
  ['npm run test:employee-pay', 'employee-pay'],
  ['npm run test:facility', 'facility'],
  ['npm run test:employee-theme', 'employee-theme'],
  ['npm run test:quick-round', 'quick-round'],
  ['npm run test:next-day-shift', 'next-day-shift'],
  ['npm run test:team-chat', 'team-chat'],
  ['npm run test:spot-contract', 'spot-contract'],
  ['npm run test:invoice-quote', 'invoice-quote'],
  ['npm run test:nfc-clock', 'nfc-clock'],
  ['npm run test:jobs-period', 'jobs-period'],
  ['npm run test:maps-link', 'maps-link'],
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
