// v1.0.150 · Employee home: 作業報告書 of my services. During the job: add photos (before /
// during / after) and notes; after the job: finish the text with the AI. The office sends it.
import { useEffect, useMemo, useState } from 'react'
import { reportIdForJob, loadReport, statusLabel } from '../lib/workReport'
import { locationNameFromTitle } from '../lib/cleaningType'
import { useLang } from '../hooks/useLang'
import WorkReportEditor from './WorkReportEditor'

export default function EmployeeWorkReports({ jobs, activeJob, today, user }) {
  const { tr } = useLang()
  const [open, setOpen] = useState(null)
  const [state, setState] = useState({}) // jobId → summary of its report
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

  const withReport = recent.filter(j => state[j.id])
  const others = recent.filter(j => !state[j.id] && j.id !== activeJob?.id)
  const live = activeJob && activeJob.status === 'in_progress' ? activeJob : null
  if (!live && !recent.length) return null

  const btn = { flexShrink: 0, padding: '8px 12px', borderRadius: 10, border: 'none', background: '#1f3a5f', color: '#fff', fontWeight: 700, cursor: 'pointer' }
  const row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 0', fontSize: 13 }
  const name = j => `${locationNameFromTitle(j.title) || j.title} · ${j.scheduled_date?.slice(5)}`

  return (
    <div style={{ margin: '0 0 14px', padding: '12px 14px', borderRadius: 16, background: 'rgba(31,58,95,0.10)', border: '1px solid rgba(31,58,95,0.30)' }}>
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 2 }}>📄 {tr('Service report', '作業報告書', 'Relatório de serviço')}</div>
      <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>{tr('Photos and notes now or later — the AI writes it, the office sends it to the client.', '写真とメモは作業中でも後でもOK。AIが文章を作成し、事務所が送付します。', 'Fotos e notas agora ou depois — a IA escreve e o escritório envia ao cliente.')}</div>
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
