// Day-off / extra-work requests (employee_availability) waiting for the admin.
import { supabase } from './supabase'

export const TIME_OFF_CHANGED = 'kp-timeoff-changed'

export async function fetchPendingTimeOff(today) {
  const { data, error } = await supabase.from('employee_availability')
    .select('id,employee_id,employee_name,date,kind,note,status,created_at')
    .eq('status', 'pending').gte('date', today)
    .order('date', { ascending: true }).limit(200)
  if (error) throw error
  return data || []
}

export async function countPendingTimeOff(today) {
  const { count, error } = await supabase.from('employee_availability')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending').gte('date', today)
  if (error) return 0
  return count || 0
}

/** Approve or reject: writes status, decided_at and the admin note. */
export async function decideTimeOff(id, status, adminNote) {
  if (!['approved', 'rejected'].includes(status)) throw new Error('bad status')
  const now = new Date().toISOString()
  const { error } = await supabase.from('employee_availability')
    .update({ status, admin_note: adminNote?.trim() || null, decided_at: now, updated_at: now })
    .eq('id', id)
  if (error) throw error
  try { window.dispatchEvent(new Event(TIME_OFF_CHANGED)) } catch { /* SSR */ }
}
