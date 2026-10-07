import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { getPeriodDates, fmtPeriod } from '../lib/salaryPeriod'
import { closePayrollMonth, periodsFromPayroll } from '../lib/payrollClose'
import { useLang, fill } from '../hooks/useLang'

export default function SalaryPeriods() {
  const { t } = useLang()
  const p = t.payroll
  const [periods, setPeriods] = useState([])
  const [statements, setStatements] = useState([])
  const [selectedPeriod, setSelectedPeriod] = useState('')
  const [loading, setLoading] = useState(true)
  const [closing, setClosing] = useState(false)
  const [schemaOk, setSchemaOk] = useState(true)

  useEffect(() => { loadPeriods() }, [])

  useEffect(() => { if (selectedPeriod) loadStatements(selectedPeriod) }, [selectedPeriod])

  const loadPeriods = async () => {
    const { data, error } = await supabase.from('payroll').select('*').order('period', { ascending: false })
    if (error?.code === 'PGRST205') { setSchemaOk(false); setLoading(false); return }
    if (error) { toast.error(error.message); setLoading(false); return }
    setSchemaOk(true)
    const list = periodsFromPayroll(data)
    setPeriods(list)
    if (list.length && !selectedPeriod) setSelectedPeriod(list[0].period)
    setLoading(false)
  }

  const loadStatements = async (period) => {
    const { data, error } = await supabase.from('payroll').select('*').eq('period', period).order('employee_name')
    if (error) { toast.error(error.message); return }
    setStatements(data || [])
  }

  const closeMonth = async (period) => {
    const { confirmDeadline, payDate } = getPeriodDates(period)
    if (!window.confirm(fill(p.closeConfirm, { period: fmtPeriod(period), deadline: confirmDeadline, payDate }))) return
    setClosing(true)
    try {
      const result = await closePayrollMonth(supabase, period, {
        salaryDesc: fill(p.salaryDesc, { period: fmtPeriod(period) }),
      })
      toast.success(fill(p.closed, { period: fmtPeriod(result.period) }))
      setSelectedPeriod(period)
      await loadPeriods()
      await loadStatements(period)
    } catch (e) {
      toast.error(e.message)
    }
    setClosing(false)
  }

  const finalizeStatement = async (id) => {
    const { error } = await supabase.from('payroll').update({
      status: 'paid',
      paid_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) return toast.error(error.message)
    toast.success(p.finalized)
    loadStatements(selectedPeriod)
  }

  const currentPeriod = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 7)
  const prevPeriod = (() => {
    const [y, m] = currentPeriod.split('-').map(Number)
    const pm = m === 1 ? 12 : m - 1
    const py = m === 1 ? y - 1 : y
    return `${py}-${String(pm).padStart(2, '0')}`
  })()

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{p.title}</h2>
      <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 16 }}>{p.hint}</p>

      {!schemaOk && (
        <div style={{ background: 'rgba(239,159,39,0.1)', border: '1px solid rgba(239,159,39,0.3)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>⚠️ {p.setupNeeded}</div>
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>{p.setupHint}</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={closing} onClick={() => closeMonth(prevPeriod)}>
          {closing ? p.closing : `🔒 ${fill(p.closePrev, { period: fmtPeriod(prevPeriod) })}`}
        </button>
        <button className="btn" onClick={() => closeMonth(currentPeriod)} disabled={closing}>
          {fill(p.closeCurrent, { period: fmtPeriod(currentPeriod) })}
        </button>
      </div>

      {loading && <div style={{ color: 'var(--text3)' }}>{t.app.loading}</div>}

      {periods.length > 0 && (
        <div className="tab-pills" style={{ marginBottom: 14 }}>
          {periods.map(row => (
            <button key={row.period} className={`tab-pill${selectedPeriod === row.period ? ' active' : ''}`}
              onClick={() => setSelectedPeriod(row.period)}>
              {fmtPeriod(row.period)} ({row.status})
            </button>
          ))}
        </div>
      )}

      {selectedPeriod && (
        <div className="card">
          <div className="card-title">{fill(p.slips, { period: fmtPeriod(selectedPeriod) })}</div>
          {(() => {
            const d = getPeriodDates(selectedPeriod)
            return <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>{fill(p.confirmUntil, { deadline: d.confirmDeadline, payDate: d.payDate })}</div>
          })()}
          {statements.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13 }}>{p.noSlips}</div>}
          {statements.map(s => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{s.employee_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                  {p.base} ¥{Number(s.base_salary).toLocaleString()} · {p.deductions} -¥{Number(s.deductions).toLocaleString()} · {p.net} <b>¥{Number(s.net_total).toLocaleString()}</b>
                </div>
                <div style={{ fontSize: 11, marginTop: 2 }}>
                  <span className={`badge ${s.status === 'paid' ? 'badge-green' : 'badge-amber'}`}>{s.status}</span>
                </div>
              </div>
              {s.status !== 'paid' && (
                <button className="btn btn-sm btn-primary" onClick={() => finalizeStatement(s.id)}>{p.finalize}</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
