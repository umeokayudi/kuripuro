// v1.0.110 · An employee score exists only once someone has evaluated the person (evaluation or complaint).
// Before that the screens show "—" instead of the default 100.
import { supabase } from './supabase'

export async function fetchEvaluatedIds() {
  const [ev, co] = await Promise.all([
    supabase.from('evaluations').select('employee_id').limit(5000),
    supabase.from('complaints').select('employee_id').limit(5000),
  ])
  return new Set([...(ev.data || []), ...(co.data || [])].map(r => r.employee_id).filter(Boolean))
}

/** number or null ("—") */
export const scoreOf = (emp, evaluated) => (evaluated?.has(emp?.id) ? Number(emp?.score ?? 100) : null)

/** ranking order: people with a score first (highest first), then the rest by name */
export const byScore = evaluated => (a, b) => {
  const sa = scoreOf(a, evaluated), sb = scoreOf(b, evaluated)
  if (sa == null || sb == null) return (sa == null) - (sb == null) || String(a.full_name).localeCompare(String(b.full_name))
  return sb - sa
}
