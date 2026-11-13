// v1.0.230 · Admin "Relatório mensal — Deep OTP": pick the month → the system gathers the completed
// deep cleanings of On The Planet with their before/after photos → preview of the PDF pages on the
// screen → download the PDF. READ ONLY: nothing is saved, sent or changed (sending = Bloco 2).
// Rules: date + START time only (never end/duration), no values, only completed deep jobs that have
// a BEFORE and an AFTER photo. The rest is listed only here: "visitas fora do relatório e por quê".
// v1.0.247 · Became the "Relatório mensal do cliente": any client (selector, OTP by default); the AI
// writes the opening, "what was done and why" of each visit and the closing — the admin sees them in
// the full preview and can edit any of them (the edited text is the one that goes in the PDF; kept
// in this browser per client + month + language). Still nothing is sent from here (Bloco 2).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'
import { useAuth } from '../hooks/useAuth'
import { tokyoToday } from '../lib/dates'
import { autoTexts, deepMonthReportHtml, OTP_CLIENT, REASONS, reportText, serviceLabel } from '../lib/deepMonthReport'
import { aiMonthTexts, deepMonthPdfBlob, loadDeepMonthReport, loadReportClients, preparePhotos } from '../lib/deepMonthReportOps'
import { resolveTexts } from '../lib/monthReportText'
import { quoteIssuerForLang } from '../lib/quoteIssuer'
import { OwnerSignaturePad } from '../components/QuickReport'
import { keepOwnerSig, readOwnerSig } from '../lib/quickReport'
import '../components/work-report.css'

const thisMonth = () => tokyoToday().slice(0, 7)
const editsKey = (clientId, month, lang) => `kp_cmr_edits:${clientId}:${month}:${lang}`
function readEdits(key) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v && typeof v === 'object' ? { visits: {}, ...v } : { visits: {} } } catch { return { visits: {} } }
}
function keepEdits(key, edits) {
  try {
    const empty = edits.intro == null && edits.closing == null && !Object.keys(edits.visits || {}).length
    if (empty) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(edits))
  } catch { /* private mode: edits live only on this screen */ }
}
const slug = s => String(s || 'Cliente').normalize('NFKD').replace(/[^\w]+/g, '') || 'Cliente'

