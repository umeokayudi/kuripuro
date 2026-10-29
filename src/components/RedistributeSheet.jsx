// v1.0.101 · Redistribute (absence / delay on the day): pick the remaining jobs of one person, the
// system suggests new owners with the same rules as the Pending box, confirm all at once.
// Old and new owners get a notice in their bell.
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useLang } from '../hooks/useLang'
import { asItem, movableJobs, planBatch, suggestPeople, weekOf } from '../lib/assignFlow'
import { assignMany } from '../lib/assignOps'
import { pendingChanged } from '../lib/adminPending'
import { assignText, conflictLabel, RED_CONFLICTS } from './assignText'
import './assign.css'

export default function RedistributeSheet({ from, date, jobs, employees, availability, onClose, onDone }) {
  const { lang, tr } = useLang()
  const T = useMemo(() => assignText(tr), [lang]) // eslint-disable-line react-hooks/exhaustive-deps
  const [week, setWeek] = useState(null)
  const [choice, setChoice] = useState({})
  const [skip, setSkip] = useState(() => new Set())
  const [saving, setSaving] = useState(false)

  const movable = useMemo(() => movableJobs(jobs, from.id), [jobs, from.id])
  const others = useMemo(() => employees.filter(e => e.id !== from.id), [employees, from.id])

  // Week of the day, so the suggestion also balances the load of the week.
  useEffect(() => {
    const w = weekOf(date)
    supabase.from('jobs').select('id,title,scheduled_date,scheduled_time,employee_id,status,expected_minutes,area,job_category')
      .gte('scheduled_date', w[0]).lte('scheduled_date', w[6]).not('employee_id', 'is', null).neq('status', 'cancelled')
      .then(({ data }) => setWeek(data || []))
  }, [date])

  const ctx = useMemo(() => {
    const ids = new Set(movable.map(j => j.id))
    const base = (week || jobs).filter(j => j.employee_id && j.employee_id !== from.id && !ids.has(j.id) && j.status !== 'cancelled')
    return { employees: others, availability, jobs: base.map(asItem) }
  }, [week, jobs, movable, others, availability, from.id])
  const plan = useMemo(() => planBatch(movable.map(asItem), ctx), [movable, ctx])
  const personOf = j => (Object.prototype.hasOwnProperty.call(choice, j.id) ? choice[j.id] : plan.get(j.id)?.emp.id || '')

  // Warnings for the chosen person, counting the other jobs being moved to them too.
  const rows = movable.map(j => {
    const pid = personOf(j)
    const extra = movable.filter(o => o.id !== j.id && personOf(o) === pid && pid).map(o => ({ ...asItem(o), employeeId: pid }))
    const rank = suggestPeople(asItem(j), { ...ctx, jobs: [...ctx.jobs, ...extra] })
    return { job: j, pid, rank, warn: pid ? rank.find(r => r.emp.id === pid)?.conflicts || [] : [], why: Object.prototype.hasOwnProperty.call(choice, j.id) ? [] : plan.get(j.id)?.why || [] }
  })
  const picked = rows.filter(r => !skip.has(r.job.id) && r.pid)

  const confirm = async () => {
    setSaving(true)
    const byId = Object.fromEntries(employees.map(e => [e.id, e]))
    const r = await assignMany(picked.map(x => ({ job: x.job, emp: byId[x.pid] })))
    setSaving(false)
    pendingChanged()
    if (r.errors.length) toast.error(r.errors[0])
    toast.success(tr(`${r.done} jobs moved · people notified`, `${r.done}件を移動・通知済み`, `${r.done} jobs passados · pessoas avisadas`))
    if (r.notices.missing) toast(tr('Notices start after the database update (SQL).', '通知はDB更新（SQL）後に有効。', 'Os avisos começam depois do SQL do banco.'), { icon: 'ℹ️' })
    onDone?.()
  }

  return (
    <div className="rd-overlay" onClick={onClose}>
      <section className="rd-sheet" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="rd-head">
          <h3>↪ {tr(`Redistribute ${from.name}'s jobs`, `${from.name}さんの作業を再配分`, `Redistribuir jobs de ${from.name}`)}</h3>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label={tr('Close', '閉じる', 'Fechar')}>✕</button>
        </div>
        <div className="as-muted" style={{ marginBottom: 10 }}>{tr('Jobs not started yet. Suggestion = role, day off, same area today and lightest week. Change any line.', '未開始の作業。提案＝役割・休み・同じ地域・今週の負荷。行ごとに変更可。', 'Jobs ainda não iniciados. Sugestão = papel, folga, mesma área no dia e semana mais leve. Troque qualquer linha.')}</div>
        {!movable.length && <div className="as-empty">{tr('No job left to move.', '移動できる作業はありません。', 'Nenhum job para passar.')}</div>}
        {rows.map(({ job, pid, rank, warn, why }) => (
          <div key={job.id} className="rd-row">
            <div className="rd-row-top">
              <input type="checkbox" checked={!skip.has(job.id)} onChange={() => setSkip(s => { const n = new Set(s); n.has(job.id) ? n.delete(job.id) : n.add(job.id); return n })} aria-label={tr('Move this job', 'この作業を移動', 'Passar este job')} />
              <div style={{ minWidth: 0 }}>
                <div className="as-place">{asItem(job).place} <span className="as-muted">· {String(job.scheduled_time || '').slice(0, 5)}</span></div>
              </div>
            </div>
            <select className="as-input" value={pid} onChange={e => setChoice(c => ({ ...c, [job.id]: e.target.value }))} aria-label={tr('New person', '新しい担当', 'Nova pessoa')}>
              <option value="">— {T.reason.noPerson} —</option>
              {rank.map(r => <option key={r.emp.id} value={r.emp.id}>{r.ok && r === rank[0] ? '★ ' : ''}{r.emp.full_name}{r.conflicts.length ? ` (⚠️ ${r.conflicts.map(c => T.conflict[c.kind]).join(', ')})` : ''}</option>)}
            </select>
            {(why.length > 0 || warn.length > 0) && (
              <div className="as-why">
                {why.length > 0 && <span className="as-sug">★ {why.map(w => T.why[w]).join(' · ')}</span>}
                {warn.map((c, i) => <span key={i} className={`as-warn${RED_CONFLICTS.has(c.kind) ? ' red' : ''}`}>⚠️ {conflictLabel(c, T)}</span>)}
              </div>
            )}
            {!pid && <span className="as-warn red">⚠️ {tr('Nobody free — pick someone with a warning, or leave it unticked and offer it in the Pending box.', '空きなし — 警告付きで選ぶか、チェックを外して未割当ボックスでオファー。', 'Ninguém livre — escolha alguém com aviso, ou deixe desmarcado e oferte na Caixa de Pendentes.')}</span>}
          </div>
        ))}
        <div className="rd-foot">
          <button type="button" className="btn" onClick={onClose}>{tr('Cancel', 'キャンセル', 'Cancelar')}</button>
          <button type="button" className="btn btn-primary" disabled={saving || !picked.length} onClick={confirm}>
            {saving ? '…' : `✅ ${tr(`Confirm ${picked.length}`, `${picked.length}件を確定`, `Confirmar ${picked.length}`)}`}
          </button>
        </div>
      </section>
    </div>
  )
}
