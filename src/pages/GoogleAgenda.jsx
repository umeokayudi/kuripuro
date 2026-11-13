// v1.0.179 · Google Agenda: one button reads the connected Google calendars, the AI turns each
// event into a service (place, type, employee, times, details), the admin checks the preview and
// creates them. Settings: company tag on every event, auto sync, which accounts/calendars.
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useLang } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { notifyCreated } from '../lib/assignOps'
import { DEEP_TASKS } from '../lib/cleaningType'
import { draftProblems, draftTitle, finishDraft, tagTitle } from '../lib/googleAgendaSync.js'
import {
  googleStatus, saveGoogleSettings, updateGoogleAccount, disconnectGoogleAccount, googleInviteLink,
  previewGoogleEvents, importGoogleDrafts, ignoreGoogleEvents, syncGoogleNow, googleConnectUrl,
} from '../lib/googleAgenda'
import './google-agenda.css'

const COLORS = [
  ['1', '#7986cb'], ['2', '#33b679'], ['3', '#8e24aa'], ['4', '#e67c73'], ['5', '#f6bf26'], ['6', '#f4511e'],
  ['7', '#039be5'], ['8', '#616161'], ['9', '#3f51b5'], ['10', '#0b8043'], ['11', '#d50000'],
]
const addDays = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10) }
const fmtWhen = (d, lang) => {
  if (!d?.date) return ''
  const day = new Date(`${d.date}T12:00:00+09:00`).toLocaleDateString(lang === 'ja' ? 'ja-JP' : lang === 'pt' ? 'pt-BR' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Tokyo' })
  return `${day}${d.time ? ` · ${d.time}${d.end_time ? `–${d.end_time}` : ''}` : ''}`
}
const fmtAgo = iso => iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'Asia/Tokyo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

export default function GoogleAgenda() {
  const { tr, lang } = useLang()
  const [params, setParams] = useSearchParams()
  const today = tokyoToday()
  const [state, setState] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [employees, setEmployees] = useState([])
  const [settings, setSettings] = useState(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [range, setRange] = useState({ from: today, to: addDays(today, 60), preset: '60' })
  const [busy, setBusy] = useState('')
  const [drafts, setDrafts] = useState([])
  const [ctx, setCtx] = useState({ places: [], employees: [], clients: [] })
  const [picked, setPicked] = useState(new Set())
  const [open, setOpen] = useState(null)
  const [info, setInfo] = useState(null)

  const load = async () => {
    try {
      const s = await googleStatus()
      setState(s); setSettings(s.settings); setLoadError(null)
      if (!drafts.length && s.pending?.length) applyDrafts(s.pending)
    } catch (e) { setLoadError(e) }
  }
  useEffect(() => {
    load()
    supabase.from('employees').select('id,full_name,email').eq('is_active', true).order('full_name').then(({ data }) => setEmployees(data || []))
    const connected = params.get('connected')
    if (connected) { toast.success(tr(`Connected: ${connected}`, `接続しました: ${connected}`, `Conectada: ${connected}`)); params.delete('connected'); setParams(params, { replace: true }) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Places / employees for the edit fields (from the preview, or loaded here for stored drafts).
  useEffect(() => {
    if (ctx.places.length) return
    Promise.all([
      supabase.from('locations').select('id,name,address,client_id,is_active'),
      supabase.from('clients').select('id,company_name'),
    ]).then(([l, c]) => setCtx(x => x.places.length ? x : {
      places: (l.data || []).filter(p => p.is_active !== false).map(p => ({ ...p, name: p.name.replace(/\s+(—|-)\s+.*$/, '').trim() })),
      employees: employees.map(e => ({ id: e.id, full_name: e.full_name })),
      clients: c.data || [],
    }))
  }, [employees]) // eslint-disable-line react-hooks/exhaustive-deps

  function applyDrafts(list) {
    setDrafts(list)
    setPicked(new Set(list.filter(d => d.is_job && !draftProblems(d).length && d.confidence >= 0.5).map(d => d.key)))
  }

  const ctxFull = useMemo(() => ({ ...ctx, employees: ctx.employees.length ? ctx.employees : employees }), [ctx, employees])
  const editDraft = (key, patch) => setDrafts(list => list.map(d => {
    if (d.key !== key) return d
    const next = finishDraft({ ...d, ...patch, source: d.source }, { ...ctxFull, event: d.event })
    return { ...next, event: d.event, problems: draftProblems(next) }
  }))

  const runPreview = async () => {
    setBusy('preview'); setInfo(null)
    try {
      const r = await previewGoogleEvents({ from: range.from, to: range.to })
      if (r.context) setCtx(r.context)
      applyDrafts(r.drafts || [])
      setInfo(r)
      if (!r.drafts?.length) toast(tr('No new events in this period', 'この期間に新しい予定はありません', 'Nenhum evento novo nesse período'))
      ;(r.errors || []).forEach(e => toast.error(`${e.account}: ${e.error}`))
    } catch (e) { toast.error(e.message) }
    setBusy('')
  }

  const createPicked = async () => {
    const items = drafts.filter(d => picked.has(d.key)).map(d => ({ key: d.key, draft: d }))
    if (!items.length) return
    setBusy('import')
    try {
      const r = await importGoogleDrafts(items)
      if (r.created?.length) {
        notifyCreated(r.created.filter(j => j.job_category !== 'spot')).catch(() => {})
        toast.success(tr(`${r.created.length} services created`, `${r.created.length}件のサービスを作成`, `${r.created.length} serviços criados`))
      }
      ;(r.failed || []).forEach(f => toast.error(`${f.error}`))
      const failed = new Set((r.failed || []).map(f => f.key))
      const done = new Set(items.map(i => i.key).filter(k => !failed.has(k)))
      setDrafts(list => list.filter(d => !done.has(d.key)))
      setPicked(new Set())
    } catch (e) { toast.error(e.message) }
    setBusy('')
  }

  const ignore = async keys => {
    if (!keys.length) return
    setBusy('ignore')
    try {
      await ignoreGoogleEvents(keys)
      setDrafts(list => list.filter(d => !keys.includes(d.key)))
      setPicked(p => new Set([...p].filter(k => !keys.includes(k))))
      toast.success(tr('Ignored — they will not come back', '無視しました（再表示されません）', 'Ignorados — não voltam mais'))
    } catch (e) { toast.error(e.message) }
    setBusy('')
  }

  const saveSettings = async patch => {
    const next = { ...settings, ...patch }
    setSettings(next); setSavingSettings(true)
    try { const r = await saveGoogleSettings(patch); setSettings(r.settings) } catch (e) { toast.error(e.message) }
    setSavingSettings(false)
  }
  const saveAccount = async (acc, patch) => {
    try {
      const r = await updateGoogleAccount(acc.id, patch)
      setState(s => ({ ...s, accounts: s.accounts.map(a => a.id === acc.id ? r.account : a) }))
    } catch (e) { toast.error(e.message) }
  }
  const disconnect = async acc => {
    if (!window.confirm?.(tr(`Disconnect ${acc.google_email}?`, `${acc.google_email} の接続を解除しますか？`, `Desconectar ${acc.google_email}?`))) return
    try { await disconnectGoogleAccount(acc.id); load() } catch (e) { toast.error(e.message) }
  }
  const copyInvite = async emp => {
    try {
      const { url } = await googleInviteLink(emp.id)
      await navigator.clipboard?.writeText(url)
      toast.success(tr(`Link copied — send it to ${emp.full_name}`, `リンクをコピーしました — ${emp.full_name}に送ってください`, `Link copiado — mande para ${emp.full_name}`))
    } catch (e) { toast.error(e.message) }
  }
  const syncNow = async () => {
    setBusy('sync')
    try {
      const r = await syncGoogleNow()
      const sent = (r.exported || []).reduce((n, a) => n + a.created + a.updated, 0)
      toast.success(tr(`Done · ${sent} sent to Google · ${r.pending} waiting · ${r.imported} created`, `完了 · Googleへ${sent}件 · 確認待ち${r.pending}件 · 作成${r.imported}件`, `Pronto · ${sent} enviados ao Google · ${r.pending} esperando você · ${r.imported} criados`))
      load()
    } catch (e) { toast.error(e.message) }
    setBusy('')
  }

  const setPreset = p => {
    if (p === '60') setRange({ from: today, to: addDays(today, 60), preset: p })
    if (p === 'year') setRange({ from: today, to: addDays(today, 365), preset: p })
    if (p === 'all') setRange({ from: addDays(today, -365), to: addDays(today, 365), preset: p })
    if (p === 'custom') setRange(r => ({ ...r, preset: p }))
  }

  const accounts = state?.accounts || []
  const byEmployee = useMemo(() => {
    const m = new Map()
    for (const a of accounts) if (a.owner_kind === 'employee') m.set(a.owner_id, [...(m.get(a.owner_id) || []), a])
    return m
  }, [accounts])
  const jobs = drafts.filter(d => d.is_job)
  const notJobs = drafts.filter(d => !d.is_job)
  const ready = drafts.filter(d => picked.has(d.key))
  const tag = settings?.company_tag || ''
  const off = !state?.configured

  if (loadError?.needsSql) return (
    <div className="ga-page">
      <h2 className="page-head">📅 Google Agenda</h2>
      <div className="card ga-setup">
        <b>{tr('One step left: run the SQL', 'あと1ステップ：SQLを実行', 'Falta um passo: rodar o SQL')}</b>
        <p>{tr('This screen needs the new tables. File:', '新しいテーブルが必要です。ファイル：', 'Esta tela precisa das tabelas novas. Arquivo:')} <code>sql/2026-11-06_google_agenda.sql</code></p>
      </div>
    </div>
  )

  return (
    <div className="ga-page">
      <h2 className="page-head" style={{ marginBottom: 4, fontSize: 22 }}>📅 Google Agenda</h2>
      <p className="ga-sub">{tr('Bring the whole Google Calendar in: the AI turns each event into a service, you check and create. Every service also goes to each person\'s Google Calendar, always marked with the company.',
        'Googleカレンダーをまとめて取り込み、AIが予定ごとにサービスを作成。確認してから作成します。サービスは各スタッフのGoogleカレンダーにも会社名付きで入ります。',
        'Traga a Google Agenda inteira: a IA transforma cada evento em serviço, você confere e cria. Cada serviço também vai para a Google Agenda de cada pessoa, sempre marcado com a empresa.')}</p>

      {loadError && <div className="card ga-setup ga-warn">{loadError.message}</div>}
      {state && <GoogleSetupStatus state={state} tr={tr} mode="top" />}

      {/* 1 · Sync */}
      <div className="card ga-sync">
        <div className="ga-sync-row">
          {[['60', tr('Next 60 days', '今後60日', 'Próximos 60 dias')], ['year', tr('Next 12 months', '今後12か月', 'Próximos 12 meses')], ['all', tr('Whole calendar (±1 year)', '全部（前後1年）', 'Agenda inteira (±1 ano)')], ['custom', tr('Dates', '期間指定', 'Datas')]].map(([k, label]) => (
            <button key={k} type="button" className={`ga-chip${range.preset === k ? ' on' : ''}`} onClick={() => setPreset(k)}>{label}</button>
          ))}
          {range.preset === 'custom' && (
            <span className="ga-dates">
              <input type="date" value={range.from} onChange={e => e.target.value && setRange(r => ({ ...r, from: e.target.value }))} aria-label={tr('From', '開始', 'De')} />
              →
              <input type="date" value={range.to} min={range.from} onChange={e => e.target.value && setRange(r => ({ ...r, to: e.target.value }))} aria-label={tr('To', '終了', 'Até')} />
            </span>
          )}
        </div>
        <button type="button" className="btn btn-primary ga-big" disabled={!!busy || !accounts.length} onClick={runPreview}>
          {busy === 'preview' ? tr('Reading calendar and asking the AI…', 'カレンダーを読み込み、AIが解析中…', 'Lendo a agenda e perguntando à IA…') : `🔄 ${tr('Sync Google Calendar', 'Googleカレンダーを同期', 'Sincronizar Google Agenda')}`}
        </button>
        {!accounts.length && state && <div className="ga-hint">{tr('Connect a Google account below first.', 'まず下でGoogleアカウントを接続してください。', 'Conecte uma conta Google aqui embaixo primeiro.')}</div>}
        {info && <div className="ga-hint">{tr(`${info.total} new events found`, `新しい予定 ${info.total}件`, `${info.total} eventos novos encontrados`)}{info.more ? ` · ${tr(`${info.more} more — sync again after these`, `残り${info.more}件は次回`, `mais ${info.more} — sincronize de novo depois destes`)}` : ''}</div>}
      </div>

      {/* 2 · Preview */}
      {drafts.length > 0 && (
        <div className="card ga-preview">
          <div className="ga-preview-head">
            <b>{tr('Check before creating', '作成前に確認', 'Confira antes de criar')} · {jobs.length} {tr('services', 'サービス', 'serviços')}</b>
            <div className="ga-preview-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set(jobs.filter(d => !d.problems?.length).map(d => d.key)))}>{tr('Select all ready', '準備OKを全選択', 'Marcar todos prontos')}</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy || !ready.length} onClick={() => ignore(ready.map(d => d.key))}>{tr('Ignore selected', '選択を無視', 'Ignorar marcados')}</button>
              <button type="button" className="btn btn-success" disabled={!!busy || !ready.length || ready.some(d => d.problems?.length)} onClick={createPicked}>
                {busy === 'import' ? '…' : `✓ ${tr(`Create ${ready.length} services`, `${ready.length}件作成`, `Criar ${ready.length} serviços`)}`}
              </button>
            </div>
          </div>
          {jobs.map(d => (
            <DraftRow key={d.key} d={d} tr={tr} lang={lang} tag={tag} ctx={ctxFull} picked={picked.has(d.key)} open={open === d.key}
              onPick={v => setPicked(p => { const n = new Set(p); v ? n.add(d.key) : n.delete(d.key); return n })}
              onOpen={() => setOpen(open === d.key ? null : d.key)} onEdit={patch => editDraft(d.key, patch)} onIgnore={() => ignore([d.key])} />
          ))}
          {notJobs.length > 0 && (
            <details className="ga-notjobs">
              <summary>{tr(`${notJobs.length} events that do not look like work`, `仕事ではなさそうな予定 ${notJobs.length}件`, `${notJobs.length} eventos que não parecem serviço`)}</summary>
              {notJobs.map(d => (
                <div key={d.key} className="ga-notjob">
                  <span>{fmtWhen(d.event, lang)} · {d.event?.summary}</span>
                  <span className="ga-notjob-btns">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => editDraft(d.key, { is_job: true })}>{tr('It is a service', 'サービスです', 'É serviço')}</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => ignore([d.key])}>{tr('Ignore', '無視', 'Ignorar')}</button>
                  </span>
                </div>
              ))}
            </details>
          )}
        </div>
      )}

      {/* 3 · Settings */}
      {settings && (
        <div className="card ga-settings">
          <div className="card-title">⚙️ {tr('Settings', '設定', 'Configurações')} {savingSettings && <small className="ga-hint">…</small>}</div>
          <label className="ga-field">
            <span>{tr('Company mark on every event', 'すべての予定に付ける会社名', 'Marca da empresa em todo evento')}</span>
            <input defaultValue={settings.company_tag} maxLength={30} onBlur={e => e.target.value !== settings.company_tag && saveSettings({ company_tag: e.target.value })} />
            <small>{tr('Example:', '例：', 'Exemplo:')} <b>{tagTitle('Loja X — Basic Cleaning', settings.company_tag)}</b></small>
          </label>
          <div className="ga-field">
            <span>{tr('Event colour in Google', 'Googleでの予定の色', 'Cor do evento no Google')}</span>
            <div className="ga-colors">{COLORS.map(([id, hex]) => (
              <button key={id} type="button" aria-label={`cor ${id}`} className={`ga-color${settings.color_id === id ? ' on' : ''}`} style={{ background: hex }} onClick={() => saveSettings({ color_id: id })} />
            ))}</div>
          </div>
          <div className="ga-field">
            <span>{tr('New Google events (automatic)', '新しいGoogle予定（自動）', 'Eventos novos do Google (automático)')}</span>
            <div className="ga-seg">
              {[['off', tr('Do nothing', '何もしない', 'Não fazer nada')], ['preview', tr('AI prepares, I confirm', 'AIが準備、私が確認', 'IA prepara, eu confirmo')], ['create', tr('AI creates when sure', 'AIが確実なら作成', 'IA cria quando tiver certeza')]].map(([k, label]) => (
                <button key={k} type="button" className={`ga-chip${settings.auto_import === k ? ' on' : ''}`} onClick={() => saveSettings({ auto_import: k })}>{label}</button>
              ))}
            </div>
          </div>
          <label className="ga-toggle">
            <input type="checkbox" checked={!!settings.auto_export} onChange={e => saveSettings({ auto_export: e.target.checked })} />
            <span>{tr('Put every service in the Google Calendar of whoever does it', '各サービスを担当者のGoogleカレンダーに入れる', 'Colocar cada serviço na Google Agenda de quem faz')}</span>
          </label>
          <div className="ga-grid2">
            <label className="ga-field"><span>{tr('Days ahead', '何日先まで', 'Dias à frente')}</span>
              <input type="number" min="7" max="180" defaultValue={settings.days_ahead} onBlur={e => Number(e.target.value) !== settings.days_ahead && saveSettings({ days_ahead: Number(e.target.value) })} /></label>
            <label className="ga-field"><span>{tr('Hours per service (no end time)', '1件の時間（終了なし）', 'Horas por serviço (sem fim)')}</span>
              <input type="number" min="0.5" max="12" step="0.5" defaultValue={settings.default_hours} onBlur={e => Number(e.target.value) !== Number(settings.default_hours) && saveSettings({ default_hours: Number(e.target.value) })} /></label>
          </div>
          <div className="ga-hint">{tr('Automatic sync runs when an admin opens KuriPuro (every 30 min) and once a day at 05:30.', '自動同期は管理者がKuriPuroを開いたとき（30分ごと）と毎日05:30に実行。', 'A sincronização automática roda quando um admin abre a KuriPuro (a cada 30 min) e todo dia às 05:30.')}</div>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy || !accounts.length} onClick={syncNow}>{busy === 'sync' ? '…' : `⟳ ${tr('Run automatic sync now', '自動同期を今すぐ実行', 'Rodar sincronização automática agora')}`}</button>
        </div>
      )}

      {/* 4 · Accounts */}
      <div className="card ga-accounts">
        <div className="card-title">👥 {tr('Connected Google accounts', '接続済みGoogleアカウント', 'Contas Google conectadas')}</div>
        {state && !state.configured && <div className="ga-hint ga-off">⚠ {tr('Connecting only works after GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are in Vercel (see the box at the top).', 'VercelにGOOGLE_CLIENT_IDとGOOGLE_CLIENT_SECRETを入れるまで接続できません（上の案内）。', 'Conectar só funciona depois que GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET estiverem no Vercel (veja o quadro lá em cima).')}</div>}
        <a className={`btn btn-primary${off ? ' ga-disabled' : ''}`} aria-disabled={off} href={off ? undefined : googleConnectUrl()}>＋ {tr('Connect my Google account', '自分のGoogleアカウントを接続', 'Conectar minha conta Google')}</a>
        {accounts.filter(a => a.owner_kind === 'admin').map(a => <AccountCard key={a.id} a={a} tr={tr} onSave={p => saveAccount(a, p)} onDisconnect={() => disconnect(a)} />)}
        <div className="ga-emp-head">{tr('Employees', 'スタッフ', 'Funcionários')}</div>
        {employees.map(emp => {
          const list = byEmployee.get(emp.id) || []
          return (
            <div key={emp.id} className="ga-emp">
              <div className="ga-emp-row">
                <b>{emp.full_name}</b>
                {list.length ? <span className="badge badge-green">✓ {list.map(a => a.google_email).join(', ')}</span> : <span className="badge badge-amber">{tr('not connected', '未接続', 'não conectado')}</span>}
                <span className="ga-emp-btns">
                  <button type="button" className="btn btn-ghost btn-sm" disabled={off} onClick={() => copyInvite(emp)}>🔗 {tr('Copy link for them', '本人用リンク', 'Copiar link para a pessoa')}</button>
                  <a className={`btn btn-ghost btn-sm${off ? ' ga-disabled' : ''}`} aria-disabled={off} href={off ? undefined : googleConnectUrl(emp.id)}>{tr('Connect here', 'ここで接続', 'Conectar aqui')}</a>
                </span>
              </div>
              {list.map(a => <AccountCard key={a.id} a={a} tr={tr} onSave={p => saveAccount(a, p)} onDisconnect={() => disconnect(a)} />)}
            </div>
          )
        })}
      </div>

      {/* 5 · v1.0.242: install checklist lives here (closed) once the integration is active */}
      {state && <GoogleSetupStatus state={state} tr={tr} mode="bottom" />}
    </div>
  )
}

/**
 * v1.0.223 · "Integração Google Agenda": is it on, which Vercel keys are missing (names the server really
 * reads), the callback URL to paste in Google Cloud, the steps, and how many employees connected.
 * No key is ever typed here: the owner puts them straight in Vercel.
 */
function GoogleSetupStatus({ state, tr, mode = 'top' }) {
  const setup = state.setup || {}
  const checks = setup.checks || [
    { name: 'GOOGLE_CLIENT_ID', ok: state.configured },
    { name: 'GOOGLE_CLIENT_SECRET', ok: state.configured },
  ]
  const missing = checks.filter(c => !c.ok)
  const on = state.configured && !missing.length
  const [open, setOpen] = useState(!on)
  const [supportOpen, setSupportOpen] = useState(false)
  const copy = async text => {
    try { await navigator.clipboard.writeText(text); toast.success(tr('Copied', 'コピーしました', 'Copiado')) }
    catch { toast(text) }
  }
  const total = setup.employeesTotal
  const connected = setup.employeesConnected ?? 0
  const steps = [
    [tr('Create the project', 'プロジェクトを作成', 'Criar o projeto'), 'https://console.cloud.google.com/projectcreate',
      tr('Name it KuriPuro and click Create.', '名前を KuriPuro にして「作成」。', 'Nome KuriPuro e clique em Criar.')],
    [tr('Turn on the Google Calendar API', 'Google Calendar API を有効にする', 'Ativar a Google Calendar API'), 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com',
      tr('Click Enable.', '「有効にする」をクリック。', 'Clique em Ativar.')],
    [tr('Consent screen', '同意画面', 'Tela de consentimento'), 'https://console.cloud.google.com/auth/overview',
      tr('Get started → name KuriPuro → External → your e-mail. Under Audience → Test users, add your Gmail and each employee\'s.', '開始 → 名前 KuriPuro → 外部 → メール。対象 → テストユーザーにあなたと各スタッフのGmailを追加。', 'Começar → nome KuriPuro → Externo → seu e-mail. Em Público-alvo → Usuários de teste, adicione o seu Gmail e o de cada funcionário.')],
    [tr('Create the OAuth credential', 'OAuth 認証情報を作成', 'Criar a credencial OAuth'), 'https://console.cloud.google.com/auth/clients',
      tr('Create client → Web application. In "Authorized redirect URIs" paste the return URL below.', 'クライアントを作成 → ウェブアプリケーション。「承認済みのリダイレクト URI」に下の戻りURLを貼り付け。', 'Criar cliente → Aplicativo da Web. Em "URIs de redirecionamento autorizados" cole a URL de retorno abaixo.')],
    [tr('Paste the keys in Vercel (Production)', 'Vercel にキーを貼る（Production）', 'Colar as chaves no Vercel (Production)'), 'https://vercel.com/umeokayudis-projects/kuripuro/settings/environment-variables',
      tr('Create GOOGLE_CLIENT_ID with the Client ID and GOOGLE_CLIENT_SECRET with the Client secret. Tick Production.', 'GOOGLE_CLIENT_ID にクライアントID、GOOGLE_CLIENT_SECRET にシークレットを入れ、Production にチェック。', 'Crie GOOGLE_CLIENT_ID com o ID do cliente e GOOGLE_CLIENT_SECRET com a chave secreta. Marque Production.')],
    [tr('Restart the site', 'サイトを再起動', 'Reiniciar o site'), 'https://vercel.com/umeokayudis-projects/kuripuro/deployments',
      tr('Vercel only reads new keys on the next deploy: Promote the next version, or ⋯ → Redeploy on the current Production one. No code change.', 'Vercel は次のデプロイで新しいキーを読み込みます：次のバージョンを Promote するか、今の Production で ⋯ → Redeploy。コード変更は不要。', 'O Vercel só lê chaves novas no próximo deploy: promova a próxima versão ou, na versão de Production atual, ⋯ → Redeploy. Não muda código.')],
  ]
  const renderBody = () => (
    <>
          <div className="ga-int-sec">
            <div className="ga-int-label">{tr('Server keys (Vercel → Environment Variables)', 'サーバーのキー（Vercel → Environment Variables）', 'Chaves no servidor (Vercel → Environment Variables)')}</div>
            {checks.map(c => (
              <div key={c.name} className={`ga-int-check ${c.ok ? 'ok' : 'miss'}`}>
                <span>{c.ok ? '✅' : '❌'}</span>
                <code>{c.name}</code>
                <span className="ga-int-state">{c.ok ? tr('in place', '設定済み', 'cadastrada') : tr('missing', '未設定', 'falta')}</span>
              </div>
            ))}
            <div className="ga-int-check ok"><span>✅</span><span>{tr('Database tables', 'データベースのテーブル', 'Tabelas no banco')}</span><span className="ga-int-state">{tr('in place', '設定済み', 'prontas')}</span></div>
          </div>

          <div className="ga-int-sec">
            <div className="ga-int-label">{tr('Return URL (paste it in Google Cloud)', '戻りURL（Google Cloud に貼る）', 'URL de retorno (cole no Google Cloud)')}</div>
            <div className="ga-int-url">
              <code>{state.redirectUri}</code>
              <button type="button" className="btn btn-sm" onClick={() => copy(state.redirectUri)}>📋 {tr('Copy', 'コピー', 'Copiar')}</button>
            </div>
          </div>

          <div className="ga-int-sec">
            <div className="ga-int-label">{tr('Step by step', '手順', 'Passo a passo')}</div>
            <ol className="ga-int-steps">
              {steps.map(([title, href, text], i) => (
                <li key={i}>
                  <a href={href} target="_blank" rel="noreferrer"><b>{title}</b> ↗</a>
                  <span>{text}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="ga-int-sec">
            <div className="ga-int-label">{tr('Connected', '接続済み', 'Conectados')}</div>
            <p className="ga-int-p">
              {tr(`${connected} employee(s) connected their own Google Calendar`, `${connected} 人のスタッフが自分のGoogleカレンダーを接続`, `${connected} funcionário(s) conectaram a própria Google Agenda`)}
              {total != null ? tr(` out of ${total} active.`, `（有効 ${total} 人中）。`, ` de ${total} ativos.`) : '.'}
              {' '}{setup.adminConnected
                ? tr(`Office: ${setup.adminConnected} account(s).`, `事務所：${setup.adminConnected} アカウント。`, `Escritório: ${setup.adminConnected} conta(s).`)
                : tr('Office: none yet.', '事務所：まだなし。', 'Escritório: nenhuma ainda.')}
            </p>
            {!on && <p className="ga-int-p ga-int-muted">{tr('Until then, the employee button stays grey with "The office is still turning Google on". It turns on by itself after step 6.', 'それまでスタッフのボタンはグレーのままです。手順6の後、自動で使えるようになります。', 'Até lá, o botão do funcionário fica cinza com "O escritório ainda está ativando o Google". Ele liga sozinho depois do passo 6.')}</p>}
          </div>
    </>
  )

  // v1.0.242: active → status banner only (no install block); the block moves to a closed "Instalação e suporte" at the page end.
  // Not active → same as before: banner on top with the checklist open.
  if (on && mode === 'top') return (
    <div className="card ga-int on">
      <div className="ga-int-head ga-int-static">
        <span className="ga-int-dot" aria-hidden="true">✓</span>
        <span className="ga-int-title">
          <b>{tr('Google Calendar integration', 'Googleカレンダー連携', 'Integração Google Agenda')}</b>
          <small>{tr('Active. Employees can connect their own calendar.', '有効。スタッフは自分のカレンダーを接続できます。', 'Ativada. Os funcionários já podem conectar a própria agenda.')}</small>
        </span>
        <span className="ga-int-count" title={tr('Employees with their own calendar connected', '自分のカレンダーを接続したスタッフ', 'Funcionários com a própria agenda conectada')}>
          👥 {connected}{total != null ? ` / ${total}` : ''}
        </span>
      </div>
    </div>
  )
  if (!on && mode === 'bottom') return null
  const wrapBody = on && mode === 'bottom'
  if (wrapBody) return (
    <details className="ga-support" open={supportOpen} onToggle={e => setSupportOpen(e.currentTarget.open)}>
      <summary>{tr('Setup and support', '設定とサポート', 'Instalação e suporte')}</summary>
      <div className="ga-int-body">{renderBody()}</div>
    </details>
  )
  return (
    <div className={`card ga-int ${on ? 'on' : 'off'}`}>
      <button type="button" className="ga-int-head" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <span className="ga-int-dot" aria-hidden="true">{on ? '✓' : '!'}</span>
        <span className="ga-int-title">
          <b>{tr('Google Calendar integration', 'Googleカレンダー連携', 'Integração Google Agenda')}</b>
          <small>{on
            ? tr('Active. Employees can connect their own calendar.', '有効。スタッフは自分のカレンダーを接続できます。', 'Ativada. Os funcionários já podem conectar a própria agenda.')
            : tr(`Not active yet · missing ${missing.map(c => c.name).join(', ')}`, `まだ無効 · 不足: ${missing.map(c => c.name).join(', ')}`, `Ainda não ativada · falta ${missing.map(c => c.name).join(', ')}`)}</small>
        </span>
        <span className="ga-int-count" title={tr('Employees with their own calendar connected', '自分のカレンダーを接続したスタッフ', 'Funcionários com a própria agenda conectada')}>
          👥 {connected}{total != null ? ` / ${total}` : ''}
        </span>
        <span className="ga-int-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>

      {open && <div className="ga-int-body">{renderBody()}</div>}
    </div>
  )
}

function AccountCard({ a, tr, onSave, onDisconnect }) {
  const importing = (a.calendars || []).filter(c => c.import).map(c => c.id)
  const toggleCal = id => onSave({ import_calendars: importing.includes(id) ? importing.filter(x => x !== id) : [...importing, id] })
  return (
    <div className="ga-acc">
      <div className="ga-acc-head">
        <b>📧 {a.google_email}</b>
        {a.owner_kind === 'admin' && <span className="badge badge-navy">admin · {a.owner_name}</span>}
        {a.last_error && <span className="badge badge-red" title={a.last_error}>⚠ {a.last_error.slice(0, 60)}</span>}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDisconnect}>{tr('Disconnect', '解除', 'Desconectar')}</button>
      </div>
      <div className="ga-acc-body">
        <label className="ga-toggle"><input type="checkbox" checked={!!a.import_enabled} onChange={e => onSave({ import_enabled: e.target.checked })} /><span>{tr('Read events from this account', 'このアカウントの予定を読む', 'Ler eventos desta conta')}</span></label>
        {a.import_enabled && (
          <div className="ga-cals">{(a.calendars || []).map(c => (
            <label key={c.id} className={`ga-chip${c.import ? ' on' : ''}`}><input type="checkbox" checked={!!c.import} onChange={() => toggleCal(c.id)} />{c.summary}</label>
          ))}<button type="button" className="btn btn-ghost btn-sm" onClick={() => onSave({ refresh_calendars: true })}>⟳</button></div>
        )}
        <label className="ga-toggle"><input type="checkbox" checked={!!a.export_enabled} onChange={e => onSave({ export_enabled: e.target.checked })} /><span>{a.owner_kind === 'admin' && a.export_scope === 'all' ? tr('Put ALL services in this calendar', '全サービスをこのカレンダーに入れる', 'Colocar TODOS os serviços nesta agenda') : tr('Put this person\'s services in this calendar', 'この人のサービスをカレンダーに入れる', 'Colocar os serviços desta pessoa nesta agenda')}</span></label>
        {a.export_enabled && (
          <div className="ga-grid2">
            <label className="ga-field"><span>{tr('Write into', '書き込み先', 'Gravar em')}</span>
              <select value={a.write_calendar_id} onChange={e => onSave({ write_calendar_id: e.target.value })}>
                {(a.calendars || []).filter(c => c.writable !== false).map(c => <option key={c.id} value={c.primary ? 'primary' : c.id}>{c.summary}</option>)}
              </select></label>
            {a.owner_kind === 'admin' && <label className="ga-field"><span>{tr('Which services', 'どのサービス', 'Quais serviços')}</span>
              <select value={a.export_scope} onChange={e => onSave({ export_scope: e.target.value })}>
                <option value="all">{tr('All services', '全サービス', 'Todos os serviços')}</option>
                <option value="mine">{tr('None (only read)', 'なし（読むだけ）', 'Nenhum (só ler)')}</option>
              </select></label>}
          </div>
        )}
        <div className="ga-hint">{tr('Last read', '最終読込', 'Última leitura')}: {fmtAgo(a.last_import_at)} · {tr('last sent', '最終送信', 'último envio')}: {fmtAgo(a.last_export_at)}</div>
      </div>
    </div>
  )
}

function DraftRow({ d, tr, lang, tag, ctx, picked, open, onPick, onOpen, onEdit, onIgnore }) {
  const problems = d.problems || []
  const conf = Math.round((d.confidence || 0) * 100)
  const tasks = new Set(d.deep_tasks || [])
  return (
    <div className={`ga-draft${problems.length ? ' bad' : ''}`}>
      <div className="ga-draft-row">
        <input type="checkbox" checked={picked} disabled={problems.length > 0} onChange={e => onPick(e.target.checked)} aria-label={tr('Create this', '作成する', 'Criar este')} />
        <button type="button" className="ga-draft-main" onClick={onOpen}>
          <span className="ga-draft-title">{tagTitle(draftTitle(d), tag)}</span>
          <span className="ga-draft-meta">
            {fmtWhen(d, lang)} · 👷 {d.employee_name || <em className="ga-miss">{tr('who?', '担当？', 'quem?')}</em>}
            {d.client_name ? ` · 🏢 ${d.client_name}` : ''}{d.job_category === 'spot' ? ' · ⚡ spot' : ''}{d.value ? ` · ¥${d.value.toLocaleString()}` : ''}
          </span>
          <span className="ga-draft-src">📅 “{d.event?.summary}” {d.event?.calendar_name ? `· ${d.event.owner_name || d.event.calendar_name}` : ''}</span>
        </button>
        <span className={`badge ${conf >= 70 ? 'badge-green' : conf >= 45 ? 'badge-amber' : 'badge-red'}`} title={d.reason}>{d.source === 'ia' ? 'IA' : tr('rules', 'ルール', 'regras')} {conf}%</span>
      </div>
      {problems.length > 0 && <div className="ga-miss-line">{tr('Missing', '不足', 'Falta')}: {problems.join(', ')} — {tr('tap to fill in', 'タップして入力', 'toque para preencher')}</div>}
      {!d.known_place && d.place_name && <div className="ga-hint">➕ {tr('Place not in KuriPuro yet — the service is created with this name', 'KuriPuroにない場所 — この名前で作成されます', 'Local ainda não está na KuriPuro — o serviço é criado com esse nome')}</div>}
      {open && (
        <div className="ga-edit">
          {d.reason && <div className="ga-hint">🤖 {d.reason}</div>}
          <div className="ga-grid2">
            <label className="ga-field"><span>{tr('Place', '場所', 'Local')}</span>
              <input list="ga-places" value={d.place_name} onChange={e => onEdit({ place_name: e.target.value, location_id: null })} />
            </label>
            <label className="ga-field"><span>{tr('Employee', '担当者', 'Funcionário')}</span>
              <select value={d.employee_id || ''} onChange={e => onEdit({ employee_id: e.target.value || null })}>
                <option value="">—</option>
                {ctx.employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select></label>
            <label className="ga-field"><span>{tr('Date', '日付', 'Data')}</span><input type="date" value={d.date} onChange={e => onEdit({ date: e.target.value })} /></label>
            <label className="ga-field"><span>{tr('Start – end', '開始 – 終了', 'Início – fim')}</span>
              <span className="ga-dates"><input type="time" value={d.time} onChange={e => onEdit({ time: e.target.value })} /> – <input type="time" value={d.end_time} onChange={e => onEdit({ end_time: e.target.value })} /></span></label>
            <label className="ga-field"><span>{tr('Type', '種類', 'Tipo')}</span>
              <select value={d.cleaning_type} onChange={e => onEdit({ cleaning_type: e.target.value })}>
                <option value="basic">Basic Cleaning</option><option value="deep">Deep Clean</option>
              </select></label>
            <label className="ga-field"><span>{tr('Kind / value', '区分・金額', 'Categoria / valor')}</span>
              <span className="ga-dates">
                <select value={d.job_category} onChange={e => onEdit({ job_category: e.target.value })}><option value="regular">{tr('Routine', '定期', 'Rotina')}</option><option value="spot">⚡ Spot</option></select>
                <input type="number" min="0" value={d.value || ''} placeholder="¥" onChange={e => onEdit({ value: e.target.value })} />
              </span></label>
          </div>
          {d.cleaning_type === 'deep' && (
            <div className="ga-cals">{DEEP_TASKS.map(t => (
              <label key={t.id} className={`ga-chip${tasks.has(t.id) ? ' on' : ''}`}>
                <input type="checkbox" checked={tasks.has(t.id)} onChange={() => onEdit({ deep_tasks: tasks.has(t.id) ? [...tasks].filter(x => x !== t.id) : [...tasks, t.id] })} />
                {t.icon} {lang === 'ja' ? t.ja : lang === 'pt' ? t.pt : t.label}
              </label>
            ))}</div>
          )}
          <label className="ga-field"><span>{tr('Address', '住所', 'Endereço')}</span><input value={d.address} onChange={e => onEdit({ address: e.target.value })} /></label>
          <label className="ga-field"><span>{tr('What to do (details)', '作業内容', 'O que fazer (detalhes)')}</span><textarea rows={3} value={d.description} onChange={e => onEdit({ description: e.target.value })} /></label>
          <label className="ga-field"><span>{tr('Instructions / access', '指示・入館', 'Instruções / acesso')}</span><textarea rows={2} value={d.instructions} onChange={e => onEdit({ instructions: e.target.value })} /></label>
          <div className="ga-edit-foot">
            {d.event?.html_link && <a href={d.event.html_link} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">{tr('Open in Google', 'Googleで開く', 'Abrir no Google')} ↗</a>}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit({ is_job: false })}>{tr('Not a service', 'サービスではない', 'Não é serviço')}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onIgnore}>{tr('Ignore', '無視', 'Ignorar')}</button>
          </div>
          <datalist id="ga-places">{ctx.places.map(p => <option key={p.id} value={p.name} />)}</datalist>
        </div>
      )}
    </div>
  )
}
