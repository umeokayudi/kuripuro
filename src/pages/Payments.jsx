import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useLang } from '../hooks/useLang'
import toast from 'react-hot-toast'
import { getPeriodDates } from '../lib/salaryPeriod'
import '../components/SalaryPopups.css'
import './Payments.css'
import PayrollCloseSheet from '../components/PayrollCloseSheet'
import { payrollState } from '../lib/salaryClose'
import { payrollMonth, monthLastDay, canCloseMonth } from '../lib/salaryCalc'
import { useNavigate } from 'react-router-dom'

// One month (= month worked, salary_payments.period) at a time, one row per employee.
// ¥0 people fold away, "Mark paid" pays every open line of that person in that month.
// v1.0.124: grouped by what to do (review / ready / waiting / payslip to make / paid), one sentence + one button per row.
// v1.0.96: opens on the current month, every active employee has a row, a salary is only paid after
// the employee confirmed the payslip, and "Payroll" opens the one-screen close of that person.

const tokyoToday = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).split(' ')[0]
const monthOf = (p) => p.period || p.payment_date?.slice(0, 7) || ''
const shiftMonth = (period, n) => {
  const [y, m] = period.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const isOpen = (p) => !p.is_deduction && p.status !== 'paid' && p.status !== 'cancelled'
const counts = (p) => p.status !== 'cancelled'

// What the employee did with the payslip of that month.
function statementState(st) {
  if (!st) return 'none'
  if (st.employee_confirmed_at) return 'confirmed'
  if (st.employee_disputed_at || st.status === 'disputed') return 'disputed'
  return 'waiting'
}

// A salary line is only paid after the employee confirmed the payslip of that month.
const blocked = (slip, lines) => lines.some(p => p.payment_type === 'salary') && slip !== 'confirmed'

const emptyForm = (period) => ({ employee_id:'', amount:'', payment_date:'', period, description:'', payment_type:'salary', status:'scheduled' })

export default function Payments() {
  const { tr, locale } = useLang()
  const navigate = useNavigate()
  const [employees, setEmployees] = useState([])
  const [payments, setPayments] = useState([])
  const [statements, setStatements] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [month, setMonth] = useState(null)
  const [who, setWho] = useState('')
  const [openRow, setOpenRow] = useState(null)
  const [showZero, setShowZero] = useState(false)
  const [ask, setAsk] = useState(null) // { kind: 'pay' | 'delete', emp, lines }
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState(null) // null = closed
  const [editingId, setEditingId] = useState(null)
  const [closing, setClosing] = useState(null) // employee whose month is open in PayrollCloseSheet
  const [monthJobs, setMonthJobs] = useState({ month: null, jobs: [] })

  // Same list as the salary_payments check constraint.
  const TYPES = ['salary','advance','bonus','extra','deduction']
  const typeLabel = {
    salary: tr('Salary','給与','Salário'),
    advance: tr('Advance','前払い','Adiantamento'),
    bonus: tr('Bonus','ボーナス','Bônus'),
    extra: tr('Extra','追加','Extra'),
    deduction: tr('Deduction','控除','Desconto'),
    transport: tr('Transport','交通費','Transporte'),
    other: tr('Other','その他','Outro'),
  }
  const payKind = {
    fixed: tr('Fixed salary','固定給','Salário fixo'),
    hourly: tr('Per hour','時給','Por hora'),
    per_job: tr('Per job','出来高','Por serviço'),
  }

  useEffect(() => { load() }, [])

  const load = async () => {
    const [e, p, st] = await Promise.all([
      supabase.from('employees').select('id,full_name,fixed_salary,monthly_work_days,salary_type,hourly_rate,job_bonus_rate,contract_start,contract_end,is_active').order('full_name'),
      supabase.from('salary_payments').select('*').order('payment_date',{ascending:true}),
      supabase.from('salary_statements').select('id,employee_id,period,status,net_total,employee_confirmed_at,employee_disputed_at'),
    ])
    setEmployees(e.data||[])
    setPayments(p.data||[])
    setStatements(st.data||[])
    setLoaded(true)
  }

  const today = tokyoToday()
  const thisMonth = today.slice(0, 7)

  // v1.0.108 · completed jobs of the month, so each row shows the same payslip numbers as Fechar folha.
  useEffect(() => {
    if (!month) return
    supabase.from('jobs').select('id,employee_id,status,scheduled_date,started_at,completed_at,retro_time_min,retro_value,value,job_category,spot_value')
      .eq('status', 'completed').gte('scheduled_date', `${month}-01`).lte('scheduled_date', monthLastDay(month))
      .then(({ data }) => setMonthJobs({ month, jobs: data || [] }))
  }, [month])

  // Always opens on the current month (Tokyo); open amounts of other months show in "Still to pay".
  useEffect(() => {
    if (!loaded || month) return
    setMonth(thisMonth)
  }, [loaded])

  const fmt = n => '¥' + Math.round(Number(n||0)).toLocaleString(locale)
  const fmtMonth = (period) => {
    if (!period) return ''
    const [y, m] = period.split('-').map(Number)
    const txt = new Date(y, m - 1, 1).toLocaleDateString(locale, { month:'long', year:'numeric' })
    return txt.charAt(0).toUpperCase() + txt.slice(1)
  }
  const fmtDay = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString(locale, { day:'numeric', month:'short' }) : ''

  // Every active employee, plus anyone (inactive too) who has lines this month, so nothing is hidden.
  const rows = useMemo(() => {
    if (!month) return []
    const lines = payments.filter(p => monthOf(p) === month)
    const ids = [...new Set([...employees.filter(e => e.is_active !== false).map(e => e.id), ...lines.map(p => p.employee_id)])]
    return ids.map(id => {
      const emp = employees.find(e => e.id === id) || { id, full_name: lines.find(p => p.employee_id === id)?.employee_name || '—', is_active: false }
      const mine = lines.filter(p => p.employee_id === id).sort((a, b) => (a.payment_date||'').localeCompare(b.payment_date||''))
      const live = mine.filter(counts)
      const earn = live.filter(p => !p.is_deduction).reduce((s, p) => s + Number(p.amount||0), 0)
      const ded = live.filter(p => p.is_deduction).reduce((s, p) => s + Number(p.amount||0), 0)
      const open = mine.filter(isOpen)
      const toPay = open.reduce((s, p) => s + Number(p.amount||0), 0)
      const salaryLine = live.find(p => p.payment_type === 'salary')
      // Fixed salary that closed at ¥0 is almost always "no completed job in the month", worth a look.
      const fixedZero = emp.salary_type === 'fixed' && Number(emp.fixed_salary) > 0 && salaryLine && Number(salaryLine.amount) === 0
      const st = statements.find(s => s.employee_id === id && s.period === month)
      // v1.0.102 · same truth as Payroll close: a salary is "Paid" only with the payslip confirmed.
      const pstate = payrollState(st, salaryLine)
      const calc = monthJobs.month === month ? payrollMonth({ emp, jobs: monthJobs.jobs.filter(j => j.employee_id === id), lines: mine, month }) : null
      // The salary line was calculated earlier: when today's numbers differ (and it is not paid), it needs a recalculation.
      const outdated = !!(calc && salaryLine && salaryLine.status !== 'paid' && Number(salaryLine.amount) !== calc.net)
      const paidUnconfirmed = pstate === 'paid_unconfirmed'
      const slip = statementState(st)
      const late = toPay > 0 && open.some(p => p.payment_date && p.payment_date < today)
      // v1.0.124 · ONE group per person, each with one sentence and one action:
      // review (something is wrong) → ready (confirmed, pay it) → waiting (employee must confirm) → todo (no payslip) → paid.
      // ¥0 with nothing wrong folds away, even when an old ¥0 line says "paid" without confirmation: no money is involved.
      let group
      if (fixedZero || outdated || (slip === 'disputed' && earn > 0) || (paidUnconfirmed && earn > 0) || late) group = 'review'
      else if (toPay > 0) group = !blocked(slip, open) ? 'ready' : slip === 'none' ? 'todo' : 'waiting'
      else if (earn > 0) group = 'paid'
      else if (!mine.length && calc && calc.net > 0) group = 'todo'
      else group = 'zero'
      const state = group
      const payDate = salaryLine?.payment_date || open[0]?.payment_date || mine[0]?.payment_date
      const paidOn = mine.filter(p => !p.is_deduction && p.status === 'paid').map(p => p.payment_date).sort().pop() || null
      const paid = live.filter(p => !p.is_deduction && p.status === 'paid').reduce((s, p) => s + Number(p.amount||0), 0)
      // Payroll close already takes deductions out of the salary row, so they are shown, not subtracted again.
      return { emp, lines: mine, earn, ded, net: earn, paid, toPay, open, group, state, late, payDate, paidOn, slip, st, fixedZero, paidUnconfirmed, salaryLine, pstate, calc, outdated }
    }).sort((a, b) => a.emp.full_name.localeCompare(b.emp.full_name))
  }, [payments, employees, statements, month, today, monthJobs])

  const visible = rows.filter(r => !who || r.emp.id === who)
  const GROUPS = ['review', 'ready', 'waiting', 'todo', 'paid']
  const inGroup = (g) => visible.filter(r => r.group === g)
  const zeroRows = inGroup('zero')

  // v1.0.124 · totals that add up: month total = already paid + still to pay.
  const totals = {
    toPay: visible.reduce((s, r) => s + r.toPay, 0),
    paid: visible.reduce((s, r) => s + r.paid, 0),
    ready: inGroup('ready').reduce((s, r) => s + r.toPay, 0),
    waiting: inGroup('waiting').reduce((s, r) => s + r.toPay, 0) + inGroup('todo').reduce((s, r) => s + r.toPay, 0),
  }
  totals.month = totals.toPay + totals.paid
  const payDay = month ? getPeriodDates(month).payDate : null
  const daysTo = (d) => Math.ceil((new Date(d) - new Date(today)) / 86400000)

  // Open amounts left in other months, so moving month never hides a debt.
  const elsewhere = useMemo(() => {
    const m = {}
    payments.filter(p => isOpen(p) && Number(p.amount) > 0 && monthOf(p) !== month).forEach(p => { m[monthOf(p)] = (m[monthOf(p)]||0) + Number(p.amount||0) })
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b))
  }, [payments, month])

  const groupInfo = {
    review: { title: tr('Needs your review','確認が必要','Precisa revisar'), hint: tr('Something does not add up. Fix it before paying.','合っていない所があります。支払う前に直してください。','Algo não bate. Arrume antes de pagar.') },
    ready: { title: tr('Ready to pay','支払OK','Pronto para pagar'), hint: tr('The employee confirmed the payslip. Pay and mark it paid.','本人が明細を確認済み。支払って「支払済」にしてください。','O funcionário confirmou o holerite. Pague e marque como pago.') },
    waiting: { title: tr('Waiting for the employee','本人の確認待ち','Esperando o funcionário'), hint: tr('Payslip sent. Nothing to do until the employee confirms it.','明細送付済み。本人が確認するまで作業はありません。','Holerite enviado. Nada a fazer até o funcionário confirmar.') },
    todo: { title: tr('Payslip not made yet','明細未作成','Holerite ainda não feito'), hint: tr('Make the payslip so the employee can confirm it.','明細を作って本人に確認してもらいます。','Faça o holerite para o funcionário confirmar.') },
    paid: { title: tr('Paid','支払済','Pago'), hint: '' },
  }
  const slipLong = {
    confirmed: tr('Employee confirmed the payslip','従業員が明細を確認済み','Funcionário confirmou o holerite'),
    disputed: tr('Employee disputed the payslip','従業員が明細に異議あり','Funcionário contestou o holerite'),
    waiting: tr('Employee has not confirmed yet','従業員はまだ確認していません','Funcionário ainda não confirmou'),
    none: tr('No payslip sent for this month','この月の明細は未送付','Holerite deste mês não foi enviado'),
  }

  // ---- actions ----
  const doConfirmed = async () => {
    if (!ask) return
    setBusy(true)
    const ids = ask.lines.map(p => p.id)
    const { error } = ask.kind === 'pay'
      ? await supabase.from('salary_payments').update({ status:'paid' }).in('id', ids)
      : await supabase.from('salary_payments').delete().in('id', ids)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(ask.kind === 'pay' ? tr('Marked as paid','支払済みにしました','Marcado como pago') : tr('Deleted','削除しました','Apagado'))
    setAsk(null); load()
  }

  // Undo a "paid" set before the employee confirmed the payslip (old data): back to scheduled.
  const undoPaid = async (r) => {
    if (!r.salaryLine) return
    setBusy(true)
    const { error } = await supabase.from('salary_payments').update({ status: 'scheduled' }).eq('id', r.salaryLine.id)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(tr('Back to "to pay"', '「未払い」に戻しました', 'Voltou para "a pagar"'))
    load()
  }

  const openNew = (emp) => {
    setEditingId(null)
    setForm({ ...emptyForm(month || thisMonth), employee_id: emp?.id || '', payment_date: today })
  }
  const openEdit = (p) => {
    setEditingId(p.id)
    setForm({ employee_id:p.employee_id||'', amount:p.amount ?? '', payment_date:p.payment_date||'', period:monthOf(p), description:p.description||'', payment_type:p.payment_type||'salary', status:p.status||'scheduled' })
  }
  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.employee_id || form.amount === '' || !form.payment_date) return toast.error(tr('Fill employee, amount and date','従業員・金額・日付を入力してください','Preencha funcionário, valor e data'))
    const emp = employees.find(e => e.id === form.employee_id)
    const payload = {
      employee_id: form.employee_id, employee_name: emp?.full_name || '',
      amount: parseFloat(form.amount), payment_date: form.payment_date,
      period: form.period || form.payment_date.slice(0, 7), description: form.description,
      payment_type: form.payment_type, is_deduction: form.payment_type === 'deduction', status: form.status,
    }
    const { error } = editingId
      ? await supabase.from('salary_payments').update(payload).eq('id', editingId)
      : await supabase.from('salary_payments').insert(payload)
    if (error) return toast.error(error.message)
    toast.success(editingId ? tr('Saved','保存しました','Salvo') : tr('Entry added','追加しました','Lançamento adicionado'))
    setForm(null); setEditingId(null)
    if (payload.period !== month) setMonth(payload.period)
    load()
  }

  const initials = (n) => (n||'?').split(' ').filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase()

  const lineBits = (r) => {
    const bits = {}
    r.lines.filter(counts).forEach(p => { const k = p.payment_type || 'other'; bits[k] = (bits[k]||0) + Number(p.amount||0) })
    const order = ['salary','extra','bonus','advance','transport','other','deduction']
    return Object.entries(bits).filter(([, v]) => v !== 0).sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
  }


  // v1.0.124 · the one sentence + the one button of a row.
  const rowPlan = (r) => {
    const open = () => setClosing(r.emp)
    const pay = () => setAsk({ kind:'pay', emp:r.emp, lines:r.open, r })
    if (r.fixedZero) return {
      why: tr(`Fixed salary is ${fmt(r.emp.fixed_salary)}/month, but the saved payslip is ¥0 (an old close).`, `固定給は ${fmt(r.emp.fixed_salary)}/月ですが、保存された明細は ¥0 です（古い締め）。`, `O fixo é ${fmt(r.emp.fixed_salary)}/mês, mas o holerite gravado está ¥0 (fechamento antigo).`),
      btn: tr('Recalculate','再計算','Recalcular'), act: open }
    if (r.outdated) return {
      why: tr(`Saved payslip ${fmt(r.salaryLine.amount)}, but today's jobs give ${fmt(r.calc.net)}.`, `保存された明細は ${fmt(r.salaryLine.amount)}、今日のジョブでは ${fmt(r.calc.net)} です。`, `Holerite gravado ${fmt(r.salaryLine.amount)}, mas pelos serviços de hoje dá ${fmt(r.calc.net)}.`),
      btn: tr('Recalculate','再計算','Recalcular'), act: open }
    if (r.slip === 'disputed') return {
      why: tr('The employee disputed the payslip.', '本人が明細に異議を出しました。', 'O funcionário contestou o holerite.'),
      btn: tr('Answer','回答する','Responder'), act: () => navigate('/salary-complaints') }
    if (r.paidUnconfirmed) return {
      why: tr('Marked paid, but the employee never confirmed the payslip.', '支払済になっていますが、本人は明細を確認していません。', 'Está como pago, mas o funcionário nunca confirmou o holerite.'),
      btn: tr('Back to "to pay"','「未払い」に戻す','Voltar para "a pagar"'), act: () => undoPaid(r) }
    if (r.late) return {
      why: tr(`Was due on ${fmtDay(r.open[0]?.payment_date)}.`, `${fmtDay(r.open[0]?.payment_date)} が支払日でした。`, `Era para pagar em ${fmtDay(r.open[0]?.payment_date)}.`),
      ...(blocked(r.slip, r.open) ? { btn: tr('Open payroll','給与締めを開く','Abrir folha'), act: open } : { btn: tr('Mark paid','支払済にする','Marcar pago'), act: pay, go: true }) }
    if (r.group === 'ready') return { why: tr(`Pay on ${fmtDay(r.open[0]?.payment_date)}.`, `${fmtDay(r.open[0]?.payment_date)} に支払い。`, `Pagar em ${fmtDay(r.open[0]?.payment_date)}.`), btn: tr('Mark paid','支払済にする','Marcar pago'), act: pay, go: true }
    if (r.group === 'waiting') return { why: tr('Payslip sent, the employee has not confirmed yet.', '明細送付済み、本人はまだ確認していません。', 'Holerite enviado, o funcionário ainda não confirmou.') }
    if (r.group === 'todo') return canCloseMonth(month, today)
      ? { why: tr('No payslip for this month yet.', 'この月の明細はまだありません。', 'Ainda não tem holerite deste mês.'), btn: tr('Make payslip','明細を作る','Fazer holerite'), act: open }
      : { why: tr(`The month closes on the 1st; then make the payslip.`, '月末締め後（1日〜）に明細を作ります。', 'O mês fecha no dia 1º; aí é só fazer o holerite.') }
    if (r.group === 'paid') return { why: r.paidOn ? tr(`Paid on ${fmtDay(r.paidOn)}.`, `${fmtDay(r.paidOn)} に支払済。`, `Pago em ${fmtDay(r.paidOn)}.`) : '', done: true }
    return { why: tr('Nothing to pay this month.', '今月の支払いはありません。', 'Nada a pagar neste mês.') }
  }

  const rowView = (r) => {
    const expanded = openRow === r.emp.id
    const bits = lineBits(r)
    const plan = rowPlan(r)
    // No payslip yet: show what today's jobs give, marked as an estimate.
    const estimate = !r.lines.length && r.calc && r.calc.net > 0
    const amount = r.toPay > 0 ? r.toPay : estimate ? r.calc.net : r.net
    return (
      <div key={r.emp.id} className={`pm-row is-${r.group}${expanded ? ' is-expanded' : ''}`}>
        <div className="pm-main" onClick={() => setOpenRow(expanded ? null : r.emp.id)}>
          <div className="pm-av">{initials(r.emp.full_name)}</div>
          <div className="pm-who">
            <b>{r.emp.full_name}{r.emp.is_active === false && <em>{tr('inactive','退職','inativo')}</em>}</b>
            <small>
              {payKind[r.emp.salary_type] || ''}
              {r.emp.salary_type === 'fixed' && Number(r.emp.fixed_salary) > 0 && ` · ${fmt(r.emp.fixed_salary)}/${tr('mo','月','mês')}`}
            </small>
            {plan.why && <p className={`pm-why is-${r.group}`}>{plan.why}</p>}
          </div>
          <div className="pm-net">
            <b>{estimate ? '≈ ' : ''}{fmt(amount)}</b>
            {estimate && <small>{tr('estimate from jobs','ジョブからの見込み','estimativa pelos serviços')}</small>}
            {bits.length > 1 && <small>{bits.map(([k, v]) => `${typeLabel[k] || k} ${k === 'deduction' ? '−' : ''}${fmt(v)}`).join(' · ')}</small>}
          </div>
          <div className="pm-act" onClick={ev => ev.stopPropagation()}>
            {plan.btn && <button className={`pm-pay${plan.go ? '' : ' is-alt'}`} disabled={busy} onClick={plan.act}>{plan.go ? '✓ ' : ''}{plan.btn}</button>}
            {plan.done && <span className="pm-done">✓</span>}
            <button className="pm-chev" aria-label={tr('Details','詳細','Detalhes')} onClick={() => setOpenRow(expanded ? null : r.emp.id)}>{expanded ? '▴' : '▾'}</button>
          </div>
        </div>

        {expanded && (
          <div className="pm-lines">
            {r.calc && <div className="pm-hint" style={{ margin: '0 0 8px' }}>{tr('Payslip','明細','Holerite')}: {tr('base','基本','base')} {fmt(r.calc.base)} + {tr('jobs','ジョブ','jobs')} {fmt(r.calc.jobsPay)} − {tr('deductions','控除','descontos')} {fmt(r.calc.deductions)} = <b>{fmt(r.calc.net)}</b></div>}
            {r.lines.map(p => (
              <div key={p.id} className={`pm-line${p.status === 'cancelled' ? ' is-cancel' : ''}`}>
                <div className="pm-line-l">
                  <span className={`pm-type t-${p.payment_type}`}>{typeLabel[p.payment_type] || p.payment_type}</span>
                  <div>
                    <div className="pm-desc">{p.description || typeLabel[p.payment_type]}</div>
                    <small>{fmtDay(p.payment_date)} · {p.status === 'paid' ? tr('paid','支払済','pago') : p.status === 'cancelled' ? tr('cancelled','取消','cancelado') : p.is_deduction ? tr('discounted from pay','給与から控除','descontado do salário') : tr('scheduled','予定','agendado')}</small>
                  </div>
                </div>
                <b className={p.is_deduction ? 'is-neg' : ''}>{p.is_deduction ? '−' : ''}{fmt(p.amount)}</b>
                <div className="pm-line-act">
                  {isOpen(p) && !blocked(r.slip, [p]) && <button title={tr('Mark paid','支払済にする','Marcar pago')} onClick={() => setAsk({ kind:'pay', emp:r.emp, lines:[p], r })}>✓</button>}
                  <button title={tr('Edit','編集','Editar')} onClick={() => openEdit(p)}>✎</button>
                  {p.payment_type !== 'salary' && <button className="is-del" title={tr('Delete','削除','Apagar')} onClick={() => setAsk({ kind:'delete', emp:r.emp, lines:[p], r })}>🗑</button>}
                </div>
              </div>
            ))}
            <button className="pm-add-line" onClick={() => setClosing(r.emp)}>🧾 {tr('Payroll of the month (calculate, payslip, finalize, pay)','今月の給与締め（計算・明細・確定・支払）','Folha do mês (calcular, holerite, finalizar, pagar)')}</button>
            <button className="pm-add-line" onClick={() => openNew(r.emp)}>+ {tr('Add entry for','追加:','Lançar para')} {r.emp.full_name.split(' ')[0]}</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="pm">
      <div className="pm-head">
        <div>
          <h2>{tr('Payments','支払い','Pagamentos')}</h2>
          <p>{tr('Salary, extras and deductions by month worked','勤務月ごとの給与・追加・控除','Salário, extras e descontos por mês trabalhado')}</p>
        </div>
        <button className="btn btn-primary" onClick={() => openNew(null)}>+ {tr('New entry','新規登録','Novo lançamento')}</button>
      </div>

      <div className="pm-bar">
        <div className="pm-month">
          <button aria-label={tr('Previous month','前月','Mês anterior')} onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
          <div><small>{tr('Month worked','勤務月','Mês trabalhado')}</small><b>{fmtMonth(month)}</b></div>
          <button aria-label={tr('Next month','翌月','Próximo mês')} onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
        </div>
        <select className="pm-who-pick" value={who} onChange={e => setWho(e.target.value)}>
          <option value="">{tr('Everyone','全員','Todos os funcionários')}</option>
          {employees.filter(e => e.is_active !== false || payments.some(p => p.employee_id === e.id)).map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </select>
      </div>

      {/* v1.0.124 · one summary: still to pay + already paid = month total, and when it is paid. */}
      <div className="pm-sum">
        <div className="pm-sum-head">
          {payDay && <b>{tr('Payday','支払日','Pagamento em')} {fmtDay(payDay)}</b>}
          {payDay && <span>{payDay < today ? tr('already passed','過ぎています','já passou') : tr(`in ${daysTo(payDay)} days`,`あと${daysTo(payDay)}日`,`faltam ${daysTo(payDay)} dias`)}</span>}
        </div>
        {loaded ? (
          <div className="pm-sum-eq">
            <div className="is-open"><small>{tr('Still to pay','未払い','Falta pagar')}</small><b>{fmt(totals.toPay)}</b>
              {totals.toPay > 0 && <span>{[totals.ready > 0 && `${fmt(totals.ready)} ${tr('ready','支払OK','pronto')}`, totals.waiting > 0 && `${fmt(totals.waiting)} ${tr('waiting for employee','本人確認待ち','esperando funcionário')}`, totals.toPay - totals.ready - totals.waiting > 0 && `${fmt(totals.toPay - totals.ready - totals.waiting)} ${tr('to review','要確認','a revisar')}`].filter(Boolean).join(' · ')}</span>}
            </div>
            <i>+</i>
            <div className="is-paid"><small>{tr('Already paid','支払済','Já pago')}</small><b>{fmt(totals.paid)}</b></div>
            <i>=</i>
            <div><small>{tr('Month total','月合計','Total do mês')}</small><b>{fmt(totals.month)}</b></div>
          </div>
        ) : <div className="kp-skel kp-skel-row" />}
        {elsewhere.length > 0 && (
          <div className="pm-elsewhere">
            <span>{tr('Also still to pay from other months:','他の月の未払いもあります:','Também falta pagar de outros meses:')}</span>
            {elsewhere.map(([m, v]) => <button key={m} onClick={() => setMonth(m)}>{fmtMonth(m)} · {fmt(v)} ›</button>)}
          </div>
        )}
      </div>

      {!loaded && <div aria-busy="true" aria-label={tr('Loading…','読み込み中…','Carregando…')}>{[0,1,2,3].map(i => <div key={i} className="kp-skel kp-skel-row" />)}</div>}
      {loaded && GROUPS.every(g => !inGroup(g).length) && (
        <div className="pm-empty">{tr('Nothing to pay this month','今月の支払いはありません','Nada a pagar neste mês')}</div>
      )}
      {loaded && GROUPS.map(g => {
        const list = inGroup(g)
        if (!list.length) return null
        return (
          <section key={g} className={`pm-group is-${g}`}>
            <h3>{groupInfo[g].title} <i>{list.length}</i></h3>
            {groupInfo[g].hint && <p>{groupInfo[g].hint}</p>}
            <div className="pm-list">{list.map(rowView)}</div>
          </section>
        )
      })}

      {zeroRows.length > 0 && (
        <div className="pm-zero">
          <button onClick={() => setShowZero(s => !s)}>
            {showZero ? '▴' : '▾'} {tr(`${zeroRows.length} people with ¥0 this month`,`今月 ¥0 の人: ${zeroRows.length}人`,`${zeroRows.length} pessoa${zeroRows.length>1?'s':''} com ¥0 neste mês`)}
            <small>{zeroRows.map(r => r.emp.full_name.split(' ')[0]).join(', ')}</small>
          </button>
          {showZero && <div className="pm-list">{zeroRows.map(rowView)}</div>}
        </div>
      )}

      {form && (
        <div className="sp-overlay" onClick={() => setForm(null)}>
          <section className="sp-modal is-admin pm-form" role="dialog" aria-modal="true" onClick={ev => ev.stopPropagation()}>
            <h3>{editingId ? tr('Edit entry','編集','Editar lançamento') : tr('New entry','新規登録','Novo lançamento')}</h3>
            <label>{tr('Employee','従業員','Funcionário')}
              <select value={form.employee_id} onChange={e => upd('employee_id', e.target.value)}>
                <option value="">{tr('Choose…','選択…','Escolha…')}</option>
                {employees.filter(e => e.is_active !== false || e.id === form.employee_id).map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </label>
            <div className="pm-types">
              {TYPES.map(k => <button key={k} type="button" className={form.payment_type === k ? 'is-on' : ''} onClick={() => upd('payment_type', k)}>{typeLabel[k]}</button>)}
            </div>
            <div className="pm-2">
              <label>{tr('Amount (¥)','金額 (¥)','Valor (¥)')}<input type="number" inputMode="numeric" value={form.amount} onChange={e => upd('amount', e.target.value)} /></label>
              <label>{tr('Month worked','勤務月','Mês trabalhado')}<input type="month" value={form.period} onChange={e => upd('period', e.target.value)} /></label>
              <label>{form.payment_type === 'deduction' ? tr('Date','日付','Data') : tr('Payment date','支払日','Data do pagamento')}<input type="date" value={form.payment_date} onChange={e => upd('payment_date', e.target.value)} /></label>
              {form.payment_type !== 'deduction' && (
                <label>{tr('Status','状態','Situação')}
                  <select value={form.status} onChange={e => upd('status', e.target.value)}>
                    <option value="scheduled">{tr('To pay','未払い','A pagar')}</option>
                    <option value="paid" disabled={form.payment_type === 'salary' && form.status !== 'paid'}>{tr('Paid','支払済','Pago')}{form.payment_type === 'salary' && form.status !== 'paid' ? ` — ${tr('use Payroll','給与締めから','pelo Folha')}` : ''}</option>
                    <option value="cancelled">{tr('Cancelled','取消','Cancelado')}</option>
                  </select>
                </label>
              )}
            </div>
            <label>{tr('Description','説明','Descrição')}<input value={form.description} onChange={e => upd('description', e.target.value)} placeholder={tr('e.g. October overtime','例: 10月残業','ex.: hora extra de outubro')} /></label>
            {form.payment_type === 'deduction' && <p className="pm-hint">{tr('A deduction is taken from this month’s salary.','控除はこの月の給与から差し引かれます。','O desconto sai do salário deste mês.')}</p>}
            <div className="sp-actions">
              <button className="btn" onClick={() => setForm(null)}>{tr('Cancel','キャンセル','Cancelar')}</button>
              <button className="btn btn-primary" onClick={handleSave}>{editingId ? tr('Save','保存','Salvar') : tr('Add','追加','Adicionar')}</button>
            </div>
          </section>
        </div>
      )}

      {closing && <PayrollCloseSheet emp={closing} period={month} onClose={() => setClosing(null)} onChanged={load} />}

      {ask && (() => {
        const { kind, emp, lines, r } = ask
        const isPay = kind === 'pay'
        const total = lines.reduce((s, p) => s + Number(p.amount||0), 0)
        const hasSalary = lines.some(p => p.payment_type === 'salary')
        const k = r?.slip || 'none'
        const calm = !hasSalary || k === 'confirmed'
        const stop = isPay && !calm
        return (
          <div className="sp-overlay" onClick={() => !busy && setAsk(null)}>
            <section className="sp-modal is-admin" role="dialog" aria-modal="true" onClick={ev => ev.stopPropagation()}>
              <h3>{isPay ? tr('Confirm this payment was made?','この支払いを完了にしますか？','Confirmar que este pagamento foi feito?') : tr('Delete this entry?','この項目を削除しますか？','Apagar este lançamento?')}</h3>
              <dl className="sp-rows">
                <div><dt>{tr('Employee','従業員','Funcionário')}</dt><dd>{emp.full_name}</dd></div>
                <div><dt>{tr('Month worked','勤務月','Mês trabalhado')}</dt><dd>{fmtMonth(monthOf(lines[0]))}</dd></div>
                {lines.map(p => (
                  <div key={p.id}><dt>{typeLabel[p.payment_type] || p.payment_type}{p.description ? ` · ${p.description}` : ''}</dt><dd>{p.is_deduction ? '−' : ''}{fmt(p.amount)}</dd></div>
                ))}
                {isPay && lines.length > 1 && <div><dt><b>{tr('Total','合計','Total')}</b></dt><dd className="sp-big">{fmt(total)}</dd></div>}
                {isPay && lines.length === 1 && <div><dt>{tr('Amount','金額','Valor')}</dt><dd className="sp-big">{fmt(total)}</dd></div>}
              </dl>
              {isPay && r?.ded > 0 && <p className="pm-hint">{tr(`Deductions of ${fmt(r.ded)} are already taken out of the salary amount.`,`控除 ${fmt(r.ded)} は給与額から差し引き済みです。`,`Os descontos de ${fmt(r.ded)} já saíram do valor do salário.`)}</p>}
              {isPay && hasSalary && (
                <div className={`sp-state is-${k}`}>
                  <b>{slipLong[k]}</b>
                  {k==='confirmed'&&r.st&&<small>{new Date(r.st.employee_confirmed_at).toLocaleString(locale,{timeZone:'Asia/Tokyo'})}</small>}
                  {k==='disputed'&&<small>{tr('Answer the dispute in Salary issues before paying.','支払う前に「給与の問題」で回答してください。','Responda a contestação em Problemas de salário antes de pagar.')}</small>}
                  {k==='waiting'&&<small>{tr('The salary can be marked paid only after the employee confirms the payslip.','従業員が明細を確認した後に支払済にできます。','O salário só pode ser marcado pago depois que o funcionário confirmar o holerite.')}</small>}
                  {k==='none'&&<small>{tr('Calculate the payslip first (Payroll).','先に明細を計算してください（給与締め）。','Calcule o holerite primeiro (Folha).')}</small>}
                </div>
              )}
              <div className="sp-actions">
                <button className="btn" disabled={busy} onClick={() => setAsk(null)}>{tr('Cancel','キャンセル','Cancelar')}</button>
                {stop
                  ? <button className="btn btn-primary" onClick={() => { setAsk(null); setClosing(emp) }}>{tr('Open payroll','給与締めを開く','Abrir folha')}</button>
                  : <button className={`btn ${isPay ? 'btn-primary' : 'btn-danger'}`} disabled={busy} onClick={doConfirmed}>
                    {isPay ? tr('Yes, it was paid','はい、支払済み','Sim, foi pago') : tr('Delete','削除','Apagar')}
                  </button>}
              </div>
            </section>
          </div>
        )
      })()}
    </div>
  )
}
