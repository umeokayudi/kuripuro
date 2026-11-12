// v1.0.213 · E-mail de confirmação com relatórios: interruptor por cliente (cadastro/lista) e a aba
// "E-mails enviados" (registro + "Reenviar relatório do dia"). Tudo passa por /api/client-email (só admin).
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { apiFetch, apiPost } from '../lib/apiFetch'
import { clientRecipients } from '../lib/clientEmailContent'
import { useLang, pickLang } from '../hooks/useLang'
import { maskEmail } from '../lib/contactMask'

const adminName = () => { try { return JSON.parse(localStorage.getItem('kp_user') || '{}')?.name || 'admin' } catch { return 'admin' } }
const todayJst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)

async function readJson(r) {
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `Erro ${r.status}`)
  return data
}

/** Loads the per-client settings once for a list. */
export function useClientEmailSettings() {
  const [state, setState] = useState({ settings: { clients: {} }, mode: 'test', loaded: false, error: '' })
  const reload = () => apiFetch('/api/client-email?op=settings').then(readJson)
    .then(d => setState({ settings: d.settings || { clients: {} }, mode: d.mode || 'test', loaded: true, error: '' }))
    .catch(e => setState(s => ({ ...s, loaded: true, error: e.message })))
  useEffect(() => { reload() }, [])
  const setOne = (id, setting) => setState(s => ({ ...s, settings: { ...s.settings, clients: { ...s.settings.clients, [id]: setting } } }))
  return { ...state, reload, setOne }
}

