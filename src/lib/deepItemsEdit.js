/**
 * v1.0.191 · Edit only the items done in one deep clean (one restaurant, one day).
 * The items live in the job title "Loc — Deep Clean (Range Hood, Grease Trap)"; changing them
 * also rebuilds the employee checklist so x of y, reports and the month's deep count stay right.
 * Nothing else of the job (date, person, value, pay) is touched.
 */
import { buildDeepTaskTitle, deepTasksFromTitle, locationNameFromTitle, cleanCustomTask } from './cleaningType.js'
import { checklistTemplateForJob, parseChecklistTemplate } from './jobChecklist.js'

/** Items of a job as { ids, custom } (known task ids + free-text items). */
export function deepItemsOf(job) {
  return deepTasksFromTitle(job?.title)
}

/** Fields to save on the job for the new list of items, or null when nothing changes / list empty. */
export function deepItemsPatch(job, ids = [], custom = [], { oldRows = null } = {}) {
  const cleanCustom = [...new Set(custom.map(cleanCustomTask).filter(Boolean))]
  if (!ids.length && !cleanCustom.length) return null
  const loc = locationNameFromTitle(job?.title) || String(job?.title || '').trim()
  const title = buildDeepTaskTitle(loc, ids, cleanCustom)
  if (title === job?.title) return null
  // Build the checklist from the new items only (the old saved template would win otherwise).
  const checklist_template = checklistTemplateForJob({ ...job, title, checklist_template: null }) || null
  const patch = { title, checklist_template }
  const items = parseChecklistTemplate(checklist_template)
  // Ticks: keep what was already ticked / missed by label; a new item counts as done on a finished job
  // (the admin is saying it was done), not done yet on a job still to do.
  const known = job?.checklist_done != null || job?.status === 'completed'
  if (known && items.length) {
    const wasDone = Object.fromEntries((oldRows || []).map(r => [r.label, r.done]))
    const rows = items.map(label => ({ label, done: label in wasDone ? wasDone[label] : job.status === 'completed' }))
    const missed = rows.filter(r => !r.done).map(r => r.label)
    Object.assign(patch, {
      checklist_total: rows.length,
      checklist_done: rows.length - missed.length,
      checklist_missed_items: missed.length ? missed.join(', ') : null,
    })
  }
  return patch
}
