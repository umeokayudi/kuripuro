// v1.0.96 · Automatic deductions (checklist items not done) are only suggestions until a person
// reviews them. Without a new DB status they are saved as `cancelled` with this prefix, so they
// never count in pay; the admin approves (→ scheduled, counts) or rejects (stays cancelled).
export const REVIEW_PREFIX = '🤖 A revisar · '
export const REJECTED_PREFIX = '✕ Recusado · '

export const isDeductionToReview = row => !!row?.is_deduction && row.status === 'cancelled' && String(row.description || '').startsWith(REVIEW_PREFIX)
export const reviewText = row => String(row?.description || '').replace(REVIEW_PREFIX, '').replace(REJECTED_PREFIX, '')

export function approvePatch(row, amount) {
  return { status: 'scheduled', description: reviewText(row), ...(amount != null ? { amount } : {}) }
}
export function rejectPatch(row) {
  return { status: 'cancelled', description: REJECTED_PREFIX + reviewText(row) }
}

// v1.0.133 · A deduction cancelled by the admin carries who/when in its description, so a cancelled row
// is never a silent end: one without this mark (old data, e.g. Alexandre −¥1.091 of 18/10) is flagged
// "cancelado sem confirmação" on the payroll screens with a button to make it count again.
export const CANCELLED_PREFIX = '⊘ Cancelado'
const CANCEL_RE = /^⊘ Cancelado[^·]*· /

export const isAdminCancelled = row => CANCEL_RE.test(String(row?.description || ''))
export const isSilentCancel = row => !!row?.is_deduction && row.status === 'cancelled'
  && !isAdminCancelled(row) && !String(row.description || '').startsWith(REJECTED_PREFIX) && !String(row.description || '').startsWith(REVIEW_PREFIX)
/** Description without the review / cancel marks. */
export const cancelText = row => reviewText(row).replace(CANCEL_RE, '')

/** Admin cancels (after a confirmation): status cancelled + who/when kept in the description. */
export function cancelPatch(row, who = 'admin', day = new Date().toISOString().slice(0, 10)) {
  return { status: 'cancelled', description: `${CANCELLED_PREFIX} (${who}, ${day}) · ${cancelText(row)}` }
}
/** Count again (undo a cancel). */
export function reactivatePatch(row) {
  return { status: 'scheduled', description: cancelText(row) }
}