/** The switch shown on each client card and in the client form. */
export function ClientEmailToggle({ client, setting, onChange, compact = false }) {
  const { lang } = useLang()
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const [busy, setBusy] = useState(false)
  const to = clientRecipients(client)
  const on = !!setting?.enabled
  const noEmail = !to.length

  const save = async (enabled, emailLang = setting?.lang || 'ja') => {
    if (enabled && noEmail) return toast.error(L('This client has no e-mail. Add the e-mail in Edit first.', 'メールが登録されていません。先に編集でメールを登録してください。', 'Este cliente não tem e-mail cadastrado. Cadastre o e-mail em Editar antes de ligar.'))
    setBusy(true)
    try {
      const d = await apiPost('/api/client-email?op=toggle', { clientId: client.id, enabled, lang: emailLang, by: adminName() }).then(readJson)
      onChange?.(client.id, d.setting)
      toast.success(enabled ? L('Confirmation e-mail ON', '確認メール：オン', 'E-mail de confirmação LIGADO') : L('Confirmation e-mail OFF', '確認メール：オフ', 'E-mail de confirmação DESLIGADO'))
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  return (
    <div className={`client-email-row${on ? ' on' : ''}`}>
      <label className="client-email-switch" title={noEmail ? L('No e-mail registered for this client', 'メール未登録', 'Cliente sem e-mail cadastrado') : ''}>
        <input type="checkbox" role="switch" checked={on} disabled={busy || (noEmail && !on)} onChange={e => save(e.target.checked)} />
        <span className="client-email-knob" aria-hidden="true" />
        <span>📧 {L('Send confirmation e-mail with reports', '報告書付きの確認メールを送る', 'Enviar e-mail de confirmação com relatórios')}</span>
      </label>
      <span className={`badge ${on ? 'badge-green' : 'badge-gray'}`}>{on ? L('ON', 'オン', 'LIGADO') : L('OFF', 'オフ', 'DESLIGADO')}</span>
      {!compact && on && (
        <select value={setting?.lang || 'ja'} disabled={busy} onChange={e => save(true, e.target.value)} aria-label={L('E-mail language', 'メールの言語', 'Idioma do e-mail')}>
          <option value="ja">日本語</option><option value="en">English</option><option value="pt">Português</option>
        </select>
      )}
      <div className="client-email-hint">
        {noEmail
          ? L('Cannot be turned on: the client has no e-mail registered.', 'メールが登録されていないためオンにできません。', 'Não dá para ligar: o cliente não tem e-mail cadastrado.')
          : on
            ? L(`To: ${to.map(maskEmail).join(', ')} · one e-mail when the day's services are done, and one per spot.`, `宛先：${to.map(maskEmail).join('、')}・その日の作業が全部終わったら1通、スポットは1件ごと。`, `Para: ${to.map(maskEmail).join(', ')} · um e-mail quando todos os serviços do dia terminam, e um por spot.`)
            : L(`Off: no e-mail is sent. Will go to ${to.map(maskEmail).join(', ')}.`, `オフ：メールは送りません。宛先は ${to.map(maskEmail).join('、')}。`, `Desligado: nenhum e-mail é enviado. Iria para ${to.map(maskEmail).join(', ')}.`)}
      </div>
    </div>
  )
}

const TRIGGER = { day: ['Day', '1日分', 'Dia'], spot: ['Spot', 'スポット', 'Spot'], resend: ['Resent', '再送', 'Reenvio'] }
const STATUS = {
  sent: ['Sent', '送信済み', 'Enviado', 'badge-green'],
  test: ['Test (not sent)', 'テスト（未送信）', 'Teste (não enviado)', 'badge-amber'],
  failed: ['Failed', '失敗', 'Falhou', 'badge-red'],
}

/** "E-mails enviados" tab: the log + "Reenviar relatório do dia". */
export function ClientEmailLog({ clients, mode }) {
  const { lang } = useLang()
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const [log, setLog] = useState(null)
  const [err, setErr] = useState('')
  const [clientId, setClientId] = useState('')
  const [date, setDate] = useState(todayJst())
  const [busy, setBusy] = useState('')
  const [preview, setPreview] = useState(null)

  const load = () => apiFetch('/api/client-email?op=log').then(readJson).then(d => { setLog(d.log || []); setErr('') }).catch(e => { setErr(e.message); setLog([]) })
  useEffect(() => { load() }, [])

  const run = async op => {
    if (!clientId) return toast.error(L('Pick the client', '顧客を選んでください', 'Escolha o cliente'))
    setBusy(op)
    try {
      const d = await apiPost(`/api/client-email?op=${op}`, { clientId, date, by: adminName() }).then(readJson)
      if (op === 'preview') setPreview(d.result)
      else {
        const st = d.result?.status
        toast[st === 'failed' ? 'error' : 'success'](st === 'failed' ? `${L('Failed', '失敗', 'Falhou')}: ${d.result.reason}` : st === 'test' ? L('Test mode: logged, not sent to the client', 'テストモード：記録のみ（お客様には送信していません）', 'Modo de teste: registrado, não enviado ao cliente') : L('Sent', '送信しました', 'Enviado'))
        load()
      }
      if (d.pending) toast(L(`${d.pending} service(s) of this day are not finished yet`, `この日の未完了の作業が${d.pending}件あります`, `${d.pending} serviço(s) deste dia ainda não terminaram`), { icon: '⏳' })
    } catch (e) { toast.error(e.message) } finally { setBusy('') }
  }

  const fmt = iso => (iso ? new Date(iso).toLocaleString(lang === 'ja' ? 'ja-JP' : lang === 'pt' ? 'pt-BR' : 'en-GB', { timeZone: 'Asia/Tokyo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')
  const nameOf = id => clients.find(c => c.id === id)?.company_name

  return (
    <div>
      <div className={`card client-email-mode ${mode === 'live' ? 'live' : 'test'}`}>
        {mode === 'live'
          ? <>✅ {L('Live: e-mails go to the clients that are ON.', '本番：オンのお客様にメールを送信します。', 'Ativo: os e-mails vão para os clientes LIGADOS.')}</>
          : <>🧪 {L('Test mode: no e-mail goes out to clients. Each e-mail is only built and logged here (you can open it). To really send, the e-mail service must be set up on the server.', 'テストモード：お客様にはメールを送りません。メールは作成してここに記録するだけです（開いて確認できます）。実際に送るにはサーバーでメール送信の設定が必要です。', 'Modo de teste: nenhum e-mail sai para clientes. Cada e-mail é só montado e registrado aqui (dá para abrir e ver). Para enviar de verdade, falta configurar o serviço de e-mail no servidor.')}</>}
      </div>

      <div className="card">
        <div className="card-title">🔁 {L('Resend the day report', '1日分の報告を再送', 'Reenviar relatório do dia')}</div>
        <div className="client-email-resend">
          <select value={clientId} onChange={e => setClientId(e.target.value)}>
            <option value="">— {L('Client', '顧客', 'Cliente')} —</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          <button className="btn btn-sm" disabled={!!busy} onClick={() => run('preview')}>{busy === 'preview' ? '…' : `👁 ${L('See first (does not send)', '先に見る（送信しない）', 'Ver antes (não envia)')}`}</button>
          <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => run('resend')}>{busy === 'resend' ? '…' : `📧 ${L('Resend', '再送', 'Reenviar')}`}</button>
        </div>
        <div className="client-email-hint">{L('Uses the finished services of that day (services marked “not done” go on a separate line). Useful when a job was registered later with “Já fiz”.', 'その日に完了した作業で作ります（未実施は別の行）。「Já fiz」で後から登録した時に使います。', 'Usa os serviços concluídos daquele dia (os “não feito” vão numa linha separada). Serve para quando um serviço foi registrado depois com “Já fiz”.')}</div>
        {preview && (
          <div className="client-email-preview">
            <div><b>{preview.subject}</b></div>
            <div className="client-email-hint">{L('To', '宛先', 'Para')}: {(preview.to || []).map(maskEmail).join(', ') || '—'} · {preview.services} {L('services', '件', 'serviços')}{preview.not_done ? ` · ${preview.not_done} ${L('not done', '未実施', 'não feito')}` : ''} · {preview.delivery === 'pdf' ? 'PDF' : L('portal link', 'ポータルのリンク', 'link do portal')}{preview.pdf_error ? ` (${preview.pdf_error})` : ''}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
              {preview.html_url && <a className="btn btn-sm" href={preview.html_url} target="_blank" rel="noreferrer">✉️ {L('Open e-mail', 'メールを開く', 'Abrir e-mail')}</a>}
              {preview.pdf_url && <a className="btn btn-sm" href={preview.pdf_url} target="_blank" rel="noreferrer">📄 PDF</a>}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>📧 {L('E-mails sent', '送信したメール', 'E-mails enviados')}</span>
          <button className="btn btn-sm" onClick={load}>↻</button>
        </div>
        {err && <div className="client-email-hint" style={{ color: 'var(--red)' }}>{err}</div>}
        {log === null && <div className="kp-skel kp-skel-row" />}
        {log && !log.length && !err && <div className="client-email-hint">{L('Nothing yet. When a client that is ON finishes the day (or a spot), the e-mail shows up here.', 'まだありません。オンのお客様の作業が1日分終わると（またはスポット）、ここに表示されます。', 'Nada ainda. Quando um cliente LIGADO terminar o dia (ou um spot), o e-mail aparece aqui.')}</div>}
        <div className="client-email-log">
          {(log || []).map(e => {
            const st = STATUS[e.status] || [e.status, e.status, e.status, 'badge-gray']
            return (
              <div key={e.id} className="client-email-item">
                <div className="client-email-item-top">
                  <span className="client-email-when">{fmt(e.at)}</span>
                  <b>{e.client_name || nameOf(e.client_id) || '—'}</b>
                  <span className="badge badge-gray">{L(...(TRIGGER[e.trigger] || [e.trigger, e.trigger, e.trigger]))}{e.date ? ` · ${e.date}` : ''}</span>
                  <span className={`badge ${st[3]}`}>{L(st[0], st[1], st[2])}</span>
                </div>
                <div className="client-email-hint">{L('To', '宛先', 'Para')}: {(e.to || []).map(maskEmail).join(', ') || '—'}{e.services != null ? ` · ${e.services} ${L('services', '件', 'serviços')}` : ''}{e.not_done ? ` · ${e.not_done} ${L('not done', '未実施', 'não feito')}` : ''}{e.by && e.by !== 'auto' ? ` · ${e.by}` : ''}</div>
                {e.reason && <div className="client-email-hint">{e.status === 'failed' ? '⚠️ ' : ''}{e.reason}</div>}
                {(e.html_url || e.pdf_url) && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    {e.html_url && <a href={e.html_url} target="_blank" rel="noreferrer">✉️ {L('E-mail', 'メール', 'E-mail')}</a>}
                    {e.pdf_url && <a href={e.pdf_url} target="_blank" rel="noreferrer">📄 PDF</a>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
