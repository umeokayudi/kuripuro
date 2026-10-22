import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useLang, pickLang } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { fetchQuoteSessions, quoteStage, scheduleQuoteSession, cancelQuoteSession, finishQuoteJob, syncQuoteSessions } from '../lib/quoteFlow'
import './quote-tracker.css'

const yen = n => `¥${Math.round(Number(n || 0)).toLocaleString()}`

// v1.0.70 · Accepted quote → book sessions → worker does it → invoice sent.
// Opens from Quotes (mitsumori accepted), Client requests (client accepted) and the admin bell.
export default function QuoteTracker({ quote, onClose }) {
  const { lang } = useLang()
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const navigate = useNavigate()
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState([])
  const [clients, setClients] = useState([])
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ date: '', time: '', employee_id: '', price: '', employee_pay: '', client_id: quote.client_id || '', address: quote.address || '', notes: '' })
  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const load = async () => {
    try {
      let rows = await fetchQuoteSessions(quote.ref)
      if (await syncQuoteSessions(rows)) rows = await fetchQuoteSessions(quote.ref)
      setSessions(rows)
    } catch (e) {
      toast.error(e.message)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    Promise.all([
      supabase.from('employees').select('id,full_name').eq('is_active', true).order('full_name'),
      supabase.from('clients').select('id,company_name,address,contact_person,contact_name,phone,manager_name,manager_phone').eq('is_active', true).order('company_name'),
    ]).then(([e, c]) => {
      setEmployees(e.data || [])
      const list = c.data || []
      setClients(list)
      // a quote made by a seller has only the company name: pick the client with that name if there is one
      if (!quote.client_id && quote.client_name) {
        const hit = list.find(x => String(x.company_name || '').trim().toLowerCase() === quote.client_name.trim().toLowerCase())
        if (hit) setForm(f => ({ ...f, client_id: hit.id, address: f.address || hit.address || '' }))
      }
    })
    const esc = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const live = sessions.filter(s => s.job?.status !== 'cancelled' && s.job?.spot_status !== 'declined')
  const booked = live.reduce((n, s) => n + Number(s.price || 0), 0)
  const left = Math.max(0, Math.round(quote.total - booked))
  const stage = quoteStage(sessions)
  const invoiced = live.filter(s => s.invoice?.status === 'sent' || s.invoice?.status === 'paid').reduce((n, s) => n + Number(s.invoice?.total || 0), 0)

  // price of the next session = what is still not booked
  useEffect(() => { if (!loading) setForm(f => ({ ...f, price: f.price === '' ? String(left || '') : f.price })) }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps

  const steps = useMemo(() => [
    { key: 'approved', label: L('Approved', '承認', 'Aprovado'), done: true, sub: quote.decided_at ? String(quote.decided_at).slice(0, 10) : '' },
    { key: 'scheduled', label: L('Scheduled', '日程確定', 'Agendado'), done: live.length > 0, sub: live.length ? live.map(s => s.service_date).join(', ') : L('pick a date', '日付を選択', 'falta a data') },
    { key: 'done', label: L('Done by the team', '作業完了', 'Feito pela equipe'), done: stage === 'done', sub: live.length ? `${live.filter(s => s.job?.status === 'completed').length}/${live.length}` : '' },
    { key: 'invoice', label: L('Invoice sent', '請求書送付', 'Nota enviada'), done: live.length > 0 && live.every(s => ['sent', 'paid'].includes(s.invoice?.status)), sub: invoiced ? yen(invoiced) : '' },
  ], [sessions, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  const book = async () => {
    const employee = employees.find(e => e.id === form.employee_id)
    if (!form.date || !employee) return toast.error(L('Pick the date and who does it.', '日付と担当者を選んでください。', 'Escolha a data e quem vai fazer.'))
    if (!Number(form.price)) return toast.error(L('Enter the price of this session.', 'この回の金額を入力してください。', 'Informe o valor desta sessão.'))
    setBusy(true)
    try {
      const r = await scheduleQuoteSession(quote, { ...form, employee, client: clients.find(c => c.id === form.client_id) || null }, live)
      toast.success(L(`Booked for ${form.date}. ${employee.full_name} got the job.`, `${form.date} に予約しました。${employee.full_name} さんに通知しました。`, `Marcado para ${form.date}. ${employee.full_name} recebeu o serviço.`))
      if (r.invoiceError) toast.error(r.invoiceError.message)
      setForm(f => ({ ...f, date: '', time: '', employee_id: '', price: '', employee_pay: '', notes: '' }))
      await load()
      setForm(f => ({ ...f, price: '' }))
    } catch (e) {
      toast.error(e.message)
    }
    setBusy(false)
  }

  const markDone = async (s) => {
    setBusy(true)
    const r = await finishQuoteJob(s.job_id, { byAdmin: true })
    if (r?.sent) toast.success(L('Done. The invoice was sent to the client.', '完了。請求書をお客様に送付しました。', 'Feito. A nota de cobrança foi enviada ao cliente.'))
    await load()
    setBusy(false)
  }

  const cancel = async (s) => {
    setBusy(true)
    await cancelQuoteSession(s)
    toast(L('Session cancelled.', 'この回をキャンセルしました。', 'Sessão cancelada.'))
    await load()
    setBusy(false)
  }

  const jobState = s => {
    if (s.job?.status === 'completed') return [L('Done', '完了', 'Feito'), 'is-done']
    if (s.job?.status === 'cancelled' || s.job?.spot_status === 'declined') return [s.job?.spot_status === 'declined' ? L('Declined by worker', '辞退', 'Funcionário recusou') : L('Cancelled', 'キャンセル', 'Cancelado'), 'is-off']
    if (s.job?.status === 'in_progress') return [L('In progress', '作業中', 'Em andamento'), 'is-now']
    if (s.job?.spot_status === 'pending') return [L('Waiting for the worker to accept', '承諾待ち', 'Esperando o funcionário aceitar'), 'is-wait']
    return [L('Confirmed', '確定', 'Confirmado'), 'is-ok']
  }
  const invState = inv => !inv ? ['—', ''] : {
    draft: [L('To invoice (confirmed revenue)', '請求予定（確定売上）', 'A faturar (faturamento confirmado)'), 'is-wait'],
    sent: [L('Invoice sent', '請求書送付済み', 'Nota enviada'), 'is-ok'],
    paid: [L('Paid', '入金済み', 'Pago'), 'is-done'],
    overdue: [L('Overdue', '期限超過', 'Vencida'), 'is-off'],
    cancelled: [L('Cancelled', 'キャンセル', 'Cancelada'), 'is-off'],
  }[inv.status] || [inv.status, '']

  return createPortal(
    <div className="qt-overlay" onClick={onClose}>
      <div className="qt-sheet" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <header className="qt-head">
          <div>
            <div className="qt-eyebrow">{quote.kind === 'mitsumori' ? `${L('Quote', '見積', 'Orçamento')} ${quote.quote_number || ''}` : L('Client request', 'お客様からの依頼', 'Pedido do cliente')}</div>
            <h3>{quote.client_name || quote.place}</h3>
            <p>{[quote.client_name && quote.place !== quote.client_name ? quote.place : '', quote.service].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="qt-total"><strong>{yen(quote.total)}</strong><span>{L('accepted', '承認済み', 'aceito')}</span></div>
          <button type="button" className="qt-x" aria-label="close" onClick={onClose}>✕</button>
        </header>

        <ol className="qt-steps">
          {steps.map((st, i) => (
            <li key={st.key} className={st.done ? 'is-done' : (steps[i - 1]?.done ? 'is-next' : '')}>
              <i>{st.done ? '✓' : i + 1}</i>
              <div><b>{st.label}</b><small>{st.sub}</small></div>
            </li>
          ))}
        </ol>

        <section className="qt-block">
          <div className="qt-block-title">{L('Sessions', '作業日程', 'Sessões')}</div>
          {loading && <div className="qt-muted">…</div>}
          {!loading && !sessions.length && <div className="qt-muted">{L('No date yet. Book the first session below; the worker is notified right away.', 'まだ日程がありません。下で1回目を予約すると担当者にすぐ通知されます。', 'Ainda sem data. Marque a primeira sessão abaixo; o funcionário é avisado na hora.')}</div>}
          {sessions.map((s, i) => {
            const [jl, jc] = jobState(s)
            const [il, ic] = invState(s.invoice)
            const open = s.job && !['completed', 'cancelled'].includes(s.job.status) && s.job.spot_status !== 'declined'
            return (
              <div key={s.id} className="qt-session">
                <div className="qt-session-n">{i + 1}</div>
                <div className="qt-session-main">
                  <b>{s.service_date}{s.service_time ? ` · ${s.service_time}` : ''}</b>
                  <span>{s.employee_name || '—'} · {yen(s.price)}</span>
                  <div className="qt-pills"><em className={jc}>{jl}</em><em className={ic}>{il}</em></div>
                </div>
                <div className="qt-session-act">
                  {open && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => markDone(s)}>{L('Mark done', '完了にする', 'Marcar feito')}</button>}
                  {open && <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => cancel(s)}>{L('Cancel', '取消', 'Cancelar')}</button>}
                  {s.fatura_id && <button type="button" className="btn btn-sm btn-ghost" onClick={() => navigate(`/faturas?search=${s.fatura_id}`)}>{L('Invoice', '請求書', 'Nota')}</button>}
                </div>
              </div>
            )
          })}
          {!!live.length && <div className="qt-sum">{L('Booked', '予約済み', 'Marcado')} {yen(booked)} / {yen(quote.total)}{left ? ` · ${L('left', '残り', 'falta')} ${yen(left)}` : ''}</div>}
        </section>

        {!live.length || left > 0 ? (
          <section className="qt-block">
            <div className="qt-block-title">{live.length ? L('Add another session', '次回を追加', 'Adicionar outra sessão') : L('Book the service', '作業日を予約', 'Marcar o serviço')}</div>
            <div className="qt-form">
              <label>{L('Date', '日付', 'Data')}<input type="date" min={tokyoToday()} value={form.date} onChange={e => upd('date', e.target.value)} /></label>
              <label>{L('Time', '時間', 'Horário')}<input type="time" value={form.time} onChange={e => upd('time', e.target.value)} /></label>
              <label className="qt-wide">{L('Who does it', '担当者', 'Quem faz')}
                <select value={form.employee_id} onChange={e => upd('employee_id', e.target.value)}>
                  <option value="">—</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select>
              </label>
              <label>{L('Price of this session (¥, tax incl.)', 'この回の金額（税込）', 'Valor desta sessão (¥, c/ imposto)')}<input type="number" min="0" value={form.price} onChange={e => upd('price', e.target.value)} /></label>
              <label>{L('Worker pay (¥)', '担当者への支払い', 'Pagamento do funcionário (¥)')}<input type="number" min="0" value={form.employee_pay} onChange={e => upd('employee_pay', e.target.value)} /></label>
              {!quote.client_id && (
                <label className="qt-wide">{L('Client (for the invoice)', '請求先', 'Cliente (para a nota)')}
                  <select value={form.client_id} onChange={e => { const c = clients.find(x => x.id === e.target.value); upd('client_id', e.target.value); if (c?.address && !form.address) upd('address', c.address) }}>
                    <option value="">— {quote.client_name || L('none', 'なし', 'nenhum')} —</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                  </select>
                </label>
              )}
              <label className="qt-wide">{L('Address', '住所', 'Endereço')}<input value={form.address} onChange={e => upd('address', e.target.value)} placeholder={quote.place} /></label>
              <label className="qt-wide">{L('Note for the worker', '担当者へのメモ', 'Recado para o funcionário')}<input value={form.notes} onChange={e => upd('notes', e.target.value)} /></label>
            </div>
            {quote.preferred_date && <div className="qt-muted">{L('Client asked for', 'お客様の希望日', 'Cliente pediu para')} {quote.preferred_date}</div>}
            <button type="button" className="btn btn-primary qt-book" disabled={busy} onClick={book}>
              {busy ? '…' : L('Book and notify the worker', '予約して担当者に通知', 'Marcar e avisar o funcionário')}
            </button>
            <div className="qt-muted">{L('Creates the job, the contract and the invoice (as confirmed revenue for that month). When the worker finishes, the invoice is sent to the client.', '作業・契約書・請求書（その月の確定売上）を作成します。作業完了で請求書がお客様に送られます。', 'Cria o serviço, o contrato e a nota (como faturamento confirmado daquele mês). Quando o funcionário terminar, a nota vai para o cliente.')}</div>
          </section>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
