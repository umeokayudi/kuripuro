// v1.0.234 · Ligações: today's call queue (one tap per result), the base of target companies and
// the meeting-request e-mails. Used by the seller portal and by the admin (Sales Team).
import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { pickLang } from '../hooks/useLang'
import { salesGet, salesPost } from '../lib/salesApi'
import { CALL_RESULTS, CALL_RESULT_ORDER, EMAIL_TEMPLATES, parseTargetText } from '../lib/salesOutreach'
import './sales-outreach.css'

const fmtDay = (d, lang) => {
  if (!d) return ''
  const [y, m, day] = String(d).split('-').map(Number)
  return lang === 'ja' ? `${m}月${day}日` : lang === 'pt' ? `${String(day).padStart(2, '0')}/${String(m).padStart(2, '0')}${y !== new Date().getFullYear() ? `/${y}` : ''}` : new Date(y, m - 1, day).toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

export default function SalesOutreach({ lang = 'pt', isAdmin = false, sellers = [], onChanged }) {
  const L = useCallback((en, ja, pt) => pickLang(lang, en, ja, pt), [lang])
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [view, setView] = useState('queue')
  const [busy, setBusy] = useState('')
  const [notes, setNotes] = useState({})
  const [noteOpen, setNoteOpen] = useState('')

  const load = useCallback(async () => {
    try { setData(await salesGet('/api/sales-data?action=outreach', lang)); setError('') } catch (e) { setError(e.message) }
  }, [lang])
  useEffect(() => { load() }, [load])

  const result = async (row, key) => {
    setBusy(row.id)
    try {
      const r = await salesPost('/api/sales-data', { action: 'call-result', lead_id: row.id, result: key, note: notes[row.id] || '' }, lang)
      const spec = CALL_RESULTS[key]
      toast.success(`${row.company_name}: ${spec[lang] || spec.pt}${r.next_followup_date ? ` · ${L('back on', '次回', 'volta em')} ${fmtDay(r.next_followup_date, lang)}` : ''}`)
      // the card leaves at once; the list is reloaded behind it
      setData(d => d ? { ...d, queue: d.queue.filter(q => q.id !== row.id), queue_total: Math.max(0, d.queue_total - 1), done_today: d.done_today + 1 } : d)
      setNoteOpen('')
      if (spec.promote) onChanged?.()
      load()
    } catch (e) { toast.error(e.message) }
    setBusy('')
  }

  const reasonLabel = r => ({
    late: L('Call-back overdue', '折り返し期限切れ', 'Retorno atrasado'), due: L('Call back today', '本日折り返し', 'Retorno para hoje'),
    funnel: L('In conversation', '商談中', 'Em conversa'), new: L('Never called', '未架電', 'Nunca ligado'),
    again: L('Try again', '再架電', 'Tentar de novo'), base: L('Base', 'リスト', 'Base'),
  }[r] || '')

  if (error) return <div className="fa-card so-empty"><p>{error}</p><button type="button" className="btn" onClick={load}>{L('Try again', '再試行', 'Tentar de novo')}</button></div>
  if (!data) return <div className="fa-card so-empty">{L('Loading…', '読み込み中…', 'Carregando…')}</div>

  return (
    <div className="so">
      <div className="fa-screen-head so-head">
        <h2>{L('Calls', '架電', 'Ligações')}</h2>
        <p className="so-sub">{L(`${data.queue_total} to call today · ${data.done_today} done`, `本日 ${data.queue_total}件 · 完了 ${data.done_today}件`, `${data.queue_total} para ligar hoje · ${data.done_today} feitas`)}</p>
      </div>
      <div className="so-tabs" role="tablist">
        {[['queue', L('Today’s queue', '本日のリスト', 'Fila de hoje'), data.queue_total], ['base', L('Target companies', 'ターゲット企業', 'Empresas-alvo'), data.targets.length], ['email', L('E-mails', 'メール', 'E-mails'), null]].map(([k, label, n]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} className={`so-tab${view === k ? ' active' : ''}`} onClick={() => setView(k)}>{label}{n != null && <span className="so-count">{n}</span>}</button>
        ))}
      </div>

      {view === 'queue' && (
        <div className="so-list">
          {!data.queue.length && (
            <div className="fa-card so-empty">
              <strong>{L('Nothing left to call today.', '本日の架電は完了です。', 'Nada mais para ligar hoje.')}</strong>
              <p>{data.targets.length ? L('Companies come back here on the day you set.', '設定した日にここへ戻ります。', 'As empresas voltam para cá no dia marcado.') : L('Add companies in “Target companies” to build the queue.', '「ターゲット企業」に企業を追加してください。', 'Adicione empresas em “Empresas-alvo” para montar a fila.')}</p>
              {!data.targets.length && <button type="button" className="btn btn-primary" onClick={() => setView('base')}>{L('Add companies', '企業を追加', 'Adicionar empresas')}</button>}
            </div>
          )}
          {data.queue.map((row, i) => {
            const phone = row.contact_phone || row.phone
            return (
              <article key={row.id} className={`fa-card so-card${busy === row.id ? ' is-busy' : ''}`}>
                <header className="so-card-head">
                  <span className="so-rank">{i + 1}</span>
                  <div className="so-who">
                    <strong>{row.company_name}</strong>
                    <span>{[row.site_name, row.contact_name, row.region || row.industry].filter(Boolean).join(' · ') || '—'}</span>
                  </div>
                  <span className={`so-chip r-${row.priority.reason}`}>{reasonLabel(row.priority.reason)}</span>
                </header>
                {row.last_call && <p className="so-last">{L('Last call', '前回', 'Última ligação')}: {fmtDay(row.last_call.date, lang)} · {(Object.values(CALL_RESULTS).find(c => c.tag === row.last_call.tag) || {})[lang] || row.last_call.tag || ''}{row.calls > 1 ? ` · ${row.calls}×` : ''}</p>}
                {row.notes && <p className="so-note-text">{row.notes}</p>}
                <a className="so-call" href={`tel:${String(phone).replace(/[^\d+]/g, '')}`}>{L('Call', '電話する', 'Ligar')} <span>{phone}</span></a>
                <div className="so-results" aria-label={L('Result of the call', '結果', 'Resultado da ligação')}>
                  {CALL_RESULT_ORDER.map(k => (
                    <button key={k} type="button" className={`so-res s-${CALL_RESULTS[k].sentiment}`} disabled={!!busy} onClick={() => result(row, k)}>{CALL_RESULTS[k][lang] || CALL_RESULTS[k].pt}</button>
                  ))}
                </div>
                {noteOpen === row.id
                  ? <input className="so-note" autoFocus value={notes[row.id] || ''} onChange={e => setNotes(n => ({ ...n, [row.id]: e.target.value }))} placeholder={L('Note (saved with the result you tap)', 'メモ（結果と一緒に保存）', 'Anotação (salva junto com o resultado que você tocar)')} />
                  : <button type="button" className="fa-link so-note-btn" onClick={() => setNoteOpen(row.id)}>{L('+ note', '+ メモ', '+ anotação')}</button>}
              </article>
            )
          })}
          {data.queue_total > data.queue.length && <p className="so-more">{L(`Showing the first ${data.queue.length} of ${data.queue_total}.`, `${data.queue_total}件中 ${data.queue.length}件を表示。`, `Mostrando as primeiras ${data.queue.length} de ${data.queue_total}.`)}</p>}
        </div>
      )}

      {view === 'base' && <TargetBase data={data} lang={lang} L={L} isAdmin={isAdmin} sellers={sellers} onDone={load} />}
      {view === 'email' && <OutreachEmail data={data} lang={lang} L={L} onDone={load} />}
    </div>
  )
}

