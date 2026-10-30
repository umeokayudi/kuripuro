// v1.0.105 · "Client reports" (Clients → client page, and Reports → "Generate client report").
// 3 steps: client → month → preview → [PDF] and/or [Share on the client portal].
// Nothing reaches the client before the admin presses Share: the month close only makes DRAFTS.
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useLang } from '../hooks/useLang'
import { useAuth } from '../hooks/useAuth'
import { tokyoToday } from '../lib/dates'
import { peekVideoStatus } from '../lib/jobVideo'
import {
  getClientReport, listClientReports, loadClientReport, missingTable, saveDraft, shareReport, shiftPeriod, unshareReport,
} from '../lib/clientReport'
import { clientReportHtml } from '../lib/clientReportPdf'
import { reportMonth } from '../lib/clientReportText'
import { openPrintHtml } from '../lib/openPrintHtml'
import { askConfirm } from './ConfirmDialog'
import ClientReportView from './ClientReportView'
import PhotoLightbox from './PhotoLightbox'
import './client-report.css'

const hasVideo = id => peekVideoStatus(id).then(s => s?.status === 'uploaded' || Boolean(s?.path))

function ClientStep({ tr, value, onPick, drafts }) {
  const [clients, setClients] = useState(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    supabase.from('clients').select('id,company_name,is_active').order('company_name').limit(500)
      .then(({ data }) => setClients(data || []))
  }, [])
  const list = (clients || []).filter(c => c.is_active !== false && (!q || String(c.company_name || '').toLowerCase().includes(q.toLowerCase())))
  return (
    <div className="crf-pick">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder={tr('Search client…', '顧客を検索…', 'Buscar cliente…')} />
      <div className="crf-list" style={{ marginTop: 8 }}>
        {clients == null && <div className="crp-empty">…</div>}
        {list.slice(0, 60).map(c => (
          <button key={c.id} type="button" className="crf-row" style={value?.id === c.id ? { borderColor: '#315cf5' } : null} onClick={() => onPick(c)}>
            <b>{c.company_name}</b>
            {drafts.has(c.id) && <span className="crf-status">{tr('draft ready', '下書きあり', 'rascunho pronto')}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function ClientReports({ client: fixedClient = null }) {
  const { lang, tr } = useLang()
  const { user } = useAuth()
  const today = tokyoToday()
  const thisMonth = today.slice(0, 7)
  // Until the 10th the month that just closed is the one to review
  const defaultPeriod = Number(today.slice(8, 10)) <= 10 ? shiftPeriod(thisMonth, -1) : thisMonth
  const [client, setClient] = useState(fixedClient)
  const [period, setPeriod] = useState(null)
  const [saved, setSaved] = useState({ rows: [], missing: false })
  const [state, setState] = useState({ loading: false, live: null, row: null, error: null })
  const [showLive, setShowLive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const step = !client ? 1 : !period ? 2 : 3

  const refreshSaved = () => listClientReports(supabase, fixedClient?.id || null).then(setSaved)
  useEffect(() => { refreshSaved() }, [fixedClient?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const drafts = useMemo(() => new Set(saved.rows.filter(r => r.status === 'draft' && r.period === defaultPeriod).map(r => r.client_id)), [saved.rows, defaultPeriod])
  const months = useMemo(() => Array.from({ length: 6 }, (_, i) => shiftPeriod(thisMonth, -i)), [thisMonth])
  const rowFor = p => saved.rows.find(r => r.client_id === client?.id && r.period === p)

  useEffect(() => {
    if (!client || !period) return
    let off = false
    setState({ loading: true, live: null, row: null, error: null })
    setShowLive(false)
    ;(async () => {
      const live = await loadClientReport(supabase, client, period, { hasVideo })
      let row = null
      if (!saved.missing) {
        try {
          row = await getClientReport(supabase, client.id, period)
          // Opening the preview keeps the draft up to date (never touches a shared one)
          if (!row || row.status === 'draft') row = await saveDraft(supabase, live)
        } catch (e) {
          if (missingTable(e)) setSaved(s => ({ ...s, missing: true }))
        }
      }
      if (!off) setState({ loading: false, live, row, error: null })
    })().catch(e => { if (!off) setState({ loading: false, live: null, row: null, error: e?.message || String(e) }) })
    return () => { off = true }
  }, [client?.id, period]) // eslint-disable-line react-hooks/exhaustive-deps

  const shared = state.row?.status === 'shared'
  const content = shared && !showLive ? state.row.content : state.live

  const pdf = () => {
    if (!content) return
    openPrintHtml(clientReportHtml(content, lang, window.location.origin))
  }

  const share = async () => {
    if (!state.live) return
    const ok = await askConfirm({
      title: tr('Share on the client portal?', 'お客様ポータルに公開しますか？', 'Compartilhar no portal do cliente?'),
      message: tr(
        `${client.company_name} will see this ${reportMonth(period, lang)} report on the portal. Each store login sees only its own store.`,
        `${client.company_name} がポータルで${reportMonth(period, lang)}のレポートを見られるようになります。店舗アカウントは自店舗のみ表示されます。`,
        `${client.company_name} vai ver este relatório de ${reportMonth(period, lang)} no portal. Cada loja vê só a própria loja.`,
      ),
      confirmLabel: tr('Share', '公開', 'Compartilhar'),
      danger: false,
    })
    if (!ok) return
    setBusy(true)
    try {
      const row = await shareReport(supabase, state.live, user?.name || 'Admin')
      setState(s => ({ ...s, row }))
      setShowLive(false)
      refreshSaved()
      toast.success(tr('Shared on the client portal', 'ポータルに公開しました', 'Compartilhado no portal do cliente'))
    } catch (e) {
      toast.error(missingTable(e) ? tr('Needs the SQL client_reports first.', 'SQL client_reports が必要です。', 'Precisa aplicar o SQL client_reports antes.') : (e?.message || String(e)))
    }
    setBusy(false)
  }

  const unshare = async () => {
    if (!state.row) return
    const ok = await askConfirm({ title: tr('Remove from the portal?', 'ポータルから外しますか？', 'Tirar do portal?'), message: tr('The client stops seeing it. It goes back to draft.', 'お客様には表示されなくなり、下書きに戻ります。', 'O cliente deixa de ver. Volta a ser rascunho.'), danger: true })
    if (!ok) return
    setBusy(true)
    try {
      const row = await unshareReport(supabase, state.row.id)
      setState(s => ({ ...s, row }))
      refreshSaved()
    } catch (e) { toast.error(e?.message || String(e)) }
    setBusy(false)
  }

  const stepLabels = [tr('Client', '顧客', 'Cliente'), tr('Month', '月', 'Mês'), tr('Preview', 'プレビュー', 'Prévia')]
  const fmtShared = at => at ? new Date(at).toLocaleDateString(lang === 'ja' ? 'ja-JP' : lang === 'pt' ? 'pt-BR' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Tokyo' }) : ''

  return (
    <div>
      <div className="crf-steps">
        {stepLabels.map((l, i) => <span key={l} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''}>{i + 1}. {l}</span>)}
      </div>

      {saved.missing && (
        <div className="crf-warn">
          {tr('Preview and PDF work now. To save drafts and share on the portal, the SQL sql/2026-10-30_relatorio_cliente.sql must be applied (waiting for the owner).',
            'プレビューとPDFは使えます。下書き保存とポータル公開には SQL sql/2026-10-30_relatorio_cliente.sql の適用が必要です（オーナー承認待ち）。',
            'Prévia e PDF já funcionam. Para guardar rascunho e compartilhar no portal, falta aplicar o SQL sql/2026-10-30_relatorio_cliente.sql (aguardando o dono).')}
        </div>
      )}

      {!fixedClient && (
        step === 1
          ? <ClientStep tr={tr} value={client} drafts={drafts} onPick={c => { setClient(c); setPeriod(null) }} />
          : <div className="crf-bar"><b>{client.company_name}</b><button type="button" className="btn btn-sm" onClick={() => { setClient(null); setPeriod(null) }}>{tr('Change', '変更', 'Trocar')}</button></div>
      )}

      {client && (
        <div className="crf-chips">
          {months.map(m => {
            const r = rowFor(m)
            return (
              <button key={m} type="button" className={period === m ? 'on' : ''} onClick={() => setPeriod(m)}>
                {reportMonth(m, lang)}
                {r && <em>{r.status === 'shared' ? '✓' : tr('draft', '下書き', 'rascunho')}</em>}
              </button>
            )
          })}
        </div>
      )}

      {step === 3 && (
        <>
          <div className="crf-bar">
            {state.row && <span className={`crf-status${shared ? ' shared' : ''}`}>{shared
              ? tr(`On the portal since ${fmtShared(state.row.shared_at)}`, `${fmtShared(state.row.shared_at)} から公開中`, `No portal desde ${fmtShared(state.row.shared_at)}`)
              : tr('Draft — not sent', '下書き — 未送信', 'Rascunho — não enviado')}</span>}
            <button type="button" className="btn" disabled={!content} onClick={pdf}>📄 {tr('Generate PDF', 'PDFを作成', 'Gerar PDF')}</button>
            {(!shared || showLive) && <button type="button" className="btn btn-primary" disabled={busy || !state.live || saved.missing} onClick={share}>🔗 {shared ? tr('Share this updated version', 'この最新版を公開', 'Compartilhar esta versão atualizada') : tr('Share on the client portal', 'ポータルに公開', 'Compartilhar no portal do cliente')}</button>}
            {shared && !showLive && <button type="button" className="btn" onClick={() => setShowLive(true)}>{tr('See current data', '最新データを見る', 'Ver dados atuais')}</button>}
            {shared && <button type="button" className="btn" disabled={busy} onClick={unshare}>{tr('Remove from portal', 'ポータルから外す', 'Tirar do portal')}</button>}
          </div>
          {shared && showLive && <div className="crf-warn">{tr('You are seeing the current data. The client still sees the version you shared.', '最新データを表示中。お客様には公開済みの版が表示されています。', 'Você está vendo os dados atuais. O cliente continua vendo a versão que você compartilhou.')}</div>}
          {state.loading && <div className="crp-empty">{tr('Building the report…', 'レポートを作成中…', 'Montando o relatório…')}</div>}
          {state.error && <div className="crf-warn">{state.error}</div>}
          {content && <ClientReportView content={content} lang={lang} onPhoto={setLightbox} />}
        </>
      )}
      {lightbox && <PhotoLightbox url={lightbox} onClose={() => setLightbox(null)} closeLabel={tr('Close', '閉じる', 'Fechar')} />}
    </div>
  )
}

/** Reports → "Generate client report": the same flow in a window, starting at step 1. */
export function ClientReportsModal({ onClose }) {
  const { tr } = useLang()
  return (
    <div className="crf-modal" onClick={onClose}>
      <div className="crf-modal-box" onClick={e => e.stopPropagation()} role="dialog">
        <div className="crf-modal-h">
          <h3>{tr('Client report', 'お客様レポート', 'Relatório do cliente')}</h3>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="close">✕</button>
        </div>
        <ClientReports />
      </div>
    </div>
  )
}
