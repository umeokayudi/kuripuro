// v1.0.150 · 作業報告書 editor (admin + employee). Full screen on phones, side sheet on desktop.
// Employee: adds photos while working (antes / durante / depois / por parte) and writes notes in
// any language; later (or the office) asks the AI to write the report in Japanese, fixes and sends.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'
import { supabase } from '../lib/supabase'
import { askConfirm } from './ConfirmDialog'
import { openPrintHtml } from '../lib/openPrintHtml'
import {
  blankReport, loadReport, saveReport, addReportPhoto, reportHtml, reportAi, draftPayload, applyDraft,
  storagePublicUrl, quoteMoney, LEVELS, reportLabels, statusLabel, reportIdForJob,
} from '../lib/workReport'
import { listJobMedia, isVideoPath } from '../lib/workMedia'
import './work-report.css'

const SECTIONS = ['before', 'during', 'after']

export function AiText({ value, onChange, field, lang, rows = 3, placeholder, context, small }) {
  const { tr } = useLang()
  const [busy, setBusy] = useState('')
  const run = async size => {
    if (!String(value || '').trim()) { toast(tr('Write something first.', '先に入力してください。', 'Escreva algo primeiro.')); return }
    setBusy(size)
    try {
      const { text } = await reportAi('polish', { text: value, field, size, lang, context })
      onChange(text)
    } catch (e) {
      toast.error(String(e.message || e).slice(0, 160))
    } finally { setBusy('') }
  }
  return (
    <div className={`wr-ai${small ? ' is-small' : ''}`}>
      <textarea rows={rows} value={value || ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
      <div className="wr-ai-bar">
        <button type="button" disabled={!!busy} onClick={() => run('same')}>{busy === 'same' ? '…' : `✨ ${tr('Fix', '校正', 'Corrigir')}`}</button>
        <button type="button" disabled={!!busy} onClick={() => run('short')}>{busy === 'short' ? '…' : tr('Shorter', '短く', 'Mais curto')}</button>
        <button type="button" disabled={!!busy} onClick={() => run('long')}>{busy === 'long' ? '…' : tr('Longer', '詳しく', 'Mais longo')}</button>
      </div>
    </div>
  )
}

function PhotoStrip({ photos, onAdd, onCaption, onRemove, onMove, adding, tr, sectionOptions }) {
  const input = useRef()
  return (
    <div className="wr-photos">
      {photos.map(p => (
        <figure key={p.path} className="wr-photo">
          {p.kind === 'video' || isVideoPath(p.path)
            ? <div className="wr-vid"><video src={`${storagePublicUrl(p.path)}#t=0.5`} controls playsInline preload="metadata" /><span>▶ {tr('video', '動画', 'vídeo')}</span></div>
            : <img src={storagePublicUrl(p.path)} alt="" loading="lazy" />}
          <input value={p.caption || ''} placeholder={tr('Caption', '説明', 'Legenda')} onChange={e => onCaption(p, e.target.value)} />
          <div className="wr-photo-act">
            {sectionOptions && (
              <select value={p.section} onChange={e => onMove(p, e.target.value)} aria-label="section">
                {sectionOptions.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            )}
            <button type="button" onClick={() => onRemove(p)} aria-label={tr('Remove', '削除', 'Remover')}>✕</button>
          </div>
        </figure>
      ))}
      <button type="button" className="wr-photo-add" disabled={adding} onClick={() => input.current?.click()}>
        {adding ? '…' : <>📷<span>{tr('Add photos', '写真を追加', 'Adicionar fotos')}</span></>}
      </button>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={e => { const files = [...(e.target.files || [])]; e.target.value = ''; if (files.length) onAdd(files) }} />
    </div>
  )
}

function Lines({ value, onChange, placeholder, rows = 5 }) {
  return <textarea rows={rows} value={(value || []).join('\n')} placeholder={placeholder} onChange={e => onChange(e.target.value.split('\n'))} onBlur={e => onChange(e.target.value.split('\n').map(s => s.trim()).filter(Boolean))} />
}

function EditorBody({ reportId, job, client, role, author, onClose, onSaved }) {
  const { lang: uiLang, tr } = useLang()
  const isAdmin = role === 'admin'
  const [r, setR] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [view, setView] = useState('client')
  const [pulling, setPulling] = useState(false)
  const [clients, setClients] = useState([])
  const [quotes, setQuotes] = useState([])
  const savedClient = useRef(undefined)
  const latest = useRef(null) // newest report state, for saves that finish after an await

  useEffect(() => {
    let off = false
    ;(async () => {
      const id = reportId || (job?.id ? await reportIdForJob(job.id) : null)
      const loaded = id ? await loadReport(id) : null
      if (off) return
      if (loaded) { savedClient.current = loaded.client_id; setR(loaded); return }
      let c = client
      if (!c && job?.client_id) {
        const { data } = await supabase.from('clients').select('id,company_name,manager_name,contact_name,contact_person').eq('id', job.client_id).maybeSingle()
        c = data
      }
      const fresh = blankReport({ mode: 'simple', job, client: c, author })
      // v1.0.155: every photo and video the team sent for this service comes in at once.
      fresh.photos = (await listJobMedia(job)).map(m => ({ path: m.path, kind: m.kind, section: m.section, caption: '', by: 'job', at: new Date().toISOString() }))
      if (off) return
      savedClient.current = fresh.client_id
      setR(fresh)
      setDirty(true)
    })().catch(e => toast.error(String(e.message || e)))
    return () => { off = true }
  }, [reportId, job?.id, client?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isAdmin) return
    supabase.from('clients').select('id,company_name,manager_name,contact_name,contact_person').order('company_name').then(({ data }) => setClients(data || []))
  }, [isAdmin])

  useEffect(() => {
    if (!isAdmin || !r?.client_name) { setQuotes([]); return }
    supabase.from('mitsumori').select('id,quote_number,needs,site_name,subtotal,tax_rate,total,status,issue_date').ilike('company_name', r.client_name).order('created_at', { ascending: false }).limit(20)
      .then(({ data }) => setQuotes(data || []))
  }, [isAdmin, r?.client_name])

  latest.current = r
  const set = patch => { setR(prev => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) })); setDirty(true) }
  const setField = (k, v) => set(prev => ({ fields: { ...prev.fields, [k]: v } }))
  // Screen labels follow the person's language; the report text follows the report language.
  const t = reportLabels(uiLang)
  const tDoc = reportLabels(r?.lang || 'ja')

  const save = async (patch = {}, action = 'save', quiet = false) => {
    if (!r) return null
    if (!isAdmin && r.status === 'sent') { toast(tr('Already sent to the client — ask the office to change it.', '送付済みです。変更は事務所へ。', 'Já foi enviado ao cliente — peça ao escritório para mudar.')); return null }
    setSaving(true)
    try {
      const next = await saveReport({ ...r, ...patch }, { by: author?.name || role, action, prevClientId: savedClient.current })
      savedClient.current = next.client_id
      setR(next)
      setDirty(false)
      onSaved?.(next)
      if (!quiet) toast.success(tr('Saved', '保存しました', 'Salvo'))
      return next
    } catch (e) {
      toast.error(String(e.message || e).slice(0, 160))
      return null
    } finally { setSaving(false) }
  }

  const addPhotos = async (files, where) => {
    setAdding(where.key)
    const added = []
    try {
      for (const f of files) added.push(await addReportPhoto(r.id, f, { ...where, by: author?.name || role }))
    } catch (e) {
      toast.error(String(e.message || e).slice(0, 160))
    }
    setAdding('')
    if (!added.length) return
    // Save at once so a photo taken on site is never lost, even if the app is closed.
    const cur = latest.current || r
    const next = { ...cur, photos: [...(cur.photos || []), ...added] }
    setR(next)
    try {
      const saved = await saveReport(next, { by: author?.name || role, action: 'photo', prevClientId: savedClient.current })
      savedClient.current = saved.client_id
      setR(saved); setDirty(false); onSaved?.(saved)
      toast.success(tr(`${added.length} photo(s) saved`, `写真${added.length}枚を保存`, `${added.length} foto(s) salva(s)`))
    } catch (e) { toast.error(String(e.message || e).slice(0, 160)); setDirty(true) }
  }
  const pullMedia = async () => {
    const ids = [...new Set([r.job_id, ...(r.job_ids || [])].filter(Boolean))]
    if (!ids.length) { toast(tr('This report has no service linked.', 'この報告書には作業がありません。', 'Este relatório não tem serviço ligado.')); return }
    setPulling(true)
    try {
      const { data: jobs } = await supabase.from('jobs').select('id,photo_start_url,photo_end_url').in('id', ids)
      const found = (await Promise.all((jobs || ids.map(id => ({ id }))).map(j => listJobMedia(j)))).flat()
      const cur = latest.current || r
      const have = new Set((cur.photos || []).map(p => p.path))
      const added = found.filter(m => !have.has(m.path)).map(m => ({ path: m.path, kind: m.kind, section: m.section, caption: '', by: 'job', at: new Date().toISOString() }))
      if (!added.length) { toast(tr('Nothing new — all media is already here.', '新しい写真・動画はありません。', 'Nada novo — todas as fotos e vídeos já estão aqui.')); return }
      set(prev => ({ photos: [...(prev.photos || []), ...added] }))
      toast.success(tr(`${added.length} added — check and save`, `${added.length}件追加しました`, `${added.length} adicionado(s) — confira e salve`))
    } catch (e) { toast.error(String(e.message || e).slice(0, 160)) } finally { setPulling(false) }
  }
  const updPhoto = (p, patch) => set(prev => ({ photos: prev.photos.map(x => (x.path === p.path ? { ...x, ...patch } : x)) }))
  const rmPhoto = p => set(prev => ({ photos: prev.photos.filter(x => x.path !== p.path) }))

  const generate = async () => {
    if (!String(r.notes_raw || '').trim() && !(r.photos || []).some(p => p.caption) && !job?.notes_employee) {
      toast(tr('Write the notes first (what you found, what you did, problems).', '先にメモを書いてください。', 'Escreva as notas primeiro (o que encontrou, o que fez, problemas).'))
      return
    }
    const filled = r.summary || (r.steps || []).length || r.before?.text || r.after?.text
    if (filled && !(await askConfirm({ title: tr('Rewrite with AI?', 'AIで作成しますか？', 'Reescrever com a IA?'), message: tr('The AI will replace the texts (photos and fields stay).', '文章を置き換えます（写真・項目はそのまま）。', 'A IA vai substituir os textos (fotos e campos ficam).'), confirmLabel: tr('Rewrite', '作成', 'Reescrever'), danger: false }))) return
    setDrafting(true)
    try {
      const d = await reportAi('draft', draftPayload(r, job))
      set(prev => applyDraft(prev, d))
      toast.success(tr('Report written — check and adjust.', '作成しました。確認してください。', 'Relatório escrito — confira e ajuste.'))
    } catch (e) {
      toast.error(String(e.message || e).slice(0, 160))
    } finally { setDrafting(false) }
  }

  const preview = () => openPrintHtml(reportHtml(r))

  const send = async () => {
    if (!r.client_id) { toast.error(tr('Choose the client first.', '先に顧客を選んでください。', 'Escolha o cliente primeiro.')); return }
    const ok = await askConfirm({
      title: tr('Send to the client?', '顧客へ送付しますか？', 'Enviar ao cliente?'),
      message: tr(`${r.client_name} will see this report in their portal (login).`, `${r.client_name}様のポータルに表示されます。`, `${r.client_name} vai ver este relatório no portal (com o login dele).`),
      confirmLabel: tr('Send', '送付', 'Enviar'), danger: false,
    })
    if (!ok) return
    await save({ status: 'sent', sent_at: new Date().toISOString(), sent_by: author?.name || '' }, 'sent', true)
    toast.success(tr('Sent — the client sees it in the portal.', '送付しました。', 'Enviado — o cliente já vê no portal.'))
  }
  const unsend = async () => {
    const ok = await askConfirm({ title: tr('Hide from the client?', '顧客から非表示にしますか？', 'Tirar do portal do cliente?'), confirmLabel: tr('Hide', '非表示', 'Tirar'), danger: true })
    if (ok) await save({ status: 'draft', sent_at: null }, 'unsent')
  }

  const close = async () => {
    if (dirty && !(await askConfirm({ title: tr('Close without saving?', '保存せずに閉じますか？', 'Fechar sem salvar?'), confirmLabel: tr('Close', '閉じる', 'Fechar') }))) return
    onClose()
  }

  const sectionOptions = useMemo(() => SECTIONS.map(k => [k, { before: t.before, during: t.during, after: t.after }[k]]), [t])

  if (!r) return <div className="wr-sheet"><div className="wr-loading">…</div></div>

  const detailed = r.mode === 'detailed'
  const photosOf = sec => (r.photos || []).filter(p => p.section === sec)
  const money = quoteMoney(r.quote)
  const ctx = `${r.client_name || ''} · ${r.title || ''} · ${r.fields?.equipment || ''}`

  return (
    <div className="wr-sheet" role="dialog" aria-label={t.doc}>
      <header className="wr-head">
        <button type="button" className="wr-x" onClick={close} aria-label="close">✕</button>
        <div className="wr-head-main">
          <b>{tr('Service report', '作業報告書', 'Relatório de serviço')}</b>
          <span>{[r.client_name, r.location, r.work_date].filter(Boolean).join(' · ') || '—'} · <em className={`wr-st st-${r.status}`}>{statusLabel(r.status, tr)}</em></span>
        </div>
        <button type="button" className="btn btn-sm" onClick={preview}>👁 {tr('Preview / PDF', 'プレビュー・PDF', 'Ver / PDF')}</button>
        <button type="button" className="btn btn-sm btn-primary" disabled={saving || !dirty} onClick={() => save()}>{saving ? '…' : tr('Save', '保存', 'Salvar')}</button>
      </header>

      <div className="wr-body">
        <div className="wr-toggles">
          <div className="wr-seg" role="group" aria-label="mode">
            <button type="button" className={!detailed ? 'on' : ''} onClick={() => set({ mode: 'simple' })}>{tr('Simple', 'シンプル', 'Simples')}</button>
            <button type="button" className={detailed ? 'on' : ''} onClick={() => set({ mode: 'detailed' })}>{tr('Detailed', '詳細', 'Detalhado')}</button>
          </div>
          <div className="wr-seg" role="group" aria-label="language">
            {[['ja', '日本語'], ['en', 'EN'], ['pt', 'PT']].map(([k, l]) => <button key={k} type="button" className={r.lang === k ? 'on' : ''} onClick={() => set({ lang: k })}>{l}</button>)}
          </div>
          <small>{detailed
            ? tr('Detailed: overview, steps, before/during/after, parts table, extra sections, recommendations.', '詳細：概要・工程・前中後・部位別比較・追加説明・ご提案', 'Detalhado: resumo, etapas, antes/durante/depois, tabela por parte, seções extras, sugestões.')
            : tr('Simple: overview, steps, before/after photos and notes.', 'シンプル：概要・工程・前後写真・ご報告事項', 'Simples: resumo, etapas, fotos antes/depois e avisos.')}</small>
        </div>

        <div className="wr-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={view === 'client'} className={view === 'client' ? 'on' : ''} onClick={() => setView('client')}>👁 {tr('What the client sees', '顧客に見える内容', 'O que o cliente vê')}</button>
          <button type="button" role="tab" aria-selected={view === 'internal'} className={`is-internal${view === 'internal' ? ' on' : ''}`} onClick={() => setView('internal')}>🔒 {tr('Internal — office only', '社内用（顧客には非表示）', 'Interno — só escritório')}</button>
        </div>

        {view === 'client' && (
          <>
            <section className="wr-card wr-aicard">
              <div>
                <b>✨ {tr('Write with AI', 'AIで作成', 'Escrever com a IA')}</b>
                <span>{String(r.notes_raw || '').trim() ? tr('Uses the team notes (internal tab).', '社内メモを使って作成します。', 'Usa as notas da equipe (aba Interno).') : tr('Write the team notes first in the Internal tab.', '先に社内タブでメモを書いてください。', 'Escreva antes as notas da equipe na aba Interno.')}</span>
              </div>
              <button type="button" className="btn btn-gold" disabled={drafting} onClick={generate}>{drafting ? tr('Writing…', '作成中…', 'Escrevendo…') : tr('Write the report', '報告書を作成', 'Escrever o relatório')}</button>
              <button type="button" className="btn btn-sm" disabled={pulling} onClick={pullMedia}>{pulling ? '…' : `↻ ${tr('Bring photos & videos of the service', '作業の写真・動画を取り込む', 'Puxar fotos e vídeos do serviço')}`}</button>
            </section>

        <section className="wr-card">
          <h4>{t.overview}</h4>
          <div className="wr-grid">
            {isAdmin ? (
              <label>{tr('Client', '顧客', 'Cliente')}
                <select value={r.client_id || ''} onChange={e => { const c = clients.find(x => x.id === e.target.value); set({ client_id: c?.id || null, client_name: c?.company_name || '', contact_name: r.contact_name || c?.manager_name || c?.contact_name || c?.contact_person || '' }) }}>
                  <option value="">—</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                </select>
              </label>
            ) : <label>{tr('Client', '顧客', 'Cliente')}<input value={r.client_name || ''} readOnly /></label>}
            <label>{tr('Contact (様)', 'ご担当者（様）', 'Contato (様)')}<input value={r.contact_name || ''} onChange={e => set({ contact_name: e.target.value })} /></label>
            <label className="wr-wide">{tr('Service name (title)', '作業名（タイトル）', 'Nome do serviço (título)')}<input value={r.title || ''} onChange={e => set({ title: e.target.value })} placeholder="業務用エアコン分解洗浄" /></label>
            <label>{t.date}<input type="date" value={r.work_date || ''} onChange={e => set({ work_date: e.target.value })} /></label>
            <label>{t.place}<input value={r.fields?.place || ''} onChange={e => setField('place', e.target.value)} placeholder="客席フロア（6台）／厨房（1台）" /></label>
            <label className="wr-wide">{t.equipment}<input value={r.fields?.equipment || ''} onChange={e => setField('equipment', e.target.value)} placeholder="三菱電機 天井カセット形（4方向吹出し）（2015年製）" /></label>
            <label>{t.lead}<input value={r.fields?.lead || ''} onChange={e => setField('lead', e.target.value)} /></label>
            <label>{t.tech}<input value={r.fields?.tech || ''} onChange={e => setField('tech', e.target.value)} /></label>
            <label>{t.doneToday}<input value={r.fields?.done_today || ''} onChange={e => setField('done_today', e.target.value)} /></label>
            <label>{t.otherDay}<input value={r.fields?.other_day || ''} onChange={e => setField('other_day', e.target.value)} /></label>
            {(r.custom_fields || []).map((c, i) => (
              <div key={i} className="wr-wide wr-custom">
                <input value={c.label} placeholder={tr('Field', '項目', 'Campo')} onChange={e => set(prev => ({ custom_fields: prev.custom_fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }))} />
                <input value={c.value} placeholder={tr('Value', '内容', 'Valor')} onChange={e => set(prev => ({ custom_fields: prev.custom_fields.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) }))} />
                <button type="button" onClick={() => set(prev => ({ custom_fields: prev.custom_fields.filter((_, j) => j !== i) }))}>✕</button>
              </div>
            ))}
            <button type="button" className="wr-link wr-wide" onClick={() => set(prev => ({ custom_fields: [...(prev.custom_fields || []), { label: '', value: '' }] }))}>＋ {tr('Add field', '項目を追加', 'Adicionar campo')}</button>
          </div>
          <h5>{tr('Opening text', '冒頭の文章', 'Texto de abertura')}</h5>
          <AiText value={r.summary} onChange={v => set({ summary: v })} field="summary" lang={r.lang} rows={4} context={ctx} placeholder={tDoc.greeting(r.client_name, r.quote?.number)} />
        </section>

        <section className="wr-card">
          <h4>{t.work}</h4>
          <p className="wr-hint">{tr('One step per line.', '1行に1工程。', 'Uma etapa por linha.')}</p>
          <Lines value={r.steps} onChange={v => set({ steps: v })} placeholder={'養生：客席・床・家具をビニールシートで養生\n分解：吸込グリル、エアフィルター…'} />
        </section>

        {SECTIONS.filter(s => detailed || s !== 'during').map(s => (
          <section key={s} className="wr-card">
            <h4>{{ before: t.before, during: t.during, after: t.after }[s]}</h4>
            {s !== 'during' && <AiText value={r[s]?.text} onChange={v => set(prev => ({ [s]: { ...prev[s], text: v } }))} field={s} lang={r.lang} context={ctx} placeholder={s === 'before' ? tr('State before the work', '作業前の状態', 'Como estava antes') : tr('Result after the work', '作業後の状態', 'Resultado depois')} />}
            <PhotoStrip photos={photosOf(s)} adding={adding === s} tr={tr} sectionOptions={sectionOptions}
              onAdd={files => addPhotos(files, { key: s, section: s })}
              onCaption={(p, v) => updPhoto(p, { caption: v })} onRemove={rmPhoto} onMove={(p, v) => updPhoto(p, { section: v })} />
            <input className="wr-cap" value={r[s]?.caption || ''} onChange={e => set(prev => ({ [s]: { ...prev[s], caption: e.target.value } }))} placeholder={tr('Caption under the photos (optional)', '写真の下の説明（任意）', 'Legenda embaixo das fotos (opcional)')} />
          </section>
        ))}

        {detailed && (
          <section className="wr-card">
            <h4>{t.parts}</h4>
            <AiText value={r.parts_intro} onChange={v => set({ parts_intro: v })} field="extra" lang={r.lang} rows={2} context={ctx} placeholder={tr('Short intro of the table (optional)', '表の前の説明（任意）', 'Introdução da tabela (opcional)')} />
            {(r.parts || []).map((p, i) => (
              <div key={i} className="wr-part">
                <div className="wr-part-head">
                  <input value={p.name} placeholder={tr('Part (e.g. ドレンパン)', '部位（例：ドレンパン）', 'Parte (ex.: ドレンパン)')} onChange={e => set(prev => ({ parts: prev.parts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) }))} />
                  <select value={p.level} onChange={e => set(prev => ({ parts: prev.parts.map((x, j) => (j === i ? { ...x, level: e.target.value } : x)) }))}>
                    {LEVELS.map(l => <option key={l} value={l}>{t.levels[l]}</option>)}
                  </select>
                  <button type="button" onClick={() => set(prev => ({ parts: prev.parts.filter((_, j) => j !== i), photos: prev.photos.filter(ph => !(ph.section === 'part' && Number(ph.part) === i)).map(ph => (ph.section === 'part' && Number(ph.part) > i ? { ...ph, part: Number(ph.part) - 1 } : ph)) }))} aria-label="remove">✕</button>
                </div>
                <div className="wr-grid">
                  {[['before', t.partCols[2]], ['why', t.partCols[3]], ['after', t.partCols[4]]].map(([k, l]) => (
                    <label key={k}>{l}<input value={p[k] || ''} onChange={e => set(prev => ({ parts: prev.parts.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) }))} /></label>
                  ))}
                </div>
                <div className="wr-pair">
                  {['before', 'after'].map(side => (
                    <div key={side}>
                      <small>{side === 'before' ? t.before : t.after}</small>
                      <PhotoStrip photos={(r.photos || []).filter(ph => ph.section === 'part' && Number(ph.part) === i && ph.side === side)} adding={adding === `part${i}${side}`} tr={tr}
                        onAdd={files => addPhotos(files.slice(0, 1), { key: `part${i}${side}`, section: 'part', part: i, side })}
                        onCaption={(ph, v) => updPhoto(ph, { caption: v })} onRemove={rmPhoto} />
                    </div>
                  ))}
                </div>
                <AiText small value={p.note} onChange={v => set(prev => ({ parts: prev.parts.map((x, j) => (j === i ? { ...x, note: v } : x)) }))} field="note" lang={r.lang} rows={2} context={`${ctx} · ${p.name}`} placeholder={tr('Explanation for the client under the photos', '写真の下の説明', 'Explicação para o cliente embaixo das fotos')} />
              </div>
            ))}
            <button type="button" className="wr-link" onClick={() => set(prev => ({ parts: [...(prev.parts || []), { name: '', level: 'heavy', before: '', why: '', after: '', note: '' }] }))}>＋ {tr('Add part', '部位を追加', 'Adicionar parte')}</button>
          </section>
        )}

        {detailed && (
          <section className="wr-card">
            <h4>{tr('Extra sections', '追加の説明', 'Seções extras')}</h4>
            <p className="wr-hint">{tr('e.g. temperature sensors, age of the equipment.', '例：温度センサーへの影響、機器の使用年数', 'ex.: sensores de temperatura, idade do equipamento.')}</p>
            {(r.extras || []).map((e, i) => (
              <div key={i} className="wr-extra">
                <div className="wr-part-head">
                  <input value={e.title} placeholder={tr('Title', '見出し', 'Título')} onChange={ev => set(prev => ({ extras: prev.extras.map((x, j) => (j === i ? { ...x, title: ev.target.value } : x)) }))} />
                  <button type="button" onClick={() => set(prev => ({ extras: prev.extras.filter((_, j) => j !== i) }))}>✕</button>
                </div>
                <AiText value={e.text} onChange={v => set(prev => ({ extras: prev.extras.map((x, j) => (j === i ? { ...x, text: v } : x)) }))} field="extra" lang={r.lang} context={`${ctx} · ${e.title}`} />
              </div>
            ))}
            <button type="button" className="wr-link" onClick={() => set(prev => ({ extras: [...(prev.extras || []), { title: '', text: '' }] }))}>＋ {tr('Add section', 'セクションを追加', 'Adicionar seção')}</button>
          </section>
        )}

        <section className="wr-card">
          <h4>{t.notices}</h4>
          <AiText value={r.notices} onChange={v => set({ notices: v })} field="notices" lang={r.lang} rows={3} context={ctx} placeholder={tr('Problems on the day, rescheduling… (empty = not shown)', '当日の問題・再設定など（空欄なら非表示）', 'Problemas no dia, remarcação… (vazio = não aparece)')} />
        </section>

        {detailed && (
          <section className="wr-card">
            <h4>{t.recs}</h4>
            <AiText small value={r.recs_intro} onChange={v => set({ recs_intro: v })} field="extra" lang={r.lang} rows={2} context={ctx} placeholder={tr('Intro (optional)', '前文（任意）', 'Introdução (opcional)')} />
            <p className="wr-hint">{tr('One recommendation per line.', '1行に1つ。', 'Uma sugestão por linha.')}</p>
            <Lines rows={4} value={r.recommendations} onChange={v => set({ recommendations: v })} placeholder={'分解洗浄：年1回を強く推奨\nエアフィルター清掃：2週間に1回'} />
          </section>
        )}

        <section className="wr-card">
          <h4>{tr('Closing', '結び', 'Fechamento')}</h4>
          <input className="wr-cap" value={r.closing || ''} onChange={e => set({ closing: e.target.value })} />
        </section>

          </>
        )}

        {view === 'internal' && (
          <>
            <p className="wr-internal-note">🔒 {tr('Nothing on this tab goes to the client. The preview shows exactly what the client sees.', 'このタブの内容は顧客には表示されません。プレビューが顧客に見える内容です。', 'Nada desta aba vai para o cliente. A prévia mostra exatamente o que o cliente vê.')}</p>
            <section className="wr-card wr-notes">
              <h4>{tr('Team notes for the AI (any language)', 'スタッフのメモ（AI用・何語でも可）', 'Notas da equipe para a IA (qualquer idioma)')}</h4>
              <p className="wr-hint">{tr('What you found, what you did, problems on the day, what the client should do. The AI writes the report from this.', '状態・作業内容・当日の問題・お客様への提案などを書いてください。AIが報告書にまとめます。', 'O que encontrou, o que fez, problemas no dia, o que o cliente deve fazer. A IA escreve o relatório a partir disso.')}</p>
              <textarea rows={5} value={r.notes_raw || ''} onChange={e => set({ notes_raw: e.target.value })} placeholder={tr('e.g. 6 ceiling ACs, drain pan very dirty with black mold and bad smell, filters clogged… elevator was locked so outside cleaning moved to another day', '例：天井カセット6台、ドレンパンに黒カビ・悪臭…', 'ex.: 6 ar-condicionados de teto, bandeja de dreno muito suja com mofo e cheiro forte, filtros entupidos… elevador estava trancado, limpeza externa ficou para outro dia')} />
            </section>

            {isAdmin && (
              <section className="wr-card"><h4>{tr('Quote and amount', '見積・金額', 'Orçamento e valor')}</h4><div className="wr-quote">
                <label>{tr('Quote', '御見積書', 'Orçamento')}
                  <select value="" onChange={e => { const q = quotes.find(x => x.id === e.target.value); if (q) set({ quote: { number: q.quote_number || '', subtotal: q.subtotal || '', tax_rate: q.tax_rate ?? 10, label: r.quote?.label || '' } }) }}>
                    <option value="">{quotes.length ? tr('Fill from a quote…', '見積書から入力…', 'Preencher de um orçamento…') : tr('No quote for this client', '見積書なし', 'Sem orçamento deste cliente')}</option>
                    {quotes.map(q => <option key={q.id} value={q.id}>No.{q.quote_number} · {q.site_name || q.needs || ''} · ¥{Number(q.total || 0).toLocaleString('ja-JP')}</option>)}
                  </select>
                </label>
                <label>No.<input value={r.quote?.number || ''} onChange={e => set(prev => ({ quote: { ...prev.quote, number: e.target.value } }))} /></label>
                <label>{tr('Amount excl. tax', '税抜金額', 'Valor sem imposto')}<input inputMode="numeric" value={r.quote?.subtotal || ''} onChange={e => set(prev => ({ quote: { ...prev.quote, subtotal: e.target.value } }))} /></label>
                <label>{tr('Label', '表記', 'Rótulo')}<input value={r.quote?.label || ''} placeholder="7台" onChange={e => set(prev => ({ quote: { ...prev.quote, label: e.target.value } }))} /></label>
                {money && <small>¥{money.sub.toLocaleString('ja-JP')} + {money.rate}% ¥{money.tax.toLocaleString('ja-JP')} = <b>¥{money.total.toLocaleString('ja-JP')}</b></small>}
              </div></section>
            )}
            {isAdmin && (
              <section className="wr-card">
                <h4>{tr('Office note', '事務所メモ', 'Nota do escritório')}</h4>
                <textarea rows={3} value={r.internal?.office_note || ''} onChange={e => set(prev => ({ internal: { ...(prev.internal || {}), office_note: e.target.value } }))} placeholder={tr('Only the office sees this.', '事務所だけが見られます。', 'Só o escritório vê.')} />
              </section>
            )}
          </>
        )}

        <footer className="wr-foot">
          {isAdmin ? (
            r.status === 'sent'
              ? <><span>✓ {tr('The client sees it in the portal', '顧客ポータルに表示中', 'O cliente vê no portal')}{r.sent_at ? ` · ${new Date(r.sent_at).toLocaleDateString(uiLang === 'ja' ? 'ja-JP' : 'pt-BR')}` : ''}</span>
                  <button type="button" className="btn btn-sm" onClick={unsend}>{tr('Hide from client', '非表示にする', 'Tirar do portal')}</button>
                  <button type="button" className="btn btn-sm btn-primary" disabled={saving || !dirty} onClick={() => save({}, 'edit-after-send')}>{tr('Save changes', '変更を保存', 'Salvar alterações')}</button></>
              : <><button type="button" className="btn" onClick={preview}>👁 {tr('Preview / PDF', 'プレビュー・PDF', 'Ver / PDF')}</button>
                  <button type="button" className="btn btn-primary" disabled={saving} onClick={send}>📨 {tr('Send to client', '顧客へ送付', 'Enviar ao cliente')}</button></>
          ) : (
            <>
              <span>{tr('The office checks and sends it to the client.', '事務所が確認して送付します。', 'O escritório confere e envia ao cliente.')}</span>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={() => save({ status: r.status === 'sent' ? 'sent' : 'ready' }, 'ready')}>{tr('Save and send to office', '保存して事務所へ', 'Salvar e mandar ao escritório')}</button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}

/** <WorkReportEditor reportId? job? client? role author onClose onSaved /> */
export default function WorkReportEditor(props) {
  return createPortal(
    <div className="wr-overlay">
      <EditorBody {...props} />
    </div>,
    document.body,
  )
}
