import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { jobToServiceReport, fmtDuration, jobReportType } from '../lib/jobReport'
import toast from 'react-hot-toast'

function typeBadge(type) {
  return type === 'retroativo'
    ? <span className="badge badge-amber">Retroativo</span>
    : <span className="badge badge-green">Ao vivo</span>
}

export default function Reports() {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [filterEmp, setFilterEmp] = useState('')
  const [filterDays, setFilterDays] = useState(30)
  const [aiAnalysis, setAiAnalysis] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => { loadReports() }, [filterDays])

  const loadReports = async () => {
    setLoading(true)
    const since = new Date(Date.now() - filterDays * 86400000).toISOString().split('T')[0]

    const { data: jobs } = await supabase
      .from('jobs')
      .select('*')
      .eq('status', 'completed')
      .gte('scheduled_date', since)
      .order('completed_at', { ascending: false })
      .limit(100)

    const mapped = (jobs || []).map(jobToServiceReport)
    setReports(mapped)
    setLoading(false)
  }

  const employees = useMemo(() =>
    [...new Set(reports.map(r => r.employee_name).filter(Boolean))].sort(),
  [reports])

  const filtered = useMemo(() =>
    filterEmp ? reports.filter(r => r.employee_name === filterEmp) : reports,
  [reports, filterEmp])

  const stats = useMemo(() => {
    const withDur = filtered.filter(r => r.duration_min != null)
    const avg = withDur.length
      ? Math.round(withDur.reduce((s, r) => s + r.duration_min, 0) / withDur.length)
      : null
    const byEmp = {}
    withDur.forEach(r => {
      if (!byEmp[r.employee_name]) byEmp[r.employee_name] = []
      byEmp[r.employee_name].push(r.duration_min)
    })
    return { total: filtered.length, avg, byEmp }
  }, [filtered])

  const runAiAnalysis = async () => {
    setAiLoading(true)
    setAiAnalysis('')
    try {
      const resp = await fetch('/api/analyze-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: filterDays, employeeName: filterEmp || undefined }),
      })
      const data = await resp.json()
      if (data.error) throw new Error(data.error)
      setAiAnalysis(data.analysis)
      toast.success(`Análise de ${data.count} relatórios pronta`)
    } catch (e) {
      toast.error(e.message)
    }
    setAiLoading(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Período</div>
          <select value={filterDays} onChange={e => setFilterDays(Number(e.target.value))} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
            <option value={7}>7 dias</option>
            <option value={30}>30 dias</option>
            <option value={90}>90 dias</option>
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Funcionário</div>
          <select value={filterEmp} onChange={e => setFilterEmp(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', minWidth: 160 }}>
            <option value="">Todos</option>
            {employees.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn btn-primary" onClick={runAiAnalysis} disabled={aiLoading || !filtered.length}>
            {aiLoading ? 'Analisando...' : '✨ IA: metas e padrões'}
          </button>
        </div>
      </div>

      <div className="grid-3" style={{ gap: 12, marginBottom: 16 }}>
        <div className="card" style={{ margin: 0, padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>Relatórios</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{stats.total}</div>
        </div>
        <div className="card" style={{ margin: 0, padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>Tempo médio</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{fmtDuration(stats.avg)}</div>
        </div>
        <div className="card" style={{ margin: 0, padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>Funcionários</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{Object.keys(stats.byEmp).length}</div>
        </div>
      </div>

      {aiAnalysis && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #c19c56' }}>
          <div className="card-title">✨ Análise IA — Metas e Padrões</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{aiAnalysis}</div>
        </div>
      )}

      <div className="card">
        <div className="card-title">Relatórios de Serviço</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
          Cada job finalizado pelo funcionário aparece aqui automaticamente.
        </div>
        {loading && <div style={{ color: 'var(--text3)', fontSize: 13 }}>Carregando...</div>}
        {!loading && filtered.length === 0 && (
          <div style={{ color: 'var(--text3)', fontSize: 13 }}>Nenhum relatório no período. Jobs concluídos pelos funcionários aparecerão aqui.</div>
        )}
        {filtered.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Funcionário</th>
                  <th>Local</th>
                  <th>Data</th>
                  <th>Tipo</th>
                  <th>Duração</th>
                  <th>Checklist</th>
                  <th>IA Foto</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.job_id}>
                    <td style={{ fontWeight: 500 }}>{r.employee_name}</td>
                    <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.client_name || r.job_title}</td>
                    <td>{r.report_date}</td>
                    <td>{typeBadge(r.report_type)}</td>
                    <td>{fmtDuration(r.duration_min)}</td>
                    <td>{r.checklist_total ? `${r.checklist_done || 0}/${r.checklist_total}` : '—'}</td>
                    <td>{r.photo_ai_score != null ? `${r.photo_ai_score}/10` : '—'}</td>
                    <td><button className="btn btn-sm" onClick={() => setSelected(r)}>Ler</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setSelected(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 24, maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{selected.job_title || selected.client_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{selected.employee_name} · {selected.report_date}</div>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>

            <div className="grid-2" style={{ gap: 8, marginBottom: 14 }}>
              {[['Início', selected.time_in], ['Fim', selected.time_out], ['Duração', fmtDuration(selected.duration_min)], ['Tipo', selected.report_type], ['Checklist', selected.checklist_total ? `${selected.checklist_done}/${selected.checklist_total}` : '—'], ['Valor', selected.job_value ? `¥${Number(selected.job_value).toLocaleString()}` : '—']].map(([l, v]) => (
                <div key={l} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{l}</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{v || '—'}</div>
                </div>
              ))}
            </div>

            {selected.notes_out && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Relatório do funcionário</div>
                <div style={{ fontSize: 13, background: 'var(--surface2)', borderRadius: 8, padding: '10px 12px', lineHeight: 1.5 }}>{selected.notes_out}</div>
              </div>
            )}

            {selected.retro_ai_summary && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Avaliação IA (retroativo)</div>
                <div style={{ fontSize: 13, background: 'rgba(193,156,86,0.1)', borderRadius: 8, padding: '10px 12px' }}>{selected.retro_ai_summary}</div>
              </div>
            )}

            {selected.checklist_missed_items && (
              <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--red)' }}>Itens não feitos: {selected.checklist_missed_items}</div>
            )}

            {selected.photo_ai_issues && (
              <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text3)' }}>Problemas na foto (IA): {selected.photo_ai_issues}</div>
            )}

            <div className="grid-2" style={{ gap: 8 }}>
              {selected.photo_before_url && (
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Antes</div>
                  <img src={selected.photo_before_url} alt="antes" style={{ width: '100%', borderRadius: 8, aspectRatio: '1', objectFit: 'cover' }} />
                </div>
              )}
              {selected.photo_after_url && (
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Depois</div>
                  <img src={selected.photo_after_url} alt="depois" style={{ width: '100%', borderRadius: 8, aspectRatio: '1', objectFit: 'cover' }} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
