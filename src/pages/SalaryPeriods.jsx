import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { getPeriodDates, fmtPeriod } from '../lib/salaryPeriod'
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

  const closeMonth = async (period) => {
    const { confirmDeadline, payDate } = getPeriodDates(period)
    if (!window.confirm(fill(p.closeConfirm, { period: fmtPeriod(period), deadline: confirmDeadline, payDate }))) return
    setClosing(true)
    try {
      await supabase.from('salary_periods').upsert({
        period, closed_at: new Date().toISOString(), confirm_deadline: confirmDeadline,
        pay_date: payDate, status: 'closed',
      }, { onConflict: 'period' })

      const { data: employees } = await supabase.from('employees').select('*').eq('is_active', true)
      const monthStart = period + '-01'
      const monthEnd = period + '-31'

      for (const emp of employees || []) {
        const { data: jobs } = await supabase.from('jobs').select('*')
          .eq('employee_id', emp.id).eq('status', 'completed')
          .gte('scheduled_date', monthStart).lte('scheduled_date', monthEnd)

        const { data: deductions } = await supabase.from('salary_payments').select('amount')
          .eq('employee_id', emp.id).eq('period', period).eq('is_deduction', true)

        const jobPay = (j) => Number(j.retro_value ?? j.value ?? 0)
        let base = 0
        if (emp.salary_type === 'fixed') {
          const days = new Set((jobs || []).map(j => j.scheduled_date)).size
          base = Math.min(Math.round((emp.fixed_salary || 0) / (emp.monthly_work_days || 22) * days), emp.fixed_salary || 0)
        } else if (emp.salary_type === 'hourly') {
          base = (jobs || []).reduce((s, j) => {
            if (j.started_at && j.completed_at) return s + (new Date(j.completed_at) - new Date(j.started_at)) / 60000
            return s + (j.retro_time_min || 45)
          }, 0) / 60 * (emp.hourly_rate || 0)
          base = Math.round(base)
        } else if (emp.salary_type === 'per_job') {
          base = (jobs || []).reduce((s, j) => s + Math.round(jobPay(j) * ((emp.job_bonus_rate || 100) / 100)), 0)
        } else {
          base = emp.fixed_salary || 0
        }

        const dedTotal = (deductions || []).reduce((s, d) => s + Number(d.amount || 0), 0)
        const net = Math.max(0, base - dedTotal)
        const desc = fill(p.salaryDesc, { period: fmtPeriod(period) })

        await supabase.from('salary_statements').upsert({
          period, employee_id: emp.id, employee_name: emp.full_name,
          base_salary: base, deductions: dedTotal, net_total: net,
          breakdown: { jobs: jobs?.length || 0, salary_type: emp.salary_type },
          status: 'awaiting_confirmation',
        }, { onConflict: 'period,employee_id' })

        await supabase.from('salary_payments').upsert({
          employee_id: emp.id, employee_name: emp.full_name,
          period, amount: net, payment_date: payDate,
          description: desc,
          status: 'scheduled', payment_type: 'salary', is_deduction: false,
        }, { onConflict: 'employee_id,period,payment_type', ignoreDuplicates: false }).catch(() => {
          supabase.from('salary_payments').insert({
            employee_id: emp.id, employee_name: emp.full_name,
            period, amount: net, payment_date: payDate,
            description: desc,
            status: 'scheduled', payment_type: 'salary', is_deduction: false,
          })
        })
      }

      toast.success(fill(p.closed, { period: fmtPeriod(period) }))
      loadPeriods()
      loadStatements(period)
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