function TargetBase({ data, lang, L, isAdmin, sellers, onDone }) {
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(!data.targets.length)
  const [owner, setOwner] = useState('')
  const [mine, setMine] = useState(false)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const rows = useMemo(() => parseTargetText(text), [text])
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase()
    return data.targets.filter(t => !k || [t.company_name, t.site_name, t.phone, t.email, t.region, t.address].some(v => String(v || '').toLowerCase().includes(k)))
  }, [data.targets, q])
  const save = async () => {
    setBusy(true)
    try {
      const r = await salesPost('/api/sales-data', { action: 'targets-import', rows, salesperson_id: owner || null, mine }, lang)
      toast.success(L(`${r.added} added${r.duplicates ? ` · ${r.duplicates} already in the system` : ''}`, `${r.added}件追加${r.duplicates ? ` · 重複 ${r.duplicates}件` : ''}`, `${r.added} adicionadas${r.duplicates ? ` · ${r.duplicates} já estavam no sistema` : ''}`))
      setText(''); setAdding(false); onDone()
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }
  return (
    <div className="so-list">
      <section className="fa-card">
        <div className="fa-card-head"><h2>{L('Target companies', 'ターゲット企業', 'Empresas-alvo')} · {data.targets.length}</h2>
          <button type="button" className="fa-link" onClick={() => setAdding(a => !a)}>{adding ? L('Close', '閉じる', 'Fechar') : L('+ Add companies', '+ 企業を追加', '+ Adicionar empresas')}</button></div>
        <p className="so-sub">{L('Companies you want as clients. They stay out of the funnel until someone answers with interest; then they enter it with whoever called.', '顧客にしたい企業のリスト。興味を示すまでファネルには入りません。', 'Empresas que você quer como cliente. Ficam fora do funil até alguém atender com interesse; aí entram no funil com quem ligou.')}</p>
        {adding && (
          <div className="so-import">
            <label className="so-label" htmlFor="so-paste">{L('Paste the list (one company per line)', 'リストを貼り付け（1行1社）', 'Cole a lista (uma empresa por linha)')}</label>
            <textarea id="so-paste" rows={7} value={text} onChange={e => setText(e.target.value)} placeholder={L('Company, phone, e-mail, address\nor paste straight from a spreadsheet (with the header line: Company, Phone, E-mail, Address, Area, Contact)', '会社名, 電話, メール, 住所\nまたは表計算から貼り付け', 'Empresa, telefone, e-mail, endereço\nou cole direto da planilha (com a linha de títulos: Empresa, Telefone, E-mail, Endereço, Região, Contato)')} />
            {rows.length > 0 && (
              <div className="so-preview">
                <strong>{L(`${rows.length} companies read`, `${rows.length}社を読み取りました`, `${rows.length} empresas lidas`)}</strong>
                <span>{rows.filter(r => r.phone).length} {L('with phone', '電話あり', 'com telefone')} · {rows.filter(r => r.email).length} {L('with e-mail', 'メールあり', 'com e-mail')}</span>
                <ul>{rows.slice(0, 4).map((r, i) => <li key={i}>{r.company_name}{r.phone ? ` · ${r.phone}` : ''}{r.email ? ` · ${r.email}` : ''}</li>)}{rows.length > 4 && <li>…</li>}</ul>
              </div>
            )}
            {isAdmin
              ? <label className="so-label">{L('Who will call', '担当', 'Quem vai ligar')}
                <select value={owner} onChange={e => setOwner(e.target.value)}>
                  <option value="">{L('Shared base (any seller)', '共有（全営業）', 'Base compartilhada (qualquer vendedor)')}</option>
                  {sellers.filter(s => s.is_active !== false && s.team !== 'marketing').map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select></label>
              : <label className="so-check"><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} /> {L('Only I call these companies', '自分だけが架電する', 'Só eu ligo para estas empresas')}</label>}
            <button type="button" className="btn btn-primary" disabled={!rows.length || busy} onClick={save}>{busy ? L('Saving…', '保存中…', 'Salvando…') : L(`Add ${rows.length || ''} to the base`, `${rows.length || ''}社を追加`, `Adicionar ${rows.length || ''} à base`)}</button>
          </div>
        )}
      </section>
      {data.targets.length > 0 && (
        <section className="fa-card">
          <input className="so-search" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={L('Search company, phone, area…', '会社名・電話・エリアで検索', 'Buscar empresa, telefone, região…')} aria-label={L('Search', '検索', 'Buscar')} />
          <ul className="so-base">
            {shown.slice(0, 80).map(t => (
              <li key={t.id}>
                <div><strong>{t.company_name}</strong><span>{[t.site_name, t.region || t.address, t.phone, t.email].filter(Boolean).join(' · ') || '—'}</span></div>
                <span className="so-base-meta">{t.calls ? `${t.calls}× · ${fmtDay(t.last_call?.date, lang)}` : L('not called', '未架電', 'sem ligação')}{t.opted_out ? ` · ${L('no e-mail', 'メール不可', 'sem e-mail')}` : ''}</span>
              </li>
            ))}
          </ul>
          {shown.length > 80 && <p className="so-more">{L(`Showing 80 of ${shown.length}. Use the search.`, `${shown.length}件中80件を表示。`, `Mostrando 80 de ${shown.length}. Use a busca.`)}</p>}
        </section>
      )}
    </div>
  )
}

