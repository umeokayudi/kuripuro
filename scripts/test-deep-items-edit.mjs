#!/usr/bin/env node
/**
 * v1.0.191 · Edit only the items done in one deep clean (no DB).
 * Run: npx vite-node scripts/test-deep-items-edit.mjs
 */
import assert from 'node:assert/strict'
import { buildDeepTaskTitle } from '../src/lib/cleaningType.js'
import { deepItemsOf, deepItemsPatch } from '../src/lib/deepItemsEdit.js'
import { checklistTemplateForJob, parseChecklistTemplate } from '../src/lib/jobChecklist.js'

const title = buildDeepTaskTitle('Ibushio', ['range_hood', 'grease_trap', 'grating', 'stove', 'ac'])
const job = {
  id: 'j1', title, status: 'completed', value: 7000, employee_pay: 3125,
  description: 'Deep OTP: Grease Trap, Grating, Fogão a gás, Range Hood, Filtro do ar-condicionado',
}
const oldItems = parseChecklistTemplate(checklistTemplateForJob(job))
const oldRows = oldItems.map(label => ({ label, done: true }))
assert.deepEqual(deepItemsOf(job).ids, ['range_hood', 'grease_trap', 'grating', 'stove', 'ac'])

// Only grease trap + grating were done → title and checklist follow; nothing else in the patch.
const p = deepItemsPatch({ ...job, checklist_done: oldItems.length }, ['grease_trap', 'grating'], [], { oldRows })
assert.equal(p.title, 'Ibushio — Deep Clean (Grease Trap, Grating)')
assert.deepEqual(Object.keys(p).sort(), ['checklist_done', 'checklist_missed_items', 'checklist_template', 'checklist_total', 'title'])
assert.ok(!p.checklist_template.includes('Range Hood'))
assert.ok(p.checklist_template.includes('Grease Trap — esvaziado e higienizado'))
assert.equal(p.checklist_done, p.checklist_total, 'kept items stay ticked')
assert.equal(p.checklist_missed_items, null)

// Adding a free-text item on a finished job counts as done; a missed item stays missed.
const rows2 = oldRows.map(r => r.label.startsWith('Grating') ? { ...r, done: false } : r)
const p2 = deepItemsPatch(job, ['grating'], ['lavar porta dos fundos'], { oldRows: rows2 })
assert.equal(p2.title, 'Ibushio — Deep Clean (Grating, lavar porta dos fundos)')
assert.equal(p2.checklist_total - p2.checklist_done, 1)
assert.ok(p2.checklist_missed_items.startsWith('Grating'))

// Job still to do: no tick counters written.
const p3 = deepItemsPatch({ ...job, status: 'pending' }, ['fryer'], [])
assert.equal(p3.title, 'Ibushio — Deep Clean (Fryer)')
assert.equal(p3.checklist_done, undefined)

// Empty list or same list → nothing to save.
assert.equal(deepItemsPatch(job, [], []), null)
assert.equal(deepItemsPatch(job, ['range_hood', 'grease_trap', 'grating', 'stove', 'ac'], []), null)

// Old title without a list ("Loc — Deep Clean") gets one.
assert.equal(deepItemsPatch({ title: 'Kodama Kinshicho — Deep Clean', status: 'completed' }, ['ac'], []).title, 'Kodama Kinshicho — Deep Clean (AC Cleaning)')

console.log('deep items edit: ok')
