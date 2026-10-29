import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useLang } from '../hooks/useLang'
import { computeBase, closeEmployeeMonth, payrollState } from '../lib/salaryClose'
import { getPeriodDates, fmtPeriod } from '../lib/salaryPeriod'
import { isDeductionToReview, reviewText } from '../lib/deductionReview'
import { PAYROLL_CHANGED } from '../lib/payrollAlerts'
import './SalaryPopups.css'

// 6.1 · Payroll of ONE person for ONE month on one screen: what the month adds up to (jobs / fixed),
// extras, advances, deductions (and automatic ones still waiting for review), the payslip preview and
// the next step (calculate → employee confirms → finalize → pay). Nothing is paid before the
// employee confirms the payslip.
export default function PayrollCloseSheet({ emp, period, onClose, onChanged }) {
  const { tr, locale } = useLang()
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const fmt = n => '¥' + Math.round(Number(n || 0)).toLocaleString(locale)

  const load = async () => {
    const { closeDate } = getPeriodDates(period)
    const [full, jobs, lines, st] = await Promise.all([
      supabase.from('employees').select('*').eq('id', emp.id).maybeSingle(),
      supabase.from('jobs').select('*')
        .eq('employee_id', emp.id).eq('status', 'completed').gte('scheduled_date', `${period}-01`).lte('scheduled_date', closeDate),
      supabase.from('salary_payments').select('*').eq('employee_id', emp.id).eq('period', period).order('payment_date'),
      supabase.from('salary_statements').select('*').eq('employee_id', emp.id).eq('period', period).maybeSingle(),
    ])
    const person = full.data || emp
    setData({ person, jobs: jobs.data || [], lines: lines.data || [], st: st.data || null, base: computeBase(person, jobs.data || [], period) })
  }
  useEffect(() => { load() }, [emp.id, period])

  const changed = () => {
    try { window.dispatchEvent(new Event(PAYROLL_CHANGED)) } catch { /* SSR */ }
    onChanged?.()
    load()
  }

  const calculate = async () => {
    setBusy(true)
    try {
      const res = await closeEmployeeMonth(supabase, period, data.person, { salaryDesc: `${tr('Salary', '給与', 'Salário')} ${fmtPeriod(period)}` })
      toast.success(res.kept ? tr('Already paid — not changed', '支払済みのため変更なし', 'Já pago — não mudou') : tr('Payslip calculated', '明細を計算しました', 'Holerite calculado'))
      changed()
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }

  const finalize = async () => {
    setBusy(true)
    const { error } = await supabase.from('salary_statements').update({ status: 'finalized', admin_finalized_at: new Date().toISOString() }).eq('id', data.st.id)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(tr('Payslip finalized', '明細を確定しました', 'Holerite finalizado'))
    changed()
  }

  const pay = async () => {
    const ids = data.lines.filter(p => !p.is_deduction && p.status === 'scheduled').map(p => p.id)
    if (!ids.length) return
    setBusy(true)
    const { error } = await supabase.from('salary_payments').update({ status: 'paid' }).in('id', ids)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(tr('Marked as paid', '支払済みにしました', 'Marcado como pago'))
    changed()
  }

  const L = data?.lines || []
  const live = L.filter(p => p.status !== 'cancelled')
  const sum = arr => arr.reduce((s, p) => s + Number(p.amount || 0), 0)
  const salaryLine = live.find(p => p.payment_type === 'salary')
  const extras = live.filter(p => ['extra', 'bonus', 'transport', 'other'].includes(p.payment_type) && !p.is_deduction)
  const advances = live.filter(p => p.payment_type === 'advance')
  const deductions = live.filter(p => p.is_deduction)
  const toReview = L.filter(isDeductionToReview)
  const st = data?.st
  const slip = !st ? 'none' : st.employee_confirmed_at ? 'confirmed' : (st.employee_disputed_at || st.status === 'disputed') ? 'disputed' : 'waiting'
  // v1.0.102 · one truth with Payments: "Paid" only when the payslip is also confirmed.
  const pstate = data ? payrollState(st, salaryLine) : 'none'
  const paid = pstate === 'paid'
  const paidUnconfirmed = pstate === 'paid_unconfirmed'
  const openToPay = live.filter(p => !p.is_deduction && p.status === 'scheduled')
  const dedTotal = sum(deductions)
  const preview = Math.max(0, (data?.base || 0) - dedTotal)
  const outdated = st && !paid && !paidUnconfirmed && (Number(st.net_total) !== preview || Number(st.base_salary) !== data.base)

  const kind = data?.person?.salary_type
  const baseHow = kind === 'fixed' ? tr('Fixed salary for the month', '月の固定給', 'Salário fixo do mês')
    : kind === 'hourly' ? tr(`${data?.jobs.length || 0} completed jobs × hours`, `完了 ${data?.jobs.length || 0}件 × 時間`, `${data?.jobs.length || 0} serviços concluídos × horas`)
    : kind === 'mixed' ? tr(`Fixed + ${data?.jobs.length || 0} jobs`, `固定 + ${data?.jobs.length || 0}件`, `Fixo + ${data?.jobs.length || 0} serviços`)
    : tr(`${data?.jobs.length || 0} completed jobs`, `完了 ${data?.jobs.length || 0}件`, `${data?.jobs.length || 0} serviços concluídos`)

  const step = paid ? 4 : !st || outdated ? 0 : slip !== 'confirmed' ? 1 : st.status !== 'finalized' ? 2 : 3
  const steps = [
    tr('Calculate', '計算', 'Calcular'),
    tr('Employee confirms', '本人確認', 'Funcionário confirma'),
    tr('Finalize', '確定', 'Finalizar'),
    tr('Pay', '支払い', 'Pagar'),
  ]
  const slipText = {
    confirmed: tr('Employee confirmed the payslip', '従業員が明細を確認済み', 'Funcionário confirmou o holerite'),
    disputed: tr('Employee disputed the payslip — answer in Salary issues', '従業員が異議 — 「給与の問題」で回答してください', 'Funcionário contestou o holerite — responda em Problemas de salário'),
    waiting: tr('Waiting for the employee to confirm in the app', 'アプリで本人の確認待ち', 'Esperando o funcionário confirmar no app'),
    none: tr('Payslip not calculated yet', '明細はまだ計算されていません', 'Holerite ainda não calculado'),
  }

  return (
    <div className="sp-overlay" onClick={() => !busy && onClose()}>
      <section className="sp-modal is-admin" role="dialog" aria-modal="true" style={{ maxWidth: 520, maxHeight: '92vh', overflowY: 'auto' }} onClick={ev => ev.stopPropagation()}>
        <h3>{tr('Payroll', '給与締め', 'Folha')} · {emp.full_name} · {fmtPeriod(period)}</h3>
        {!data ? <p style={{ color: 'var(--text3)' }}>{tr('Loading…', '読み込み中…', 'Carregando…')}</p> : (
          <>
            <ol style={{ display: 'flex', gap: 6, listStyle: 'none', padding: 0, margin: '0 0 12px', flexWrap: 'wrap' }}>
              {steps.map((s, i) => (
                <li key={s} style={{ fontSize: 12, fontWeight: 700, padding: '4px 8px', borderRadius: 999,
                  background: i < step ? 'rgba(34,197,94,.15)' : i === step ? 'var(--accent, #2563eb)' : 'var(--bg2, #f3f4f6)',
                  color: i === step ? '#fff' : i < step ? 'var(--green, #16a34a)' : 'var(--text3)' }}>
                  {i < step ? '✓ ' : `${i + 1}. `}{s}
                </li>
              ))}
            </ol>

            <dl className="sp-rows">
              <div><dt>{baseHow}</dt><dd>{fmt(data.base)}</dd></div>
              {deductions.map(p => <div key={p.id}><dt>{tr('Deduction', '控除', 'Desconto')} · {p.description || ''}</dt><dd style={{ color: 'var(--red, #dc2626)' }}>−{fmt(p.amount)}</dd></div>)}
              <div><dt><b>{tr('Payslip (net salary)', '明細（差引支給）', 'Holerite (salário líquido)')}</b></dt><dd className="sp-big">{fmt(paid || paidUnconfirmed ? salaryLine.amount : preview)}</dd></div>
              {extras.map(p => <div key={p.id}><dt>{p.payment_type === 'bonus' ? tr('Bonus', 'ボーナス', 'Bônus') : tr('Extra', '追加', 'Extra')} · {p.description || ''}</dt><dd>+{fmt(p.amount)}</dd></div>)}
              {advances.map(p => <div key={p.id}><dt>{tr('Advance', '前払い', 'Adiantamento')} · {p.description || ''} {p.status === 'paid' ? `(${tr('already paid', '支払済', 'já pago')})` : ''}</dt><dd>{fmt(p.amount)}</dd></div>)}
            </dl>

            {toReview.length > 0 && (
              <p className="pm-hint" style={{ marginTop: 10 }}>
                🤖 {tr(`${toReview.length} automatic deduction(s) waiting for your review (not in the payslip until approved):`, `自動控除 ${toReview.length}件が確認待ち（承認まで明細に入りません）:`, `${toReview.length} desconto(s) automático(s) esperando sua revisão (só entram no holerite depois de aprovar):`)}
                {' '}{toReview.map(p => `${reviewText(p)} ${fmt(p.amount)}`).join(' · ')}
                {' '}<Link to="/deductions">{tr('Review', '確認', 'Revisar')} →</Link>
              </p>
            )}
            {outdated && <p className="pm-hint" style={{ marginTop: 10 }}>⚠️ {tr(`The payslip sent says ${fmt(st.net_total)}; today’s numbers give ${fmt(preview)}. Recalculate and the employee confirms again.`, `送付済み明細は ${fmt(st.net_total)}、現在の計算は ${fmt(preview)} です。再計算すると本人が再確認します。`, `O holerite enviado diz ${fmt(st.net_total)}; com os números de hoje dá ${fmt(preview)}. Recalcule e o funcionário confirma de novo.`)}</p>}

            <div className={`sp-state is-${paidUnconfirmed ? 'disputed' : slip}`}><b>{paid ? tr('Paid', '支払済', 'Pago')
              : paidUnconfirmed ? tr('Marked paid, but the payslip is NOT confirmed yet — it only counts as paid after the employee confirms', '支払済ですが明細は未確認です — 本人の確認後に支払済になります', 'Marcado pago, mas o holerite AINDA NÃO foi confirmado — só conta como pago depois que o funcionário confirmar')
              : slipText[slip]}</b></div>

            <div className="sp-actions" style={{ flexWrap: 'wrap' }}>
              <button className="btn" disabled={busy} onClick={onClose}>{tr('Close', '閉じる', 'Fechar')}</button>
              {!paid && !paidUnconfirmed && <button className={`btn${step === 0 ? ' btn-primary' : ''}`} disabled={busy} onClick={calculate}>{st ? tr('Recalculate', '再計算', 'Recalcular') : tr('Calculate payslip', '明細を計算', 'Calcular holerite')}</button>}
              {step === 2 && <button className="btn btn-primary" disabled={busy} onClick={finalize}>{tr('Finalize payslip', '明細を確定', 'Finalizar holerite')}</button>}
              {step === 3 && openToPay.length > 0 && <button className="btn btn-primary" disabled={busy} onClick={pay}>✓ {tr(`Mark paid ${fmt(sum(openToPay))}`, `${fmt(sum(openToPay))} を支払済に`, `Marcar pago ${fmt(sum(openToPay))}`)}</button>}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
