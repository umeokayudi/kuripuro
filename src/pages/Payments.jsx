import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useLang } from '../hooks/useLang'
import toast from 'react-hot-toast'
import { getPeriodDates } from '../lib/salaryPeriod'
import '../components/SalaryPopups.css'
import './Payments.css'
import PayrollCloseSheet from '../components/PayrollCloseSheet'
import { payrollState } from '../lib/salaryClose'

// One month (= month worked, salary_payments.period) at a time, one row per employee.
// ¥0 people fold away, "Mark paid" pays every open line of that person in that month.
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

const emptyForm = (period) => ({ employee_id:'', amount:'', payment_date:'', period, description:'', payment_type:'salary', status:'scheduled' })

export default function Payments() {
  const { tr, locale } = useLang()
  const [employees, setEmployees] = useState([])
  const [payments, setPayments] = useState([])
  const [statements, setStatements] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [month, setMonth] = useState(null)
  const [filter, setFilter] = useState('all') // all | open | paid | check
  const [who, setWho] = useState('')
  const [openRow, setOpenRow] = useState(null)
  const [showZero, setShowZero] = useState(false)
  const [ask, setAsk] = useState(null) // { kind: 'pay' | 'delete', emp, lines }
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState(null) // null = closed
  const [editingId, setEditingId] = useState(null)
  const [closing, setClosing] = useState(null) // employee whose month is open in PayrollCloseSheet

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
      supabase.from('employees').select('id,full_name,fixed_salary,monthly_work_days,salary_type,hourly_rate,is_active').order('full_name'),
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
      const paidUnconfirmed = pstate === 'paid_unconfirmed'
      let state
      if (!mine.length) state = 'none'
      else if (fixedZero || paidUnconfirmed) state = 'check'
      else if (earn === 0) state = 'zero'
      else if (toPay > 0) state = open.some(p => p.payment_date && p.payment_date < today) ? 'late' : 'open'
      else state = 'paid'
      const payDate = salaryLine?.payment_date || open[0]?.payment_date || mine[0]?.payment_date
      const paidOn = state === 'paid' ? mine.filter(p => !p.is_deduction && p.status === 'paid').map(p => p.payment_date).sort().pop() : null
      // Payroll close already takes deductions out of the salary row, so they are shown, not subtracted again.
      return { emp, lines: mine, earn, ded, net: earn, toPay, open, state, payDate, paidOn, slip: statementState(st), st, fixedZero, paidUnconfirmed, salaryLine }
    }).sort((a, b) => {
      const order = { late:0, check:1, open:2, none:3, paid:4, zero:5 }
      return order[a.state] - order[b.state] || a.emp.full_name.localeCompare(b.emp.full_name)
    })
  }, [payments, employees, statements, month, today])

  const visible = rows.filter(r => !who || r.emp.id === who)
  const byFilter = {
    all: visible.filter(r => r.state !== 'zero'),
    open: visible.filter(r => r.state === 'open' || r.state === 'late'),
    paid: visible.filter(r => r.state === 'paid'),
    check: visible.filter(r => r.state === 'check' || r.slip === 'disputed'),
  }
  const shown = byFilter[filter]
  const zeroRows = filter === 'all' ? visible.filter(r => r.state === 'zero') : []

  const totals = {
    toPay: visible.reduce((s, r) => s + r.toPay, 0),
    toPayPeople: visible.filter(r => r.toPay > 0).length,
    paid: visible.filter(r => !r.paidUnconfirmed).reduce((s, r) => s + r.lines.filter(p => !p.is_deduction && p.status === 'paid').reduce((a, p) => a + Number(p.amount||0), 0), 0),
    paidPeople: visible.filter(r => r.state === 'paid').length,
    ded: visible.reduce((s, r) => s + r.ded, 0),
    dedCount: visible.reduce((s, r) => s + r.lines.filter(p => p.is_deduction && counts(p)).length, 0),
  }
  const payDay = month ? getPeriodDates(month).payDate : null

  // Open amounts left in other months, so moving month never hides a debt.
  const elsewhere = useMemo(() => {
    const m = {}
    payments.filter(p => isOpen(p) && Number(p.amount) > 0 && monthOf(p) !== month).forEach(p => { m[monthOf(p)] = (m[monthOf(p)]||0) + Number(p.amount||0) })
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b))
  }, [payments, month])

  const statePill = {
    late: tr('Late','遅延','Atrasado'),
    open: tr('To pay','未払い','A pagar'),
    paid: tr('Paid','支払済','Pago'),
    check: tr('Check','要確認','Conferir'),
    zero: tr('No amount','金額なし','Sem valor'),
    none: tr('Not closed','未締め','Sem fechamento'),
  }
  const slipShort = {
    confirmed: tr('Payslip confirmed','明細確認済','Holerite confirmado'),
    disputed: tr('Payslip disputed','明細に異議','Holerite contestado'),
    waiting: tr('Payslip not confirmed','明細未確認','Holerite não confirmado'),
    none: tr('No payslip','明細なし','Sem holerite'),
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

  // A salary line is only paid after the employee confirmed the payslip of that month.
  const blocked = (r, lines) => lines.some(p => p.payment_type === 'salary') && r.slip !== 'confirmed'

  const rowView = (r) => {
    const expanded = openRow === r.emp.id
    const bits = lineBits(r)
    return (
      <div key={r.emp.id} className={`pm-row is-${r.state}${expanded ? ' is-expanded' : ''}`}>
        <div className="pm-main" onClick={() => setOpenRow(expanded ? null : r.emp.id)}>
          <div className="pm-av">{initials(r.emp.full_name)}</div>
          <div className="pm-who">
            <b>{r.emp.full_name}{r.emp.is_active === false && <em>{tr('inactive','退職','inativo')}</em>}</b>
            <small>
              {payKind[r.emp.salary_type] || ''}
              {r.emp.salary_type === 'fixed' && Number(r.emp.fixed_salary) > 0 && ` · ${fmt(r.emp.fixed_salary)}/${tr('mo','月','mês')}`}
            </small>
            {bits.length > 0 && (
              <div className="pm-bits">
                {bits.map(([k, v]) => <span key={k} className={k === 'deduction' ? 'is-neg' : ''}>{typeLabel[k] || k} {k === 'deduction' ? '−' : ''}{fmt(v)}</span>)}
              </div>
            )}
          </div>
          <div className="pm-net">
            <b>{fmt(r.toPay > 0 ? r.toPay : r.net)}</b>
            <small>{r.state === 'paid'
              ? `${tr('paid','支払','pago')} ${fmtDay(r.paidOn)}`
              : r.toPay > 0 ? `${tr('to pay','支払予定','a pagar')} ${fmtDay(r.open[0]?.payment_date)}${r.toPay !== r.net ? ` · ${tr('total','合計','total')} ${fmt(r.net)}` : ''}` : tr('this month','今月','no mês')}</small>
          </div>
          <div className="pm-tags">
            <span className={`pm-pill is-${r.state}`}>{statePill[r.state]}</span>
            {r.lines.some(p => p.payment_type === 'salary') && <span className={`pay-st is-${r.slip}`} title={slipLong[r.slip]}>{slipShort[r.slip]}</span>}
          </div>
          <div className="pm-act" onClick={ev => ev.stopPropagation()}>
            {r.toPay > 0 && !blocked(r, r.open)
              ? <button className="pm-pay" onClick={() => setAsk({ kind:'pay', emp:r.emp, lines:r.open, r })}>✓ {tr('Mark paid','支払済にする','Marcar pago')}</button>
              : r.state === 'paid' ? <span className="pm-done">✓</span>
              : <button className="pm-pay" style={{ background:'transparent', color:'var(--text2)', border:'1px solid var(--border)' }} onClick={() => setClosing(r.emp)}>{tr('Payroll','給与締め','Folha')}</button>}
            <button className="pm-chev" aria-label={tr('Details','詳細','Detalhes')} onClick={() => setOpenRow(expanded ? null : r.emp.id)}>{expanded ? '▴' : '▾'}</button>
          </div>
        </div>

        {r.paidUnconfirmed && (
          <div className="pm-note">
            {tr(
              'The salary is marked paid, but the employee has NOT confirmed the payslip yet. It only counts as paid after the confirmation.',
              '給与は支払済になっていますが、本人がまだ明細を確認していません。確認後に支払済として扱われます。',
              'O salário está marcado como pago, mas o funcionário AINDA NÃO confirmou o holerite. Só conta como pago depois da confirmação.')}
            <button className="pm-note-btn" disabled={busy} onClick={() => undoPaid(r)}>{tr('Back to "to pay"', '「未払い」に戻す', 'Voltar para "a pagar"')}</button>
          </div>
        )}

        {r.fixedZero && (
          <div className="pm-note">
            {tr(
              `Fixed salary is ${fmt(r.emp.fixed_salary)}/month but this line is ¥0 (an old close). The fixed salary is the whole month, with or without jobs: recalculate.`,
              `固定給 ${fmt(r.emp.fixed_salary)}/月ですが、この行は ¥0 です（古い締め）。固定給はジョブの有無に関係なく1か月分です。再計算してください。`,
              `Salário fixo de ${fmt(r.emp.fixed_salary)}/mês, mas esta linha está ¥0 (fechamento antigo). O fixo é o mês inteiro, com ou sem serviços: recalcule.`)}
            <button className="pm-note-btn" onClick={() => setClosing(r.emp)}>{tr('Recalculate','再計算','Recalcular')}</button>
          </div>
        )}

        {expanded && (
          <div className="pm-lines">
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
                  {isOpen(p) && !blocked(r, [p]) && <button title={tr('Mark paid','支払済にする','Marcar pago')} onClick={() => setAsk({ kind:'pay', emp:r.emp, lines:[p], r })}>✓</button>}
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

  const chips = [
    ['all', tr('All','すべて','Todos'), byFilter.all.length],
    ['open', tr('To pay','未払い','A pagar'), byFilter.open.length],
    ['paid', tr('Paid','支払済','Pagos'), byFilter.paid.length],
    ['check', tr('Check','要確認','Conferir'), byFilter.check.length],
  ]

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

      {elsewhere.length > 0 && (
        <div className="pm-elsewhere">
          <span>{tr('Still to pay in other months:','他の月の未払い:','Ainda a pagar em outros meses:')}</span>
          {elsewhere.map(([m, v]) => <button key={m} onClick={() => { setMonth(m); setFilter('open') }}>{fmtMonth(m)} · {fmt(v)}</button>)}
        </div>
      )}

      <div className="pm-sum">
        <div className="pm-card is-open">
          <small>{tr('To pay','支払予定','A pagar')}</small>
          <b>{fmt(totals.toPay)}</b>
          <span>{totals.toPayPeople ? tr(`${totals.toPayPeople} people`,`${totals.toPayPeople}人`,`${totals.toPayPeople} pessoa${totals.toPayPeople>1?'s':''}`) : tr('nothing open','未払いなし','nada em aberto')}</span>
        </div>
        <div className="pm-card is-paid">
          <small>{tr('Already paid','支払済','Já pago')}</small>
          <b>{fmt(totals.paid)}</b>
          <span>{tr(`${totals.paidPeople} people`,`${totals.paidPeople}人`,`${totals.paidPeople} pessoa${totals.paidPeople===1?'':'s'}`)}</span>
        </div>
        <div className="pm-card is-ded">
          <small>{tr('Deductions','控除','Descontos')}</small>
          <b>{totals.ded ? '−' : ''}{fmt(totals.ded)}</b>
          <span>{tr(`${totals.dedCount} entries`,`${totals.dedCount}件`,`${totals.dedCount} lançamento${totals.dedCount===1?'':'s'}`)}</span>
        </div>
        <div className="pm-card is-day">
          <small>{tr('Payday','支払日','Dia do pagamento')}</small>
          <b>{fmtDay(payDay)}</b>
          <span>{payDay && payDay < today ? tr('already passed','過ぎています','já passou') : payDay ? tr(`in ${Math.ceil((new Date(payDay) - new Date(today)) / 86400000)} days`,`あと${Math.ceil((new Date(payDay) - new Date(today)) / 86400000)}日`,`faltam ${Math.ceil((new Date(payDay) - new Date(today)) / 86400000)} dias`) : ''}</span>
        </div>
      </div>

      <div className="pm-chips">
        {chips.map(([k, label, n]) => (
          <button key={k} className={filter === k ? 'is-on' : ''} onClick={() => setFilter(k)}>{label}<i>{n}</i></button>
        ))}
      </div>

      <div className="pm-list">
        {!loaded && <div className="pm-empty">{tr('Loading…','読み込み中…','Carregando…')}</div>}
        {loaded && shown.length === 0 && (
          <div className="pm-empty">
            {filter === 'open' ? tr('Nothing left to pay this month 🎉','今月の未払いはありません 🎉','Nada para pagar neste mês 🎉')
              : filter === 'check' ? tr('Nothing to check','確認事項なし','Nada para conferir')
              : tr('No entries this month','今月の登録なし','Nenhum lançamento neste mês')}
          </div>
        )}
        {shown.map(rowView)}
      </div>

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
