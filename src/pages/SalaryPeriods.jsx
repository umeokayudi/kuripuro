import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { getPeriodDates, fmtPeriod } from '../lib/salaryPeriod'
import { closePayrollMonth, payClosedPayroll, periodsFromPayroll, previousPeriod } from '../lib/payrollClose'
import { tokyoToday } from '../lib/dates'
import { useLang, fill } from '../hooks/useLang'

export default function SalaryPeriods() {
  const { t } = useLang()
  const p = t.payroll
  const [periods, setPeriods] = useState([])
  const [statements, setStatements] = useState([])
  const [selectedPeriod, setSelectedPeriod] = useState('')
  const [loading, setLoading] = useState(true)
  const [closing, setClosing] = useState(false)
  const [paying, setPaying] = useState(false)
  const [schemaOk, setSchemaOk] = useState(true)

  const currentPeriod = tokyoToday().slice(0, 7)
  const prevPeriod = previousPeriod(currentPeriod)

  useEffect(() => { boot() }, [])

  useEffect(() => { if (selectedPeriod) loadStatements(selectedPeriod) }, [selectedPeriod])

  const boot = async () => {
    try {
      const result = await closePayrollMonth(supabase, prevPeriod)
      if (result.closed.length) {
        toast.success(fill(p.autoClosed, { period: fmtPeriod(prevPeriod), n: result.closed.length }))
      }
    } catch (e) {
      if (e.message?.includes('PGRST205') || /schema cache|does not exist/i.test(e.message || '')) {
        setSchemaOk(false)
        setLoading(false)
        return
      }
    }
    await loadPeriods(prevPeriod)
  }

  const loadPeriods = async (prefer) => {
    const { data, error } = await supabase.from('payroll').select('*').order('period', { ascending: false })
    if (error?.code === 'PGRST205') { setSchemaOk(false); setLoading(false); return }
    if (error) { toast.error(error.message); setLoading(false); return }
    setSchemaOk(true)
    const list = periodsFromPayroll(data)
    setPeriods(list)
    const next = prefer || selectedPeriod || list[0]?.period || prevPeriod
    setSelectedPeriod(next)
    setLoading(false)
    if (next) await loadStatements(next)
  }

  const loadStatements = async (period) => {
    const { data, error } = await supabase.from('payroll').select('*').eq('period', period).order('employee_name')
    if (error) { toast.error(error.message); return }
    setStatements(data || [])
  }

  const recalcClose = async (period) => {
    setClosing(true)
    try {
      const result = await closePayrollMonth(supabase, period)
      toast.success(fill(p.closed, { period: fmtPeriod(result.period) }))
      await loadPeriods(period)
    } catch (e) {
      toast.error(e.message)
    }
    setClosing(false)
  }

  const payPeriod = async (period, employeeId) => {
    const { payDate } = getPeriodDates(period)
    if (!window.confirm(fill(p.payConfirm, { period: fmtPeriod(period), payDate }))) return
    setPaying(true)
    try {
      const result = await payClosedPayroll(supabase, period, {
        employeeId,
        salaryDesc: fill(p.salaryDesc, { period: fmtPeriod(period) }),
      })
      toast.success(fill(p.paidToast, { n: result.paid.length, period: fmtPeriod(period) }))
      await loadPeriods(period)
    } catch (e) {
      toast.error(e.message)
    }
    setPaying(false)
  }

  const unpaid = statements.filter(s => s.status !== 'paid')

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
        <button className="btn" disabled={closing || paying} onClick={() => recalcClose(prevPeriod)}>
          {closing ? p.closing : fill(p.recalc, { period: fmtPeriod(prevPeriod) })}
        </button>
        <button className="btn" disabled={closing || paying} onClick={() => recalcClose(currentPeriod)}>
          {fill(p.recalc, { period: fmtPeriod(currentPeriod) })}
        </button>
        <button className="btn btn-primary" disabled={paying || closing || !selectedPeriod || unpaid.length === 0}
          onClick={() => payPeriod(selectedPeriod)}>
          {paying ? p.paying : fill(p.payPeriod, { period: fmtPeriod(selectedPeriod || prevPeriod) })}
        </button>
      </div>

      {loading && <div style={{ color: 'var(--text3)' }}>{t.app.loading}</div>}

      {periods.length > 0 && (
        <div className="tab-pills" style={{ marginBottom: 14 }}>
          {periods.map(row => (
            <button key={row.period} className={`tab-pill${selectedPeriod === row.period ? ' active' : ''}`}
              onClick={() => setSelectedPeriod(row.period)}>
              {fmtPeriod(row.period)} ({row.status === 'paid' ? p.paidLabel : p.closedLabel})
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
                  <span className={`badge ${s.status === 'paid' ? 'badge-green' : 'badge-amber'}`}>
                    {s.status === 'paid' ? p.paidLabel : p.closedLabel}
                  </span>
                </div>
              </div>
              {s.status !== 'paid' && (
                <button className="btn btn-sm btn-primary" disabled={paying} onClick={() => payPeriod(selectedPeriod, s.employee_id)}>{p.payOne}</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
