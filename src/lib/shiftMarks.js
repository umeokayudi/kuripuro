// v1.0.151 · Shift do dia — the person's own mark for ONE specific day (never the weekly pattern).
// Stored in employee_availability (one row per person per day): 'confirmed' | 'off' (Não posso) | 'extra'.
// Audit: marked_by / marked_by_role + employee_availability_log (sql/2026-11-05_marca_shift_do_dia.sql).
// Until that SQL runs, the app still saves the mark and writes who marked it in admin_note.
import { supabase } from './supabase.js'
import { TIME_OFF_CHANGED } from './timeOff.js'
import { pendingChanged } from './adminPending.js'

export const SHIFT_MARK_CHANGED = 'kp-shift-mark-changed'
const missingColumn = err => /marked_by|column .* does not exist|schema cache/i.test(String(err?.message || ''))

/** Row to save. by = { name, role: 'employee' | 'admin' }. Admin marks need no approval. */
export function shiftMarkRow({ employee, date, kind, reason = '', by, now = new Date() }) {
  if (!['confirmed', 'off', 'extra'].includes(kind)) throw new Error('bad kind')
  const admin = by?.role === 'admin'
  const at = now.toISOString()
  return {
    employee_id: employee.id, employee_name: employee.name || employee.full_name || '', date, kind,
    note: kind === 'off' ? (String(reason || '').trim() || null) : null,
    // "Vou trabalhar" needs no approval; "Não posso" / extra still go to the bell unless the admin marked them
    status: kind === 'confirmed' || admin ? 'approved' : 'pending',
    admin_note: admin ? `Marcado pelo admin${by?.name ? ` (${by.name})` : ''} em ${at.slice(0, 16).replace('T', ' ')} UTC` : null,
    decided_at: admin || kind === 'confirmed' ? at : null,
    updated_at: at,
    marked_by: by?.name || null, marked_by_role: admin ? 'admin' : 'employee',
  }
}

function changed() {
  try { window.dispatchEvent(new Event(SHIFT_MARK_CHANGED)); window.dispatchEvent(new Event(TIME_OFF_CHANGED)) } catch { /* SSR */ }
  try { pendingChanged() } catch { /* no window */ }
}

export async function saveShiftMark(args) {
  const row = shiftMarkRow(args)
  let { error } = await supabase.from('employee_availability').upsert(row, { onConflict: 'employee_id,date' })
  if (error && missingColumn(error)) {
    const { marked_by, marked_by_role, ...rest } = row // eslint-disable-line no-unused-vars
    ;({ error } = await supabase.from('employee_availability').upsert(rest, { onConflict: 'employee_id,date' }))
  }
  if (error) throw error
  changed()
  return row
}

/** Remove the mark of that day (back to "sem marca"). */
export async function clearShiftMark(employeeId, date) {
  const { error } = await supabase.from('employee_availability').delete().eq('employee_id', employeeId).eq('date', date)
  if (error) throw error
  changed()
}

export async function fetchShiftMarks(employeeId, from, to) {
  const { data, error } = await supabase.from('employee_availability').select('*').eq('employee_id', employeeId).gte('date', from).lte('date', to)
  if (error) throw error
  return data || []
}
