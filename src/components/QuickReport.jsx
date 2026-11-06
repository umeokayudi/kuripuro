// v1.0.158 · One-tap reports: "Relatório" (service) and "Relatório do dia" (one person, one day).
// The report opens already built (never a blank form); "Editar" opens the normal editors,
// "Aceitar e assinar" puts the owner's signature on a day report.
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'
import { useAuth } from '../hooks/useAuth'
import { loadReport, reportHtml } from '../lib/workReport'
import { quickJobReport, quickDayReport, acceptDayReport, readOwnerSig, keepOwnerSig } from '../lib/quickReport'
import { openPrintHtml } from '../lib/openPrintHtml'
import { SIGNATURE_INK } from '../lib/signature'
import './work-report.css'

const WorkReportEditor = lazy(() => import('./WorkReportEditor'))
const PeriodReportEditor = lazy(() => import('./PeriodReportEditor'))

export function OwnerSignaturePad({ current, onSave, onCancel, title }) {
  const { tr } = useLang()
  const ref = useRef(null)
  const drawing = useRef(false)
  const [ink, setInk] = useState(false)
  const paper = () => { const c = ref.current; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height) }
  useEffect(() => { paper() }, [])
  const pos = e => { const c = ref.current, b = c.getBoundingClientRect(), t = e.touches?.[0] || e; return [(t.clientX - b.left) * c.width / b.width, (t.clientY - b.top) * c.height / b.height] }
  const down = e => { e.preventDefault(); drawing.current = true; const x = ref.current.getContext('2d'); const [a, b] = pos(e); x.beginPath(); x.moveTo(a, b) }
  const move = e => { if (!drawing.current) return; e.preventDefault(); const x = ref.current.getContext('2d'); x.strokeStyle = SIGNATURE_INK; x.lineWidth = 3; x.lineCap = 'round'; x.lineJoin = 'round'; const [a, b] = pos(e); x.lineTo(a, b); x.stroke(); setInk(true) }
  const up = () => { drawing.current = false }
  return (
    <div className="qr-pad" role="dialog" aria-label={tr('Your signature', 'あなたの署名', 'Sua assinatura')}>
      <b>{title || tr('Accept and sign', '承認して署名', 'Aceitar e assinar')}</b>
      <small>{current ? tr('Use your saved signature or draw a new one.', '保存済みの署名を使うか、新しく書いてください。', 'Use a assinatura salva ou desenhe outra.') : tr('Draw your signature. It is kept on this device for next time.', '署名を書いてください。この端末に保存されます。', 'Desenhe sua assinatura. Ela fica salva neste aparelho para a próxima vez.')}</small>
      {current && <button type="button" className="btn btn-primary" onClick={() => onSave(current)}>✓ {tr('Sign with my saved signature', '保存済みの署名で署名', 'Assinar com a assinatura salva')} <img src={current} alt="" /></button>}
      <canvas ref={ref} width={600} height={200} onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up} onTouchStart={down} onTouchMove={move} onTouchEnd={up} />
      <div className="qr-pad-actions">
        <button type="button" className="btn btn-sm" onClick={() => { paper(); setInk(false) }}>{tr('Clear', 'クリア', 'Limpar')}</button>
        <button type="button" className="btn btn-sm" onClick={onCancel}>{tr('Cancel', 'キャンセル', 'Cancelar')}</button>
        <button type="button" className="btn btn-sm btn-primary" disabled={!ink} onClick={() => onSave(ref.current.toDataURL('image/png'), true)}>✓ {title || tr('Accept and sign', '承認して署名', 'Aceitar e assinar')}</button>
      </div>
    </div>
  )
}

