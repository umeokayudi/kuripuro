#!/usr/bin/env node
/**
 * Deep-clean task picker: title ⇄ tasks and the employee checklist (no DB).
 * Run: npx vite-node scripts/test-deep-tasks.mjs
 */
import assert from 'node:assert/strict'
import { buildDeepTaskTitle, deepTasksFromTitle, parseDeepComponents, getCleaningType, buildJobTitle } from '../src/lib/cleaningType.js'
import { checklistTemplateForJob, checklistDisplayLabel } from '../src/lib/jobChecklist.js'

const title = buildDeepTaskTitle('Kodama Oimachi', ['fryer', 'range_hood'], ['limpar atrás (da) geladeira, porta'])
assert.equal(title, 'Kodama Oimachi — Deep Clean (Range Hood, Fryer, limpar atrás da geladeira porta)')
assert.equal(getCleaningType({ title }), 'deep')
assert.deepEqual(deepTasksFromTitle(title), { ids: ['range_hood', 'fryer'], custom: ['limpar atrás da geladeira porta'] })

// Catalog place: base items + only the picked deep tasks.
const ck = checklistTemplateForJob({ title }).split('\n')
assert.ok(ck.includes('Range Hood — limpeza completa (filtros, duto, superficie)'))
assert.ok(ck.includes('Fryer — oleo retirado, cesto e cuba limpos'))
assert.ok(ck.includes('limpar atrás da geladeira porta'))
assert.ok(!ck.some(l => l.startsWith('Grease Trap')), 'not picked → not in checklist')
assert.ok(ck.includes('Lixo banheiro'), 'store base checklist kept')
assert.equal(checklistDisplayLabel('Fryer — oleo retirado, cesto e cuba limpos', 'pt'), 'Fritadeira — óleo retirado, cesto e cuba limpos')

// Non-catalog place: saved checklist wins; without one, the deep task lines.
const other = 'Hotel X — Deep Clean (Fridge)'
assert.equal(checklistTemplateForJob({ title: other, checklist_template: 'A\nB' }), 'A\nB')
assert.equal(checklistTemplateForJob({ title: other }), 'Fridge — por dentro e por fora, borrachas limpas')

// Explicit list → only those components (client care no longer counts all four as done).
assert.deepEqual(parseDeepComponents({ title: other }), [])
assert.deepEqual(parseDeepComponents({ title: 'Kodama Oimachi — Deep Clean (AC Cleaning, Stove)' }), ['ac'])
assert.ok(parseDeepComponents({ title: 'Kodama Oimachi — Deep Clean' }).includes('grease_trap'), 'no list = all')

// Employee "add service" titles keep working.
const empTitle = buildJobTitle('Kodama Oimachi', { cleaningType: 'deep', deepComponents: ['grease_trap'] })
assert.ok(checklistTemplateForJob({ title: empTitle }).includes('Grease Trap — esvaziado e higienizado'))
assert.ok(!checklistTemplateForJob({ title: buildJobTitle('Kodama Oimachi', { cleaningType: 'deep', deepComponents: ['other'] }) }).split('\n').includes('Other'))

console.log('✓ deep tasks OK')
