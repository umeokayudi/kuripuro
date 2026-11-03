// v1.0.148 · The owner's two answers for "Coberto por outro" (see lib/jobCoverage.js).
import { supabase } from './supabase'
import { tokyoToday } from './dates'
import { removeCoverPatch, keepCoverPatch, suggestedPayForB } from './jobCoverage'
import { logJobAdmin } from './jobAdminOps'

function ownerName() {
  try { return JSON.parse(localStorage.getItem('kp_user') || '{}').name || 'dono' } catch { return 'dono' }
}

/** Fresh copies of A and B (with every column, employee_pay included when it exists). */
export async function loadCoverPair(aId, bId) {
  const { data, error } = await supabase.from('jobs').select('*').in('id', [aId, bId])
  if (error) throw error
  return { a: (data || []).find(j => j.id === aId) || null, b: (data || []).find(j => j.id === bId) || null }
}

/**
 * [Retirar de A]: only while A is still not done (never touches a job A finished meanwhile).
 * passPay: also write A's pay line on B when B has none.
 */
export async function removeFromA(a, b, { passPay = false } = {}) {
  const today = tokyoToday()
  const patch = removeCoverPatch(a, b, { owner: ownerName(), today })
  const { data, error } = await supabase.from('jobs').update(patch).eq('id', a.id).in('status', ['assigned', 'in_progress']).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('changed')
  await logJobAdmin(a.id, 'coverage_removed', { reason: patch.description.split('\n').pop(), oldValue: { status: a.status }, newValue: { status: 'cancelled', covered_by_job: b.id } })
  const pay = suggestedPayForB(a, b)
  if (passPay && pay != null) {
    await supabase.from('jobs').update({ employee_pay: pay, employee_pay_updated_by: `${ownerName()} (cobertura de ${a.employee_name || '—'})` }).eq('id', b.id).is('employee_pay', null)
  }
  return { pay }
}

/** [Manter em A]: stays on A's agenda; this cover is not asked again. */
export async function keepInA(a, b) {
  const patch = keepCoverPatch(a, b, { owner: ownerName(), today: tokyoToday() })
  const { error } = await supabase.from('jobs').update(patch).eq('id', a.id)
  if (error) throw error
  await logJobAdmin(a.id, 'coverage_kept', { reason: patch.description.split('\n').pop(), newValue: { covered_by_job: b.id } })
}