/** Full-screen view of a ready report: same on phone and computer. */
export function QuickReportViewer({ report: initial, onClose }) {
  const { tr } = useLang()
  const { user } = useAuth()
  const [report, setReport] = useState(initial)
  const [edit, setEdit] = useState(false)
  const [pad, setPad] = useState(false)
  const [busy, setBusy] = useState(false)
  const author = { name: user?.name || '' }
  const isDay = !!report.day
  const signed = report.signatures?.owner
  const L = (en, ja, pt) => tr(en, ja, pt)

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !edit && !pad) onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [edit, pad, onClose])

  const sign = async (url, fresh) => {
    setBusy(true)
    try {
      if (fresh) keepOwnerSig(user?.id, url)
      setReport(await acceptDayReport(report, { name: user?.name || 'KuriPuro', url }))
      setPad(false)
      toast.success(L('Accepted — your signature is on the report', '承認しました。署名が入りました', 'Aceito — sua assinatura entrou no relatório'))
    } catch (e) { toast.error(String(e.message || e)) } finally { setBusy(false) }
  }
  const reopen = async () => { const r = await loadReport(report.id); if (r) setReport(r) }

  if (edit) {
    return (
      <Suspense fallback={null}>
        {report.kind === 'period'
          ? <PeriodReportEditor reportId={report.id} author={author} onSaved={() => {}} onClose={() => { setEdit(false); reopen() }} />
          : <WorkReportEditor reportId={report.id} role="admin" author={author} onSaved={() => {}} onClose={() => { setEdit(false); reopen() }} />}
      </Suspense>
    )
  }
  return createPortal(
    <div className="qr-overlay" role="dialog" aria-label={report.title}>
      <header className="qr-head">
        <button type="button" className="wr-x" onClick={onClose} aria-label="close">✕</button>
        <div className="qr-title"><b>{report.title || L('Service report', '作業報告書', 'Relatório de serviço')}</b>
          <span>{isDay
            ? (signed ? L(`Accepted by ${signed.name}`, `${signed.name}が承認済み`, `Aceito por ${signed.name}`) : L('Ready — waiting for your acceptance', '作成済み・承認待ち', 'Pronto — aguardando seu aceite'))
            : [report.location, report.work_date].filter(Boolean).join(' · ')}</span></div>
        <div className="qr-actions">
          <button type="button" className="btn btn-sm" onClick={() => openPrintHtml(reportHtml(report))}>🖨 PDF</button>
          <button type="button" className="btn btn-sm" onClick={() => setEdit(true)}>✎ {L('Edit', '編集', 'Editar')}</button>
          {isDay && !signed && <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => setPad(true)}>✍ {L('Accept and sign', '承認して署名', 'Aceitar e assinar')}</button>}
        </div>
      </header>
      <iframe className="qr-frame" title={report.title} srcDoc={reportHtml(report)} />
      {pad && <div className="qr-pad-wrap"><OwnerSignaturePad current={readOwnerSig(user?.id)} onSave={sign} onCancel={() => setPad(false)} /></div>}
    </div>,
    document.body,
  )
}

function useOpener(build) {
  const { tr } = useLang()
  const { user } = useAuth()
  const [report, setReport] = useState(null)
  const [busy, setBusy] = useState(false)
  const open = async e => {
    e?.stopPropagation?.()
    setBusy(true)
    try { setReport(await build({ name: user?.name || '' })) } catch (err) { toast.error(String(err.message || err).slice(0, 160) || tr('Could not build the report', '報告書を作成できませんでした', 'Não foi possível montar o relatório')) } finally { setBusy(false) }
  }
  return { report, busy, open, close: () => setReport(null) }
}

/** "📄 Relatório" — one tap, the simple report of the service already built. */
export function QuickReportButton({ job, jobId, className = 'btn btn-sm', label }) {
  const { tr } = useLang()
  const o = useOpener(author => quickJobReport(job || jobId, { author }))
  return (
    <>
      <button type="button" className={className} disabled={o.busy} onClick={o.open}>{o.busy ? '…' : `📄 ${label || tr('Report', '報告書', 'Relatório')}`}</button>
      {o.report && <QuickReportViewer report={o.report} onClose={o.close} />}
    </>
  )
}

/** "📄 Relatório do dia" — every service of one person on one day. */
export function DayReportButton({ employeeId, employeeName, date, className = 'btn btn-sm', label }) {
  const { tr } = useLang()
  const o = useOpener(author => quickDayReport({ employeeId, employeeName, date, author }))
  if (!employeeId || !date) return null
  return (
    <>
      <button type="button" className={className} disabled={o.busy} onClick={o.open}>{o.busy ? '…' : `📄 ${label || tr('Day report', '作業日報', 'Relatório do dia')}`}</button>
      {o.report && <QuickReportViewer report={o.report} onClose={o.close} />}
    </>
  )
}

