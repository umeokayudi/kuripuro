import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { Link, useSearchParams } from 'react-router-dom'
import { getPeriodDates, fmtPeriod } from '../lib/salaryPeriod'
import { closeSalaryPeriod, closeEmployeeMonth, isPayrollActive, payrollState, payStateText } from '../lib/salaryClose'
import { payrollMonth, canCloseMonth, monthLastDay } from '../lib/salaryCalc'
import { tokyoToday } from '../lib/dates'
import { PAYROLL_CHANGED } from '../lib/payrollAlerts'
import { useLang, fill } from '../hooks/useLang'
import { askConfirm } from '../components/ConfirmDialog'
import PayrollCloseSheet from '../components/PayrollCloseSheet'

const shiftMonth = (period, n) => {
  const [y, m] = period.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const JOB_COLS = 'id,employee_id,status,scheduled_date,started_at,completed_at,retro_time_min,retro_value,value,job_category,spot_value'

// v1.0.108 · "Fechar folha": one screen for the owner. Per person: base + jobs − deductions = net and the
// payment state, all from payrollMonth (the same calculation as Payments, Salary and the employee app).
// Nobody active stays out in silence: the "out of this payroll" list says why and has "Include".
export default function SalaryPeriods() {
  const { t, tr, locale } = useLang()
  const p = t.payroll
  const today = tokyoToday()
  const [params] = useSearchParams()
  const [periods, setPeriods] = useState([])
  const [period, setPeriod] = useState(params.get('period') || shiftMonth(today.slice(0, 7), -1))
  const [employees, setEmployees] = useState([])
  const [data, setData] = useState(null) // { statements, lines, jobs }
  const [schemaOk, setSchemaOk] = useState(true)
  const [closing, setClosing] = useState(false)
  const [failed, setFailed] = useState({})
  const [including, setIncluding] = useState(null)
  const [sheet, setSheet] = useState(null)

  const fmt = n => '¥' + Math.round(Number(n || 0)).toLocaleString(locale)

  useEffect(() => {
    supabase.from('employees').select('*').order('full_name').then(({ data: e }) => setEmployees(e || []))
    loadPeriods()
  }, [])
  useEffect(() => { load(period) }, [period])

  const loadPeriods = async () => {
    const { data: rows, error } = await supabase.from('salary_periods').select('*').order('period', { ascending: false })
    if (error?.code === 'PGRST205') { setSchemaOk(false); return }
    setPeriods(rows || [])
  }

  const load = async (m) => {
    setData(null)
    const [st, ln, jb] = await Promise.all([
      supabase.from('salary_statements').select('*').eq('period', m),
      supabase.from('salary_payments').select('*').eq('period', m),
      supabase.from('jobs').select(JOB_COLS).eq('status', 'completed').gte('scheduled_date', `${m}-01`).lte('scheduled_date', monthLastDay(m)),
    ])
    setData({ statements: st.data || [], lines: ln.data || [], jobs: jb.data || [] })
  }

  const notifyChanged = () => { try { window.dispatchEvent(new Event(PAYROLL_CHANGED)) } catch { /* SSR */ } }
  const refresh = () => { notifyChanged(); loadPeriods(); load(period) }

  const periodRow = periods.find(r => r.period === period)
  const status = periodRow?.status || 'open'
  const closable = canCloseMonth(period, today)

  // One row per person: everyone active plus anyone who already has a payslip / lines this month.
  const rows = useMemo(() => {
    if (!data) return []
    const ids = new Set([...employees.filter(isPayrollActive).map(e => e.id), ...data.statements.map(s => s.employee_id)])
    return [...ids].map(id => {
      const emp = employees.find(e => e.id === id) || { id, full_name: data.statements.find(s => s.employee_id === id)?.employee_name || '—', is_active: false }
      const calc = payrollMonth({ emp, jobs: data.jobs.filter(j => j.employee_id === id), lines: data.lines.filter(l => l.employee_id === id), month: period })
      const st = data.statements.find(s => s.employee_id === id) || null
      const state = payrollState(st, calc.salaryLine)
      const paidAmount = state === 'paid' || state === 'paid_unconfirmed' ? Number(calc.salaryLine?.amount || 0) : null
      // The payslip sent is a snapshot: when today's numbers differ, say it and offer to recalculate.
      const outdated = st && paidAmount === null && Number(st.net_total) !== calc.net
      return { emp, calc, st, state, paidAmount, outdated }
    }).sort((a, b) => a.emp.full_name.localeCompare(b.emp.full_name))
  }, [data, employees, period])

  const inPayroll = rows.filter(r => r.st)
  const out = rows.filter(r => !r.st && isPayrollActive(r.emp))
  const outReason = (r) => {
    if (failed[r.emp.id]) return tr(`Could not calculate: ${failed[r.emp.id]}`, `計算できませんでした: ${failed[r.emp.id]}`, `Não deu para calcular: ${failed[r.emp.id]}`)
    const start = String(r.emp.contract_start || '').slice(0, 10)
    if (start && start > monthLastDay(period)) return tr(`Contract starts on ${start}, after this month`, `契約開始 ${start}（この月の後）`, `Contrato começa em ${start}, depois deste mês`)
    if (periodRow?.closed_at && r.emp.created_at && r.emp.created_at > periodRow.closed_at) return tr('Registered after this month was closed', '締めの後に登録', 'Cadastrado depois do fechamento deste mês')
    if (!closable) return tr('Month still running — closes on the 1st', '月の途中 — 1日に締め', 'Mês em andamento — fecha no dia 1º')
    if (status === 'open') return tr('Month not closed yet', '未締め', 'Mês ainda não fechado')
    return tr('Left out of the close (no payslip)', '締めに含まれていません（明細なし）', 'Ficou fora do fechamento (sem holerite)')
  }

  const totals = {
    // Totals of the people IN this payroll; who is out is listed apart with their own amount.
    net: inPayroll.reduce((s, r) => s + (r.paidAmount ?? r.calc.net), 0),
    base: inPayroll.reduce((s, r) => s + r.calc.base, 0),
    jobs: inPayroll.reduce((s, r) => s + r.calc.jobsPay, 0),
    ded: inPayroll.reduce((s, r) => s + r.calc.deductions, 0),
    confirmed: inPayroll.filter(r => ['confirmed', 'finalized', 'paid'].includes(r.state)).length,
    paid: inPayroll.filter(r => r.state === 'paid').length,
  }

  const closeMonth = async () => {
    const { confirmDeadline, payDate } = getPeriodDates(period)
    const msg = `${fill(p.closeConfirm, { period: fmtPeriod(period), deadline: confirmDeadline, payDate })}\n\n${tr(`${rows.length} people`, `${rows.length}人`, `${rows.length} pessoas`)}`
    if (!(await askConfirm({ message: msg, danger: false }))) return
    setClosing(true)
    try {
      const res = await closeSalaryPeriod(supabase, period, { salaryDesc: fill(p.salaryDesc, { period: fmtPeriod(period) }) })
      setFailed(Object.fromEntries((res.failed || []).map(f => [f.id, f.error])))
      if (res.failed?.length) toast.error(tr(`${res.failed.length} person(s) could not be included — see the list`, `${res.failed.length}人を含められませんでした — 一覧を確認`, `${res.failed.length} pessoa(s) não entraram — veja a lista`))
      else toast.success(fill(p.closed, { period: fmtPeriod(period) }))
      refresh()
    } catch (e) { toast.error(e.message) }
    setClosing(false)
  }

  const includeOne = async (emp) => {
    setIncluding(emp.id)
    try {
      await closeEmployeeMonth(supabase, period, emp, { salaryDesc: fill(p.salaryDesc, { period: fmtPeriod(period) }) })
      setFailed(f => { const n = { ...f }; delete n[emp.id]; return n })
      toast.success(tr(`${emp.full_name} included`, `${emp.full_name} を追加しました`, `${emp.full_name} incluído(a)`))
      refresh()
    } catch (e) {
      setFailed(f => ({ ...f, [emp.id]: e.message }))
      toast.error(e.message)
    }
    setIncluding(null)
  }

  const setPeriodStatus = async (next, message) => {
    const { error } = await supabase.from('salary_periods').update({ status: next }).eq('period', period)
    if (error) return toast.error(error.message)
    toast.success(message)
    refresh()
  }
  const reopen = async () => {
    if (!(await askConfirm({ message: fill(p.reopenConfirm, { period: fmtPeriod(period) }), danger: true }))) return
    setPeriodStatus('open', fill(p.reopened, { period: fmtPeriod(period) }))
  }
  const finalize = async (st) => {
    const { error } = await supabase.from('salary_statements').update({ status: 'finalized', admin_finalized_at: new Date().toISOString() }).eq('id', st.id)
    if (error) return toast.error(error.message)
    toast.success(p.finalized)
    refresh()
  }

  const dates = getPeriodDates(period)
  const months = [...new Set([shiftMonth(today.slice(0, 7), 0), shiftMonth(today.slice(0, 7), -1), ...periods.map(r => r.period)])].sort().reverse().slice(0, 8)
  const toneCls = { green: 'badge-green', amber: 'badge-amber', red: 'badge-red' }

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

      <div className="tab-pills" style={{ marginBottom: 14 }}>
        {months.map(m => {
          const s = periods.find(r => r.period === m)?.status || 'open'
          return (
            <button key={m} className={`tab-pill${period === m ? ' active' : ''}`} onClick={() => setPeriod(m)}>
              {fmtPeriod(m)} ({p.status?.[s] || s})
            </button>
          )
        })}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title">{fill(p.slips, { period: fmtPeriod(period) })}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          {status === 'open' && closable && (
            <button className="btn btn-primary" disabled={closing || !data} onClick={closeMonth}>{closing ? p.closing : `🔒 ${fill(p.closePrev, { period: fmtPeriod(period) })}`}</button>
          )}
          {status === 'open' && !closable && (
            <span style={{ fontSize: 13, color: 'var(--text2)' }}>🗓 {tr(`Can be closed from ${shiftMonth(period, 1)}-01`, `${shiftMonth(period, 1)}-01 から締められます`, `Pode ser fechado a partir de ${shiftMonth(period, 1)}-01`)}</span>
          )}
          {status === 'auto_closed' && (
            <>
              <span style={{ fontSize: 13, color: 'var(--text2)' }}>🤖 {p.autoClosedHint}</span>
              <button className="btn btn-sm btn-primary" onClick={() => setPeriodStatus('closed', p.reviewedToast)}>✓ {p.markReviewed}</button>
            </>
          )}
          {status !== 'open' && <button className="btn btn-sm" onClick={reopen}>🔓 {p.reopen}</button>}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>{fill(p.confirmUntil, { deadline: dates.confirmDeadline, payDate: dates.payDate })}</div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8, marginBottom: 12 }}>
          {[
            [tr('Base', '基本', 'Base'), fmt(totals.base)],
            [tr('Jobs', 'ジョブ', 'Jobs'), `+${fmt(totals.jobs)}`],
            [tr('Deductions', '控除', 'Descontos'), `−${fmt(totals.ded)}`],
            [tr('Net', '差引支給', 'Líquido'), fmt(totals.net)],
            [tr('Confirmed', '本人確認', 'Confirmados'), `${totals.confirmed}/${inPayroll.length}`],
            [tr('Paid', '支払済', 'Pagos'), `${totals.paid}/${inPayroll.length}`],
          ].map(([l, v]) => (
            <div key={l} style={{ background: 'var(--surface2)', borderRadius: 10, padding: '8px 10px' }}>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{l}</div>
              <div style={{ fontWeight: 700 }}>{data ? v : <span className="kp-skel-text">…</span>}</div>
            </div>
          ))}
        </div>

        {!data && <div aria-busy="true">{[0, 1, 2].map(i => <div key={i} className="kp-skel kp-skel-row" style={{ height: 52, marginBottom: 8 }} />)}</div>}

        {data && out.length > 0 && (
          <div className="sp-out" style={{ border: '1px solid rgba(245,158,11,.4)', background: 'rgba(245,158,11,.08)', borderRadius: 12, padding: '10px 12px', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>⚠️ {tr(`Out of this payroll (${out.length})`, `この締めに含まれていない人（${out.length}人）`, `Fora deste fechamento (${out.length})`)}</div>
            {out.map(r => (
              <div key={r.emp.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid rgba(245,158,11,.25)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{r.emp.full_name} · {fmt(r.calc.net)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', overflowWrap: 'anywhere' }}>{outReason(r)}</div>
                </div>
                {closable && (
                  <button className="btn btn-sm btn-primary" style={{ minHeight: 40, flexShrink: 0 }} disabled={including === r.emp.id || closing} onClick={() => includeOne(r.emp)}>
                    {including === r.emp.id ? '…' : tr('Include', '追加', 'Incluir')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {data && inPayroll.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13 }}>{p.noSlips}</div>}
        {data && inPayroll.map(r => {
          const paidOn = r.state === 'paid' ? r.calc.salaryLine?.payment_date || '' : ''
          const label = payStateText(r.state, tr, paidOn)
          return (
            <div key={r.emp.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{r.emp.full_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                  {p.base} {fmt(r.calc.base)} · {tr('Jobs', 'ジョブ', 'Jobs')} +{fmt(r.calc.jobsPay)} · {p.deductions} −{fmt(r.calc.deductions)} · {p.net} <b>{fmt(r.paidAmount ?? r.calc.net)}</b>
                </div>
                <div style={{ fontSize: 11, marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span className={`badge ${toneCls[label.tone]}`}>{label.text}</span>
                  {r.outdated && <span className="badge badge-amber">{tr(`Payslip sent says ${fmt(r.st.net_total)} — recalculate`, `送付済み明細は ${fmt(r.st.net_total)} — 再計算`, `Holerite enviado diz ${fmt(r.st.net_total)} — recalcular`)}</span>}
                  {r.state === 'disputed' && <Link to="/salary-complaints" style={{ fontSize: 11 }}>{tr('Answer', '回答', 'Responder')} →</Link>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {r.state === 'confirmed' && !r.outdated && <button className="btn btn-sm btn-primary" onClick={() => finalize(r.st)}>{p.finalize}</button>}
                <button className="btn btn-sm" onClick={() => setSheet(r.emp)}>{tr('Open', '開く', 'Abrir')}</button>
              </div>
            </div>
          )
        })}
      </div>

      {sheet && <PayrollCloseSheet emp={sheet} period={period} onClose={() => setSheet(null)} onChanged={refresh} />}
    </div>
  )
}
