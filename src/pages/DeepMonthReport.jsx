// v1.0.230 · Admin "Relatório mensal — Deep OTP": pick the month → the system gathers the completed
// deep cleanings of On The Planet with their before/after photos → preview of the PDF pages on the
// screen → download the PDF. READ ONLY: nothing is saved, sent or changed (sending = Bloco 2).
// Rules: date + START time only (never end/duration), no values, only completed deep jobs that have
// a BEFORE and an AFTER photo. The rest is listed only here: "visitas fora do relatório e por quê".
import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'
import { useAuth } from '../hooks/useAuth'
import { tokyoToday } from '../lib/dates'
import { deepMonthReportHtml, OTP_NAME, REASONS, reportText } from '../lib/deepMonthReport'
import { deepMonthPdfBlob, loadDeepMonthReport, preparePhotos } from '../lib/deepMonthReportOps'
import { quoteIssuerForLang } from '../lib/quoteIssuer'
import { OwnerSignaturePad } from '../components/QuickReport'
import { keepOwnerSig, readOwnerSig } from '../lib/quickReport'
import '../components/work-report.css'

const thisMonth = () => tokyoToday().slice(0, 7)
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

export default function DeepMonthReport() {
  const { tr, lang: uiLang } = useLang()
  const { user } = useAuth()
  const [month, setMonth] = useState(thisMonth)
  const [docLang, setDocLang] = useState('ja')
  const [busy, setBusy] = useState(null) // text of what is running
  const [result, setResult] = useState(null) // { report, images }
  const [sig, setSig] = useState(() => readOwnerSig(user?.id))
  const [pad, setPad] = useState(false)
  const [pdfUrl, setPdfUrl] = useState(null)
  const L = (en, ja, pt) => tr(en, ja, pt)
  const reasonText = k => { const r = REASONS[k] || [k, k, k]; return uiLang === 'ja' ? r[1] : uiLang === 'pt' ? r[2] : r[0] }
  const issuer = useMemo(() => quoteIssuerForLang(docLang), [docLang])

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl) }, [pdfUrl])

  const generate = async () => {
    setResult(null); setPdfUrl(null)
    try {
      setBusy(L('Reading the deep cleanings of the month…', '今月のディープを読み込み中…', 'Lendo os deep do mês…'))
      const base = await loadDeepMonthReport(month, {
        onProgress: p => setBusy(p.step === 'photos'
          ? L(`Looking for photos ${p.done}/${p.total}…`, `写真を確認中 ${p.done}/${p.total}…`, `Procurando as fotos ${p.done}/${p.total}…`)
          : L('Reading the service report notes…', '作業報告書の備考を読み込み中…', 'Lendo as observações dos relatórios…')),
      })
      setBusy(L('Preparing the photos…', '写真を準備中…', 'Preparando as fotos…'))
      const prepared = await preparePhotos(base, { onProgress: (d, t) => setBusy(L(`Preparing the photos ${d}/${t}…`, `写真を準備中 ${d}/${t}…`, `Preparando as fotos ${d}/${t}…`)) })
      setResult(prepared)
    } catch (e) {
      toast.error(String(e.message || e))
    } finally { setBusy(null) }
  }

  const html = useMemo(() => (result ? deepMonthReportHtml(result.report, {
    lang: docLang, clientName: OTP_NAME, issuedOn: tokyoToday(), signature: sig, signer: issuer.name, issuer, images: result.images,
  }) : ''), [result, docLang, sig, issuer])
  useEffect(() => { setPdfUrl(null) }, [html])

  const makePdf = async () => {
    if (!html) return null
    if (pdfUrl) return pdfUrl
    setBusy(L('Making the PDF…', 'PDFを作成中…', 'Gerando o PDF…'))
    try {
      const blob = await deepMonthPdfBlob(html, { onProgress: (d, t) => setBusy(L(`Making the PDF — page ${d}/${t}…`, `PDF作成中 ${d}/${t}ページ…`, `Gerando o PDF — página ${d}/${t}…`)) })
      const url = URL.createObjectURL(blob)
      setPdfUrl(url)
      return url
    } catch (e) { toast.error(String(e.message || e)); return null } finally { setBusy(null) }
  }
  const fileName = `KuriPuro_DeepCleaning_OnThePlanet_${month}.pdf`
  const download = async () => {
    const url = await makePdf()
    if (!url) return
    const a = document.createElement('a')
    a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove()
  }

  const r = result?.report
  const T = reportText(uiLang)
  const unfinishedMonth = month >= thisMonth()

  return (
    <div style={{ maxWidth: 980 }}>
      <h2 className="page-head" style={{ marginBottom: 4, fontSize: 22 }}>🧽 {L('Monthly report — Deep OTP', '月次報告書 — ディープ（OTP）', 'Relatório mensal — Deep OTP')}</h2>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text2)' }}>
        {L('PDF for On The Planet with the completed deep cleanings of the month: summary with charts, then each visit with date, start time and the before/after photos. No end time, no duration, no values. Nothing is sent from here.',
          'On The Planet様向けPDF：今月完了したディープクリーニングのまとめ（グラフ）と、訪問ごとの日付・開始時刻・作業前後の写真。終了時刻・作業時間・金額は載りません。ここからは送信しません。',
          'PDF para a On The Planet com os deep concluídos do mês: resumo com gráficos e depois cada visita com data, hora de início e as fotos de antes e depois. Sem hora de término, sem duração, sem valores. Nada é enviado daqui.')}
      </p>

      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text2)' }}>
          {L('Month', '対象月', 'Mês')}
          <input type="month" value={month} max={thisMonth()} onChange={e => { setMonth(e.target.value); setResult(null) }} style={field} />
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
              <b style={{ fontSize: 16 }}>{L(`${r.visits.length} visits in the PDF`, `PDFに載る訪問 ${r.visits.length}件`, `${r.visits.length} visitas no PDF`)}</b>
              <span style={{ fontSize: 13, color: 'var(--text2)' }}>
                {L(`Completed ${r.total.done} of ${r.total.programmed} scheduled (${r.total.pct}%)`, `予定${r.total.programmed}件中 ${r.total.done}件完了（${r.total.pct}%）`, `Concluídos ${r.total.done} de ${r.total.programmed} programados (${r.total.pct}%)`)}
              </span>
            </div>
            {unfinishedMonth && (
              <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--text2)' }}>
                ℹ️ {L(`This month is not over: ${r.notDone.length} deep cleanings are still scheduled, so the % will go up as they are done.`, `今月はまだ終わっていません。予定中のディープが${r.notDone.length}件あり、完了するごとに%が上がります。`, `O mês ainda não acabou: ${r.notDone.length} deep ainda estão agendados, o % sobe conforme forem feitos.`)}
              </p>
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

          <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 13 }}>✍️ {sig ? L('Your signature is on the closing page.', '最終ページに署名が入っています。', 'Sua assinatura está na página de fechamento.') : L('No signature yet on the closing page.', '最終ページにまだ署名がありません。', 'Ainda sem assinatura na página de fechamento.')}</span>
            <button type="button" className="btn btn-sm" onClick={() => setPad(true)}>{sig ? L('Change signature', '署名を変更', 'Trocar assinatura') : L('Add my signature', '署名を追加', 'Adicionar minha assinatura')}</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-primary" disabled={!!busy} onClick={download} style={{ minHeight: 40 }}>⬇ {L('Download PDF', 'PDFをダウンロード', 'Baixar PDF')}</button>
          </div>

          <h3 style={{ margin: '18px 0 8px', fontSize: 15 }}>👁 {L('Preview — exactly what goes into the PDF', 'プレビュー（PDFと同じ内容）', 'Prévia — exatamente o que vai no PDF')}</h3>
          <Preview html={html} />
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