/** Opens an existing report by id in the same viewer (list "Prontos"). */
export function ReportViewerById({ id, onClose }) {
  const [r, setR] = useState(null)
  useEffect(() => { let off = false; loadReport(id).then(x => { if (!off) { if (x) setR(x); else { toast.error('?'); onClose?.() } } }); return () => { off = true } }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  return r ? <QuickReportViewer report={r} onClose={onClose} /> : null
}

/**
 * v1.0.164 · Reports: tick cleaners × days and make one day report each
 * (every service of that person on that day, together). `rows` = the rows on screen.
 */
export function DayReportPicker({ rows, onClose }) {
  const { tr } = useLang()
  const { user } = useAuth()
  const L = (en, ja, pt) => tr(en, ja, pt)
  const groups = (() => {
    const m = new Map()
    for (const r of rows || []) {
      const empId = r._job?.employee_id || r.employee_id
      const date = r._job?.scheduled_date || r.report_date
      if (!empId || !date) continue
      const k = `${empId}|${date}`
      if (!m.has(k)) m.set(k, { key: k, employeeId: empId, employeeName: r.employee_name || '', date, n: 0 })
      m.get(k).n++
    }
    return [...m.values()].sort((a, b) => b.date.localeCompare(a.date) || a.employeeName.localeCompare(b.employeeName))
  })()
  const [marked, setMarked] = useState(() => new Set(groups.map(g => g.key)))
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState({})
  const [viewing, setViewing] = useState(null)
  const toggle = k => setMarked(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const all = marked.size === groups.length
  const create = async () => {
    setBusy(true)
    const out = { ...done }
    let ok = 0
    for (const g of groups.filter(x => marked.has(x.key))) {
      try { out[g.key] = await quickDayReport({ employeeId: g.employeeId, employeeName: g.employeeName, date: g.date, author: { name: user?.name || '' } }); ok++ }
      catch (e) { toast.error(`${g.employeeName} ${g.date}: ${String(e.message || e).slice(0, 120)}`) }
      setDone({ ...out })
    }
    setBusy(false)
    if (ok) toast.success(L(`${ok} day report(s) ready`, `作業日報 ${ok}件 作成`, `${ok} relatório(s) do dia pronto(s)`))
    if (ok === 1) setViewing(Object.values(out).find(Boolean))
  }
  if (viewing) return <QuickReportViewer report={viewing} onClose={() => setViewing(null)} />
  return createPortal(
    <div className="qr-pad-wrap" onClick={e => { if (e.target === e.currentTarget && !busy) onClose?.() }}>
      <div className="qr-pad qr-pick" role="dialog" aria-label={L('Day report', '作業日報', 'Relatório do dia')}>
        <b>📄 {L('Day report — all services of each cleaner together', '作業日報（スタッフごとに1日分まとめて）', 'Relatório do dia — todos os serviços de cada limpador juntos')}</b>
        <small>{L('Tick who and which day. One report per cleaner per day.', '担当者と日付を選んでください。1人1日につき1件です。', 'Marque quem e qual dia. Sai um relatório por limpador por dia.')}</small>
        {!groups.length
          ? <small>{L('No services on screen.', '表示中の作業がありません。', 'Nenhum serviço na tela.')}</small>
          : <>
            <label className="qr-pick-row qr-pick-all"><input type="checkbox" checked={all} onChange={() => setMarked(all ? new Set() : new Set(groups.map(g => g.key)))} /> {L('All', 'すべて', 'Todos')} ({groups.length})</label>
            <div className="qr-pick-list">
              {groups.map(g => (
                <div key={g.key} className="qr-pick-row">
                  <label><input type="checkbox" checked={marked.has(g.key)} onChange={() => toggle(g.key)} disabled={busy} /> <b>{g.employeeName || '—'}</b> · {g.date} · {g.n} {L('service(s)', '件', g.n === 1 ? 'serviço' : 'serviços')}</label>
                  {done[g.key] && <button type="button" className="btn btn-sm" onClick={() => setViewing(done[g.key])}>{L('View', '表示', 'Ver')}</button>}
                </div>
              ))}
            </div>
          </>}
        <div className="qr-pad-actions">
          <button type="button" className="btn btn-sm" onClick={onClose} disabled={busy}>{L('Close', '閉じる', 'Fechar')}</button>
          <button type="button" className="btn btn-sm btn-primary" disabled={busy || !marked.size} onClick={create}>{busy ? '…' : `📄 ${L('Create', '作成', 'Criar')} ${marked.size}`}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
