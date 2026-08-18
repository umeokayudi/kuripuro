import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { useLang, fill } from '../hooks/useLang'
import {
  DEFAULT_LOCATIONS, buildMonthSchedule, scheduleStats, jobsToRows,
  contractsForActiveEmployees, locationsFromContracts, DOW_PT, DOW_JA,
} from '../lib/scheduleGenerator'

export default function ScheduleGenerator() {
  const { lang, t } = useLang()
  const s = t.schedule
  const dateLocale = lang === 'ja' ? 'ja-JP' : 'en-GB'
  const dowLabels = lang === 'ja' ? DOW_JA : DOW_PT

  const [month, setMonth] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 1)
    return d.toISOString().slice(0, 7)
  })
  const [preview, setPreview] = useState([])
  const [loading, setLoading] = useState(false)
  const [existingCount, setExistingCount] = useState(0)
  const [includeDuskin, setIncludeDuskin] = useState(true)
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
      toast.error(s.noActiveContracts)
      return
    }
    const jobs = buildMonthSchedule(month, { contracts, locations, includeDuskin })
    setPreview(jobs)
    toast.success(fill(s.previewToast, { count: jobs.length, employees: contracts.length }))
  }

  const stats = useMemo(() => scheduleStats(preview), [preview])

  const byDate = useMemo(() => {
    const acc = {}
    preview.forEach(j => { (acc[j.date] = acc[j.date] || []).push(j) })
    return acc
  }, [preview])

  const handleGenerate = async () => {
    if (!contracts.length) { toast.error(s.noContractsToast); return }
    const jobs = preview.length ? preview : buildMonthSchedule(month, { contracts, locations, includeDuskin })
    if (!jobs.length) { toast.error(s.previewFirst); return }

    const summary = Object.entries(scheduleStats(jobs).byEmployee).map(([n, c]) => `${n}: ${c}`).join(', ')
    if (existingCount > 0) {
      if (!confirm(fill(s.confirmReplace, { existing: existingCount, month, count: jobs.length, summary }))) return
      await supabase.from('jobs').delete().gte('scheduled_date', `${month}-01`).lte('scheduled_date', `${month}-31`)
    } else if (!confirm(fill(s.confirmCreate, { count: jobs.length, summary }))) return

    setLoading(true)
    const rows = jobsToRows(jobs, contracts)
    for (let i = 0; i < rows.length; i += 50) {
      const { error } = await supabase.from('jobs').insert(rows.slice(i, i + 50))
      if (error) { toast.error(error.message); setLoading(false); return }
    }
    toast.success(fill(s.jobsCreated, { count: rows.length }))
    setLoading(false)
    loadExisting()
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">📋 {s.contractsTitle}</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
          {s.contractsHint}
        </div>
        {contracts.length === 0 ? (
          <div style={{ padding: 16, background: 'var(--surface2)', borderRadius: 10, fontSize: 13, color: 'var(--text3)' }}>
            {s.noContracts}
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
                <div style={{ fontSize: 11, color: 'var(--text3)', alignSelf: 'center' }}>{s.alwaysIncluded}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 10 }}>
          {fill(s.locationsCount, { count: locations.length })}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">🗓 {s.generator}</div>

        <div className="grid-2" style={{ marginBottom: 14 }}>
          <div className="form-group">
            <label>{s.month}</label>
            <input type="month" value={month} onChange={e => { setMonth(e.target.value); setPreview([]) }} />
          </div>
          <div className="form-group">
            <label>{s.existingJobs}</label>
            <div style={{ padding: '10px 12px', background: existingCount ? 'rgba(251,191,36,0.1)' : 'var(--surface2)', borderRadius: 8, fontSize: 14, fontWeight: 600 }}>
              {existingCount > 0 ? fill(s.jobsInMonth, { count: existingCount, month }) : s.noJobsMonth}
            </div>
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={includeDuskin} onChange={e => setIncludeDuskin(e.target.checked)} />
          {s.includeDuskin || 'Incluir Duskin (domingos do mês)'}
        </label>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn" onClick={runPreview} disabled={!contracts.length}>👁 {s.preview}</button>
          <button className="btn btn-primary" onClick={handleGenerate} disabled={loading || !contracts.length}>
            {loading ? s.creating : `✅ ${fill(s.generate, { count: preview.length || '…' })}`}
          </button>
        </div>
      </div>

      {preview.length > 0 && (
        <div className="card">
          <div className="card-title">{fill(s.previewTitle, { total: stats.total, days: stats.days })}</div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
            {contracts.map(c => (
              <div key={c.employeeId} style={{ padding: '10px 14px', borderRadius: 10, background: `${c.color}12`, border: `1px solid ${c.color}30`, minWidth: 100 }}>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{c.shortName}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: c.color }}>{stats.byEmployee[c.shortName] || 0}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
            {dowLabels.map((label, i) => (
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
                      {dowLabels[dow]} {new Date(date + 'T12:00:00').toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' })}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text3)' }}>{dayJobs.length} {s.jobsLabel} {isOpen ? '▲' : '▼'}</span>
                  </button>
                  {isOpen ? (
                    <div style={{ padding: '8px 14px 12px' }}>
                      {dayJobs.sort((a, b) => a.time.localeCompare(b.time)).map(j => (
                        <div key={j.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                          <span style={{ color: 'var(--text3)', width: 42 }}>{j.time}</span>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: empColors[j.employee] || '#999' }} />
                          <span style={{ fontWeight: 600, width: 70, color: empColors[j.employee] }}>{j.employee}</span>
                          <span style={{ flex: 1 }}>{j.title.split(' —')[0]}</span>
                          {j.type === 'deep' && <span className="badge badge-amber" style={{ fontSize: 10 }}>{t.jobs.deep}</span>}
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
