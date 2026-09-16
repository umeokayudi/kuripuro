import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { useLang, fill } from '../hooks/useLang'
import { tokyoToday, monthBounds } from '../lib/dates'
import { recentYearMonths, fmtPeriod, getPeriodDates } from '../lib/salaryPeriod'
import {
  calcPeriodSalary,
  plannedWeeklyAdvances,
  isDeductionRow,
} from '../lib/salaryCalc'
import { salaryTypeLabel } from '../lib/employeePay'

const yen = n => `¥${Number(n || 0).toLocaleString()}`

export default function Salary() {
  const { lang, t } = useLang()
  const s = t.salaryDesk
  const [employees, setEmployees] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [period, setPeriod] = useState(tokyoToday().slice(0, 7))
  const [jobs, setJobs] = useState([])
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [advForm, setAdvForm] = useState({ amount: '', desc: '', date: tokyoToday() })
  const [dedForm, setDedForm] = useState({ amount: '', desc: '', date: tokyoToday() })

  const selected = employees.find(e => e.id === selectedId) || null
  const months = useMemo(() => recentYearMonths(8), [])

  useEffect(() => { loadEmployees() }, [])
  useEffect(() => { if (selectedId) loadPeriod() }, [selectedId, period])

  const loadEmployees = async () => {
    const { data } = await supabase.from('employees').select('*').eq('is_active', true).order('full_name')
    setEmployees(data || [])
    setLoading(false)
  }

  const loadPeriod = async () => {
    const { from, to } = monthBounds(period)
    const [{ data: jobRows }, { data: payRows }] = await Promise.all([
      supabase.from('jobs').select('*')
        .eq('employee_id', selectedId)
        .eq('status', 'completed')
        .gte('scheduled_date', from)
        .lte('scheduled_date', to),
      supabase.from('salary_payments').select('*')
        .eq('employee_id', selectedId)
        .eq('period', period)
        .order('payment_date'),
    ])
    setJobs(jobRows || [])
    setPayments(payRows || [])
  }

  const calc = useMemo(
    () => selected ? calcPeriodSalary(selected, jobs, payments, { period }) : null,
    [selected, jobs, payments, period],
  )
  const weeklyDrafts = selected ? plannedWeeklyAdvances(selected, period, calc?.advanceRows) : []
  const payDates = getPeriodDates(period)

  const addRow = async (payload, okMsg) => {
    const { error } = await supabase.from('salary_payments').insert(payload)
    if (error) return toast.error(error.message)
    toast.success(okMsg)
    loadPeriod()
  }

  const addAdvance = async () => {
    if (!advForm.amount) return toast.error(s.enterAmount)
    if (!advForm.date) return toast.error(s.enterDate)
    await addRow({
      employee_id: selected.id,
      employee_name: selected.full_name,
      period,
      amount: parseFloat(advForm.amount),
      payment_date: advForm.date,
      description: advForm.desc || s.addAdvance,
      payment_type: 'advance',
      status: 'scheduled',
      is_deduction: false,
    }, s.advanceAdded)
    setAdvForm({ amount: '', desc: '', date: tokyoToday() })
  }

  const addDeduction = async () => {
    if (!dedForm.amount || !dedForm.desc) return toast.error(s.enterAmount)
    await addRow({
      employee_id: selected.id,
      employee_name: selected.full_name,
      period,
      amount: parseFloat(dedForm.amount),
      payment_date: dedForm.date || tokyoToday(),
      description: dedForm.desc,
      payment_type: 'deduction',
      status: 'scheduled',
      is_deduction: true,
    }, s.deductionAdded)
    setDedForm({ amount: '', desc: '', date: tokyoToday() })
  }

  const createWeekly = async () => {
    if (!weeklyDrafts.length) return
    const rows = weeklyDrafts.map(d => ({
      ...d,
      employee_id: selected.id,
      employee_name: selected.full_name,
      period,
    }))
    const { error } = await supabase.from('salary_payments').insert(rows)
    if (error) return toast.error(error.message)
    toast.success(fill(s.weeklyDone, { n: rows.length }))
    loadPeriod()
  }

  const downloadPayslip = async () => {
    const { generatePayslip, generatePayslipJP } = await import('../lib/generatePDF')
    const doc = lang === 'ja'
      ? await generatePayslipJP(selected, period, calc, payments, calc.advanceRows)
      : await generatePayslip(selected, period, calc, payments, calc.advanceRows)
    doc.save(`payslip_${(selected.full_name || 'staff').replace(/\s+/g, '_')}_${period}.pdf`)
    toast.success(s.payslipReady)
  }

  const markSalaryPaid = async () => {
    const row = (calc?.salaryRows || []).find(p => p.status !== 'paid')
    if (!row) return toast.error(s.noSalaryRow)
    const { error } = await supabase.from('salary_payments').update({ status: 'paid' }).eq('id', row.id)
    if (error) return toast.error(error.message)
    toast.success(s.salaryPaid)
    loadPeriod()
  }

  const rateLabel = emp => {
    if (emp.salary_type === 'hourly') return `${yen(emp.hourly_rate)}/h`
    if (emp.salary_type === 'per_job') return salaryTypeLabel('per_job', lang)
    return `${yen(emp.fixed_salary)}/mo`
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{s.title}</h2>
          <p style={{ fontSize: 13, color: 'var(--text3)', margin: '6px 0 0' }}>{s.hint}</p>
        </div>
        <Link to="/salary-periods" className="btn">{s.openClose}</Link>
      </div>

      <div className="grid-2" style={{ gap: 14 }}>
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-title">{s.selectEmployee}</div>
            <div className="form-group">
              <label>{s.period}</label>
              <select value={period} onChange={e => setPeriod(e.target.value)}>
                {months.map(m => <option key={m} value={m}>{fmtPeriod(m, lang)} ({m})</option>)}
              </select>
            </div>
            {loading && <div style={{ color: 'var(--text3)', fontSize: 13 }}>{t.app.loading}</div>}
            {employees.map(e => (
              <button
                key={e.id}
                type="button"
                onClick={() => setSelectedId(e.id)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '10px 12px', borderRadius: 8, cursor: 'pointer', marginBottom: 6,
                  background: selectedId === e.id ? 'var(--navy)' : 'var(--surface2)',
                  border: selectedId === e.id ? '1px solid var(--navy)' : '1px solid transparent',
                  color: selectedId === e.id ? '#fff' : 'var(--text)',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>{e.full_name}</div>
                <div style={{ fontSize: 11, opacity: 0.7 }}>{salaryTypeLabel(e.salary_type, lang)} · {rateLabel(e)}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          {!selected && <div className="card"><div style={{ color: 'var(--text3)', fontSize: 13 }}>{s.noEmployee}</div></div>}

          {selected && calc && <>
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="card-title">{s.contract} — {selected.full_name}</div>
              <div className="grid-2" style={{ gap: 8 }}>
                {[
                  [salaryTypeLabel(selected.salary_type, lang), rateLabel(selected)],
                  [s.start, selected.contract_start || '—'],
                  [s.end, selected.contract_end || '—'],
                  [s.weekly, selected.advance_per_week ? yen(selected.advance_per_week) : '—'],
                  [s.transport, selected.transport_reimbursed ? s.reimbursed : s.notReimbursed],
                  ['15th', payDates.payDate],
                ].map(([l, v]) => (
                  <div key={String(l)} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase' }}>{l}</div>
                    <div style={{ fontSize: 13, fontWeight: 500, marginTop: 2 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card" style={{ marginBottom: 14 }}>
              <div className="card-title">{fmtPeriod(period, lang)}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                {[
                  [s.earned, yen(calc.gross), 'var(--text)'],
                  [s.deductions, `-${yen(calc.deductions)}`, 'var(--red)'],
                  [s.advances, `-${yen(calc.advancesReceived)}`, 'var(--amber)'],
                  [s.toPay, yen(calc.toPay), 'var(--green)'],
                ].map(([l, v, c]) => (
                  <div key={l} style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{l}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: c, marginTop: 2 }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
                {fill(s.jobsCount, { n: calc.jobs })} · {fill(s.hours, { h: calc.hours })} · {fill(s.days, { n: calc.workedDays })}
                {calc.spotEarned > 0 ? ` · ${yen(calc.spotEarned)}` : ''}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={downloadPayslip}>{s.downloadPayslip}</button>
                <button className="btn" onClick={markSalaryPaid}>{s.markPaid}</button>
                {weeklyDrafts.length > 0
                  ? <button className="btn" onClick={createWeekly}>{fill(s.weeklyAdvances, { n: weeklyDrafts.length })}</button>
                  : selected.advance_per_week > 0 && <span style={{ fontSize: 12, color: 'var(--text3)', alignSelf: 'center' }}>{s.weeklyNone}</span>}
              </div>
            </div>

            <div className="card" style={{ marginBottom: 14 }}>
              <div className="card-title">{s.jobsThisPeriod}</div>
              {jobs.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13 }}>{s.noJobs}</div>}
              {jobs.map(j => (
                <div key={j.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{j.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{j.scheduled_date}</div>
                  </div>
                  <span style={{ color: 'var(--green)', fontWeight: 500 }}>{yen(j.retro_value ?? j.value)}</span>
                </div>
              ))}
            </div>

            <div className="card" style={{ marginBottom: 14 }}>
              <div className="card-title">{s.ledger}</div>
              {payments.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13, marginBottom: 10 }}>—</div>}
              {payments.map(p => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{p.description || p.payment_type}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{p.payment_date || '—'} · {p.payment_type} · {p.status}</div>
                  </div>
                  <span style={{ fontWeight: 600, color: isDeductionRow(p) || p.payment_type === 'advance' ? 'var(--red)' : 'var(--green)' }}>
                    {isDeductionRow(p) || p.payment_type === 'advance' ? '-' : '+'}{yen(p.amount)}
                  </span>
                </div>
              ))}

              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{s.addAdvance}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input type="number" value={advForm.amount} onChange={e => setAdvForm(f => ({ ...f, amount: e.target.value }))} placeholder={s.amount} style={{ width: 110 }} />
                  <input type="date" value={advForm.date} onChange={e => setAdvForm(f => ({ ...f, date: e.target.value }))} />
                  <input value={advForm.desc} onChange={e => setAdvForm(f => ({ ...f, desc: e.target.value }))} placeholder={s.description} style={{ flex: 1, minWidth: 140 }} />
                  <button className="btn btn-primary" onClick={addAdvance}>+ {s.addAdvance}</button>
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{s.addDeduction}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input type="number" value={dedForm.amount} onChange={e => setDedForm(f => ({ ...f, amount: e.target.value }))} placeholder={s.amount} style={{ width: 110 }} />
                  <input type="date" value={dedForm.date} onChange={e => setDedForm(f => ({ ...f, date: e.target.value }))} />
                  <input value={dedForm.desc} onChange={e => setDedForm(f => ({ ...f, desc: e.target.value }))} placeholder={s.description} style={{ flex: 1, minWidth: 140 }} />
                  <button className="btn btn-danger" onClick={addDeduction}>− {s.addDeduction}</button>
                </div>
              </div>
            </div>
          </>}
        </div>
      </div>
    </div>
  )
}
