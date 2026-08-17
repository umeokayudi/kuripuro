import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import {
  SCHEDULE_EMPLOYEES, RESTAURANTS, buildMonthSchedule, scheduleStats, jobsToRows, SCHEDULE_RULES, DOW_PT,
} from '../lib/scheduleGenerator'

const EMP_COLORS = Object.fromEntries(
  Object.values(SCHEDULE_EMPLOYEES).map(e => [e.short, e.color])
)

export default function ScheduleGenerator() {
  const [month, setMonth] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 1)
    return d.toISOString().slice(0, 7)
  })
  const [preview, setPreview] = useState([])
  const [loading, setLoading] = useState(false)
  const [existingCount, setExistingCount] = useState(0)
  const [includeYuraku, setIncludeYuraku] = useState(false)
  const [enabled, setEnabled] = useState({ bemnet: true, gabriel: true, solomon: true })
  const [expandedDay, setExpandedDay] = useState(null)

  useEffect(() => { loadExisting() }, [month])

  const loadExisting = async () => {
    const { count } = await supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .gte('scheduled_date', `${month}-01`)
      .lte('scheduled_date', `${month}-31`)
    setExistingCount(count || 0)
  }

  const runPreview = () => {
    const jobs = buildMonthSchedule(month, { includeYuraku, enabled })
    setPreview(jobs)
    if (!jobs.length) toast.error('Nenhum job gerado — verifique os funcionários ativos')
    else toast.success(`${jobs.length} jobs no preview`)
  }

  const stats = useMemo(() => scheduleStats(preview), [preview])

  const byDate = useMemo(() => {
    const acc = {}
    preview.forEach(j => {
      if (!acc[j.date]) acc[j.date] = []
      acc[j.date].push(j)
    })
    return acc
  }, [preview])

  const handleGenerate = async () => {
    const jobs = preview.length ? preview : buildMonthSchedule(month, { includeYuraku, enabled })
    if (!jobs.length) { toast.error('Gere o preview primeiro'); return }

    const summary = Object.entries(stats.byEmployee || scheduleStats(jobs).byEmployee)
      .map(([n, c]) => `${n}: ${c}`)
      .join(', ')

    if (existingCount > 0) {
      if (!confirm(`Já existem ${existingCount} jobs em ${month}.\n\nApagar e recriar ${jobs.length} jobs?\n\n${summary}`)) return
      await supabase.from('jobs').delete().gte('scheduled_date', `${month}-01`).lte('scheduled_date', `${month}-31`)
    } else if (!confirm(`Criar ${jobs.length} jobs para ${month}?\n\n${summary}`)) {
      return
    }

    setLoading(true)
    const rows = jobsToRows(jobs)
    for (let i = 0; i < rows.length; i += 50) {
      const { error } = await supabase.from('jobs').insert(rows.slice(i, i + 50))
      if (error) { toast.error(error.message); setLoading(false); return }
    }
    toast.success(`✅ ${rows.length} jobs criados!`)
    setLoading(false)
    loadExisting()
  }

  const toggleEmp = (key) => setEnabled(e => ({ ...e, [key]: !e[key] }))

  return (
    <div>
      {/* Regras */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">📋 Como funciona a escala</div>
        <div style={{ display: 'grid', gap: 10 }}>
          {SCHEDULE_RULES.map(r => (
            <div key={r.who} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 12px', background: 'var(--surface2)', borderRadius: 10 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: EMP_COLORS[r.who], marginTop: 5, flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{r.who} <span style={{ fontWeight: 400, color: 'var(--text3)' }}>({r.when})</span></div>
                <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 2 }}>{r.detail}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 10 }}>
          {RESTAURANTS.length} restaurantes no contrato On The Planet + Atomic Bar (só segunda, Bemnet).
        </div>
      </div>

      {/* Config */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">🗓 Gerador de Escala</div>

        <div className="grid-2" style={{ marginBottom: 14 }}>
          <div className="form-group">
            <label>Mês</label>
            <input type="month" value={month} onChange={e => { setMonth(e.target.value); setPreview([]) }} />
          </div>
          <div className="form-group">
            <label>Jobs já no sistema</label>
            <div style={{ padding: '10px 12px', background: existingCount ? 'rgba(251,191,36,0.1)' : 'var(--surface2)', borderRadius: 8, fontSize: 14, fontWeight: 600 }}>
              {existingCount > 0 ? `⚠️ ${existingCount} jobs em ${month}` : '✓ Nenhum job neste mês'}
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, color: 'var(--text3)', display: 'block', marginBottom: 8 }}>Incluir na geração</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {Object.entries(SCHEDULE_EMPLOYEES).map(([key, emp]) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 10, border: `2px solid ${enabled[key] ? emp.color : 'var(--border)'}`, background: enabled[key] ? `${emp.color}15` : 'transparent', cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={enabled[key]} onChange={() => toggleEmp(key)} style={{ accentColor: emp.color }} />
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: emp.color }} />
                {emp.short}
              </label>
            ))}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 10, border: '1px solid var(--border)', cursor: 'pointer', fontSize: 13 }}>
              <input type="checkbox" checked={includeYuraku} onChange={e => setIncludeYuraku(e.target.checked)} />
              + Kodama Yurakucho (Solomon, terça)
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn" onClick={runPreview}>👁 Ver preview</button>
          <button className="btn btn-primary" onClick={handleGenerate} disabled={loading}>
            {loading ? 'Criando...' : `✅ Gerar ${preview.length || '…'} jobs`}
          </button>
        </div>
      </div>

      {/* Stats + Preview */}
      {preview.length > 0 && (
        <div className="card">
          <div className="card-title">Preview — {stats.total} jobs em {stats.days} dias</div>

          <div className="grid-3" style={{ gap: 10, marginBottom: 16 }}>
            {Object.entries(stats.byEmployee).map(([name, count]) => (
              <div key={name} style={{ padding: 12, borderRadius: 10, background: `${EMP_COLORS[name]}12`, border: `1px solid ${EMP_COLORS[name]}30` }}>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{name}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: EMP_COLORS[name] }}>{count}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>jobs no mês</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
            {DOW_PT.map((label, i) => (
              <div key={label} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, background: 'var(--surface2)' }}>
                {label}: <b>{stats.byDow[i]}</b>
              </div>
            ))}
          </div>

          <div style={{ maxHeight: 520, overflowY: 'auto' }}>
            {Object.keys(byDate).sort().map(date => {
              const dayJobs = byDate[date]
              const dow = new Date(date + 'T12:00:00').getDay()
              const isOpen = expandedDay === date
              return (
                <div key={date} style={{ marginBottom: 8, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                  <button
                    onClick={() => setExpandedDay(isOpen ? null : date)}
                    style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--surface2)', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <span style={{ fontWeight: 600, fontSize: 13 }}>
                      {DOW_PT[dow]} {new Date(date + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text3)' }}>{dayJobs.length} jobs {isOpen ? '▲' : '▼'}</span>
                  </button>
                  {isOpen && (
                    <div style={{ padding: '8px 14px 12px' }}>
                      {dayJobs.sort((a, b) => a.time.localeCompare(b.time)).map(j => (
                        <div key={j.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                          <span style={{ color: 'var(--text3)', width: 42 }}>{j.time}</span>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: EMP_COLORS[j.employee], flexShrink: 0 }} />
                          <span style={{ fontWeight: 600, color: EMP_COLORS[j.employee], width: 56 }}>{j.employee[0]}</span>
                          <span style={{ flex: 1 }}>{j.title.split(' —')[0]}</span>
                          {j.type === 'deep' && <span className="badge badge-amber" style={{ fontSize: 10 }}>Deep</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {!isOpen && (
                    <div style={{ padding: '6px 14px 10px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {dayJobs.slice(0, 8).map(j => (
                        <span key={j.id} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 12, background: `${EMP_COLORS[j.employee]}18`, color: EMP_COLORS[j.employee] }}>
                          {j.employee[0]}·{j.title.split(' —')[0].slice(0, 12)}
                        </span>
                      ))}
                      {dayJobs.length > 8 && <span style={{ fontSize: 10, color: 'var(--text3)' }}>+{dayJobs.length - 8}</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
