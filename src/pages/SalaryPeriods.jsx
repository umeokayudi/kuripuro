import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { getPeriodDates, fmtPeriod } from '../lib/salaryPeriod'
import { closeSalaryPeriod } from '../lib/salaryClose'
import { PAYROLL_CHANGED } from '../lib/payrollAlerts'
import { useSearchParams } from 'react-router-dom'
import { useLang, fill } from '../hooks/useLang'
import { askConfirm } from '../components/ConfirmDialog'

export default function SalaryPeriods() {
  const { t, tr } = useLang()
  const p = t.payroll
  const [periods, setPeriods] = useState([])
  const [statements, setStatements] = useState([])
  const [selectedPeriod, setSelectedPeriod] = useState('')
  const [loading, setLoading] = useState(true)
  const [closing, setClosing] = useState(false)
  const [schemaOk, setSchemaOk] = useState(true)
  const [activeEmps, setActiveEmps] = useState([])
  const [searchParams] = useSearchParams()
  const wanted = searchParams.get('period')

  useEffect(() => {
    loadPeriods()
    supabase.from('employees').select('id,full_name').eq('is_active', true).order('full_name').then(({ data }) => setActiveEmps(data || []))
  }, [])

  useEffect(() => { if (selectedPeriod) loadStatements(selectedPeriod) }, [selectedPeriod])

  const loadPeriods = async () => {
    const { data, error } = await supabase.from('salary_periods').select('*').order('period', { ascending: false })
    if (error?.code === 'PGRST205') { setSchemaOk(false); setLoading(false); return }
    setPeriods(data || [])
    if (data?.length && !selectedPeriod) setSelectedPeriod(data.find(r => r.period === wanted)?.period || data[0].period)
    setLoading(false)
  }

  const loadStatements = async (period) => {
    const { data } = await supabase.from('salary_statements').select('*').eq('period', period).order('employee_name')
    setStatements(data || [])
  }

  const closeMonth = async (period) => {
    const { confirmDeadline, payDate } = getPeriodDates(period)
    if (!(await askConfirm({ message: fill(p.closeConfirm, { period: fmtPeriod(period), deadline: confirmDeadline, payDate }), danger: false }))) return
    setClosing(true)
    try {
      await closeSalaryPeriod(supabase, period, { salaryDesc: fill(p.salaryDesc, { period: fmtPeriod(period) }) })
      toast.success(fill(p.closed, { period: fmtPeriod(period) }))
      notifyChanged()
      loadPeriods()
      loadStatements(period)
    } catch (e) {
      toast.error(e.message)
    }
    setClosing(false)
  }

  const notifyChanged = () => { try { window.dispatchEvent(new Event(PAYROLL_CHANGED)) } catch { /* SSR */ } }

  const setPeriodStatus = async (period, status, message) => {
    const { error } = await supabase.from('salary_periods').update({ status }).eq('period', period)
    if (error) { toast.error(error.message); return }
    toast.success(message)
    notifyChanged()
    loadPeriods()
  }

  const reopen = async (period) => {
    if (!(await askConfirm({ message: fill(p.reopenConfirm, { period: fmtPeriod(period) }), danger: true }))) return
    setPeriodStatus(period, 'open', fill(p.reopened, { period: fmtPeriod(period) }))
  }

  const finalizeStatement = async (id) => {
    await supabase.from('salary_statements').update({ status: 'finalized', admin_finalized_at: new Date().toISOString() }).eq('id', id)
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

  // A month shows ONE action: close it while open, otherwise its state (+ reopen / recalculate).
  const statusOf = (period) => periods.find(r => r.period === period)?.status || 'open'
  const missing = activeEmps.filter(e => !statements.some(s => s.employee_id === e.id))
  const selectedStatus = selectedPeriod ? statusOf(selectedPeriod) : 'open'

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
        {statusOf(prevPeriod) === 'open' && (
          <button className="btn btn-primary" disabled={closing} onClick={() => closeMonth(prevPeriod)}>
            {closing ? p.closing : `🔒 ${fill(p.closePrev, { period: fmtPeriod(prevPeriod) })}`}
          </button>
        )}
        {statusOf(currentPeriod) === 'open' && (
          <button className="btn" onClick={() => closeMonth(currentPeriod)} disabled={closing}>
            {fill(p.closeCurrent, { period: fmtPeriod(currentPeriod) })}
          </button>
        )}
      </div>

      {loading && <div style={{ color: 'var(--text3)' }}>{t.app.loading}</div>}

      {periods.length > 0 && (
        <div className="tab-pills" style={{ marginBottom: 14 }}>
          {periods.map(row => (
            <button key={row.period} className={`tab-pill${selectedPeriod === row.period ? ' active' : ''}`}
              onClick={() => setSelectedPeriod(row.period)}>
              {fmtPeriod(row.period)} ({p.status?.[row.status] || row.status})
            </button>
          ))}
        </div>
      )}

      {selectedPeriod && (
        <div className="card">
          <div className="card-title">{fill(p.slips, { period: fmtPeriod(selectedPeriod) })}</div>
          {(() => {
            const row = periods.find(r => r.period === selectedPeriod)
            if (!row) return null
            return (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                {row.status === 'auto_closed' && (
                  <>
                    <span style={{ fontSize: 13, color: 'var(--text2)' }}>🤖 {p.autoClosedHint}</span>
                    <button className="btn btn-sm btn-primary" onClick={() => setPeriodStatus(row.period, 'closed', p.reviewedToast)}>✓ {p.markReviewed}</button>
                  </>
                )}
                {row.status !== 'open' && (
                  <button className="btn btn-sm" onClick={() => reopen(row.period)}>🔓 {p.reopen}</button>
                )}
                {row.status === 'open' && (
                  <button className="btn btn-sm btn-primary" disabled={closing} onClick={() => closeMonth(row.period)}>🔒 {fill(p.closePrev, { period: fmtPeriod(row.period) })}</button>
                )}
              </div>
            )
          })()}
          {(() => {
            const d = getPeriodDates(selectedPeriod)
            return <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>{fill(p.confirmUntil, { deadline: d.confirmDeadline, payDate: d.payDate })}</div>
          })()}
          {selectedStatus !== 'open' && missing.length > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13, color: 'var(--text2)', marginBottom: 10 }}>
              <span>⚠️ {tr(`Not in this payroll: ${missing.map(e => e.full_name).join(', ')}`, `この締めに含まれていない人: ${missing.map(e => e.full_name).join('、')}`, `Fora desta folha: ${missing.map(e => e.full_name).join(', ')}`)}</span>
              <button className="btn btn-sm" disabled={closing} onClick={() => closeMonth(selectedPeriod)}>{tr('Recalculate and include', '再計算して追加', 'Recalcular e incluir')}</button>
            </div>
          )}
          {statements.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13 }}>{p.noSlips}</div>}
          {statements.map(s => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{s.employee_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                  {p.base} ¥{Number(s.base_salary).toLocaleString()} · {p.deductions} -¥{Number(s.deductions).toLocaleString()} · {p.net} <b>¥{Number(s.net_total).toLocaleString()}</b>
                </div>
                <div style={{ fontSize: 11, marginTop: 2 }}>
                  {s.employee_confirmed_at && <span style={{ color: 'var(--green)' }}>✓ {p.confirmed} </span>}
                  {s.employee_disputed_at && <span style={{ color: 'var(--red)' }}>⚠ {p.disputed} </span>}
                  <span className={`badge ${s.status === 'finalized' ? 'badge-green' : 'badge-amber'}`}>{s.status}</span>
                </div>
              </div>
              {s.status !== 'finalized' && s.employee_confirmed_at && (
                <button className="btn btn-sm btn-primary" onClick={() => finalizeStatement(s.id)}>{p.finalize}</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
