import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { getPeriodDates, fmtPeriod } from '../lib/salaryPeriod'
import { closeSalaryPeriod, closeEmployeeMonth, isPayrollActive, payrollState } from '../lib/salaryClose'
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
  const [salaryLines, setSalaryLines] = useState([])
  const [failed, setFailed] = useState({}) // employee id → error of the last close
  const [including, setIncluding] = useState(null)
  const [searchParams] = useSearchParams()
  const wanted = searchParams.get('period')

  useEffect(() => {
    loadPeriods()
    // Same rule as the close: everyone not switched off (is_active empty counts as active).
    supabase.from('employees').select('*').order('full_name').then(({ data }) => setActiveEmps((data || []).filter(isPayrollActive)))
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
    const [{ data }, { data: lines }] = await Promise.all([
      supabase.from('salary_statements').select('*').eq('period', period).order('employee_name'),
      supabase.from('salary_payments').select('id,employee_id,status,amount').eq('period', period).eq('payment_type', 'salary'),
    ])
    setStatements(data || [])
    setSalaryLines(lines || [])
  }

  const closeMonth = async (period) => {
    const { confirmDeadline, payDate } = getPeriodDates(period)
    if (!(await askConfirm({ message: fill(p.closeConfirm, { period: fmtPeriod(period), deadline: confirmDeadline, payDate }), danger: false }))) return
    setClosing(true)
    try {
      const res = await closeSalaryPeriod(supabase, period, { salaryDesc: fill(p.salaryDesc, { period: fmtPeriod(period) }) })
      setFailed(Object.fromEntries((res.failed || []).map(f => [f.id, f.error])))
      if (res.failed?.length) toast.error(tr(`${res.failed.length} person(s) could not be included — see the list`, `${res.failed.length}人を含められませんでした — 一覧を確認`, `${res.failed.length} pessoa(s) não entraram — veja a lista`))
      else toast.success(fill(p.closed, { period: fmtPeriod(period) }))
      notifyChanged()
      loadPeriods()
      loadStatements(period)
    } catch (e) {
      toast.error(e.message)
    }
    setClosing(false)
  }

  // "Include" one person left out of the month: same calculation as the month close, for that person only.
  const includeOne = async (emp) => {
    setIncluding(emp.id)
    try {
      await closeEmployeeMonth(supabase, selectedPeriod, emp, { salaryDesc: fill(p.salaryDesc, { period: fmtPeriod(selectedPeriod) }) })
      setFailed(f => { const n = { ...f }; delete n[emp.id]; return n })
      toast.success(tr(`${emp.full_name} included`, `${emp.full_name} を追加しました`, `${emp.full_name} incluído(a)`))
      notifyChanged()
      loadStatements(selectedPeriod)
    } catch (e) {
      setFailed(f => ({ ...f, [emp.id]: e.message }))
      toast.error(e.message)
    }
    setIncluding(null)
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
          {(selectedStatus !== 'open' || statements.length > 0) && missing.length > 0 && (
            <div className="sp-out" style={{ border: '1px solid rgba(245,158,11,.4)', background: 'rgba(245,158,11,.08)', borderRadius: 12, padding: '10px 12px', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>⚠️ {tr(`Out of this payroll (${missing.length})`, `この締めに含まれていない人（${missing.length}人）`, `Fora deste fechamento (${missing.length})`)}</div>
              {missing.map(e => (
                <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid rgba(245,158,11,.25)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{e.full_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text2)', overflowWrap: 'anywhere' }}>
                      {failed[e.id]
                        ? tr(`Could not calculate: ${failed[e.id]}`, `計算できませんでした: ${failed[e.id]}`, `Não deu para calcular: ${failed[e.id]}`)
                        : tr('No payslip for this month yet', 'この月の明細がまだありません', 'Ainda sem holerite neste mês')}
                    </div>
                  </div>
                  <button className="btn btn-sm btn-primary" style={{ minHeight: 40, flexShrink: 0 }} disabled={including === e.id || closing} onClick={() => includeOne(e)}>
                    {including === e.id ? '…' : tr('Include', '追加', 'Incluir')}
                  </button>
                </div>
              ))}
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
                  {(() => {
                    const st = payrollState(s, salaryLines.find(l => l.employee_id === s.employee_id))
                    const label = {
                      none: tr('Not calculated', '未計算', 'Sem cálculo'),
                      waiting: tr('Waiting for the employee', '本人確認待ち', 'Esperando o funcionário'),
                      disputed: tr('Disputed', '異議あり', 'Contestado'),
                      confirmed: tr('Confirmed', '確認済み', 'Confirmado'),
                      finalized: tr('Finalized', '確定済み', 'Finalizado'),
                      paid: tr('Paid', '支払済', 'Pago'),
                      paid_unconfirmed: tr('Marked paid, payslip NOT confirmed', '支払済だが明細は未確認', 'Marcado pago, holerite NÃO confirmado'),
                    }[st]
                    const cls = st === 'paid' || st === 'finalized' || st === 'confirmed' ? 'badge-green' : st === 'disputed' || st === 'paid_unconfirmed' ? 'badge-red' : 'badge-amber'
                    return <span className={`badge ${cls}`}>{label}</span>
                  })()}
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
