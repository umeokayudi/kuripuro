import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useLang, pickLang } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { fetchQuoteSessions, quoteStage, scheduleQuoteSession, cancelQuoteSession, finishQuoteJob, syncQuoteSessions } from '../lib/quoteFlow'
import './quote-tracker.css'
import AddressInput from './AddressInput'
import InvoiceDatesDialog from './InvoiceDatesDialog'
import { askConfirm } from './ConfirmDialog'
import { suggestedInvoiceDates, looksLikeYearTypo } from '../lib/invoiceDates'
import TimeSelect from './TimeSelect'
import { reasonText, laterOptions, isLaterActive } from '../lib/quoteSuggest'
import { loadQuoteLaterMap, setQuoteLater, fetchQuoteSuggestions } from '../lib/quoteLaterOps'
import { fmtDay } from './AvailabilityPlanner'
import { useAuth } from '../hooks/useAuth'

const addOne = iso => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }
const yen = n => `¥${Math.round(Number(n || 0)).toLocaleString()}`

// v1.0.70 · Accepted quote → book sessions → worker does it → invoice sent.
// Opens from Quotes (mitsumori accepted), Client requests (client accepted) and the admin bell.
export default function QuoteTracker({ quote, onClose }) {
  const { lang } = useLang()
  const { user } = useAuth() || {}
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const navigate = useNavigate()
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState([])
  const [clients, setClients] = useState([])
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ date: '', time: '', employee_id: '', price: '', employee_pay: '', client_id: quote.client_id || '', address: quote.address || '', notes: '' })
  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }))
  // v1.0.146 · "Mark done" first shows the 請求書 dates (発行日 / 対象期間 / 支払期限) to confirm
  const [doneFor, setDoneFor] = useState(null) // { s, initial, future }
  const [moveDate, setMoveDate] = useState(true)
  // v1.0.159 · "Agendar depois" (no date now) + suggested dates (one quote at a time, only fills the form)
  const [later, setLater] = useState(null) // { until, note, by, at } | null
  const [laterOpen, setLaterOpen] = useState(false)
  const [laterForm, setLaterForm] = useState({ until: '', note: '' })
  const [formOpen, setFormOpen] = useState(true)
  const [suggest, setSuggest] = useState(null) // null = loading, [] = none
  const [picked, setPicked] = useState(null)
  const today = tokyoToday()
  const dayLabel = d => (d ? fmtDay(d, lang, { weekday: 'short', day: '2-digit', month: '2-digit' }) : '')

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
    loadQuoteLaterMap().then(map => {
      const l = map[quote.ref] || null
      setLater(l)
      if (isLaterActive(l, tokyoToday())) setFormOpen(false)
    })
    Promise.all([
      supabase.from('employees').select('id,full_name').eq('is_active', true).order('full_name'),
      supabase.from('clients').select('id,company_name,address,contact_person,contact_name,phone,manager_name,manager_phone').eq('is_active', true).order('company_name'),
    ]).then(([e, c]) => {
      setEmployees(e.data || [])
      fetchQuoteSuggestions(quote, { today: tokyoToday(), address: quote.address, employees: e.data || [] })
        .then(setSuggest).catch(() => setSuggest([]))
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
    { key: 'scheduled', label: L('Scheduled', '日程確定', 'Agendado'), done: live.length > 0, sub: live.length ? live.map(s => s.service_date).join(', ') : later?.until ? L(`later · reminder ${dayLabel(later.until)}`, `あとで · ${dayLabel(later.until)}`, `depois · lembrete ${dayLabel(later.until)}`) : L('pick a date', '日付を選択', 'falta a data') },
    { key: 'done', label: L('Done by the team', '作業完了', 'Feito pela equipe'), done: stage === 'done', sub: live.length ? `${live.filter(s => s.job?.status === 'completed').length}/${live.length}` : '' },
    { key: 'invoice', label: L('Invoice sent', '請求書送付', 'Nota enviada'), done: live.length > 0 && live.every(s => ['sent', 'paid'].includes(s.invoice?.status)), sub: invoiced ? yen(invoiced) : '' },
  ], [sessions, lang, later]) // eslint-disable-line react-hooks/exhaustive-deps

  const applySuggestion = (sg) => {
    setPicked(sg.date + sg.employee_id)
    setForm(f => ({ ...f, date: sg.date, time: sg.time || f.time, employee_id: sg.employee_id }))
  }

  const saveLater = async (until, note) => {
    if (!until) return toast.error(L('Pick the reminder day.', 'リマインド日を選んでください。', 'Escolha o dia do lembrete.'))
    setBusy(true)
    try {
      const who = user?.full_name || user?.name || user?.email || ''
      const l = await setQuoteLater(quote.ref, { until, note: note || '', by: who })
      setLater(l); setLaterOpen(false); setFormOpen(false)
      toast.success(L(`OK — left for later. Reminder on ${dayLabel(until)}.`, `あとで日程にしました。${dayLabel(until)}にリマインドします。`, `Pronto — fica para depois. Lembrete em ${dayLabel(until)}.`))
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }
  const clearLater = async () => {
    if (!later) return
    try { await setQuoteLater(quote.ref, null); setLater(null) } catch { /* keeps the mark; harmless */ }
  }

  const book = async () => {
    const employee = employees.find(e => e.id === form.employee_id)
    if (!form.date || !employee) return toast.error(L('Pick the date and who does it.', '日付と担当者を選んでください。', 'Escolha a data e quem vai fazer.'))
    if (looksLikeYearTypo(form.date) && !(await askConfirm({
      message: L(`The date is ${form.date} — more than 45 days ahead. Is the date right?`, `日付は ${form.date}（45日以上先）です。日付は正しいですか？`, `A data é ${form.date} — mais de 45 dias daqui. A data está certa?`),
      confirmLabel: L('Yes, book it', 'はい、予約する', 'Sim, marcar'),
    }))) return
    if (!Number(form.price)) return toast.error(L('Enter the price of this session.', 'この回の金額を入力してください。', 'Informe o valor desta sessão.'))
    setBusy(true)
    try {
      const r = await scheduleQuoteSession(quote, { ...form, employee, client: clients.find(c => c.id === form.client_id) || null }, live)
      toast.success(L(`Booked for ${form.date}. ${employee.full_name} got the job.`, `${form.date} に予約しました。${employee.full_name} さんに通知しました。`, `Marcado para ${form.date}. ${employee.full_name} recebeu o serviço.`))
      if (r.invoiceError) toast.error(r.invoiceError.message)
      clearLater()
      setPicked(null)
      setForm(f => ({ ...f, date: '', time: '', employee_id: '', price: '', employee_pay: '', notes: '' }))
      await load()
      setForm(f => ({ ...f, price: '' }))
    } catch (e) {
      toast.error(e.message)
    }
    setBusy(false)
  }

  const markDone = (s) => {
    const today = tokyoToday()
    const future = s.service_date > today
    const inv = s.invoice
    if (!inv || inv.status !== 'draft') return finishDone(s, null, '')
    // Session booked for a future day but done now → suggest today as the period.
    const initial = suggestedInvoiceDates({ period_start: future ? today : s.service_date, period_end: future ? today : s.service_date }, { today })
    setMoveDate(future)
    setDoneFor({ s, initial, future })
  }

  const finishDone = async (s, dates, moveTo) => {
    setBusy(true)
    const r = await finishQuoteJob(s.job_id, { byAdmin: true, dates, moveTo })
    setDoneFor(null)
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
          {!loading && !sessions.length && <div className="qt-muted">{later?.until && !formOpen ? L('No date yet — left for later.', 'まだ日程なし（あとで決めます）。', 'Ainda sem data — fica para depois.') : L('No date yet. Book the first session below; the worker is notified right away.', 'まだ日程がありません。下で1回目を予約すると担当者にすぐ通知されます。', 'Ainda sem data. Marque a primeira sessão abaixo; o funcionário é avisado na hora.')}</div>}
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

        {!live.length && later?.until && !formOpen && (
          <section className="qt-block qt-later">
            <div className="qt-later-row">
              <span className="qt-later-ic" aria-hidden="true">🕒</span>
              <div>
                <b>{L('Left to book later', 'あとで日程を決める', 'Deixado para agendar depois')}</b>
                <span>{L(`Reminder on ${dayLabel(later.until)}`, `${dayLabel(later.until)}にリマインド`, `Lembrete em ${dayLabel(later.until)}`)}{later.note ? ` · ${later.note}` : ''}</span>
              </div>
            </div>
            <div className="qt-later-act">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setFormOpen(true)}>{L('Book now', '今すぐ予約', 'Agendar agora')}</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setLaterForm({ until: later.until, note: later.note || '' }); setLaterOpen(true); setFormOpen(true) }}>{L('Change reminder', 'リマインド変更', 'Mudar lembrete')}</button>
            </div>
          </section>
        )}

        {(!live.length || left > 0) && formOpen ? (
          <section className="qt-block">
            <div className="qt-block-title">{live.length ? L('Add another session', '次回を追加', 'Adicionar outra sessão') : L('Book the service', '作業日を予約', 'Marcar o serviço')}</div>
            <div className="qt-suggest">
              <div className="qt-suggest-head">✨ {L('Suggested dates', 'おすすめの日', 'Datas sugeridas')} <small>{L('by route and map area — tap to fill, then edit', 'ルートと地図エリアから · タップで入力、変更可', 'pela rota e área do mapa — toque para preencher e edite')}</small></div>
              {suggest === null && <div className="qt-muted">{L('Looking at the next 2 weeks…', '2週間分を確認中…', 'Olhando as próximas 2 semanas…')}</div>}
              {suggest && !suggest.length && <div className="qt-muted">{L('No suggestion (no team or schedule found). Pick the date below.', 'おすすめなし。下で日付を選んでください。', 'Sem sugestão (sem equipe ou agenda). Escolha a data abaixo.')}</div>}
              {suggest && suggest.length > 0 && (
                <div className="qt-suggest-list">
                  {suggest.map((sg, i) => (
                    <button key={sg.date + sg.employee_id} type="button" className={`qt-sg${picked === sg.date + sg.employee_id ? ' is-on' : ''}${i === 0 ? ' is-best' : ''}`} onClick={() => applySuggestion(sg)}>
                      <span className="qt-sg-top"><b>{dayLabel(sg.date)}</b>{sg.time ? <em>{sg.time}</em> : null}{i === 0 && <i>{L('best', 'おすすめ', 'melhor')}</i>}</span>
                      <span className="qt-sg-who">{sg.employee_name}</span>
                      <span className="qt-sg-why">{sg.reasons.map(r => reasonText(r, L)).filter(Boolean).join(' · ')}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="qt-form">
              <label>{L('Date', '日付', 'Data')}<input type="date" min={tokyoToday()} value={form.date} onChange={e => upd('date', e.target.value)} />
                {form.date !== tokyoToday() && <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: 4 }} onClick={() => upd('date', tokyoToday())}>{L('Today', '今日', 'Hoje')}</button>}
                {looksLikeYearTypo(form.date) && <span className="badge badge-amber" style={{ marginTop: 4, whiteSpace: 'normal' }}>{L('More than 45 days ahead — check the date', '45日以上先です。日付を確認', 'Mais de 45 dias daqui — confira a data')}</span>}
              </label>
              <label>{L('Time', '時間', 'Horário')}<TimeSelect value={form.time} onChange={v => upd('time', v)} emptyLabel={L('No time', '時間なし', 'Sem horário')} ariaLabel={L('Time', '時間', 'Horário')} /></label>
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
              <label className="qt-wide">{L('Address', '住所', 'Endereço')}<AddressInput value={form.address} onChange={e => upd('address', e.target.value)} placeholder={quote.place} /></label>
              <label className="qt-wide">{L('Note for the worker', '担当者へのメモ', 'Recado para o funcionário')}<input value={form.notes} onChange={e => upd('notes', e.target.value)} /></label>
            </div>
            {quote.preferred_date && <div className="qt-muted">{L('Client asked for', 'お客様の希望日', 'Cliente pediu para')} {quote.preferred_date}</div>}
            <button type="button" className="btn btn-primary qt-book" disabled={busy} onClick={book}>
              {busy ? '…' : L('Book and notify the worker', '予約して担当者に通知', 'Marcar e avisar o funcionário')}
            </button>
            {!laterOpen && (
              <button type="button" className="btn btn-ghost qt-later-btn" disabled={busy} onClick={() => { setLaterForm({ until: later?.until || '', note: later?.note || '' }); setLaterOpen(true) }}>
                🕒 {L('Book later — no date now', 'あとで日程を決める（今は日付なし）', 'Agendar depois — sem data agora')}
              </button>
            )}
            {laterOpen && (
              <div className="qt-later-pick">
                <div className="qt-block-title">{L('Remind me to book it on…', 'いつリマインドしますか…', 'Me lembrar de agendar em…')}</div>
                <div className="qt-later-chips">
                  {laterOptions(today).map(o => (
                    <button key={o.key} type="button" className={laterForm.until === o.date ? 'on' : ''} onClick={() => setLaterForm(f => ({ ...f, until: o.date }))}>
                      {{ tomorrow: L('Tomorrow', '明日', 'Amanhã'), '3d': L('In 3 days', '3日後', 'Em 3 dias'), monday: L('Next Monday', '来週月曜', 'Segunda que vem'), '2w': L('In 2 weeks', '2週間後', 'Em 2 semanas') }[o.key]}
                      <small>{dayLabel(o.date)}</small>
                    </button>
                  ))}
                </div>
                <div className="qt-form">
                  <label>{L('Or another day', 'または日付', 'Ou outro dia')}<input type="date" min={addOne(today)} value={laterForm.until} onChange={e => setLaterForm(f => ({ ...f, until: e.target.value }))} /></label>
                  <label>{L('Note (optional)', 'メモ（任意）', 'Recado (opcional)')}<input value={laterForm.note} placeholder={L('e.g. client will confirm', '例: お客様が確認予定', 'ex.: cliente vai confirmar')} onChange={e => setLaterForm(f => ({ ...f, note: e.target.value }))} /></label>
                </div>
                <div className="qt-later-act">
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy || !laterForm.until} onClick={() => saveLater(laterForm.until, laterForm.note)}>{L('Save — book later', '保存 · あとで予約', 'Salvar — agendar depois')}</button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setLaterOpen(false); if (later && isLaterActive(later, today) && !live.length) setFormOpen(false) }}>{L('Back', '戻る', 'Voltar')}</button>
                </div>
                <div className="qt-muted">{L('Nothing is booked and nobody is notified. The quote leaves the bell count and comes back on that day.', '予約も通知もしません。ベルの件数から外れ、その日に戻ってきます。', 'Nada é marcado e ninguém é avisado. O orçamento sai da contagem do sino e volta nesse dia.')}</div>
              </div>
            )}
            <div className="qt-muted">{L('Creates the job, the contract and the invoice (as confirmed revenue for that month). When the worker finishes, the invoice is sent to the client.', '作業・契約書・請求書（その月の確定売上）を作成します。作業完了で請求書がお客様に送られます。', 'Cria o serviço, o contrato e a nota (como faturamento confirmado daquele mês). Quando o funcionário terminar, a nota vai para o cliente.')}</div>
          </section>
        ) : null}
      </div>
      {doneFor && (
        <InvoiceDatesDialog
          initial={doneFor.initial}
          title={L('Done — invoice dates', '完了 — 請求書の日付', 'Feito — datas da nota')}
          intro={L(`Session booked for ${doneFor.s.service_date}. Check the dates printed on the invoice before it goes to the client.`, `${doneFor.s.service_date} 予約の回です。お客様に送る前に請求書の日付を確認してください。`, `Sessão marcada para ${doneFor.s.service_date}. Confira as datas que saem na nota antes de ir para o cliente.`)}
          saveLabel={L('Mark done and send', '完了にして送付', 'Marcar feito e enviar')}
          onSave={d => finishDone(doneFor.s, d, doneFor.future && moveDate ? d.period_start : '')}
          onClose={() => setDoneFor(null)}
        >
          {doneFor.future && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, marginTop: 10 }}>
              <input type="checkbox" checked={moveDate} onChange={e => setMoveDate(e.target.checked)} />
              <span>{L(`The session was booked for a future day (${doneFor.s.service_date}). Also move the service to the period start date.`, `この回は先の日付（${doneFor.s.service_date}）で予約されています。作業日も対象期間の開始日に変更する。`, `A sessão foi marcada para um dia futuro (${doneFor.s.service_date}). Mudar também a data do serviço para o início do período.`)}</span>
            </label>
          )}
        </InvoiceDatesDialog>
      )}
    </div>,
    document.body,
  )
}
