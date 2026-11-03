// v1.0.148 · "Coberto por outro": B finished a service that is also on A's agenda (same day, same store,
// same service). A's job is marked "Coberto por B": struck on A's agenda, no pending, no delay —
// and NOTHING leaves A's agenda by itself. The owner decides in "Aguardando você":
//   [Retirar de A] → A's job is cancelled with an audited note ("baixado por autorização do dono em
//                    [data] — executado por [B]"), so it is out of A's payroll; B's pay is suggested.
//   [Manter em A]  → a note on A's job; it is never flagged again for that cover.
// No new table: the decision lives on the job itself (status + description), so every screen agrees.
// Same rule as getCleaningType (lib/cleaningType), inlined so this file stays importable by node tests.
const getCleaningType = job => {
  const t = `${job?.title || ''} ${job?.description || ''}`.toLowerCase()
  return /deep\s*clean|profunda|limpeza profunda|range hood|grease trap|grating|ac cleaning|stove|fog[aã]o|レンジフード|グリストラップ|コンロ/.test(t) ? 'deep' : 'basic'
}

export const KEEP_MARK = '⟲ Cobertura: mantido'
export const REMOVED_MARK = '⊘ Baixado por autorização do dono'

const norm = s => String(s || '').toLowerCase().normalize('NFKC').replace(/\s+/g, '').trim()
const placeOf = j => norm(String(j?.title || '').split(' — ')[0])
const serviceOf = j => {
  if (j?.job_category === 'spot') return `spot:${norm(String(j?.title || '').split(' — ')[1])}`
  return getCleaningType(j) === 'deep' ? `deep:${norm(String(j?.title || '').split(' — ')[1])}` : 'basic'
}
/** Same day + store + service: the key under which two jobs are "the same service". */
export const coverKey = j => `${j?.scheduled_date || ''}|${placeOf(j)}|${serviceOf(j)}`

export const isKeptCover = j => String(j?.description || '').includes(KEEP_MARK)
export const isRemovedCover = j => String(j?.description || '').includes(REMOVED_MARK)

/**
 * jobs: any jobs (several people, several days). Returns Map(A.id → B job) for each job of A that is
 * not done (assigned / in progress) while B (another person) completed the same service.
 */
export function coveredJobs(jobs = []) {
  const doneBy = new Map()
  for (const j of jobs || []) {
    if (j?.status !== 'completed' || !j.scheduled_date) continue
    const k = coverKey(j)
    if (!doneBy.has(k)) doneBy.set(k, [])
    doneBy.get(k).push(j)
  }
  const out = new Map()
  if (!doneBy.size) return out
  for (const a of jobs || []) {
    if (!a || !a.employee_id || !['assigned', 'in_progress'].includes(a.status) || isKeptCover(a)) continue
    const b = (doneBy.get(coverKey(a)) || []).find(x => x.id !== a.id && x.employee_id && x.employee_id !== a.employee_id)
    if (b) out.set(a.id, b)
  }
  return out
}

/** Jobs of the list without the covered ones (for counters: a service counts once). */
export function withoutCovered(jobs = []) {
  const cov = coveredJobs(jobs)
  return cov.size ? (jobs || []).filter(j => !cov.has(j.id)) : (jobs || [])
}

const ddmmyyyy = d => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

/** Patch for [Retirar de A]: cancelled with the audited sentence appended to the description. */
export function removeCoverPatch(a, b, { owner = 'dono', today }) {
  const line = `${REMOVED_MARK} (${owner}) em ${ddmmyyyy(today)} — executado por ${b?.employee_name || '—'}${b?.id ? ` (job ${String(b.id).slice(0, 8)})` : ''}`
  return { status: 'cancelled', description: [String(a?.description || '').trim(), line].filter(Boolean).join('\n') }
}

/** Patch for [Manter em A]: stays on A's agenda; this cover is not asked again. */
export function keepCoverPatch(a, b, { owner = 'dono', today }) {
  const line = `${KEEP_MARK} (${owner}) em ${ddmmyyyy(today)} — também feito por ${b?.employee_name || '—'}`
  return { description: [String(a?.description || '').trim(), line].filter(Boolean).join('\n') }
}

/** Pay suggested for B: A's pay line when B has none ("a definir"). */
export function suggestedPayForB(a, b) {
  const ap = a?.employee_pay, bp = b?.employee_pay
  if (bp !== null && bp !== undefined && bp !== '') return null
  return ap === null || ap === undefined || ap === '' ? null : Number(ap)
}
