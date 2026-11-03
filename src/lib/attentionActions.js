// v1.0.149 · "Precisa de atenção": every row can be RESOLVED where it is, and leaves the list the
// moment it is resolved (no waiting for the next refresh, no item that only someone else can clear
// counting as the admin's to-do). One place for the rules, used by the Dashboard.
import { supabase } from './supabase'
import { adminMarkNotDone } from './jobAdminOps'
import { gradeJobPhoto } from './photoAi'
import { pendingChanged } from './adminPending'

/** Kinds that wait on someone else (the admin cannot clear them): shown apart, never in the red total. */
export const WAITING_KINDS = new Set(['paid_unconfirmed'])
export const isWaiting = x => !!x?.waiting || WAITING_KINDS.has(x?.kind)

/**
 * The same job must never be in two rows: "old jobs never started" leaves out the jobs that already
 * have their own row (covered by a coworker, incomplete…).
 */
export function staleNotListed(staleIds = [], exceptions = []) {
  const listed = new Set((exceptions || []).map(x => x.jobId).filter(Boolean))
  return (staleIds || []).filter(id => !listed.has(id))
}

/** Hide resolved items right away (optimistic), until the reload confirms it. */
export const withoutResolved = (list, resolved) => (list || []).filter(x => !resolved.has(x.id))

/** "Aceitar sem foto" / "Conferido": the admin checked the finished job → out of no_photo / ai_waiting / long. */
export async function markReviewed(jobIds = []) {
  if (!jobIds.length) return 0
  const { error } = await supabase.from('jobs').update({ admin_reviewed: true }).in('id', jobIds).eq('status', 'completed')
  if (error) throw error
  pendingChanged()
  return jobIds.length
}

/** "Rodar IA agora": grade each waiting After photo; returns { ok, failed }. */
export async function runAiNow(jobIds = [], onProgress) {
  const { data, error } = await supabase.from('jobs').select('*').in('id', jobIds)
  if (error) throw error
  let ok = 0, failed = 0
  for (const job of data || []) {
    try { await gradeJobPhoto(job); ok++ } catch { failed++ }
    onProgress?.(ok + failed, (data || []).length)
  }
  pendingChanged()
  return { ok, failed }
}

/** "Não foi feito": cancel a never-started job (not paid, not billed). Fresh read first. */
export async function markNotDone(jobId, reason) {
  const { data: job, error } = await supabase.from('jobs').select('*').eq('id', jobId).maybeSingle()
  if (error) throw error
  if (!job || job.status !== 'assigned' || job.started_at) throw new Error('changed')
  await adminMarkNotDone(job, { reason })
  pendingChanged()
  return true
}
