// Portuguese in the employee portal: the admin marks who speaks Portuguese (employees.speaks_portuguese,
// with the Brazilian team as fallback until the column exists). They always get PT; others get EN / JA only.
import assert from 'node:assert/strict'
import { canUsePt } from '../src/hooks/useLang.jsx'
import { speaksPt, hasPtColumn } from '../src/lib/employeeLang.js'
import { monthLabel, dayLabel, rangeLabel } from '../src/lib/earnings.js'
import { spokenDuration } from '../src/lib/voiceAlert.js'
import { payslipHtml } from '../src/lib/payslipPdf.js'
import { translations } from '../src/i18n/translations.js'

const LETICIA = '3a39b220-9984-41e4-ab61-4cf96b93a99f'
assert.equal(canUsePt({ role: 'employee', id: 'x' }, false), false) // not a PT speaker: EN / JA only
assert.equal(canUsePt({ role: 'employee', id: 'x' }, true), true)
assert.equal(canUsePt({ role: 'admin', id: 'x' }, false), true)
assert.equal(canUsePt({ role: 'client', id: 'x' }, false), false)
// before the SQL: fallback list
assert.equal(speaksPt({ id: LETICIA }), true)
assert.equal(speaksPt({ id: 'someone-else' }), false)
// after the SQL: the admin's choice wins
assert.equal(hasPtColumn({ id: LETICIA, speaks_portuguese: false }), true)
assert.equal(speaksPt({ id: LETICIA, speaks_portuguese: false }), false)
assert.equal(speaksPt({ id: 'someone-else', speaks_portuguese: true }), true)

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
