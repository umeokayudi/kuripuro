import { supabase } from './supabase'
import { getConfirmablePeriod } from './salaryPeriod'

// v1.0.108 · Salary complaints that arrive in the Chat become Salary issues (one place to answer them).
const SALARY_WORDS = /sal[aá]ri|holerite|pagamento|desconto|payslip|salary|wage|paid|deduction|給与|給料|明細|控除|支払/i

export const looksLikeSalaryMessage = text => SALARY_WORDS.test(String(text || ''))

/** Creates a pending Salary issue from a chat message, linked to that month's payslip when there is one. */
export async function salaryIssueFromChat(employee, message) {
  const period = getConfirmablePeriod()
  const { data: st } = await supabase.from('salary_statements').select('id').eq('employee_id', employee.id).eq('period', period).maybeSingle()
  const { error } = await supabase.from('salary_complaints').insert({
    employee_id: employee.id, employee_name: employee.full_name,
    period, statement_id: st?.id || null,
    category: 'chat', description: String(message.content || '').trim(), status: 'pending',
  })
  if (error) throw error
  return period
}
