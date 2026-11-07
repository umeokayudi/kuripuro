// v1.0.172 · lives in "Meu dia" and in its own ☰ menu tab (no longer on Início), with
// "fazer todos do dia": one tap builds the report of every finished service of that day from what
// is already saved (photos, checklist, signature) and sends them to the office (status 'ready').
// v1.0.150 · Employee home: 作業報告書 of my services. During the job: add photos (before /
// during / after) and notes; after the job: finish the text with the AI. The office sends it.
import { useEffect, useMemo, useState } from 'react'
import { reportIdForJob, loadReport, saveReport, statusLabel } from '../lib/workReport'
import { quickJobReport } from '../lib/quickReport'
import toast from 'react-hot-toast'
import { locationNameFromTitle } from '../lib/cleaningType'
import { useLang } from '../hooks/useLang'
import WorkReportEditor from './WorkReportEditor'
import { combinedReportsHtml, groupByClientDay, isOnThePlanet } from '../lib/clientDayPdf'
import { openPrintHtml } from '../lib/openPrintHtml'

export default function EmployeeWorkReports({ jobs, activeJob, today, user, flat = false }) {
  const { tr } = useLang()
  const [open, setOpen] = useState(null)
  const [state, setState] = useState({}) // jobId → summary of its report
  const [bulk, setBulk] = useState(null) // { day, done, total } while making all reports of a day
  const since = useMemo(() => new Date(Date.parse(`${today}T12:00:00Z`) - 7 * 864e5).toISOString().slice(0, 10), [today])
  const recent = useMemo(() => (jobs || [])
    .filter(j => j.scheduled_date >= since && j.scheduled_date <= today && (j.status === 'completed' || j.status === 'in_progress'))
    .sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date)), [jobs, since, today])
  const author = useMemo(() => ({ name: user?.name || '' }), [user?.name])

  const ids = recent.slice(0, 20).map(j => j.id).join(',')
  useEffect(() => {
    let off = false
    ;(async () => {
      const out = {}
      await Promise.all(recent.slice(0, 20).map(async j => {
        const id = await reportIdForJob(j.id)
        if (!id) return
        const r = await loadReport(id)
        if (r) out[j.id] = r
      }))
      if (!off) setState(out)
    })()
    return () => { off = true }
  }, [ids]) // eslint-disable-line react-hooks/exhaustive-deps

  // the most recent day (today first) that still has finished services without a report sent to the office
  const pendingOf = d => recent.filter(j => j.scheduled_date === d && j.status === 'completed' && (!state[j.id] || state[j.id].status === 'draft'))
  const bulkDay = [...new Set(recent.map(j => j.scheduled_date))].sort().reverse().find(d => pendingOf(d).length > 0) || null
  const bulkJobs = bulkDay ? pendingOf(bulkDay) : []
  const dayName = d => (d === today ? tr('today', '今日', 'de hoje') : tr(`of ${d.slice(5).replace('-', '/')}`, `${d.slice(5).replace('-', '/')}の`, `de ${d.slice(8)}/${d.slice(5, 7)}`))
  const doAll = async () => {
    const list = bulkJobs
    setBulk({ day: bulkDay, done: 0, total: list.length })
    let ok = 0
    for (const j of list) {
      try {
        let r = await quickJobReport(j, { author })
        if (r && r.status === 'draft') r = await saveReport({ ...r, status: 'ready' }, { by: author.name, action: 'ready-all-day' })
        if (r) setState(s => ({ ...s, [j.id]: r }))
        ok++
      } catch (err) { console.warn('report', j.id, err) }
      setBulk(b => b && { ...b, done: b.done + 1 })
    }
    setBulk(null)
    if (ok === list.length) toast.success(tr(`${ok} reports sent to the office`, `${ok}件の報告書を事務所へ送りました`, `${ok} relatórios enviados ao escritório`))
    else toast.error(tr(`${ok} of ${list.length} done — try again for the rest`, `${list.length}件中${ok}件完了。残りはもう一度`, `${ok} de ${list.length} feitos — tente de novo para o resto`))
  }

  const withReport = recent.filter(j => state[j.id])
  const others = recent.filter(j => !state[j.id] && j.id !== activeJob?.id)
  const live = activeJob && activeJob.status === 'in_progress' ? activeJob : null
  if (!live && !recent.length) return flat ? <p style={{ fontSize: 13, color: '#66758b', margin: '4px 2px 14px' }}>{tr('No finished services in the last 7 days.', '過去7日間に完了した作業はありません。', 'Nenhum serviço terminado nos últimos 7 dias.')}</p> : null

  // v1.0.181 · rows as small cards (name on top, status below, button on the right) — nothing
  // wider than the phone; the long texts wrap instead of pushing the card off the screen.
  const name = j => locationNameFromTitle(j.title) || j.title
  const shortDay = d => `${d?.slice(8)}/${d?.slice(5, 7)}`
  // v1.0.181 · optional: all reports of one client on one day (e.g. every On The Planet store) in one PDF
  const groups = groupByClientDay([...new Map(Object.values(state).map(r => [r.id, r])).values()]).slice(0, 3)
  const onePdf = g => {
    const html = combinedReportsHtml(g.reports, { clientName: g.client_name, date: g.date })
    if (html) openPrintHtml(html)
  }
  const statusClass = st => (st === 'sent' ? 'is-sent' : st === 'ready' ? 'is-ready' : 'is-draft')

  return (
    <div className={`ewr${flat ? ' ewr-flat' : ''}`}>
      {!flat && <>
      <div className="ewr-title">📄 {tr('Service report', '作業報告書', 'Relatório de serviço')}</div>
      <div className="ewr-sub">{tr('Photos and notes now or later — the AI writes it, the office sends it to the client.', '写真とメモは作業中でも後でもOK。AIが文章を作成し、事務所が送付します。', 'Fotos e notas agora ou depois — a IA escreve e o escritório envia ao cliente.')}</div>
      </>}
      {bulkDay && (
        <button type="button" className="ewr-all" disabled={!!bulk} onClick={doAll}>
          <span>{bulk
            ? `⏳ ${tr('Making reports', '報告書を作成中', 'Fazendo relatórios')} ${bulk.done}/${bulk.total}…`
            : `📄 ${tr(`Make all ${bulkJobs.length} reports ${dayName(bulkDay)} at once`, `${dayName(bulkDay)}${bulkJobs.length}件をまとめて作成`, `Fazer os ${bulkJobs.length} relatórios ${dayName(bulkDay)} de uma vez`)}`}</span>
          {!bulk && <small>{tr('Uses the photos, checklist and signature already saved, and sends them to the office.', '保存済みの写真・チェックリスト・署名で作成し、事務所へ送ります。', 'Usa as fotos, o checklist e a assinatura já salvos e manda ao escritório.')}</small>}
        </button>
      )}
      {live && (
        <div className="ewr-row is-live">
          <div className="ewr-row-main">
            <b>🟢 {name(live)}</b>
            <span>{shortDay(live.scheduled_date)} · {tr('in progress', '作業中', 'em andamento')}</span>
          </div>
          <button type="button" className="ewr-btn" onClick={() => setOpen(live)}>📷 {state[live.id] ? tr('Continue', '続ける', 'Continuar') : tr('Photos', '写真', 'Fotos')}</button>
        </div>
      )}
      {withReport.filter(j => j.id !== live?.id).map(j => (
        <div key={j.id} className="ewr-row">
          <div className="ewr-row-main">
            <b>{name(j)}</b>
            <span>{shortDay(j.scheduled_date)} · <em className={`ewr-st ${statusClass(state[j.id].status)}`}>{statusLabel(state[j.id].status, tr)}</em> · 📷 {(state[j.id].photos || []).length}</span>
          </div>
          <button type="button" className={`ewr-btn${state[j.id].status === 'sent' ? ' is-light' : ''}`} onClick={() => setOpen(j)}>{state[j.id].status === 'sent' ? tr('View', '見る', 'Ver') : tr('Continue', '続ける', 'Continuar')}</button>
        </div>
      ))}
      {groups.map(g => (
        <button key={g.key} type="button" className={`ewr-pdf${isOnThePlanet(g.client_name) ? ' is-otp' : ''}`} onClick={() => onePdf(g)}>
          <span>📑 {tr(`One PDF: all ${g.reports.length} ${g.client_name} stores · ${shortDay(g.date)}`, `${g.client_name}の${g.reports.length}店舗を1つのPDFに · ${shortDay(g.date)}`, `Um PDF só: as ${g.reports.length} lojas ${g.client_name} · ${shortDay(g.date)}`)}</span>
          <small>{tr('Optional — the separate reports stay as they are.', '任意：個別の報告書はそのまま残ります。', 'Opcional — os relatórios separados continuam iguais.')}</small>
        </button>
      ))}
      {others.length > 0 && (
        <select className="ewr-other" value="" onChange={e => { const j = others.find(x => x.id === e.target.value); if (j) setOpen(j) }}>
          <option value="">＋ {tr('Another service (last 7 days)', '他の作業（7日以内）', 'Outro serviço (últimos 7 dias)')}</option>
          {others.map(j => <option key={j.id} value={j.id}>{name(j)} · {shortDay(j.scheduled_date)}</option>)}
        </select>
      )}
      {open && (
        <WorkReportEditor job={open} role="employee" author={author}
          onSaved={r => setState(s => ({ ...s, [open.id]: r }))}
          onClose={() => setOpen(null)} />
      )}
    </div>
  )
}
