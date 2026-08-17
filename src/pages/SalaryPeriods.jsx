import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { getPeriodDates, fmtPeriod } from '../lib/salaryPeriod'

export default function SalaryPeriods() {
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
    const { closeDate, confirmDeadline, payDate } = getPeriodDates(period)
    if (!window.confirm(`Fechar ${fmtPeriod(period)}?\n\nFuncionários confirmam até ${confirmDeadline}\nPagamento em ${payDate}`)) return
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

        await supabase.from('salary_statements').upsert({
          period, employee_id: emp.id, employee_name: emp.full_name,
          base_salary: base, deductions: dedTotal, net_total: net,
          breakdown: { jobs: jobs?.length || 0, salary_type: emp.salary_type },
          status: 'awaiting_confirmation',
        }, { onConflict: 'period,employee_id' })

        await supabase.from('salary_payments').upsert({
          employee_id: emp.id, employee_name: emp.full_name,
          period, amount: net, payment_date: payDate,
          description: `Salário ${fmtPeriod(period)}`,
          status: 'scheduled', payment_type: 'salary', is_deduction: false,
        }, { onConflict: 'employee_id,period,payment_type', ignoreDuplicates: false }).catch(() => {
          supabase.from('salary_payments').insert({
            employee_id: emp.id, employee_name: emp.full_name,
            period, amount: net, payment_date: payDate,
            description: `Salário ${fmtPeriod(period)}`,
            status: 'scheduled', payment_type: 'salary', is_deduction: false,
          })
        })
      }

      toast.success(`Mês ${fmtPeriod(period)} fechado! Confirmação até dia 5, pagamento dia 15.`)
      loadPeriods()
      loadStatements(period)
    } catch (e) {
      toast.error(e.message)
    }
    setClosing(false)
  }

  const finalizeStatement = async (id) => {
    await supabase.from('salary_statements').update({ status: 'finalized', admin_finalized_at: new Date().toISOString() }).eq('id', id)
    toast.success('Holerite finalizado')
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
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>📅 Fechamento de Salário</h2>
      <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 16 }}>
        Fecha no último dia do mês → funcionário confirma até dia <b>5</b> → pagamento dia <b>15</b>
      </p>

      {!schemaOk && (
        <div style={{ background: 'rgba(239,159,39,0.1)', border: '1px solid rgba(239,159,39,0.3)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>⚠️ Setup necessário (uma vez)</div>
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>
            Execute o arquivo <code>schema-extensions.sql</code> no Supabase SQL Editor para ativar contratos PDF e fechamento de salário.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={closing} onClick={() => closeMonth(prevPeriod)}>
          {closing ? 'Fechando...' : `🔒 Fechar ${fmtPeriod(prevPeriod)}`}
        </button>
        <button className="btn" onClick={() => closeMonth(currentPeriod)} disabled={closing}>
          Fechar {fmtPeriod(currentPeriod)} (atual)
        </button>
      </div>

      {loading && <div style={{ color: 'var(--text3)' }}>Loading...</div>}

      {periods.length > 0 && (
        <div className="tab-pills" style={{ marginBottom: 14 }}>
          {periods.map(p => (
            <button key={p.period} className={`tab-pill${selectedPeriod === p.period ? ' active' : ''}`}
              onClick={() => setSelectedPeriod(p.period)}>
              {fmtPeriod(p.period)} ({p.status})
            </button>
          ))}
        </div>
      )}

      {selectedPeriod && (
        <div className="card">
          <div className="card-title">Holerites — {fmtPeriod(selectedPeriod)}</div>
          {(() => {
            const d = getPeriodDates(selectedPeriod)
            return <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>Confirmar até {d.confirmDeadline} · Pagar em {d.payDate}</div>
          })()}
          {statements.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13 }}>Nenhum holerite gerado. Feche o mês primeiro.</div>}
          {statements.map(s => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{s.employee_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                  Base ¥{Number(s.base_salary).toLocaleString()} · Desc -¥{Number(s.deductions).toLocaleString()} · Líquido <b>¥{Number(s.net_total).toLocaleString()}</b>
                </div>
                <div style={{ fontSize: 11, marginTop: 2 }}>
                  {s.employee_confirmed_at && <span style={{ color: 'var(--green)' }}>✓ Confirmado </span>}
                  {s.employee_disputed_at && <span style={{ color: 'var(--red)' }}>⚠ Contestado </span>}
                  <span className={`badge ${s.status === 'finalized' ? 'badge-green' : 'badge-amber'}`}>{s.status}</span>
                </div>
              </div>
              {s.status !== 'finalized' && s.employee_confirmed_at && (
                <button className="btn btn-sm btn-primary" onClick={() => finalizeStatement(s.id)}>Finalizar</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