/** Waits `ms` after the last change (the preview iframe reloads big data URLs on every change). */
function useDebounced(value, ms) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}
const field = { font: 'inherit', fontSize: 14, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface, #fff)' }

/** The client document shown at page width (scaled down on a phone). */
function Preview({ html }) {
  const box = useRef(null)
  const frame = useRef(null)
  const [w, setW] = useState(820)
  const [h, setH] = useState(1200)
  useEffect(() => {
    const el = box.current
    if (!el) return undefined
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const scale = Math.min(1, w / 820)
  const onLoad = () => {
    const doc = frame.current?.contentDocument
    if (!doc) return
    const fit = () => setH(doc.documentElement.scrollHeight)
    fit()
    ;[...doc.images].forEach(img => { if (!img.complete) img.addEventListener('load', fit, { once: true }) })
  }
  return (
    <div ref={box} style={{ width: '100%', overflow: 'hidden', borderRadius: 10, background: '#e9edf3', height: h * scale + 8 }}>
      <iframe ref={frame} title="PDF" srcDoc={html} onLoad={onLoad} scrolling="no"
        style={{ width: 820, height: h, border: 0, transform: `scale(${scale})`, transformOrigin: '0 0', display: 'block', paddingTop: 8 }} />
    </div>
  )
}

/** One AI text the admin can change. */
function TextBox({ label, sub, item, aiText, onChange, onReset, L, rows = 3 }) {
  const badge = item.source === 'edited'
    ? { t: L('edited by you', '編集済み', 'editado por você'), c: '#7c3aed' }
    : item.source === 'ai' ? { t: L('written by the AI', 'AI作成', 'escrito pela IA'), c: '#2563eb' }
      : { t: L('automatic text', '自動作成', 'texto automático'), c: '#64748b' }
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline', marginBottom: 4 }}>
        <b style={{ fontSize: 13.5 }}>{label}</b>
        {sub && <span style={{ fontSize: 12, color: 'var(--text2)' }}>{sub}</span>}
        <span style={{ fontSize: 11, fontWeight: 700, color: badge.c, border: `1px solid ${badge.c}`, borderRadius: 10, padding: '0 7px' }}>{badge.t}</span>
        {item.source === 'edited' && (
          <button type="button" className="btn btn-sm" onClick={onReset} style={{ padding: '2px 8px', fontSize: 12 }}>
            ↺ {aiText ? L('back to the AI text', 'AIの文に戻す', 'voltar ao texto da IA') : L('back to the automatic text', '自動の文に戻す', 'voltar ao texto automático')}
          </button>
        )}
      </div>
      <textarea value={item.source === 'edited' ? item.raw : item.text} rows={rows} onChange={e => onChange(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 13.5, lineHeight: 1.6, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface, #fff)', color: 'inherit', resize: 'vertical' }} />
      {item.removed > 0 && (
        <div style={{ fontSize: 12, color: 'var(--red, #dc2626)', marginTop: 2 }}>
          ⚠️ {L(`${item.removed} sentence(s) with a time, duration or value will NOT go into the PDF.`, `時刻・時間・金額を含む文（${item.removed}件）はPDFに入りません。`, `${item.removed} frase(s) com horário, duração ou valor NÃO vai(ão) para o PDF.`)}
        </div>
      )}
    </div>
  )
}

export default function DeepMonthReport() {
  const { tr, lang: uiLang } = useLang()
  const { user } = useAuth()
  const [clients, setClients] = useState([OTP_CLIENT])
  const [clientId, setClientId] = useState(OTP_CLIENT.id)
  const [month, setMonth] = useState(thisMonth)
  const [docLang, setDocLang] = useState('ja')
  const [busy, setBusy] = useState(null) // text of what is running
  const [result, setResult] = useState(null) // { report, images }
  const [ai, setAi] = useState({}) // lang → { intro, closing, visits } from the AI
  const [aiState, setAiState] = useState({}) // lang → 'busy' | 'ok' | error text
  const [edits, setEdits] = useState({ visits: {} })
  const [sig, setSig] = useState(() => readOwnerSig(user?.id))
  const [pad, setPad] = useState(false)
  const [pdfUrl, setPdfUrl] = useState(null)
  const L = (en, ja, pt) => tr(en, ja, pt)
  const reasonText = k => { const r = REASONS[k] || [k, k, k]; return uiLang === 'ja' ? r[1] : uiLang === 'pt' ? r[2] : r[0] }
  const issuer = useMemo(() => quoteIssuerForLang(docLang), [docLang])
  const client = clients.find(c => c.id === clientId) || OTP_CLIENT
  const key = editsKey(clientId, month, docLang)

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl) }, [pdfUrl])
  useEffect(() => {
    let live = true
    loadReportClients(month).then(list => { if (live && list.length) setClients(list) }).catch(e => toast.error(String(e.message || e)))
    return () => { live = false }
  }, [month])
  useEffect(() => { setEdits(readEdits(key)) }, [key])
  const reset = () => { setResult(null); setAi({}); setAiState({}) }

  const askAi = useCallback(async (report, lang, name) => {
    setAiState(s => ({ ...s, [lang]: 'busy' }))
    try {
      const out = await aiMonthTexts(report, { lang, clientName: name, today: tokyoToday() })
      setAi(a => ({ ...a, [lang]: out }))
      setAiState(s => ({ ...s, [lang]: 'ok' }))
    } catch (e) {
      setAiState(s => ({ ...s, [lang]: String(e.message || e) }))
    }
  }, [])

  const generate = async () => {
    reset(); setPdfUrl(null)
    try {
      setBusy(L('Reading the deep cleanings of the month…', '今月のディープを読み込み中…', 'Lendo os deep do mês…'))
      const base = await loadDeepMonthReport(month, {
        client,
        onProgress: p => setBusy(p.step === 'photos'
          ? L(`Looking for photos ${p.done}/${p.total}…`, `写真を確認中 ${p.done}/${p.total}…`, `Procurando as fotos ${p.done}/${p.total}…`)
          : L('Reading the service report notes…', '作業報告書の備考を読み込み中…', 'Lendo as observações dos relatórios…')),
      })
      setBusy(L('Preparing the photos…', '写真を準備中…', 'Preparando as fotos…'))
      const prepared = await preparePhotos(base, { onProgress: (d, t) => setBusy(L(`Preparing the photos ${d}/${t}…`, `写真を準備中 ${d}/${t}…`, `Preparando as fotos ${d}/${t}…`)) })
      setResult(prepared)
      setBusy(null)
      await askAi(prepared.report, docLang, client.name)
    } catch (e) {
      toast.error(String(e.message || e))
    } finally { setBusy(null) }
  }
  // Another PDF language after generating: the AI writes in that language too (once).
  useEffect(() => {
    if (result && !ai[docLang] && !aiState[docLang]) askAi(result.report, docLang, client.name)
  }, [docLang, result, ai, aiState, askAi, client.name])

  const r = result?.report
  const auto = useMemo(() => (r ? autoTexts(r, { lang: docLang, clientName: client.name, today: tokyoToday() }) : null), [r, docLang, client.name])
  const texts = useMemo(() => {
    if (!auto) return null
    const t = resolveTexts({ auto, ai: ai[docLang] || {}, edits })
    // keep the raw edited text for the box (the PDF gets the cleaned one)
    const raw = (item, val) => ({ ...item, raw: typeof val === 'string' ? val : item.text })
    return {
      intro: raw(t.intro, edits.intro), closing: raw(t.closing, edits.closing),
      visits: Object.fromEntries(Object.entries(t.visits).map(([id, it]) => [id, raw(it, edits.visits?.[id])])),
    }
  }, [auto, ai, docLang, edits])
  const setEdit = (field, value, id) => {
    setEdits(prev => {
      const next = { ...prev, visits: { ...(prev.visits || {}) } }
      if (id) { if (value == null) delete next.visits[id]; else next.visits[id] = value } else if (value == null) delete next[field]; else next[field] = value
      keepEdits(key, next)
      return next
    })
  }

  const liveHtml = useMemo(() => (result && texts ? deepMonthReportHtml(result.report, {
    lang: docLang, clientName: client.name, issuedOn: tokyoToday(), signature: sig, signer: issuer.name, issuer, images: result.images, texts,
  }) : ''), [result, docLang, sig, issuer, texts, client.name])
  const html = useDebounced(liveHtml, 700)
  useEffect(() => { setPdfUrl(null) }, [html])

  const makePdf = async () => {
    if (!liveHtml) return null
    if (pdfUrl && html === liveHtml) return pdfUrl
    setBusy(L('Making the PDF…', 'PDFを作成中…', 'Gerando o PDF…'))
    try {
      const blob = await deepMonthPdfBlob(liveHtml, { onProgress: (d, t) => setBusy(L(`Making the PDF — page ${d}/${t}…`, `PDF作成中 ${d}/${t}ページ…`, `Gerando o PDF — página ${d}/${t}…`)) })
      const url = URL.createObjectURL(blob)
      setPdfUrl(url)
      return url
    } catch (e) { toast.error(String(e.message || e)); return null } finally { setBusy(null) }
  }
  const fileName = `KuriPuro_RelatorioMensal_${slug(client.name)}_${month}.pdf`
  const download = async () => {
    const url = await makePdf()
    if (!url) return
    const a = document.createElement('a')
    a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove()
  }

  const T = reportText(uiLang)
  const DT = reportText(docLang)
  const unfinishedMonth = month >= thisMonth()
  const st = aiState[docLang]
  const aiTexts = ai[docLang] || {}

  return (
    <div style={{ maxWidth: 980 }}>
      <h2 className="page-head" style={{ marginBottom: 4, fontSize: 22 }}>📑 {L('Client monthly report', 'お客様月次報告書', 'Relatório mensal do cliente')}</h2>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text2)' }}>
        {L('One PDF per client with the completed deep cleanings of the month: summary with charts, then each visit with date, start time and the before/after photos. The AI writes the texts from the service data only; you can change any of them before downloading. No end time, no duration, no values. Nothing is sent from here.',
          'お客様ごとのPDF：今月完了したディープクリーニングのまとめ（グラフ）と、訪問ごとの日付・開始時刻・作業前後の写真。文章はAIが作業データだけから作成し、ダウンロード前に自由に編集できます。終了時刻・作業時間・金額は載りません。ここからは送信しません。',
          'Um PDF por cliente com os deep concluídos do mês: resumo com gráficos e depois cada visita com data, hora de início e as fotos de antes e depois. A IA escreve os textos só com os dados do serviço; você pode mudar qualquer um antes de baixar. Sem hora de término, sem duração, sem valores. Nada é enviado daqui.')}
      </p>

      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text2)', flex: '1 1 220px', minWidth: 0 }}>
          {L('Client', 'お客様', 'Cliente')}
          <select value={clientId} onChange={e => { setClientId(e.target.value); reset() }} style={{ ...field, width: '100%' }}>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.name}{c.deep ? ` — ${L(`${c.done} deep done / ${c.deep}`, `ディープ ${c.done}/${c.deep}件`, `${c.done} deep feitos / ${c.deep}`)}` : ''}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text2)' }}>
          {L('Month', '対象月', 'Mês')}
          <input type="month" value={month} max={thisMonth()} onChange={e => { setMonth(e.target.value); reset() }} style={field} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text2)' }}>
          {L('PDF language', 'PDFの言語', 'Idioma do PDF')}
          <select value={docLang} onChange={e => setDocLang(e.target.value)} style={field}>
            <option value="ja">日本語</option><option value="pt">Português</option><option value="en">English</option>
          </select>
        </label>
        <button type="button" className="btn btn-primary" disabled={!!busy || !month} onClick={generate} style={{ minHeight: 40 }}>
          {r ? L('Generate again', '再作成', 'Gerar de novo') : L('Generate report', '報告書を作成', 'Gerar relatório')}
        </button>
        {busy && <span style={{ fontSize: 13, color: 'var(--text2)' }}>⏳ {busy}</span>}
      </div>

      {r && (
        <>
          <div className="card">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'baseline', marginBottom: 6 }}>
              <b style={{ fontSize: 16 }}>{client.name} · {L(`${r.visits.length} visits in the PDF`, `PDFに載る訪問 ${r.visits.length}件`, `${r.visits.length} visitas no PDF`)}</b>
              <span style={{ fontSize: 13, color: 'var(--text2)' }}>
                {L(`Completed ${r.total.done} of ${r.total.programmed} scheduled (${r.total.pct}%)`, `予定${r.total.programmed}件中 ${r.total.done}件完了（${r.total.pct}%）`, `Concluídos ${r.total.done} de ${r.total.programmed} programados (${r.total.pct}%)`)}
              </span>
            </div>
            {unfinishedMonth && (
              <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--text2)' }}>
                ℹ️ {L(`This month is not over: ${r.notDone.length} deep cleanings are still scheduled, so the % will go up as they are done.`, `今月はまだ終わっていません。予定中のディープが${r.notDone.length}件あり、完了するごとに%が上がります。`, `O mês ainda não acabou: ${r.notDone.length} deep ainda estão agendados, o % sobe conforme forem feitos.`)}
              </p>
            )}
            {r.total.programmed === 0 && (
              <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--text2)' }}>ℹ️ {L('This client has no deep cleaning in this month.', 'このお客様の今月のディープはありません。', 'Este cliente não tem deep neste mês.')}</p>
            )}
            {r.total.done > 0 && r.visits.length === 0 && (
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--red, #dc2626)' }}>⚠️ {L('No completed visit has both a before and an after photo: the PDF has only the summary and the closing.', '作業前・作業後の写真がそろった訪問がないため、PDFはまとめと完了報告のみです。', 'Nenhuma visita concluída tem foto de antes E de depois: o PDF sai só com o resumo e o fechamento.')}</p>
            )}
          </div>

          <div className="card" style={{ borderLeft: '4px solid var(--amber, #d97706)' }}>
            <b style={{ fontSize: 15 }}>🔒 {L('Visits left out of the report, and why', '報告書に載らない訪問と理由', 'Visitas fora do relatório e por quê')} ({r.excluded.length})</b>
            <p style={{ margin: '4px 0 10px', fontSize: 12.5, color: 'var(--text2)' }}>
              {L('Only you see this list — it is never in the client file. Fix the photo of the service and generate again.', 'この一覧は管理者だけに表示され、お客様のファイルには入りません。写真を直して再作成してください。', 'Só você vê esta lista — ela nunca vai no arquivo do cliente. Resolva a foto do serviço e gere de novo.')}
            </p>
            {r.excluded.length === 0
              ? <p style={{ margin: 0, fontSize: 13, color: 'var(--green, #16a34a)' }}>✓ {L('Every completed deep cleaning has before and after photos.', '完了したディープはすべて作業前後の写真があります。', 'Todos os deep concluídos têm foto de antes e depois.')}</p>
              : (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
                  {r.excluded.map(x => (
                    <li key={x.job.id}><b>{T.dateFmt(x.job.scheduled_date)}</b> · {x.store}{x.job.employee_name ? ` · ${x.job.employee_name}` : ''} — <span style={{ color: 'var(--red, #dc2626)' }}>{x.reasons.map(reasonText).join(' · ')}</span></li>
                  ))}
                </ul>
              )}
            {r.visits.some(v => v.warnings.length) && (
              <>
                <b style={{ display: 'block', marginTop: 12, fontSize: 13 }}>{L('In the report, with a note for you', '報告書に載るが確認してほしい訪問', 'No relatório, mas confira')}</b>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7, color: 'var(--text2)' }}>
                  {r.visits.filter(v => v.warnings.length).map(v => (
                    <li key={v.id}>{T.dateFmt(v.date)} · {v.store} — {v.warnings.map(reasonText).join(' · ')}</li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {texts && (
            <div className="card" style={{ borderLeft: '4px solid #2563eb' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 6 }}>
                <b style={{ fontSize: 15 }}>✍️ {L('Report texts', '報告書の文章', 'Textos do relatório')}</b>
                <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>
                  {st === 'busy' ? `⏳ ${L('The AI is writing from the service data…', 'AIが作業データから作成中…', 'A IA está escrevendo com os dados dos serviços…')}`
                    : st === 'ok' ? `✓ ${L('Written by the AI from the service data only. Read and change what you want — your text is the one that counts.', 'AIが作業データのみから作成しました。確認して自由に編集できます（編集した文が優先されます）。', 'Escrito pela IA só com os dados dos serviços. Leia e mude o que quiser — o seu texto é o que vale.')}`
                      : st ? `⚠️ ${L('The AI did not answer — the automatic texts (facts only) are in the PDF.', 'AIが応答しませんでした。自動作成の文（事実のみ）がPDFに入ります。', 'A IA não respondeu — os textos automáticos (só fatos) estão no PDF.')} (${st})` : ''}
                </span>
                <span style={{ flex: 1 }} />
                <button type="button" className="btn btn-sm" disabled={st === 'busy' || !!busy} onClick={() => askAi(r, docLang, client.name)}>🤖 {L('Ask the AI again', 'AIに再作成させる', 'Pedir à IA de novo')}</button>
              </div>
              <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text2)' }}>
                {L('Sentences with a time of day, duration or value never go into the PDF, even if typed here. Your changes stay saved in this browser for this client, month and language.', '時刻・作業時間・金額を含む文は、ここに入力してもPDFには入りません。編集内容はこのブラウザに、お客様・月・言語ごとに保存されます。', 'Frases com horário, duração ou valor nunca vão para o PDF, mesmo se digitadas aqui. Suas mudanças ficam salvas neste navegador para este cliente, mês e idioma.')}
              </p>
              <TextBox L={L} label={L('Opening — summary of the month', '冒頭 — 今月のまとめ', 'Abertura — resumo do mês')} item={texts.intro} aiText={aiTexts.intro} rows={5}
                onChange={v => setEdit('intro', v)} onReset={() => setEdit('intro', null)} />
              {r.visits.map((v, i) => (
                <TextBox key={v.id} L={L} rows={3}
                  label={`${i + 1}. ${v.store}`}
                  sub={`${DT.dateFmt(v.date)}${v.service ? ` · ${serviceLabel(v.service, docLang)}` : ''} — ${DT.why}`}
                  item={texts.visits[v.id]} aiText={aiTexts.visits?.[v.id]}
                  onChange={val => setEdit('visits', val, v.id)} onReset={() => setEdit('visits', null, v.id)} />
              ))}
              <TextBox L={L} label={L('Closing', '結び', 'Fechamento')} item={texts.closing} aiText={aiTexts.closing} rows={3}
                onChange={v => setEdit('closing', v)} onReset={() => setEdit('closing', null)} />
            </div>
          )}

          <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 13 }}>✍️ {sig ? L('Your signature is on the closing page.', '最終ページに署名が入っています。', 'Sua assinatura está na página de fechamento.') : L('No signature yet on the closing page.', '最終ページにまだ署名がありません。', 'Ainda sem assinatura na página de fechamento.')}</span>
            <button type="button" className="btn btn-sm" onClick={() => setPad(true)}>{sig ? L('Change signature', '署名を変更', 'Trocar assinatura') : L('Add my signature', '署名を追加', 'Adicionar minha assinatura')}</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-primary" disabled={!!busy || st === 'busy'} onClick={download} style={{ minHeight: 40 }}>⬇ {L('Download PDF', 'PDFをダウンロード', 'Baixar PDF')}</button>
          </div>

          <h3 style={{ margin: '18px 0 8px', fontSize: 15 }}>👁 {L('Preview — exactly what goes into the PDF', 'プレビュー（PDFと同じ内容）', 'Prévia — exatamente o que vai no PDF')}</h3>
          {html && <Preview html={html} />}
        </>
      )}

      {pad && (
        <div className="qr-pad-wrap">
          <OwnerSignaturePad current={readOwnerSig(user?.id)} title={L('Sign the report', '報告書に署名', 'Assinar o relatório')}
            onCancel={() => setPad(false)}
            onSave={(url, fresh) => { if (fresh) keepOwnerSig(user?.id, url); setSig(url); setPad(false) }} />
        </div>
      )}
    </div>
  )
}
