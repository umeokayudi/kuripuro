// v1.0.115 · The AI photo grade is shown only WITH its reasons: number + the problems it found
// (or "no problems" when it approved the photo). A bare number with no reason is hidden.
import { aiIssueRows } from './photoAi'

/** → null (hide) or { score, approved, reasons: [{ issue, fix }], clean } */
export function aiScoreView(row) {
  const score = row?.photo_ai_score
  if (score == null || score === '') return null
  const reasons = aiIssueRows(row.photo_ai_issues)
  const clean = !reasons.length && row.photo_ai_approved === true
  if (!reasons.length && !clean) return null
  return { score: Number(score), approved: row.photo_ai_approved === true, reasons, clean }
}

/** one-line reason for lists: first problem (+N), or the "no problems" label */
export function aiReasonShort(view, noProblems) {
  if (!view) return ''
  if (view.clean) return noProblems
  return view.reasons[0].issue + (view.reasons.length > 1 ? ` (+${view.reasons.length - 1})` : '')
}
