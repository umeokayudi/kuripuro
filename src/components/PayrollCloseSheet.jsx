import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useLang } from '../hooks/useLang'
import { closeEmployeeMonth, payrollState, payStateText } from '../lib/salaryClose'
import { payrollMonth, canCloseMonth } from '../lib/salaryCalc'
import { getPeriodDates, fmtPeriod } from '../lib/salaryPeriod'
import { isDeductionToReview, reviewText, cancelText, isSilentCancel, reactivatePatch } from '../lib/deductionReview'
import { PAYROLL_CHANGED } from '../lib/payrollAlerts'
import { loadPayBasis, savePayBasis, isMissingColumn } from '../lib/jobEmployeePay'
import { locationNameFromTitle } from '../lib/cleaningType'
import PayrollJobsDetail from './PayrollJobsDetail'
import './SalaryPopups.css'

// 6.1 · Payroll of ONE person for ONE month on one screen: what the month adds up to (jobs / fixed),
// extras, advances, deductions (and automatic ones still waiting for review), the payslip preview and
// the next step (calculate → employee confirms → finalize → pay). Nothing is paid before the
// employee confirms the payslip.
export default function PayrollCloseSheet({ emp, period, onClose, onChanged }) {
  const { tr, locale } = useLang()
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState(false)
  const fmt = n => '¥' + Math.round(Number(n || 0)).toLocaleString(locale)

  const load = async () => {
    const { closeDate } = getPeriodDates(period)
    const [full, jobs, lines, st, bases] = await Promise.all([
      supabase.from('employees').select('*').eq('id', emp.id).maybeSingle(),
      supabase.from('jobs').select('*')
        .eq('employee_id', emp.id).eq('status', 'completed').gte('scheduled_date', `${period}-01`).lte('scheduled_date', closeDate),
      supabase.from('salary_payments').select('*').eq('employee_id', emp.id).eq('period', period).order('payment_date'),
      supabase.from('salary_statements').select('*').eq('employee_id', emp.id).eq('period', period).maybeSingle(),
      loadPayBasis(supabase, period, emp.id),
    ])
    const person = full.data || emp
    // v1.0.108 · same calculation as Fechar folha / Payments / employee app.
    const basis = bases[emp.id] || null
    const calc = payrollMonth({ emp: person, jobs: jobs.data || [], lines: lines.data || [], month: period, basis })
    setData({ person, jobs: jobs.data || [], lines: lines.data || [], st: st.data || null, base: calc.base, calc, basis })
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

  // v1.0.131 · the admin picks which total counts this month: fixed salary OR sum per job (never both).
  const chooseBasis = async (basis) => {
    setBusy(true)
    try {
      await savePayBasis(supabase, { employeeId: emp.id, period, basis, fixedTotal: data.calc.fixedTotal, perJobTotal: data.calc.perJob.total })
      toast.success(basis === 'fixed'
        ? tr('Fixed salary counts this month', '今月は固定給で計算', 'Neste mês vale o salário fixo')
        : tr('Sum per job counts this month', '今月は件数合計で計算', 'Neste mês vale a soma por job'))
      changed()
    } catch (e) {
      toast.error(isMissingColumn(e)
        ? tr('Run the SQL 2026-11-02_pagamento_funcionario_job.sql first', '先にSQLを実行してください', 'Rode antes o SQL 2026-11-02_pagamento_funcionario_job.sql')
        : e.message)
    }
    setBusy(false)
  }

  const reactivate = async (row) => {
    setBusy(true)
    const { error } = await supabase.from('salary_payments').update(reactivatePatch(row)).eq('id', row.id)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(tr('Deduction counts again — recalculate the payslip', '控除を戻しました — 明細を再計算してください', 'Desconto voltou a valer — recalcule o holerite'))
    changed()
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
    // A salary is paid only after the employee confirmed the payslip.
    if (!['confirmed', 'finalized'].includes(pstate)) return toast.error(tr('The employee has not confirmed the payslip yet.', '本人がまだ明細を確認していません。', 'O funcionário ainda não confirmou o holerite.'))
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
  const deductions = data?.calc.dedRows || []
  const toReview = L.filter(isDeductionToReview)
  // v1.0.133 · cancelled deductions stay visible in the month (never a silent end)
  const cancelledDeds = L.filter(p => p.is_deduction && p.status === 'cancelled' && !isDeductionToReview(p))
  const st = data?.st
  const slip = !st ? 'none' : st.employee_confirmed_at ? 'confirmed' : (st.employee_disputed_at || st.status === 'disputed') ? 'disputed' : 'waiting'
  // v1.0.102 · one truth with Payments: "Paid" only when the payslip is also confirmed.
  const pstate = data ? payrollState(st, salaryLine) : 'none'
  const paid = pstate === 'paid'
  const paidUnconfirmed = pstate === 'paid_unconfirmed'
  const openToPay = live.filter(p => !p.is_deduction && p.status === 'scheduled')
  const jobsPay = data?.calc.jobsPay || 0
  const preview = data?.calc.net || 0
  const outdated = st && !paid && !paidUnconfirmed && (Number(st.net_total) !== preview || Number(st.base_salary) !== data.base)

  const kind = data?.person?.salary_type
  const basisPick = data?.calc.basis
  // v1.0.133 · no choice yet → the rule that applies (fixed when there is a fixed salary)
  const basisShown = basisPick || data?.calc.autoBasis || null
  const perJob = data?.calc.perJob
  const showBasis = !!data && (perJob.priced > 0 || !!basisPick)
  const fmtDay = d => d ? new Date(`${d}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short', weekday: 'short' }) : ''
  const baseHow = basisShown === 'fixed' ? tr('Fixed salary (chosen for this month)', '固定給（今月の選択）', 'Salário fixo (escolhido no mês)')
    : basisShown === 'per_job' ? tr(`Sum per job (${perJob.priced} jobs)`, `件数合計（${perJob.priced}件）`, `Soma por job (${perJob.priced} jobs)`)
    : kind === 'fixed' ? tr('Fixed salary for the month', '月の固定給', 'Salário fixo do mês')
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

            {showBasis && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{tr('What counts this month?', '今月はどちらで支払う？', 'O que vale neste mês?')}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    { key: 'fixed', label: tr('Fixed salary', '固定給', 'Salário fixo'), total: data.calc.fixedTotal },
                    { key: 'per_job', label: tr(`Sum per job · ${perJob.priced}`, `件数合計 · ${perJob.priced}件`, `Soma por job · ${perJob.priced}`), total: perJob.total },
                  ].map(o => (
                    <button key={o.key} type="button" className="btn" disabled={busy || paid || paidUnconfirmed}
                      onClick={() => basisPick !== o.key && chooseBasis(o.key)}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '10px 12px', height: 'auto',
                        border: `2px solid ${basisShown === o.key ? 'var(--accent, #2563eb)' : 'var(--border, #e5e7eb)'}` }}>
                      <span style={{ fontSize: 12, color: 'var(--text3)' }}>{basisShown === o.key ? '✓ ' : ''}{o.label}</span>
                      <span style={{ fontSize: 17, fontWeight: 800 }}>{fmt(o.total)}</span>
                    </button>
                  ))}
                </div>
                <p className="pm-hint" style={{ marginTop: 6 }}>
                  {basisPick
                    ? tr(`Chosen by ${data.basis?.chosen_by || 'admin'}${data.basis?.chosen_at ? ` on ${new Date(data.basis.chosen_at).toLocaleString(locale)}` : ''}. The two are never added.`,
                        `${data.basis?.chosen_by || 'admin'} が選択${data.basis?.chosen_at ? `（${new Date(data.basis.chosen_at).toLocaleString(locale)}）` : ''}。合算はしません。`,
                        `Escolhido por ${data.basis?.chosen_by || 'admin'}${data.basis?.chosen_at ? ` em ${new Date(data.basis.chosen_at).toLocaleString(locale)}` : ''}. Os dois nunca são somados.`)
                    : basisShown === 'fixed'
                      ? tr('The fixed salary counts (default when there is one). Tap the other to switch. The two are never added.', '固定給で計算中（固定給がある場合の標準）。切り替えるにはもう一方をタップ。合算はしません。', 'Vale o salário fixo (padrão quando há fixo). Toque no outro para trocar. Os dois nunca são somados.')
                      : tr('The sum per job counts (no fixed salary on the record). The two are never added.', '件数合計で計算中（固定給の登録なし）。合算はしません。', 'Vale a soma por job (sem salário fixo no cadastro). Os dois nunca são somados.')}
                </p>
                <details style={{ marginTop: 4 }} open={basisPick === 'per_job'}>
                  <summary style={{ fontSize: 13, cursor: 'pointer' }}>{tr('Completed jobs with employee pay', '完了した作業（作業者への支払い）', 'Jobs concluídos com pagamento do funcionário')} ({perJob.rows.length})</summary>
                  <dl className="sp-rows">
                    {perJob.rows.map(r => (
                      <div key={r.id}><dt>{fmtDay(r.date)} · {locationNameFromTitle(r.title) || r.title}</dt>
                        <dd style={r.pay === null ? { color: 'var(--text3)', fontWeight: 500 } : undefined}>{r.pay === null ? tr('to be defined', '未定', 'a definir') : fmt(r.pay)}</dd></div>
                    ))}
                    <div><dt><b>{tr('Sum per job', '件数合計', 'Soma por job')}</b></dt><dd>{fmt(perJob.total)}</dd></div>
                  </dl>
                  {perJob.undefinedCount > 0 && <p className="pm-hint" style={{ marginTop: 6 }}>⚠️ {tr(`${perJob.undefinedCount} completed job(s) without employee pay — not in the sum.`, `${perJob.undefinedCount}件は支払い未定（合計に含まれません）。`, `${perJob.undefinedCount} job(s) concluído(s) sem pagamento definido — fora da soma.`)}</p>}
                </details>
              </div>
            )}

            <dl className="sp-rows">
              {/* v1.0.145 · tap the calculated salary → every job of the month (date, place, client, address, time, value) */}
              <div className="pjd-row" role="button" tabIndex={0} onClick={() => setDetail(true)}
                onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setDetail(true) } }}>
                <dt>{baseHow}<small>{tr('See details per job ›', '作業ごとの内訳を見る ›', 'Ver detalhes por job ›')}</small></dt>
                <dd>{data.calc.needsBasis ? tr('choose above', '上で選択', 'escolha acima') : fmt(data.base)}</dd>
              </div>
              {jobsPay > 0 && <div><dt>{tr('Spot jobs', 'スポット', 'Jobs spot')}</dt><dd>+{fmt(jobsPay)}</dd></div>}
              {deductions.map(p => <div key={p.id}><dt>{tr('Deduction', '控除', 'Desconto')} · {cancelText(p)}</dt><dd style={{ color: 'var(--red, #dc2626)' }}>−{fmt(p.amount)}</dd></div>)}
              {cancelledDeds.map(p => <div key={p.id} style={{ opacity: .7 }}><dt>{tr('Deduction', '控除', 'Desconto')} · <s>{cancelText(p)}</s> · <b>{isSilentCancel(p) ? tr('cancelled with no confirmation', '確認なしで取消', 'cancelado sem confirmação') : tr('cancelled', '取消', 'cancelado')}</b>
                {isSilentCancel(p) && !paid && <> · <button type="button" className="btn btn-sm" disabled={busy} onClick={() => reactivate(p)}>{tr('Count again', '再び控除する', 'Voltar a valer')}</button></>}</dt>
                <dd style={{ color: 'var(--text3)' }}><s>−{fmt(p.amount)}</s></dd></div>)}
              <div><dt><b>{tr('Payslip (net salary)', '明細（差引支給）', 'Holerite (salário líquido)')}</b></dt><dd className="sp-big">{paid || paidUnconfirmed ? fmt(salaryLine.amount) : data.calc.needsBasis ? '—' : fmt(preview)}</dd></div>
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

            <div className={`sp-state is-${paidUnconfirmed ? 'disputed' : slip}`}><b>{payStateText(pstate, tr, paid ? salaryLine?.payment_date : '').text}</b>{!paid && !paidUnconfirmed && slip !== 'confirmed' && <small>{slipText[slip]}</small>}</div>

            <div className="sp-actions" style={{ flexWrap: 'wrap' }}>
              <button className="btn" disabled={busy} onClick={onClose}>{tr('Close', '閉じる', 'Fechar')}</button>
              {!paid && !paidUnconfirmed && canCloseMonth(period) && <button className={`btn${step === 0 ? ' btn-primary' : ''}`} disabled={busy || data.calc.needsBasis} onClick={calculate}>{st ? tr('Recalculate', '再計算', 'Recalcular') : tr('Calculate payslip', '明細を計算', 'Calcular holerite')}</button>}
              {step === 2 && <button className="btn btn-primary" disabled={busy} onClick={finalize}>{tr('Finalize payslip', '明細を確定', 'Finalizar holerite')}</button>}
              {step === 3 && openToPay.length > 0 && <button className="btn btn-primary" disabled={busy} onClick={pay}>✓ {tr(`Mark paid ${fmt(sum(openToPay))}`, `${fmt(sum(openToPay))} を支払済に`, `Marcar pago ${fmt(sum(openToPay))}`)}</button>}
            </div>
          </>
        )}
      </section>
      {detail && data && <PayrollJobsDetail person={data.person} jobs={data.jobs} period={period} calc={data.calc} onClose={() => setDetail(false)} />}
    </div>
  )
}
