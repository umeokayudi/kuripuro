// v1.0.148 · The owner's two answers for "Coberto por outro" (see lib/jobCoverage.js).
import { supabase } from './supabase'
import { tokyoToday } from './dates'
import { removeCoverPatch, keepCoverPatch, suggestedPayForB } from './jobCoverage'
import { logJobAdmin } from './jobAdminOps'
import toast from 'react-hot-toast'
import { askConfirm } from '../components/ConfirmDialog'

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

const coverLine = (x, dShort) => `${dShort(x.date)} · ${x.place} · ${x.byJob ? String(x.byJob.title || '').split(' — ')[1] || '' : ''}`
/** Asks and applies the owner's decision. true = changed. Shared by the bell and the Dashboard. */
export async function decideCoverFlow(x, remove, { L, dShort = d => d }) {
  let pair
  try { pair = await loadCoverPair(x.jobId, x.byJob?.id) } catch (err) { toast.error(err.message); return false }
  const { a, b } = pair
  if (!a || !b || !['assigned', 'in_progress'].includes(a.status) || b.status !== 'completed') { toast(L('Already changed — list updated', 'すでに変更されています', 'Já mudou — lista atualizada')); return false }
  if (!remove) {
    if (!(await askConfirm({
      title: L(`Keep on ${a.employee_name}'s agenda?`, `${a.employee_name}の予定に残しますか？`, `Manter na agenda de ${a.employee_name}?`),
      message: `${coverLine(x, dShort)}\n${L(`Done by ${b.employee_name}. It stays on ${a.employee_name}'s agenda and is not asked again.`, `${b.employee_name}が実施済み。${a.employee_name}の予定に残り、再確認しません。`, `Feito por ${b.employee_name}. Continua na agenda de ${a.employee_name} e não pergunta de novo.`)}`,
      confirmLabel: L(`Keep on ${a.employee_name}`, '残す', `Manter em ${a.employee_name}`), danger: false,
    }))) return false
    try { await keepInA(a, b) } catch (err) { toast.error(err.message); return false }
    toast.success(L('Kept', '残しました', 'Mantido'))
  } else {
    const pay = suggestedPayForB(a, b)
    if (!(await askConfirm({
      title: L(`Remove from ${a.employee_name}?`, `${a.employee_name}から外しますか？`, `Retirar de ${a.employee_name}?`),
      message: `${coverLine(x, dShort)}\n${L(`Done by ${b.employee_name}. It leaves ${a.employee_name}'s agenda (past date included), is not paid to ${a.employee_name} and is recorded as "removed with the owner's authorization — done by ${b.employee_name}". Reports count it once.`, `${b.employee_name}が実施。${a.employee_name}の予定から外し（過去日も）、${a.employee_name}の給与に含めず、「オーナー承認で削除 — 実施 ${b.employee_name}」と記録します。`, `Feito por ${b.employee_name}. Sai da agenda de ${a.employee_name} (inclusive data passada), não entra na folha de ${a.employee_name} e fica no histórico "baixado por autorização do dono — executado por ${b.employee_name}". Relatórios contam uma vez.`)}`,
      confirmLabel: L(`Remove from ${a.employee_name}`, '外す', `Retirar de ${a.employee_name}`), danger: true,
    }))) return false
    let passPay = false
    if (pay != null) passPay = await askConfirm({
      title: L(`Pay ¥${pay.toLocaleString()} to ${b.employee_name}?`, `${b.employee_name}に¥${pay.toLocaleString()}？`, `Pagar ¥${pay.toLocaleString()} para ${b.employee_name}?`),
      message: L(`${b.employee_name}'s job has no pay line ("to define"). Suggested: the value that was on ${a.employee_name}'s job.`, `${b.employee_name}の作業に支払額がありません。${a.employee_name}の作業の金額を提案します。`, `O job de ${b.employee_name} está sem pagamento ("a definir"). Sugestão: o valor que estava no job de ${a.employee_name}.`),
      confirmLabel: L('Yes, use this value', 'この金額にする', 'Sim, usar esse valor'), danger: false,
    })
    try { await removeFromA(a, b, { passPay }) } catch (err) { toast.error(err.message === 'changed' ? L('Already changed', 'すでに変更済み', 'Já mudou') : err.message); return false }
    toast.success(L(`Removed from ${a.employee_name}`, `${a.employee_name}から外しました`, `Retirado de ${a.employee_name}`))
  }
  return true
}
