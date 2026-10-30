// v1.0.112 · Field execution on the phone: "forgot to finish?" reminder, payslip in 3 states,
// "report a problem" message format (read by the owner's exception queue).

/** Minutes after the planned end at which the worker is asked "did you forget to finish?". */
export const FORGOT_AFTER_MIN = 30

/** true once the job ran `planned + 30` minutes and it was not asked yet. */
export function shouldAskForgot({ elapsedSec, plannedMin, asked }) {
  if (asked || !plannedMin) return false
  return elapsedSec / 60 >= plannedMin + FORGOT_AFTER_MIN
}

/**
 * The worker's view of the payslip: one of
 *  to_confirm  — "to confirm by you"   (single Confirm button)
 *  confirmed   — "confirmed by you"
 *  paid        — "paid on <date>"
 *  disputed    — "you disputed — waiting for the office"
 */
export function employeeSlipState(statement, salaryLine) {
  if (!statement) return null
  if (salaryLine?.status === 'paid') return 'paid'
  if (statement.employee_confirmed_at) return 'confirmed'
  if (statement.employee_disputed_at || statement.status === 'disputed') return 'disputed'
  return 'to_confirm'
}

export function employeeSlipText(state, L, paidOn = '') {
  switch (state) {
    case 'paid': return { text: L(`Paid${paidOn ? ` on ${paidOn}` : ''}`, `支払済${paidOn ? `（${paidOn}）` : ''}`, `Pago${paidOn ? ` em ${paidOn}` : ''}`), tone: 'ok' }
    case 'confirmed': return { text: L('Confirmed by you', '確認済み', 'Confirmado por você'), tone: 'ok' }
    case 'disputed': return { text: L('You disputed — waiting for the office', '異議あり — 事務所の回答待ち', 'Você contestou — aguardando o escritório'), tone: 'bad' }
    case 'to_confirm': return { text: L('To confirm by you', '確認してください', 'A confirmar por você'), tone: 'warn' }
    default: return { text: '', tone: '' }
  }
}

// "Report a problem" goes to the office chat with a marker the exception queue can read.
const MARK = /#job:([\w-]+)/
export const problemMessage = ({ place, date, text, jobId }) => `🛠 ${place}${date ? ` (${date})` : ''}\n${String(text || '').trim()}\n#job:${jobId}`
export const problemJobId = content => (String(content || '').match(MARK) || [])[1] || null
