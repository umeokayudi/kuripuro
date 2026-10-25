import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useLang, pickLang } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { viewablePhotoUrl } from '../lib/photoUrl'
import PhotoLightbox from './PhotoLightbox'
import { fetchQuoteSessions, quoteProgress, scheduleQuoteSession, cancelQuoteSession, finishQuoteJob, syncQuoteSessions, sessionLate, checkQuoteSession, checkQuoteBilling, rescheduleQuoteSession } from '../lib/quoteFlow'
import './quote-tracker.css'

const yen = n => `¥${Math.round(Number(n || 0)).toLocaleString()}`
const billed = s => ['sent', 'paid'].includes(s.invoice?.status)
const billChecked = s => s.invoice?.status === 'paid' || Boolean(s.contract_details?.billing_checked_at)

// v1.0.70 · Accepted quote → book sessions → worker does it → invoice sent.
// Opens from Quotes (mitsumori accepted), Client requests (client accepted) and the admin bell.
// v1.0.87 · after the date: late alert, "was it done / how did it go" check with the worker's report
// and photos, reschedule when it was not done, and the billing check.
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
  const [checkNote, setCheckNote] = useState({})
  const [moving, setMoving] = useState(null)
  const [move, setMove] = useState({ date: '', time: '', employee_id: '', reason: '' })
  const [zoom, setZoom] = useState(null)

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
  const prog = quoteProgress(sessions)
  const invoiced = live.filter(s => s.invoice?.status === 'sent' || s.invoice?.status === 'paid').reduce((n, s) => n + Number(s.invoice?.total || 0), 0)

  // price of the next session = what is still not booked
  useEffect(() => { if (!loading) setForm(f => ({ ...f, price: f.price === '' ? String(left || '') : f.price })) }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps

  const steps = useMemo(() => {
    const all = n => prog.booked > 0 && n === prog.booked
    return [
      { key: 'approved', label: L('Approved', '承認', 'Aprovado'), done: true, sub: quote.decided_at ? String(quote.decided_at).slice(0, 10) : '' },
      { key: 'scheduled', label: L('Date booked', '日程確定', 'Data marcada'), done: prog.booked > 0, sub: prog.booked ? live.map(s => s.service_date).join(', ') : L('pick a date', '日付を選択', 'falta a data') },
      { key: 'done', label: L('Done?', '実施', 'Foi feito?'), done: all(prog.done), late: prog.late > 0, sub: prog.late ? L(`${prog.late} late`, `${prog.late}件 遅延`, `${prog.late} atrasado`) : prog.booked ? `${prog.done}/${prog.booked}` : '' },
      { key: 'checked', label: L('How it went', '確認', 'Como foi'), done: all(prog.checked), sub: prog.done ? `${prog.checked}/${prog.done} ${L('checked', '確認済み', 'conferido')}` : '' },
      { key: 'invoice', label: L('Billing checked', '請求確認', 'Cobrança checada'), done: all(prog.billChecked), sub: prog.billed ? `${yen(invoiced)} · ${prog.billChecked}/${prog.booked}` : '' },
    ]
  }, [sessions, lang]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const saveCheck = async (s, result) => {
    setBusy(true)
    try {
      await checkQuoteSession(s, { result, note: checkNote[s.id] ?? s.contract_details?.check?.note ?? '' })
      toast.success(result === 'ok' ? L('Checked: all good.', '確認しました：問題なし。', 'Conferido: tudo certo.') : L('Saved with the problem noted.', '問題を記録しました。', 'Salvo com o problema anotado.'))
      setCheckNote(n => ({ ...n, [s.id]: undefined }))
      await load()
    } catch (e) {
      toast.error(e.message)
    }
    setBusy(false)
  }

  const saveBilling = async (s) => {
    setBusy(true)
    try {
      await checkQuoteBilling(s)
      toast.success(L('Billing checked.', '請求を確認しました。', 'Cobrança checada.'))
      await load()
    } catch (e) {
      toast.error(e.message)
    }
    setBusy(false)
  }

  const openMove = (s) => { setMoving(s.id); setMove({ date: '', time: s.service_time || '', employee_id: s.employee_id || '', reason: '' }) }
  const saveMove = async (s) => {
    if (!move.date) return toast.error(L('Pick the new date.', '新しい日付を選んでください。', 'Escolha a nova data.'))
    setBusy(true)
    try {
      await rescheduleQuoteSession(s, { date: move.date, time: move.time, employee: employees.find(e => e.id === move.employee_id) || null, reason: move.reason })
      toast.success(L(`Moved to ${move.date}.`, `${move.date} に変更しました。`, `Remarcado para ${move.date}.`))
      setMoving(null)
      await load()
    } catch (e) {
      toast.error(e.message)
    }
    setBusy(false)
  }

  const cancel = async (s) => {
    setBusy(true)
    await cancelQuoteSession(s)
    toast(L('Session cancelled.', 'この回をキャンセルしました。', 'Sessão cancelada.'))
    await load()
    setBusy(false)
  }

  const lateText = why => ({
    missed: L('Late: not done', '遅延：未実施', 'Atrasado: não foi feito'),
    unfinished: L('Late: started, not finished', '遅延：未完了', 'Atrasado: começou e não terminou'),
    not_started: L('Late: not started', '遅延：未開始', 'Atrasado: não começou'),
  }[why])
  const jobState = s => {
    if (s.job?.status === 'completed') return [L('Done', '完了', 'Feito'), 'is-done']
    const why = sessionLate(s)
    if (why) return [`⚠ ${lateText(why)}`, 'is-late']
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
            <li key={st.key} className={st.late ? 'is-late' : st.done ? 'is-done' : (steps[i - 1]?.done ? 'is-next' : '')}>
              <i>{st.late ? '!' : st.done ? '✓' : i + 1}</i>
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
            const late = sessionLate(s)
            const done = s.job?.status === 'completed'
            const check = s.contract_details?.check
            const moves = s.contract_details?.reschedules || []
            const j = s.job || {}
            const report = [j.notes_employee, j.retro_report, j.retro_ai_summary].map(x => String(x || '').trim()).filter(Boolean)
            const photos = [j.photo_start_url && [j.photo_start_url, L('Before', '作業前', 'Antes')], j.photo_end_url && [j.photo_end_url, L('After', '作業後', 'Depois')]].filter(Boolean)
            const note = checkNote[s.id] ?? check?.note ?? ''
            const editing = checkNote[s.id] !== undefined
            return (
              <div key={s.id} className={`qt-session${late ? ' is-late' : ''}`}>
                <div className="qt-session-row">
                  <div className="qt-session-n">{i + 1}</div>
                  <div className="qt-session-main">
                    <b>{s.service_date}{s.service_time ? ` · ${s.service_time}` : ''}</b>
                    <span>{s.employee_name || '—'} · {yen(s.price)}{moves.length ? ` · ${L(`moved ${moves.length}×`, `${moves.length}回変更`, `remarcado ${moves.length}×`)}` : ''}</span>
                    <div className="qt-pills">
                      <em className={jc}>{jl}</em>
                      <em className={ic}>{il}</em>
                      {check?.result === 'ok' && <em className="is-done">✓ {L('Checked', '確認済み', 'Conferido')}</em>}
                      {check?.result === 'issue' && <em className="is-off">⚠ {L('Had a problem', '問題あり', 'Teve problema')}</em>}
                      {billChecked(s) && <em className="is-done">✓ {L('Billing checked', '請求確認済み', 'Cobrança checada')}</em>}
                    </div>
                  </div>
                  <div className="qt-session-act">
                    {open && !late && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => markDone(s)}>{L('Mark done', '完了にする', 'Marcar feito')}</button>}
                    {open && !late && <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => openMove(s)}>{L('Move date', '日程変更', 'Remarcar')}</button>}
                    {open && <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => cancel(s)}>{L('Cancel', '取消', 'Cancelar')}</button>}
                    {s.fatura_id && <button type="button" className="btn btn-sm btn-ghost" onClick={() => navigate(`/faturas?search=${s.fatura_id}`)}>{L('Invoice', '請求書', 'Nota')}</button>}
                  </div>
                </div>

                {late && moving !== s.id && (
                  <div className="qt-alert">
                    <b>⚠ {late === 'not_started'
                      ? L(`Booked for ${s.service_time} today and nobody started yet.`, `本日 ${s.service_time} の予定ですが、まだ開始されていません。`, `Marcado para hoje ${s.service_time} e ninguém começou ainda.`)
                      : L(`The day (${s.service_date}) passed and the job was not finished.`, `予定日（${s.service_date}）を過ぎても完了していません。`, `O dia (${s.service_date}) passou e o serviço não foi concluído.`)}</b>
                    <span>{L('Was it done?', '実施しましたか？', 'Foi feito?')}</span>
                    <div className="qt-alert-act">
                      <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => markDone(s)}>✓ {L('Yes, it was done', 'はい、実施済み', 'Sim, foi feito')}</button>
                      <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => openMove(s)}>✕ {L('Not done: move the date', '未実施：日程変更', 'Não foi feito: remarcar')}</button>
                    </div>
                  </div>
                )}

                {moving === s.id && (
                  <div className="qt-move">
                    <div className="qt-form">
                      <label>{L('New date', '新しい日付', 'Nova data')}<input type="date" min={tokyoToday()} value={move.date} onChange={e => setMove(m => ({ ...m, date: e.target.value }))} /></label>
                      <label>{L('Time', '時間', 'Horário')}<input type="time" value={move.time} onChange={e => setMove(m => ({ ...m, time: e.target.value }))} /></label>
                      <label className="qt-wide">{L('Who does it', '担当者', 'Quem faz')}
                        <select value={move.employee_id} onChange={e => setMove(m => ({ ...m, employee_id: e.target.value }))}>
                          {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                        </select>
                      </label>
                      <label className="qt-wide">{L('Why it was not done', '未実施の理由', 'Por que não foi feito')}<input value={move.reason} onChange={e => setMove(m => ({ ...m, reason: e.target.value }))} placeholder={L('e.g. store closed, client asked to move', '例：店舗休業、お客様の希望', 'ex.: loja fechada, cliente pediu para mudar')} /></label>
                    </div>
                    <div className="qt-alert-act">
                      <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => saveMove(s)}>{L('Move and notify', '変更して通知', 'Remarcar e avisar')}</button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMoving(null)}>{L('Close', '閉じる', 'Fechar')}</button>
                    </div>
                  </div>
                )}

                {done && (
                  <div className="qt-report">
                    <div className="qt-report-head">
                      <b>📝 {L('How it went', '作業報告', 'Como foi')}</b>
                      <span>{[j.employee_name || s.employee_name, j.completed_at && new Date(j.completed_at).toLocaleString(lang === 'ja' ? 'ja-JP' : lang === 'pt' ? 'pt-BR' : 'en-GB', { timeZone: 'Asia/Tokyo', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), j.checklist_total ? `✓ ${j.checklist_done || 0}/${j.checklist_total}` : '', j.photo_ai_score != null ? `📷 ${j.photo_ai_score}/100` : ''].filter(Boolean).join(' · ')}</span>
                    </div>
                    {photos.length > 0 && (
                      <div className="qt-photos">
                        {photos.map(([url, label]) => (
                          <button key={url} type="button" onClick={() => setZoom(url)}><img src={viewablePhotoUrl(url)} alt="" loading="lazy" /><span>{label}</span></button>
                        ))}
                      </div>
                    )}
                    {report.map((r, k) => <p key={k} className="qt-report-text">{r}</p>)}
                    {j.checklist_missed_items && <p className="qt-report-text is-warn">⚠ {L('Missed on the checklist', 'チェック漏れ', 'Faltou no checklist')}: {j.checklist_missed_items}</p>}
                    {j.photo_ai_issues && <p className="qt-report-text is-warn">📷 {j.photo_ai_issues}</p>}
                    {!photos.length && !report.length && <p className="qt-muted">{L('The worker left no photo or note.', '写真・メモはありません。', 'O funcionário não deixou foto nem recado.')}</p>}

                    {check && !editing ? (
                      <div className="qt-checked">
                        <span>{check.result === 'ok' ? '✓' : '⚠'} {check.result === 'ok' ? L('Checked: all good', '確認済み：問題なし', 'Conferido: tudo certo') : L('Checked: had a problem', '確認済み：問題あり', 'Conferido: teve problema')}{check.at ? ` · ${String(check.at).slice(0, 10)}` : ''}</span>
                        {check.note && <p>{check.note}</p>}
                        <button type="button" className="qt-link" onClick={() => setCheckNote(n => ({ ...n, [s.id]: check.note || '' }))}>{L('Edit', '編集', 'Editar')}</button>
                      </div>
                    ) : (
                      <div className="qt-check">
                        <input value={note} onChange={e => setCheckNote(n => ({ ...n, [s.id]: e.target.value }))} placeholder={L('Details: how it went, what the client said…', '詳細：作業の様子、お客様の声など', 'Detalhes: como foi, o que o cliente falou…')} />
                        <div className="qt-alert-act">
                          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => saveCheck(s, 'ok')}>✓ {L('All good', '問題なし', 'Tudo certo')}</button>
                          <button type="button" className="btn btn-sm btn-danger" disabled={busy || !note.trim()} title={note.trim() ? '' : L('Write what happened', '内容を記入してください', 'Escreva o que aconteceu')} onClick={() => saveCheck(s, 'issue')}>⚠ {L('Had a problem', '問題あり', 'Teve problema')}</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {billed(s) && !billChecked(s) && (
                  <div className="qt-bill">
                    <span>🧾 {L(`Invoice ${yen(s.invoice.total)} sent${s.invoice.issue_date ? ` on ${s.invoice.issue_date}` : ''}${s.invoice.due_date ? ` · due ${s.invoice.due_date}` : ''}. Did the client get it?`, `請求書 ${yen(s.invoice.total)} 送付済み${s.invoice.due_date ? `・期限 ${s.invoice.due_date}` : ''}。お客様に届きましたか？`, `Nota ${yen(s.invoice.total)} enviada${s.invoice.issue_date ? ` em ${s.invoice.issue_date}` : ''}${s.invoice.due_date ? ` · vence ${s.invoice.due_date}` : ''}. O cliente recebeu?`)}</span>
                    <button type="button" className="btn btn-sm" disabled={busy} onClick={() => saveBilling(s)}>✓ {L('Billing checked', '請求確認', 'Cobrança checada')}</button>
                  </div>
                )}
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
      {zoom && <div onClick={e => e.stopPropagation()}><PhotoLightbox url={zoom} onClose={() => setZoom(null)} closeLabel={L('Close', '閉じる', 'Fechar')} /></div>}
    </div>,
    document.body,
  )
}
