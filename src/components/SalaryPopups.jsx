import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { pickLang } from '../hooks/useLang'
import { enrichJobValues } from '../lib/employeePay'
import { isDuskinJob } from '../lib/employeeAddJob'
import { jobMinutes } from '../lib/salaryCalc'
import { getPeriodDates } from '../lib/salaryPeriod'
import { summarizeRange, monthEnd, monthLabel, dayLabel, jobEarnings } from '../lib/earnings'
import './SalaryPopups.css'

// Pop-ups the employee sees on the home screen:
//  - PayslipPopup: the month's full payslip, then confirm it or open a dispute.
//  - SalaryAnswerPopup: the admin's answer to a dispute, with reply / ask for contact.

const yen = n => `¥${Math.round(Number(n || 0)).toLocaleString('ja-JP')}`
const shortDate = (d, lang) => {
  const [, m, day] = d.split('-').map(Number)
  return lang === 'ja' ? `${m}月${day}日` : `${day} ${monthLabel(d.slice(0, 7), lang === 'pt' ? 'pt' : 'en')}`
}

function Sheet({ onClose, children, label }) {
  useEffect(() => {
    const onKey = ev => { if (ev.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="sp-overlay" onClick={onClose}>
      <section className="sp-sheet" role="dialog" aria-modal="true" aria-label={label} onClick={ev => ev.stopPropagation()}>
        <div className="sp-grab" aria-hidden="true" />
        {children}
      </section>
    </div>,
    document.body,
  )
}

/** Disputes and their answers are salary_complaints rows; a reply is a new pending row. */
async function sendComplaint({ statement, employeeId, employeeName, period, category, description }) {
  const { error } = await supabase.from('salary_complaints').insert({
    employee_id: employeeId, employee_name: employeeName,
    period, statement_id: statement?.id || null,
    category, description, status: 'pending',
  })
  if (error) throw error
  if (statement?.id) {
    await supabase.from('salary_statements').update({
      employee_disputed_at: new Date().toISOString(), status: 'disputed',
    }).eq('id', statement.id)
  }
}

async function confirmStatementRow(statement) {
  const { error } = await supabase.from('salary_statements').update({
    employee_confirmed_at: new Date().toISOString(), employee_disputed_at: null, status: 'confirmed',
  }).eq('id', statement.id)
  if (error) throw error
}

function DisputeForm({ L, busy, onSend, onCancel, withCategory = true, placeholder }) {
  const [category, setCategory] = useState('hours')
  const [text, setText] = useState('')
  return (
    <div className="sp-form">
      {withCategory && (
        <select value={category} onChange={ev => setCategory(ev.target.value)} aria-label={L.whatsWrong}>
          <option value="hours">{L.catHours}</option>
          <option value="deductions">{L.catDeductions}</option>
          <option value="rate">{L.catRate}</option>
          <option value="missing">{L.catMissing}</option>
          <option value="other">{L.catOther}</option>
        </select>
      )}
      <textarea value={text} onChange={ev => setText(ev.target.value)} placeholder={placeholder || L.disputePh} autoFocus />
      <div className="sp-btns two">
        <button className="sp-btn" onClick={onCancel} disabled={busy}>{L.cancel}</button>
        <button className="sp-btn is-bad" disabled={busy || !text.trim()} onClick={() => onSend(category, text.trim())}>{busy ? L.sending : L.send}</button>
      </div>
    </div>
  )
}

function texts(lang) {
  const t = (en, ja, pt) => pickLang(lang, en, ja, pt)
  return {
    payslip: t('Payslip', '給与明細', 'Holerite'),
    checkIt: t('Check your salary', '給与を確認してください', 'Confira seu salário'),
    net: t('Net pay', '差引支給額', 'Líquido'),
    payDate: t('Pay day', '支払日', 'Dia do pagamento'),
    confirmBy: t('Confirm by', '確認期限', 'Confirmar até'),
    days: t('days worked', '勤務日数', 'dias trabalhados'),
    hours: t('hours', '時間', 'horas'),
    jobs: t('jobs', '件', 'trabalhos'),
    detail: t('Breakdown', '内訳', 'Detalhes'),
    gross: t('Gross pay', '支給合計', 'Bruto'),
    deductions: t('Deductions', '控除', 'Descontos'),
    work: t('Work this month', '今月の作業', 'Trabalhos do mês'),
    seeAll: n => t(`See all ${n} jobs`, `全${n}件を見る`, `Ver os ${n} trabalhos`),
    pdf: t('📄 Download full payslip (PDF)', '📄 給与明細をダウンロード (PDF)', '📄 Baixar holerite completo (PDF)'),
    confirm: t('✅ Amount is correct', '✅ 金額は正しい', '✅ Valor está certo'),
    dispute: t('⚠️ Something is wrong', '⚠️ 問題がある', '⚠️ Tem algo errado'),
    later: t('Later', 'あとで', 'Depois'),
    whatsWrong: t('What is wrong?', '何が違いますか？', 'O que está errado?'),
    catHours: t('Hours / days', '時間・日数', 'Horas / dias'),
    catDeductions: t('Deductions', '控除', 'Descontos'),
    catRate: t('Pay rate', '単価', 'Valor por hora/dia'),
    catMissing: t('Missing job', '作業の漏れ', 'Trabalho faltando'),
    catOther: t('Other', 'その他', 'Outro'),
    disputePh: t('Explain what is wrong…', '内容を書いてください…', 'Explique o que está errado…'),
    cancel: t('Cancel', 'キャンセル', 'Cancelar'),
    send: t('Send', '送信', 'Enviar'),
    sending: t('Sending…', '送信中…', 'Enviando…'),
    confirmedToast: t('Salary confirmed. Thank you!', '給与を確認しました。ありがとうございます！', 'Salário confirmado. Obrigado!'),
    sentToast: t('Sent to the admin', '管理者に送信しました', 'Enviado ao responsável'),
    differs: t('The amounts below are recalculated from your work; if they differ from the total, tell us with “Something is wrong”.',
      '下の内訳は作業記録から再計算したものです。合計と違う場合は「問題がある」から連絡してください。',
      'O detalhe abaixo é recalculado pelos trabalhos; se não bater com o total, avise em “Tem algo errado”.'),
    loading: t('Loading…', '読み込み中…', 'Carregando…'),
    // Answer pop-up
    answerTitle: t('Answer about your salary', '給与についての回答', 'Resposta sobre seu salário'),
    accepted: t('Your request was accepted', '申し立ては承認されました', 'Sua contestação foi aceita'),
    rejected: t('Your request was not accepted', '申し立ては却下されました', 'Sua contestação foi recusada'),
    youWrote: t('You wrote', 'あなたの申し立て', 'Você escreveu'),
    adminSaid: t('Admin answer', '管理者の回答', 'Resposta do responsável'),
    noAnswer: t('No comment from the admin.', '管理者からのコメントはありません。', 'Sem comentário do responsável.'),
    reply: t('↩ Reply', '↩ 返信する', '↩ Responder'),
    replyPh: t('Write your reply…', '返信を書いてください…', 'Escreva sua resposta…'),
    contact: t('📞 Ask the manager to contact me', '📞 担当者に連絡をお願いする', '📞 Pedir contato do responsável'),
    contactMsg: p => t(`Please contact me about my salary for ${p}.`, `${p}の給与について連絡をお願いします。`, `Por favor, entre em contato comigo sobre o salário de ${p}.`),
    contactToast: t('The manager was asked to contact you', '担当者に連絡を依頼しました', 'Pedimos para o responsável entrar em contato'),
    confirmNow: t('✅ Confirm the salary now', '✅ 給与を確認する', '✅ Confirmar o salário agora'),
    ok: t('OK', 'OK', 'OK'),
  }
}

/** Loads the month's work so the payslip shows days, hours, jobs and a daily chart. */
function useMonthWork(employeeId, month) {
  const [data, setData] = useState(null)
  useEffect(() => {
    if (!employeeId || !month) return
    let alive = true
    const from = `${month}-01`, to = monthEnd(month)
    Promise.all([
      supabase.from('employees').select('id,full_name,contract_type,hourly_rate,fixed_salary,salary_type,job_bonus_rate,monthly_work_days').eq('id', employeeId).maybeSingle(),
      supabase.from('jobs').select('*').eq('employee_id', employeeId).eq('status', 'completed').gte('scheduled_date', from).lte('scheduled_date', to).limit(2000),
      supabase.from('service_contracts').select('location_name,price_per_visit').eq('is_active', true),
      supabase.from('salary_payments').select('*').eq('employee_id', employeeId).eq('period', month).order('payment_date'),
    ]).then(([emp, jobs, contracts, pays]) => {
      if (!alive) return
      const visible = (jobs.data || []).filter(j => !isDuskinJob(j))
      const all = pays.data || []
      setData({
        emp: emp.data || {}, jobs: enrichJobValues(visible, contracts.data || []),
        deductions: all.filter(p => p.is_deduction && p.status !== 'cancelled'), payments: all,
      })
    }).catch(() => alive && setData({ emp: {}, jobs: [], deductions: [], payments: [] }))
    return () => { alive = false }
  }, [employeeId, month])
  const summary = useMemo(() => data && summarizeRange({
    emp: data.emp, jobs: data.jobs, deductions: [], from: `${month}-01`, to: monthEnd(month),
  }), [data, month])
  return { data, summary }
}

export function PayslipPopup({ statement, employeeId, employeeName, lang, onClose, onDone }) {
  const L = texts(lang)
  const month = statement.period
  const { data, summary } = useMonthWork(employeeId, month)
  const [mode, setMode] = useState('view') // view | dispute
  const [busy, setBusy] = useState(false)
  const [allJobs, setAllJobs] = useState(false)
  const [making, setMaking] = useState(false)
  const { payDate, confirmDeadline } = getPeriodDates(month)

  const dedRows = data?.deductions || []
  const dedSum = dedRows.reduce((s, d) => s + Number(d.amount || 0), 0)
  const stDed = Number(statement.deductions || 0)
  const max = summary ? Math.max(1, ...summary.days.map(d => d.total)) : 1
  const jobs = summary ? summary.days.flatMap(d => d.jobs).reverse() : []
  const differs = summary && Math.abs(summary.total - Number(statement.base_salary || 0)) > 1

  const confirm = async () => {
    setBusy(true)
    try { await confirmStatementRow(statement); toast.success(L.confirmedToast); onDone() } catch (err) { toast.error(err.message) }
    setBusy(false)
  }
  const dispute = async (category, text) => {
    setBusy(true)
    try {
      await sendComplaint({ statement, employeeId, employeeName, period: month, category, description: text })
      toast.success(L.sentToast); onDone()
    } catch (err) { toast.error(err.message) }
    setBusy(false)
  }
  const pdf = async () => {
    if (!data || !summary) return
    setMaking(true)
    try {
      const { downloadPayslipPdf } = await import('../lib/payslipPdf')
      const full = summarizeRange({ emp: data.emp, jobs: data.jobs, deductions: dedRows, from: `${month}-01`, to: monthEnd(month) })
      await downloadPayslipPdf({
        employee: data.emp, month, salary: full.salary, lang,
        deductions: full.deductionRows, payments: data.payments, jobs: full.days.flatMap(d => d.jobs),
      })
    } catch (err) { toast.error(err.message || 'PDF error') }
    setMaking(false)
  }

  return (
    <Sheet onClose={onClose} label={L.payslip}>
      <div className="sp-head">
        <div><div className="sp-kicker">💴 {L.checkIt}</div><h2>{L.payslip} · {monthLabel(month, lang, true)}</h2></div>
        <button className="sp-x" aria-label={L.later} onClick={onClose}>×</button>
      </div>
      <div className="sp-net"><strong>{yen(statement.net_total)}</strong><span>{L.net}</span></div>
      <div className="sp-dates">
        <div><small>{L.payDate}</small><b>{shortDate(payDate, lang)}</b></div>
        <div><small>{L.confirmBy}</small><b>{shortDate(confirmDeadline, lang)}</b></div>
      </div>

      {!summary ? <div className="sp-net"><span>{L.loading}</span></div> : (
        <>
          <div className="sp-strip" aria-hidden="true">
            {summary.days.map(d => <i key={d.day} className={d.total ? '' : 'is-zero'} style={{ height: `${Math.max(4, (d.total / max) * 100)}%` }} title={`${dayLabel(d.day, lang)} ${yen(d.total)}`} />)}
          </div>
          <div className="sp-strip-lbl"><span>1</span><span>15</span><span>{monthEnd(month).slice(8)}</span></div>
          <div className="sp-stats">
            <div><b>{summary.workedDays}</b><span>{L.days}</span></div>
            <div><b>{summary.hours.toFixed(1)}</b><span>{L.hours}</span></div>
            <div><b>{summary.jobs}</b><span>{L.jobs}</span></div>
          </div>
        </>
      )}

      <div className="sp-h">{L.detail}</div>
      <div className="sp-break">
        <div><span>{L.gross}</span><b>{yen(statement.base_salary)}</b></div>
        {dedRows.length && Math.abs(dedSum - stDed) <= 1
          ? dedRows.map(d => <div key={d.id} className="is-neg"><span>{d.description || L.deductions}</span><b>-{yen(d.amount)}</b></div>)
          : <div className="is-neg"><span>{L.deductions}</span><b>-{yen(stDed)}</b></div>}
        <div className="is-net"><span>{L.net}</span><b>{yen(statement.net_total)}</b></div>
      </div>
      {differs && <div className="sp-warn">{L.differs}</div>}

      {jobs.length > 0 && (
        <>
          <div className="sp-h">{L.work}</div>
          <div className="sp-jobs">
            {(allJobs ? jobs : jobs.slice(0, 4)).map(j => (
              <div key={j.id} className="sp-job">
                <div><b>{j.title || '—'}</b><small>{dayLabel(j.scheduled_date, lang)} · {(jobMinutes(j) / 60).toFixed(1)}h</small></div>
                {(data.emp.salary_type || 'fixed') !== 'fixed' || j.job_category === 'spot' ? <b>{yen(jobEarnings(j, data.emp))}</b> : null}
              </div>
            ))}
          </div>
          {!allJobs && jobs.length > 4 && <button className="sp-more" onClick={() => setAllJobs(true)}>{L.seeAll(jobs.length)} ›</button>}
        </>
      )}

      <div className="sp-btns">
        <button className="sp-btn" onClick={pdf} disabled={making || !summary}>{making ? L.loading : L.pdf}</button>
      </div>
      {mode === 'view' ? (
        <>
          <div className="sp-btns two">
            <button className="sp-btn is-bad" disabled={busy} onClick={() => setMode('dispute')}>{L.dispute}</button>
            <button className="sp-btn is-ok" disabled={busy} onClick={confirm}>{L.confirm}</button>
          </div>
          <div className="sp-btns"><button className="sp-btn is-link" onClick={onClose}>{L.later}</button></div>
        </>
      ) : (
        <>
          <div className="sp-h">{L.whatsWrong}</div>
          <DisputeForm L={L} busy={busy} onSend={dispute} onCancel={() => setMode('view')} />
        </>
      )}
    </Sheet>
  )
}

export function SalaryAnswerPopup({ complaint, statement, employeeId, employeeName, lang, onClose, onDone }) {
  const L = texts(lang)
  const [mode, setMode] = useState('view') // view | reply
  const [busy, setBusy] = useState(false)
  const period = complaint.period
  const ok = complaint.status === 'resolved'
  const canConfirm = statement && statement.id === complaint.statement_id && !statement.employee_confirmed_at && !statement.employee_disputed_at

  const run = async (fn, msg) => {
    setBusy(true)
    try { await fn(); if (msg) toast.success(msg); onDone() } catch (err) { toast.error(err.message) }
    setBusy(false)
  }
  const reply = (_c, text) => run(() => sendComplaint({
    statement: statement?.id === complaint.statement_id ? statement : null,
    employeeId, employeeName, period, category: 'reply',
    description: text,
  }), L.sentToast)
  const contact = () => run(async () => {
    const text = L.contactMsg(monthLabel(period, lang, true))
    await sendComplaint({ statement: null, employeeId, employeeName, period, category: 'contact', description: text })
    // Also in the chat, so whoever reads messages first sees it.
    await supabase.from('messages').insert({ employee_id: employeeId, employee_name: employeeName, sender: 'employee', content: `📞 ${text}`, read: false })
  }, L.contactToast)
  const confirm = () => run(() => confirmStatementRow(statement), L.confirmedToast)

  return (
    <Sheet onClose={onClose} label={L.answerTitle}>
      <div className="sp-head">
        <div><div className="sp-kicker">💴 {L.answerTitle}</div><h2>{ok ? '✅ ' : '✕ '}{ok ? L.accepted : L.rejected}</h2></div>
        <button className="sp-x" aria-label={L.ok} onClick={onClose}>×</button>
      </div>
      <p style={{ margin: '6px 0 0', color: 'var(--sp-muted)', fontSize: 13 }}>{monthLabel(period, lang, true)}</p>
      <div className={`sp-quote is-admin${ok ? '' : ' is-rejected'}`}><small>{L.adminSaid}</small>{complaint.admin_response || L.noAnswer}</div>
      <div className="sp-quote"><small>{L.youWrote}</small>{complaint.description}</div>

      {mode === 'view' ? (
        <div className="sp-btns">
          {canConfirm && <button className="sp-btn is-ok" disabled={busy} onClick={confirm}>{L.confirmNow}</button>}
          <button className="sp-btn" disabled={busy} onClick={() => setMode('reply')}>{L.reply}</button>
          <button className="sp-btn" disabled={busy} onClick={contact}>{L.contact}</button>
          <button className="sp-btn is-dark" disabled={busy} onClick={onClose}>{L.ok}</button>
        </div>
      ) : (
        <DisputeForm L={L} busy={busy} onSend={reply} onCancel={() => setMode('view')} withCategory={false} placeholder={L.replyPh} />
      )}
    </Sheet>
  )
}
