import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import {
  DEFAULT_LOCATIONS, buildMonthSchedule, scheduleStats, jobsToRows,
  contractsForActiveEmployees, locationsFromContracts, DOW_PT,
} from '../lib/scheduleGenerator'

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
  const [contracts, setContracts] = useState([])
  const [locations, setLocations] = useState(DEFAULT_LOCATIONS)
  const [expandedDay, setExpandedDay] = useState(null)

  useEffect(() => { loadData() }, [])
  useEffect(() => { loadExisting() }, [month])

  const loadData = async () => {
    const [{ data: employees }, { data: serviceContracts }] = await Promise.all([
      supabase.from('employees').select('id, full_name, is_active').eq('is_active', true).order('full_name'),
      supabase.from('service_contracts').select('*').eq('is_active', true),
    ])
    const activeContracts = contractsForActiveEmployees(employees || [])
    setContracts(activeContracts)
    setLocations(locationsFromContracts(serviceContracts) || DEFAULT_LOCATIONS)
  }

  const loadExisting = async () => {
    const { count } = await supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .gte('scheduled_date', `${month}-01`)
      .lte('scheduled_date', `${month}-31`)
    setExistingCount(count || 0)
  }

  const empColors = useMemo(() =>
    Object.fromEntries(contracts.map(c => [c.shortName, c.color])),
  [contracts])

  const runPreview = () => {
    if (!contracts.length) {
      toast.error('Nenhum funcionário ativo com contrato de escala configurado')
      return
    }
    const jobs = buildMonthSchedule(month, { contracts, locations, includeOptionalExtras: includeYuraku })
    setPreview(jobs)
    toast.success(`${jobs.length} jobs · ${contracts.length} funcionário(s)`)
  }

  const stats = useMemo(() => scheduleStats(preview), [preview])

  const byDate = useMemo(() => {
    const acc = {}
    preview.forEach(j => { (acc[j.date] = acc[j.date] || []).push(j) })
    return acc
  }, [preview])

  const handleGenerate = async () => {
    if (!contracts.length) { toast.error('Sem funcionários ativos com contrato'); return }
    const jobs = preview.length ? preview : buildMonthSchedule(month, { contracts, locations, includeOptionalExtras: includeYuraku })
    if (!jobs.length) { toast.error('Gere o preview primeiro'); return }

    const summary = Object.entries(scheduleStats(jobs).byEmployee).map(([n, c]) => `${n}: ${c}`).join(', ')
    if (existingCount > 0) {
      if (!confirm(`Já existem ${existingCount} jobs em ${month}.\n\nApagar e recriar ${jobs.length}?\n\n${summary}`)) return
      await supabase.from('jobs').delete().gte('scheduled_date', `${month}-01`).lte('scheduled_date', `${month}-31`)
    } else if (!confirm(`Criar ${jobs.length} jobs?\n\n${summary}`)) return

    setLoading(true)
    const rows = jobsToRows(jobs, contracts)
    for (let i = 0; i < rows.length; i += 50) {
      const { error } = await supabase.from('jobs').insert(rows.slice(i, i + 50))
      if (error) { toast.error(error.message); setLoading(false); return }
    }
    toast.success(`✅ ${rows.length} jobs criados!`)
    setLoading(false)
    loadExisting()
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">📋 Contratos ativos na escala</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
          Só aparecem funcionários <b>ativos</b> no sistema com contrato configurado. Inativos somem automaticamente.
        </div>
        {contracts.length === 0 ? (
          <div style={{ padding: 16, background: 'var(--surface2)', borderRadius: 10, fontSize: 13, color: 'var(--text3)' }}>
            Nenhum funcionário ativo com contrato de escala. Ative o funcionário em Employees ou peça para atualizar os contratos.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {contracts.map(c => (
              <div key={c.employeeId} style={{ display: 'flex', gap: 12, padding: '10px 12px', background: 'var(--surface2)', borderRadius: 10, borderLeft: `4px solid ${c.color}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{c.employeeName}</div>
                  <div style={{ fontSize: 12, color: c.color, fontWeight: 600 }}>{c.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{c.detail}</div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)', alignSelf: 'center' }}>✓ sempre incluído</div>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 10 }}>
          {locations.length} locais · dados de Contracts ou lista padrão
        </div>
      </div>

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

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={includeYuraku} onChange={e => setIncludeYuraku(e.target.checked)} />
          Incluir Kodama Yurakucho no deep clean de terça (Solomon)
        </label>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn" onClick={runPreview} disabled={!contracts.length}>👁 Ver preview</button>
          <button className="btn btn-primary" onClick={handleGenerate} disabled={loading || !contracts.length}>
            {loading ? 'Criando...' : `✅ Gerar ${preview.length || '…'} jobs`}
          </button>
        </div>
      </div>

      {preview.length > 0 && (
        <div className="card">
          <div className="card-title">Preview — {stats.total} jobs em {stats.days} dias</div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
            {contracts.map(c => (
              <div key={c.employeeId} style={{ padding: '10px 14px', borderRadius: 10, background: `${c.color}12`, border: `1px solid ${c.color}30`, minWidth: 100 }}>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{c.shortName}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: c.color }}>{stats.byEmployee[c.shortName] || 0}</div>
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
                  <button type="button" onClick={() => setExpandedDay(isOpen ? null : date)}
                    style={{ width: '100%', display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--surface2)', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>
                      {DOW_PT[dow]} {new Date(date + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text3)' }}>{dayJobs.length} jobs {isOpen ? '▲' : '▼'}</span>
                  </button>
                  {isOpen ? (
                    <div style={{ padding: '8px 14px 12px' }}>
                      {dayJobs.sort((a, b) => a.time.localeCompare(b.time)).map(j => (
                        <div key={j.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                          <span style={{ color: 'var(--text3)', width: 42 }}>{j.time}</span>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: empColors[j.employee] || '#999' }} />
                          <span style={{ fontWeight: 600, width: 70, color: empColors[j.employee] }}>{j.employee}</span>
                          <span style={{ flex: 1 }}>{j.title.split(' —')[0]}</span>
                          {j.type === 'deep' && <span className="badge badge-amber" style={{ fontSize: 10 }}>Deep</span>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ padding: '6px 14px 10px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {dayJobs.slice(0, 8).map(j => (
                        <span key={j.id} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 12, background: `${empColors[j.employee] || '#999'}18`, color: empColors[j.employee] }}>
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