function OutreachEmail({ data, lang, L, onDone }) {
  const tpl = EMAIL_TEMPLATES.ja
  const [tplLang, setTplLang] = useState('ja')
  const [subject, setSubject] = useState(tpl.subject)
  const [body, setBody] = useState(tpl.body)
  const [picked, setPicked] = useState(() => new Set())
  const [busy, setBusy] = useState('')
  const [preview, setPreview] = useState(null)
  const [report, setReport] = useState(null)
  const set = data.email
  const day14 = useMemo(() => { const d = new Date(`${data.today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 14); return d.toISOString().slice(0, 10) }, [data.today])
  const candidates = useMemo(() => [...data.targets, ...data.queue.filter(q => q.stage !== 'target')]
    .filter((r, i, a) => a.findIndex(x => x.id === r.id) === i)
    .filter(r => (r.contact_email || r.email) && !r.opted_out && !(r.last_email && r.last_email >= day14)), [data, day14])
  const blocked = data.targets.filter(r => r.opted_out).length
  const useTpl = k => { setTplLang(k); setSubject(EMAIL_TEMPLATES[k].subject); setBody(EMAIL_TEMPLATES[k].body) }
  const toggle = id => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const pickAll = () => setPicked(p => p.size ? new Set() : new Set(candidates.slice(0, set.left_today || set.limit).map(c => c.id)))
  const send = async dry => {
    if (!dry && !window.confirm(L(`Send this e-mail to ${picked.size} companies now?`, `${picked.size}社にメールを送信しますか？`, `Enviar este e-mail para ${picked.size} empresas agora?`))) return
    setBusy(dry ? 'preview' : 'send')
    try {
      const r = await salesPost('/api/sales-data', { action: 'outreach-email', lead_ids: [...picked], subject, body, dry_run: dry }, lang)
      if (dry || !r.live) setPreview(r.results.find(x => x.status === 'preview') || null)
      setReport(r)
      if (r.sent) { toast.success(L(`${r.sent} sent`, `${r.sent}件送信`, `${r.sent} enviados`)); setPicked(new Set()); onDone() }
    } catch (e) { toast.error(e.message) }
    setBusy('')
  }
  return (
    <div className="so-list">
      <section className="fa-card">
        <div className="fa-card-head"><h2>{L('Meeting-request e-mail', '面談依頼メール', 'E-mail pedindo reunião')}</h2></div>
        {set.configured
          ? <p className="so-sub">{L(`Sent from ${set.from} · ${set.left_today} of ${set.limit} left today.`, `送信元 ${set.from} · 本日残り ${set.left_today}/${set.limit}`, `Sai de ${set.from} · restam ${set.left_today} de ${set.limit} hoje.`)}</p>
          : <p className="so-warn">{L('Test mode: nothing is sent yet. You can write, choose companies and see exactly what would go out. Sending starts when the office sets the sales e-mail address (separate domain).', 'テストモード：まだ送信されません。送信内容の確認のみ可能です。', 'Modo de teste: nada é enviado ainda. Dá para escrever, escolher as empresas e ver exatamente o que sairia. O envio começa quando o escritório cadastrar o endereço de e-mail de vendas (domínio separado).')}</p>}
        <div className="so-tpl">
          {[['ja', '日本語'], ['pt', 'Português'], ['en', 'English']].map(([k, label]) => <button key={k} type="button" className={`so-tab${tplLang === k ? ' active' : ''}`} onClick={() => useTpl(k)}>{label}</button>)}
        </div>
        <label className="so-label">{L('Subject', '件名', 'Assunto')}<input value={subject} onChange={e => setSubject(e.target.value)} /></label>
        <label className="so-label">{L('Text', '本文', 'Texto')}<textarea rows={11} value={body} onChange={e => setBody(e.target.value)} /></label>
        <p className="so-hint">{L('{company}, {contact} and {seller} are filled in for each company. Every e-mail ends with the company name and a link to stop receiving.', '{会社名} {担当者} {営業担当} は自動で入ります。配信停止リンクが必ず付きます。', '{empresa}, {contato} e {vendedor} são preenchidos para cada empresa. Todo e-mail termina com o nome da empresa e um link para parar de receber.')}</p>
      </section>
      <section className="fa-card">
        <div className="fa-card-head"><h2>{L('Who receives', '送信先', 'Quem recebe')} · {picked.size}</h2>
          {candidates.length > 0 && <button type="button" className="fa-link" onClick={pickAll}>{picked.size ? L('Clear', 'クリア', 'Limpar') : L(`Pick the first ${Math.min(candidates.length, set.left_today || set.limit)}`, `先頭${Math.min(candidates.length, set.left_today || set.limit)}社を選択`, `Marcar as primeiras ${Math.min(candidates.length, set.left_today || set.limit)}`)}</button>}</div>
        {!candidates.length && <p className="so-sub">{L('No company with an e-mail is waiting. Companies that received one in the last 14 days or asked to stop do not appear.', 'メール送信可能な企業がありません。', 'Nenhuma empresa com e-mail esperando. Quem recebeu nos últimos 14 dias ou pediu para parar não aparece.')}</p>}
        <ul className="so-base so-pick">
          {candidates.slice(0, 200).map(c => (
            <li key={c.id}><label><input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} /><div><strong>{c.company_name}</strong><span>{c.contact_email || c.email}{c.last_email ? ` · ${L('last', '前回', 'último')} ${fmtDay(c.last_email, lang)}` : ''}</span></div></label></li>
          ))}
        </ul>
        {blocked > 0 && <p className="so-hint">{L(`${blocked} asked to stop receiving and are left out.`, `${blocked}社は配信停止済みです。`, `${blocked} pediram para não receber e ficam de fora.`)}</p>}
        <div className="so-actions">
          <button type="button" className="btn" disabled={!picked.size || !!busy} onClick={() => send(true)}>{busy === 'preview' ? '…' : L('See what goes out', '送信内容を確認', 'Ver o que sai')}</button>
          {set.configured && <button type="button" className="btn btn-primary" disabled={!picked.size || !!busy} onClick={() => send(false)}>{busy === 'send' ? L('Sending…', '送信中…', 'Enviando…') : L(`Send to ${picked.size}`, `${picked.size}社に送信`, `Enviar para ${picked.size}`)}</button>}
        </div>
        {preview && <div className="so-mail"><div className="so-mail-to">{L('To', '宛先', 'Para')}: {preview.to}</div><strong>{preview.subject}</strong><pre>{preview.body}</pre></div>}
        {report && report.results.some(r => r.status === 'skipped' || r.status === 'failed') && (
          <ul className="so-report">{report.results.filter(r => r.status === 'skipped' || r.status === 'failed').map(r => <li key={r.lead_id}>{r.company_name}: {r.reason}</li>)}</ul>
        )}
      </section>
    </div>
  )
}
