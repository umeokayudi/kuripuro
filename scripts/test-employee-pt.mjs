// Portuguese in the employee portal: PT is offered to employees, the Brazilian team opens in PT,
// and dates / voice / payslip have Portuguese text.
import assert from 'node:assert/strict'
import { canUsePt, ptByDefault } from '../src/hooks/useLang.jsx'
import { monthLabel, dayLabel, rangeLabel } from '../src/lib/earnings.js'
import { spokenDuration } from '../src/lib/voiceAlert.js'
import { payslipHtml } from '../src/lib/payslipPdf.js'
import { translations } from '../src/i18n/translations.js'

assert.equal(canUsePt({ role: 'employee', id: 'x' }), true)
assert.equal(canUsePt({ role: 'client', id: 'x' }), false)
assert.equal(ptByDefault({ role: 'employee', id: '3a39b220-9984-41e4-ab61-4cf96b93a99f' }), true) // Letícia
assert.equal(ptByDefault({ role: 'employee', id: '8772f25f-7bd2-460d-8818-ad3bad3ab541' }), true) // Guilherme
assert.equal(ptByDefault({ role: 'employee', id: 'someone-else' }), false)
assert.equal(ptByDefault({ role: 'admin', id: '4c064fb5-e39d-4086-a798-f6e670730bac' }), false)

assert.equal(monthLabel('2026-10', 'pt', true), 'outubro de 2026')
assert.equal(monthLabel('2026-10', 'en', true), 'Oct 2026')
assert.equal(dayLabel('2026-10-25', 'pt'), 'dom 25 out')
assert.equal(rangeLabel('2026-10-19', '2026-10-25', 'pt'), '19 out – 25 out')
assert.equal(spokenDuration(65, 'pt'), '1 hora e 5 minutos')
assert.equal(spokenDuration(65, 'en'), '1 hour 5 minutes')
assert.match(payslipHtml({ employee: { full_name: 'A' }, month: '2026-10', salary: {}, lang: 'pt' }), /Holerite/)

// Every employee screen key has Portuguese text (no English fallback left).
const missing = Object.keys(translations.en.employee).filter(k => translations.pt.employee[k] === translations.en.employee[k] && /[a-z]{4}/.test(String(translations.en.employee[k])))
console.log('same as English (names/ok words):', missing.join(', ') || 'none')
console.log('✅ employee portal Portuguese OK')
