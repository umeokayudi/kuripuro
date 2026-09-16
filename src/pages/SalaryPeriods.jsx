import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { getPeriodDates, fmtPeriod, getCurrentPeriod, shiftYearMonth } from '../lib/salaryPeriod'
import { monthBounds } from '../lib/dates'
import { calcPeriodSalary } from '../lib/salaryCalc'
import { useLang, fill } from '../hooks/useLang'

const yen = n => `¥${Number(n || 0).toLocaleString()}`

async function loadMonthSnapshot(period) {
  const { from, to } = monthBounds(period)
  const [{ data: employees }, { data: jobs }, { data: payments }] = await Promise.all([
    supabase.from('employees').select('*').eq('is_active', true).order('full_name'),
    supabase.from('jobs').select('*').eq('status', 'completed').gte('scheduled_date', from).lte('scheduled_date', to),
    supabase.from('salary_payments').select('*').eq('period', period),
  ])
  return (employees || []).map(emp => {
    const calc = calcPeriodSalary(
      emp,
      (jobs || []).filter(j => j.employee_id === emp.id),
      (payments || []).filter(p => p.employee_id === emp.id),
      { period },
    )
    return { emp, calc }
  })
}

export default function SalaryPeriods() {
  const { lang, t } = useLang()
  const p = t.payroll
  const [periods, setPeriods] = useState([])
  const [statements, setStatements] = useState([])
  const [selectedPeriod, setSelectedPeriod] = useState('')
  const [loading, setLoading] = useState(true)
  const [closing, setClosing] = useState(false)
  const [schemaOk, setSchemaOk] = useState(true)
  const [preview, setPreview] = useState(null)

  useEffect(() => { loadPeriods() }, [])
  useEffect(() => { if (selectedPeriod) loadStatements(selectedPeriod) }, [selectedPeriod])

  const loadPeriods = async () => {
    const { data, error } = await supabase.from('salary_periods').select('*').order('period', { ascending: false })
    if (error?.code === 'PGRST205') { setSchemaOk(false); setLoading(false); return }
    setPeriods(data || [])
    if (data?.length && !selectedPeriod) setSelectedPeriod(data[0].period)
    setLoading(false)
  }

  const loadStatements = async (period) => {
    const { data } = await supabase.from('salary_statements').select('*').eq('period', period).order('employee_name')
    setStatements(data || [])
  }

  const openPreview = async (period) => {
    const { confirmDeadline, payDate } = getPeriodDates(period)
    setClosing(true)
    try {
      const rows = await loadMonthSnapshot(period)
      setPreview({ period, confirmDeadline, payDate, rows })
    } catch (e) {
      toast.error(e.message)
    }
    setClosing(false)
  }

  const writeClose = async () => {
    if (!preview) return
    const { period, confirmDeadline, payDate, rows } = preview
    setClosing(true)
    try {
      await supabase.from('salary_periods').upsert({
        period, closed_at: new Date().toISOString(), confirm_deadline: confirmDeadline,
        pay_date: payDate, status: 'closed',
      }, { onConflict: 'period' })

      const desc = fill(p.salaryDesc, { period: fmtPeriod(period, lang) })
      for (const { emp, calc } of rows) {
        await supabase.from('salary_statements').upsert({
          period, employee_id: emp.id, employee_name: emp.full_name,
          base_salary: calc.base, deductions: calc.deductions, bonuses: calc.spotEarned,
          net_total: calc.toPay,
          breakdown: {
            jobs: calc.jobs, hours: calc.hours, workedDays: calc.workedDays,
            base: calc.base, spot: calc.spotEarned, advances: calc.advancesReceived,
            earnedNet: calc.net, toPay: calc.toPay, salary_type: calc.salaryType,
          },
          status: 'awaiting_confirmation',
        }, { onConflict: 'period,employee_id' })

        if (calc.toPay <= 0) continue
        const payload = {
          employee_id: emp.id, employee_name: emp.full_name,
          period, amount: calc.toPay, payment_date: payDate,
          description: desc,
          status: 'scheduled', payment_type: 'salary', is_deduction: false,
        }
        const up = await supabase.from('salary_payments').upsert(payload, {
          onConflict: 'employee_id,period,payment_type', ignoreDuplicates: false,
        })
        if (up.error) await supabase.from('salary_payments').insert(payload)
      }

      toast.success(fill(p.closed, { period: fmtPeriod(period, lang) }))
      setPreview(null)
      loadPeriods()
      loadStatements(period)
      setSelectedPeriod(period)
    } catch (e) {
      toast.error(e.message)
    }
    setClosing(false)
  }

  const finalizeStatement = async (id) => {
    await supabase.from('salary_statements').update({ status: 'finalized', admin_finalized_at: new Date().toISOString() }).eq('id', id)
    toast.success(p.finalized)
    loadStatements(selectedPeriod)
  }

  const currentPeriod = getCurrentPeriod()
  const prevPeriod = shiftYearMonth(currentPeriod, -1)

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
        <button className="btn btn-primary" disabled={closing} onClick={() => openPreview(prevPeriod)}>
          {closing ? p.closing : `🔒 ${fill(p.closePrev, { period: fmtPeriod(prevPeriod, lang) })}`}
        </button>
        <button className="btn" onClick={() => openPreview(currentPeriod)} disabled={closing}>
          {fill(p.closeCurrent, { period: fmtPeriod(currentPeriod, lang) })}
        </button>
      </div>

      {preview && (
        <div className="card" style={{ marginBottom: 16, border: '1px solid rgba(193,156,86,0.35)' }}>
          <div className="card-title">{fill(p.previewTitle, { period: fmtPeriod(preview.period, lang) })}</div>
          <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 12 }}>{p.previewHint}</p>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
            {fill(p.confirmUntil, { deadline: preview.confirmDeadline, payDate: preview.payDate })}
          </div>
          {preview.rows.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13 }}>{p.emptyPreview}</div>}
          {preview.rows.map(({ emp, calc }) => (
            <div key={emp.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{emp.full_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                  {p.base} {yen(calc.base)} · {p.deductions} -{yen(calc.deductions)} · {p.advances} -{yen(calc.advancesReceived)} · {p.jobs} {calc.jobs}
                </div>
              </div>
              <div style={{ fontWeight: 800, color: 'var(--green)', whiteSpace: 'nowrap' }}>{p.toPay} {yen(calc.toPay)}</div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn btn-primary" disabled={closing || !preview.rows.length} onClick={writeClose}>{p.previewWrite}</button>
            <button className="btn" onClick={() => setPreview(null)}>{p.previewCancel}</button>
          </div>
        </div>
      )}

      {loading && <div style={{ color: 'var(--text3)' }}>{t.app.loading}</div>}

      {periods.length > 0 && (
        <div className="tab-pills" style={{ marginBottom: 14 }}>
          {periods.map(row => (
            <button key={row.period} className={`tab-pill${selectedPeriod === row.period ? ' active' : ''}`}
              onClick={() => setSelectedPeriod(row.period)}>
              {fmtPeriod(row.period, lang)} ({row.status})
            </button>
          ))}
        </div>
      )}

      {selectedPeriod && (
        <div className="card">
          <div className="card-title">{fill(p.slips, { period: fmtPeriod(selectedPeriod, lang) })}</div>
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
                  {p.base} {yen(s.base_salary)} · {p.deductions} -{yen(s.deductions)} · {p.net} <b>{yen(s.net_total)}</b>
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
