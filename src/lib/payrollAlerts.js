// Payroll periods the daily cron closed on its own and the admin has not reviewed yet.
import { supabase } from './supabase'

export const PAYROLL_CHANGED = 'kp-payroll-changed'

export async function fetchAutoClosedPeriods() {
  const { data, error } = await supabase.from('salary_periods')
    .select('id,period,closed_at,confirm_deadline,pay_date,status')
    .eq('status', 'auto_closed').order('period', { ascending: false }).limit(12)
  if (error) throw error
  return data || []
}
