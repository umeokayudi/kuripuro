// v1.0.155 · Client report of a period (e.g. October), one section per store. Built by the system
// from the completed services and every photo/video the team sent — the office only checks,
// removes what it does not want, and sends. Nothing internal (values, times, AI grades) goes in.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'
import { supabase } from '../lib/supabase'
import { askConfirm } from './ConfirmDialog'
import { AiText } from './WorkReportEditor'
import { openPrintHtml } from '../lib/openPrintHtml'
import ShareReportButton from './ShareReportButton'
import { buildPeriodReport, loadReport, saveReport, reportHtml, statusLabel, storagePublicUrl, periodLabels, periodMediaCount } from '../lib/workReport'
import { mediaForJobs, isVideoPath } from '../lib/workMedia'
import { jobsOfDay } from '../lib/quickReport'
import './work-report.css'

const JOB_FIELDS = 'id,title,client_id,client_name,scheduled_date,status,job_category,employee_name,photo_start_url,photo_end_url,description,checklist_template'

export async function loadPeriodSource(clientId, from, to, onProgress) {
  const { data: jobs, error } = await supabase.from('jobs').select(JOB_FIELDS).eq('client_id', clientId)
    .gte('scheduled_date', from).lte('scheduled_date', to).eq('status', 'completed').order('scheduled_date').limit(2000)
  if (error) throw new Error(error.message)
  const media = await mediaForJobs(jobs || [], { onProgress })
  return { jobs: jobs || [], media }
}

