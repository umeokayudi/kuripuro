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
