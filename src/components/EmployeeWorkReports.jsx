// v1.0.172 · lives in "Meu dia" and in its own ☰ menu tab (no longer on Início), with
// "fazer todos do dia": one tap builds the report of every finished service of that day from what
// is already saved (photos, checklist, signature) and sends them to the office (status 'ready').
// v1.0.150 · Employee home: 作業報告書 of my services. During the job: add photos (before /
// during / after) and notes; after the job: finish the text with the AI. The office sends it.
import { useEffect, useMemo, useState } from 'react'
import { reportIdForJob, loadReport, saveReport, statusLabel } from '../lib/workReport'
import { quickJobReport } from '../lib/quickReport'
import toast from 'react-hot-toast'
import { locationNameFromTitle } from '../lib/cleaningType'
import { useLang } from '../hooks/useLang'
import WorkReportEditor from './WorkReportEditor'

export default function EmployeeWorkReports({ jobs, activeJob, today, user, flat = false }) {
  const { tr } = useLang()
  const [open, setOpen] = useState(null)
  const [state, setState] = useState({}) // jobId → summary of its report
  const [bulk, setBulk] = useState(null) // { day, done, total } while making all reports of a day
  const since = useMemo(() => new Date(Date.parse(`${today}T12:00:00Z`) - 7 * 864e5).toISOString().slice(0, 10), [today])
  const recent = useMemo(() => (jobs || [])
    .filter(j => j.scheduled_date >= since && j.scheduled_date <= today && (j.status === 'completed' || j.status === 'in_progress'))
    .sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date)), [jobs, since, today])
  const author = useMemo(() => ({ name: user?.name || '' }), [user?.name])

  const ids = recent.slice(0, 20).map(j => j.id).join(',')
  useEffect(() => {
    let off = false
    ;(async () => {
      const out = {}
      await Promise.all(recent.slice(0, 20).map(async j => {
        const id = await reportIdForJob(j.id)
        if (!id) return
        const r = await loadReport(id)
        if (r) out[j.id] = r
      }))
      if (!off) setState(out)
    })()
    return () => { off = true }
  }, [ids]) // eslint-disable-line react-hooks/exhaustive-deps

  // the most recent day (today first) that still has finished services without a report sent to the office
  const pendingOf = d => recent.filter(j => j.scheduled_date === d && j.status === 'completed' && (!state[j.id] || state[j.id].status === 'draft'))
  const bulkDay = [...new Set(recent.map(j => j.scheduled_date))].sort().reverse().find(d => pendingOf(d).length > 0) || null
  const bulkJobs = bulkDay ? pendingOf(bulkDay) : []
  const dayName = d => (d === today ? tr('today', '今日', 'de hoje') : tr(`of ${d.slice(5).replace('-', '/')}`, `${d.slice(5).replace('-', '/')}の`, `de ${d.slice(8)}/${d.slice(5, 7)}`))
  const doAll = async () => {
    const list = bulkJobs
    setBulk({ day: bulkDay, done: 0, total: list.length })
    let ok = 0
    for (const j of list) {
      try {
        let r = await quickJobReport(j, { author })
        if (r && r.status === 'draft') r = await saveReport({ ...r, status: 'ready' }, { by: author.name, action: 'ready-all-day' })
        if (r) setState(s => ({ ...s, [j.id]: r }))
        ok++
      } catch (err) { console.warn('report', j.id, err) }
      setBulk(b => b && { ...b, done: b.done + 1 })
    }
    setBulk(null)
    if (ok === list.length) toast.success(tr(`${ok} reports sent to the office`, `${ok}件の報告書を事務所へ送りました`, `${ok} relatórios enviados ao escritório`))
    else toast.error(tr(`${ok} of ${list.length} done — try again for the rest`, `${list.length}件中${ok}件完了。残りはもう一度`, `${ok} de ${list.length} feitos — tente de novo para o resto`))
  }

  const withReport = recent.filter(j => state[j.id])
  const others = recent.filter(j => !state[j.id] && j.id !== activeJob?.id)
  const live = activeJob && activeJob.status === 'in_progress' ? activeJob : null
  if (!live && !recent.length) return flat ? <p style={{ fontSize: 13, color: '#66758b', margin: '4px 2px 14px' }}>{tr('No finished services in the last 7 days.', '過去7日間に完了した作業はありません。', 'Nenhum serviço terminado nos últimos 7 dias.')}</p> : null

  const btn = { flexShrink: 0, padding: '8px 12px', borderRadius: 10, border: 'none', background: '#1f3a5f', color: '#fff', fontWeight: 700, cursor: 'pointer' }
  const row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 0', fontSize: 13 }
  const name = j => `${locationNameFromTitle(j.title) || j.title} · ${j.scheduled_date?.slice(5)}`

  return (
    <div className="ewr" style={flat ? { margin: '0 0 14px' } : { margin: '0 0 14px', padding: '12px 14px', borderRadius: 16, background: 'rgba(31,58,95,0.10)', border: '1px solid rgba(31,58,95,0.30)' }}>
      {!flat && <>
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 2 }}>📄 {tr('Service report', '作業報告書', 'Relatório de serviço')}</div>
      <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>{tr('Photos and notes now or later — the AI writes it, the office sends it to the client.', '写真とメモは作業中でも後でもOK。AIが文章を作成し、事務所が送付します。', 'Fotos e notas agora ou depois — a IA escreve e o escritório envia ao cliente.')}</div>
      </>}
      {bulkDay && (
        <button type="button" className="ewr-all" disabled={!!bulk} onClick={doAll}>
          {bulk
            ? `⏳ ${tr('Making reports', '報告書を作成中', 'Fazendo relatórios')} ${bulk.done}/${bulk.total}…`
            : `📄 ${tr(`Make all ${bulkJobs.length} reports ${dayName(bulkDay)} at once`, `${dayName(bulkDay)}${bulkJobs.length}件をまとめて作成`, `Fazer os ${bulkJobs.length} relatórios ${dayName(bulkDay)} de uma vez`)}`}
          {!bulk && <small>{tr('Uses the photos, checklist and signature already saved, and sends them to the office.', '保存済みの写真・チェックリスト・署名で作成し、事務所へ送ります。', 'Usa as fotos, o checklist e a assinatura já salvos e manda ao escritório.')}</small>}
        </button>
      )}
      {live && (
        <div style={row}>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🟢 {name(live)}</span>
          <button type="button" style={btn} onClick={() => setOpen(live)}>📷 {state[live.id] ? tr('Continue', '続ける', 'Continuar') : tr('Photos for report', '報告書用の写真', 'Fotos p/ relatório')}</button>
        </div>
      )}
      {withReport.filter(j => j.id !== live?.id).map(j => (
        <div key={j.id} style={row}>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name(j)} · <small>{statusLabel(state[j.id].status, tr)} · 📷 {(state[j.id].photos || []).length}</small></span>
          <button type="button" style={btn} onClick={() => setOpen(j)}>{state[j.id].status === 'sent' ? tr('View', '見る', 'Ver') : tr('Continue', '続ける', 'Continuar')}</button>
        </div>
      ))}
      {others.length > 0 && (
        <select value="" onChange={e => { const j = others.find(x => x.id === e.target.value); if (j) setOpen(j) }}
          style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(31,58,95,0.3)', font: 'inherit', fontSize: 13 }}>
          <option value="">＋ {tr('Report for another service (last 7 days)', '他の作業の報告書（7日以内）', 'Relatório de outro serviço (últimos 7 dias)')}</option>
          {others.map(j => <option key={j.id} value={j.id}>{name(j)}</option>)}
        </select>
      )}
      {open && (
        <WorkReportEditor job={open} role="employee" author={author}
          onSaved={r => setState(s => ({ ...s, [open.id]: r }))}
          onClose={() => setOpen(null)} />
      )}
    </div>
  )
}