function Body({ reportId, client, from, to, author, onClose, onSaved }) {
  const { tr } = useLang()
  const [r, setR] = useState(null)
  const [busy, setBusy] = useState('')
  const [dirty, setDirty] = useState(false)
  const [view, setView] = useState('client')
  const [progress, setProgress] = useState(null)
  const savedClient = useRef(undefined)

  useEffect(() => {
    let off = false
    ;(async () => {
      if (reportId) {
        const loaded = await loadReport(reportId)
        if (!off && loaded) { savedClient.current = loaded.client_id; setR(loaded) }
        return
      }
      const src = await loadPeriodSource(client.id, from, to, (d, n) => !off && setProgress({ d, n }))
      if (off) return
      const fresh = buildPeriodReport({ client, from, to, ...src, author })
      savedClient.current = fresh.client_id
      setR(fresh); setDirty(true); setProgress(null)
    })().catch(e => toast.error(String(e.message || e)))
    return () => { off = true }
  }, [reportId, client?.id, from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = patch => { setR(prev => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) })); setDirty(true) }
  const setStore = (si, fn) => set(prev => ({ stores: prev.stores.map((st, i) => (i === si ? fn(st) : st)) }))
  const setSvc = (si, vi, fn) => setStore(si, st => ({ ...st, services: st.services.map((sv, j) => (j === vi ? fn(sv) : sv)) }))

  const save = async (patch = {}, action = 'save', quiet = false) => {
    setBusy('save')
    try {
      const next = await saveReport({ ...r, ...patch }, { by: author?.name || 'admin', action, prevClientId: savedClient.current })
      savedClient.current = next.client_id
      setR(next); setDirty(false); onSaved?.(next)
      if (!quiet) toast.success(tr('Saved', '保存しました', 'Salvo'))
      return next
    } catch (e) { toast.error(String(e.message || e).slice(0, 160)); return null } finally { setBusy('') }
  }

  // New services or media since the report was made — keeps what the office already removed.
  const refresh = async () => {
    setBusy('refresh')
    try {
      // v1.0.158 · a day report (one person, one day) refreshes from that person's services of the day
      const src = r.day
        ? await (async () => { const jobs = await jobsOfDay(r.day.employee_id, r.day.date); return { jobs, media: await mediaForJobs(jobs.filter(j => ['completed', 'in_progress'].includes(j.status)), { onProgress: (d, n) => setProgress({ d, n }) }) } })()
        : await loadPeriodSource(r.client_id, r.from, r.to, (d, n) => setProgress({ d, n }))
      const fresh = r.day
        ? buildPeriodReport({ client: null, from: r.from, to: r.to, ...src, lang: r.lang, statuses: ['completed', 'in_progress'] })
        : buildPeriodReport({ client: { id: r.client_id, company_name: r.client_name }, from: r.from, to: r.to, ...src, lang: r.lang })
      const old = new Map(r.stores.flatMap(st => st.services.map(sv => [sv.job_id, sv])))
      const notes = new Map(r.stores.map(st => [st.name, st.note]))
      const stores = fresh.stores.map(st => ({ ...st, note: notes.get(st.name) || '', services: st.services.map(sv => {
        const o = old.get(sv.job_id)
        if (!o) return sv
        const off = new Set((o.media || []).filter(m => m.include === false).map(m => m.path))
        return { ...sv, include: o.include, sig: o.sig ?? sv.sig, media: sv.media.map(m => ({ ...m, include: !off.has(m.path) })) }
      }) }))
      set({ stores })
      toast.success(tr('Updated with the latest services and media', '最新の作業・写真で更新しました', 'Atualizado com os serviços e mídias mais recentes'))
    } catch (e) { toast.error(String(e.message || e).slice(0, 160)) } finally { setBusy(''); setProgress(null) }
  }

  const send = async () => {
    const ok = await askConfirm({
      title: tr('Send to the client?', '顧客へ送付しますか？', 'Enviar ao cliente?'),
      message: tr('Each store login sees its own store; the main login sees all stores.', '各店舗のログインには自店舗分のみ、本部ログインには全店舗分が表示されます。', 'Cada login de loja vê só a sua loja; o login geral vê todas.'),
      confirmLabel: tr('Send', '送付', 'Enviar'), danger: false,
    })
    if (ok && await save({ status: 'sent', sent_at: new Date().toISOString(), sent_by: author?.name || '' }, 'sent', true)) toast.success(tr('Sent — visible in the portal.', '送付しました。', 'Enviado — já aparece no portal.'))
  }
  const unsend = async () => {
    if (await askConfirm({ title: tr('Hide from the client?', '顧客から非表示にしますか？', 'Tirar do portal do cliente?'), confirmLabel: tr('Hide', '非表示', 'Tirar') })) await save({ status: 'draft', sent_at: null }, 'unsent')
  }
  const close = async () => {
    if (dirty && !(await askConfirm({ title: tr('Close without saving?', '保存せずに閉じますか？', 'Fechar sem salvar?'), confirmLabel: tr('Close', '閉じる', 'Fechar') }))) return
    onClose()
  }

  if (!r) {
    return <div className="wr-sheet"><div className="wr-loading">{tr('Collecting services, photos and videos…', '作業・写真・動画を集めています…', 'Juntando serviços, fotos e vídeos…')}{progress ? ` ${progress.d}/${progress.n}` : ''}</div></div>
  }
  const L = periodLabels(r.lang)
  const total = r.stores.reduce((n, st) => n + st.services.filter(sv => sv.include !== false).length, 0)

  return (
    <div className="wr-sheet" role="dialog" aria-label={r.title}>
      <header className="wr-head">
        <button type="button" className="wr-x" onClick={close} aria-label="close">✕</button>
        <div className="wr-head-main">
          <b>{tr('Client report by store', '店舗別 作業報告書', 'Relatório do cliente por loja')}</b>
          <span>{r.client_name} · {r.from} → {r.to} · <em className={`wr-st st-${r.status}`}>{statusLabel(r.status, tr)}</em></span>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => openPrintHtml(reportHtml(r))}>👁 {tr('Client view / PDF', '顧客ビュー・PDF', 'Visão do cliente / PDF')}</button>
        <ShareReportButton report={r} />
        <button type="button" className="btn btn-sm btn-primary" disabled={!!busy || !dirty} onClick={() => save()}>{busy === 'save' ? '…' : tr('Save', '保存', 'Salvar')}</button>
      </header>
      <div className="wr-body">
        <div className="wr-tabs" role="tablist">
          <button type="button" className={view === 'client' ? 'on' : ''} onClick={() => setView('client')}>👁 {tr('What the client sees', '顧客に見える内容', 'O que o cliente vê')}</button>
          <button type="button" className={`is-internal${view === 'internal' ? ' on' : ''}`} onClick={() => setView('internal')}>🔒 {tr('Internal — office only', '社内用（顧客には非表示）', 'Interno — só escritório')}</button>
        </div>

        {view === 'client' ? (
          <>
            <section className="wr-card">
              <label className="wr-grid" style={{ gridTemplateColumns: '1fr' }}><span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{tr('Title', 'タイトル', 'Título')}</span><input value={r.title || ''} onChange={e => set({ title: e.target.value })} /></label>
              <AiText value={r.summary} onChange={v => set({ summary: v })} field="summary" lang={r.lang} rows={3} context={`${r.client_name} · ${r.from}〜${r.to} · ${total} services`} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12.5, color: 'var(--text2)' }}>
                <span>{r.stores.length} {tr('stores', '店舗', 'lojas')} · {total} {tr('services', '件', 'serviços')} · {periodMediaCount(r)} {tr('photos/videos', '写真・動画', 'fotos/vídeos')}</span>
                <button type="button" className="btn btn-sm" disabled={!!busy} onClick={refresh} style={{ marginLeft: 'auto' }}>{busy === 'refresh' ? `… ${progress ? `${progress.d}/${progress.n}` : ''}` : `↻ ${tr('Update with new services and media', '新しい作業・写真で更新', 'Atualizar com serviços e mídias novos')}`}</button>
              </div>
            </section>
            {!r.stores.length && <p className="wr-hint">{L.none}</p>}
            {r.stores.map((st, si) => (
              <details key={st.name} className="wr-store" open={r.stores.length <= 3}>
                <summary>🏬 {st.name} <small>{st.services.filter(sv => sv.include !== false).length} {tr('services', '件', 'serviços')} · {st.services.reduce((n, sv) => n + (sv.media || []).filter(m => m.include !== false).length, 0)} 📷</small></summary>
                <div className="wr-store-body">
                  <textarea rows={2} value={st.note || ''} onChange={e => setStore(si, x => ({ ...x, note: e.target.value }))} placeholder={tr('Note for this store (optional, the client sees it)', 'この店舗へのコメント（任意・顧客に表示）', 'Recado para esta loja (opcional, o cliente vê)')} style={{ font: 'inherit', fontSize: 13, padding: 8, border: '1px solid var(--border)', borderRadius: 8 }} />
                  {st.services.map((sv, vi) => (
                    <div key={sv.job_id} className={`wr-svc${sv.include === false ? ' off' : ''}`}>
                      <div className="wr-svc-h">
                        <b>{sv.date}</b><span>{L.types[sv.type]}{sv.service && sv.type !== 'basic' ? ` · ${sv.service}` : ''}</span><span>{L.who}: {sv.who || '—'}</span>
                        <label><input type="checkbox" checked={sv.include !== false} onChange={e => setSvc(si, vi, x => ({ ...x, include: e.target.checked }))} /> {tr('in the report', '報告書に含める', 'no relatório')}</label>
                      </div>
                      {(sv.media || []).length > 0 ? (
                        <div className="wr-media">
                          {sv.media.map((m, mi) => (
                            <figure key={m.path} className={m.include === false ? 'off' : ''}>
                              {m.kind === 'video' || isVideoPath(m.path) ? <video src={`${storagePublicUrl(m.path)}#t=0.5`} preload="metadata" muted playsInline /> : <img src={storagePublicUrl(m.path)} alt="" loading="lazy" />}
                              <em>{m.kind === 'video' ? '▶ ' : ''}{m.section === 'before' ? L.before : L.after}</em>
                              <button type="button" title={m.include === false ? tr('Put back', '戻す', 'Voltar') : tr('Remove', '外す', 'Tirar')} onClick={() => setSvc(si, vi, x => ({ ...x, media: x.media.map((y, k) => (k === mi ? { ...y, include: y.include === false } : y)) }))}>{m.include === false ? '↺' : '✕'}</button>
                            </figure>
                          ))}
                        </div>
                      ) : <small className="wr-hint">{tr('No photo or video for this service.', 'この作業の写真・動画はありません。', 'Sem foto ou vídeo neste serviço.')}</small>}
                    </div>
                  ))}
                  <button type="button" className="btn btn-sm" onClick={() => openPrintHtml(reportHtml(r, { store: st.name }))}>👁 {tr('What this store login sees', 'この店舗のログインで見える内容', 'O que o login desta loja vê')}</button>
                </div>
              </details>
            ))}
          </>
        ) : (
          <>
            <p className="wr-internal-note">🔒 {tr('Nothing on this tab goes to the client.', 'このタブの内容は顧客には表示されません。', 'Nada desta aba vai para o cliente.')}</p>
            <section className="wr-card">
              <h4>{tr('Office note', '事務所メモ', 'Nota do escritório')}</h4>
              <textarea rows={4} value={r.internal?.office_note || ''} onChange={e => set(prev => ({ internal: { ...(prev.internal || {}), office_note: e.target.value } }))} />
            </section>
            <section className="wr-card">
              <h4>{tr('History', '履歴', 'Histórico')}</h4>
              {(r.history || []).slice().reverse().map((h, i) => <small key={i} className="wr-hint">{h.at?.slice(0, 16).replace('T', ' ')} · {h.by} · {h.action}</small>)}
              {!(r.history || []).length && <small className="wr-hint">—</small>}
            </section>
          </>
        )}

        <footer className="wr-foot">
          {r.status === 'sent'
            ? <><span>✓ {tr('The client sees it in the portal', '顧客ポータルに表示中', 'O cliente vê no portal')}</span>
                <button type="button" className="btn btn-sm" onClick={unsend}>{tr('Hide from client', '非表示にする', 'Tirar do portal')}</button>
                <button type="button" className="btn btn-sm btn-primary" disabled={!!busy || !dirty} onClick={() => save({}, 'edit-after-send')}>{tr('Save changes', '変更を保存', 'Salvar alterações')}</button></>
            : <><button type="button" className="btn" onClick={() => openPrintHtml(reportHtml(r))}>👁 {tr('Client view / PDF', '顧客ビュー・PDF', 'Visão do cliente / PDF')}</button>
                {r.day
                  ? <button type="button" className="btn btn-primary" disabled={!!busy || !dirty} onClick={() => save()}>{tr('Save', '保存', 'Salvar')}</button>
                  : <button type="button" className="btn btn-primary" disabled={!!busy} onClick={send}>📨 {tr('Send to client', '顧客へ送付', 'Enviar ao cliente')}</button>}</>}
        </footer>
      </div>
    </div>
  )
}

export default function PeriodReportEditor(props) {
  return createPortal(<div className="wr-overlay"><Body {...props} /></div>, document.body)
}
