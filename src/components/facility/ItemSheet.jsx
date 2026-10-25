import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useLang, localeOf } from '../../hooks/useLang'
import { viewablePhotoUrl } from '../../lib/photoUrl'
import { jobDurationMin, jobReportText, fmtDuration, fmtTime } from '../../lib/jobReport'
import { AREA_KINDS, ELEMENT_KINDS, areaForElement, careForElement, elementHistory } from '../../lib/facilityModel'
import PhotoLightbox from '../PhotoLightbox'
import CareList, { rowsForElement } from './CareList'
import './item-sheet.css'

const STATUS_STYLE = {
  overdue: { background: 'rgba(239,68,68,0.2)', color: '#fca5a5' },
  due: { background: 'rgba(245,158,11,0.2)', color: '#fcd34d' },
  ok: { background: 'rgba(34,197,94,0.2)', color: '#86efac' },
  none: { background: 'rgba(148,163,184,0.18)', color: '#cbd5e1' },
}
const RANK = { overdue: 0, due: 1, none: 2, ok: 3 }
const JOB_FIELDS = 'id,title,scheduled_date,started_at,completed_at,employee_name,photo_start_url,photo_end_url,notes_employee,retro_report,retro_time_min,retro_ai_summary,checklist_done,checklist_total'

/** Uma limpeza: registro do item + serviço (job) do dia, se houver. Fotos: antes (início do serviço) e depois. */
function visitOf(log, job) {
  const before = [job?.photo_start_url].filter(Boolean)
  const after = [...(Array.isArray(log.photos) ? log.photos : []), job?.photo_end_url].filter(Boolean)
  return {
    id: log.id,
    date: String(log.service_date || '').slice(0, 10),
    who: log.employee_name || job?.employee_name || '',
    service: log.service || '',
    notes: log.notes || '',
    report: job ? (jobReportText(job) || job.retro_ai_summary || '') : '',
    minutes: job ? jobDurationMin(job) : null,
    timeIn: job?.started_at || null,
    timeOut: job?.completed_at || null,
    checklist: job?.checklist_total ? `${job.checklist_done || 0}/${job.checklist_total}` : '',
    jobTitle: job?.title || '',
    before,
    after,
  }
}

/**
 * Ficha do item (só ver, nada de editar): fotos reais, "como era → como está",
 * primeira e última limpeza (quem fez, quanto tempo, relatório) e o histórico inteiro.
 */
export default function ItemSheet({ el, layout, t, status, logs = [], onClose, onDetails, onLog, onOffer, offered = false, extraActions = null }) {
  const { lang, tr } = useLang()
  const [jobs, setJobs] = useState(new Map())
  const [open, setOpen] = useState(null)
  const [zoom, setZoom] = useState(null)
  const history = useMemo(() => elementHistory(el.id, logs), [el.id, logs])
  const jobIds = useMemo(() => [...new Set(history.map(l => l.job_id).filter(Boolean))], [history])

  useEffect(() => {
    if (!jobIds.length) { setJobs(new Map()); return }
    let off = false
    supabase.from('jobs').select(JOB_FIELDS).in('id', jobIds.slice(0, 200)).then(({ data }) => {
      if (!off) setJobs(new Map((data || []).map(j => [j.id, j])))
    })
    return () => { off = true }
  }, [jobIds.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const visits = history.map(l => visitOf(l, jobs.get(l.job_id)))
  const last = visits[0] || null
  const firstV = visits.length > 1 ? visits[visits.length - 1] : null
  const k = ELEMENT_KINDS[el.kind] || ELEMENT_KINDS.other
  const area = areaForElement(layout, el)
  const st = status?.get?.(el.id)
  const stLabel = { overdue: t.stOverdue, due: t.stDue, ok: t.stOk, none: t.stNone }[st]
  const careRows = rowsForElement(el, el.care || careForElement(el, [])).sort((a, b) => RANK[a.status] - RANK[b.status])

  // "como era → como está": a foto mais antiga que existe x a mais nova
  const allPhotos = [...visits].reverse().flatMap(v => [...v.before, ...v.after])
  const oldest = allPhotos[0] || el.photos?.[0] || null
  const newest = [...visits].flatMap(v => [...v.after, ...v.before])[0] || null

  const fmt = d => (d ? new Date(`${d}T00:00:00+09:00`).toLocaleDateString(localeOf(lang), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Tokyo' }) : '—')
  const ago = d => {
    const n = Math.round((Date.now() - new Date(`${d}T00:00:00+09:00`)) / 86400000)
    if (n <= 0) return tr('today', '今日', 'hoje')
    if (n === 1) return tr('yesterday', '昨日', 'ontem')
    return tr(`${n} days ago`, `${n}日前`, `há ${n} dias`)
  }

  const Card = ({ v, label, tone }) => (
    <button type="button" className={`is-card ${tone}${open === v.id ? ' on' : ''}`} onClick={() => setOpen(o => (o === v.id ? null : v.id))}>
      <span className="is-card-label">{label}</span>
      <strong>{fmt(v.date)}</strong>
      <small>{ago(v.date)}</small>
      <span className="is-card-row">👤 {v.who || '—'}</span>
      <span className="is-card-row">⏱ {v.minutes != null ? fmtDuration(v.minutes, lang) : '—'}</span>
      {(v.after[0] || v.before[0]) && <img src={viewablePhotoUrl(v.after[0] || v.before[0])} alt="" loading="lazy" />}
      <span className="is-card-more">📄 {tr('Report', '報告', 'Relatório')} ›</span>
    </button>
  )

  const Report = ({ v }) => (
    <div className="is-report">
      <div className="is-report-grid">
        <span>📅 <b>{fmt(v.date)}</b></span>
        <span>👤 <b>{v.who || '—'}</b></span>
        <span>⏱ <b>{v.minutes != null ? fmtDuration(v.minutes, lang) : '—'}</b>{v.timeIn ? ` (${fmtTime(v.timeIn, lang)}–${fmtTime(v.timeOut, lang)})` : ''}</span>
        {v.checklist && <span>✅ <b>{v.checklist}</b> {tr('checklist', 'チェック', 'checklist')}</span>}
      </div>
      {v.service && <div className="is-report-what">🧽 {v.service}</div>}
      {(v.before.length > 0 || v.after.length > 0) && (
        <div className="is-ba">
          {v.before.map(p => (
            <button key={p} type="button" onClick={() => setZoom(p)}><img src={viewablePhotoUrl(p)} alt="" loading="lazy" /><span>{tr('Before', '作業前', 'Antes')}</span></button>
          ))}
          {v.after.map(p => (
            <button key={p} type="button" onClick={() => setZoom(p)}><img src={viewablePhotoUrl(p)} alt="" loading="lazy" /><span>{tr('After', '作業後', 'Depois')}</span></button>
          ))}
        </div>
      )}
      {v.notes && <p className="is-report-text">📝 {v.notes}</p>}
      {v.report && v.report !== v.notes && <p className="is-report-text">📄 {v.report}</p>}
      {!v.notes && !v.report && <p className="is-report-text muted">{tr('No written report for this cleaning.', 'この清掃の報告文はありません。', 'Sem relatório escrito nesta limpeza.')}</p>}
    </div>
  )

  return (
    <div className="is" key={el.id}>
      <div className="is-head">
        <span className="is-ico" aria-hidden="true">{k.icon}</span>
        <div className="is-title">
          <h4>{el.name}</h4>
          <small>{area ? `${(AREA_KINDS[area.kind] || AREA_KINDS.other).icon} ${area.name}` : ''}{el.important ? ` · ⭐ ${t.important}` : ''}</small>
          {st && <span className="is-pill" style={STATUS_STYLE[st]}>{stLabel}</span>}
        </div>
        <button type="button" className="is-x" onClick={onClose} aria-label={t.close}>✕</button>
      </div>

      {(oldest || newest) && (
        <div className="is-compare">
          <button type="button" onClick={() => oldest && setZoom(oldest)} disabled={!oldest}>
            {oldest ? <img src={viewablePhotoUrl(oldest)} alt="" loading="lazy" /> : <span className="is-noph">—</span>}
            <span>{tr('How it was', '以前', 'Como era')}</span>
          </button>
          <i aria-hidden="true">→</i>
          <button type="button" onClick={() => newest && setZoom(newest)} disabled={!newest || newest === oldest}>
            {newest && newest !== oldest ? <img src={viewablePhotoUrl(newest)} alt="" loading="lazy" /> : <span className="is-noph">{tr('No new photo yet', 'まだ新しい写真なし', 'Sem foto nova ainda')}</span>}
            <span>{tr('How it is now', '現在', 'Como está')}</span>
          </button>
        </div>
      )}

      {last ? (
        <>
          <div className="is-cards">
            {firstV && <Card v={firstV} label={tr('First cleaning', '初回の清掃', 'Primeira limpeza')} tone="first" />}
            <Card v={last} label={tr('Last cleaning', '前回の清掃', 'Última limpeza')} tone="last" />
          </div>
          {visits.filter(v => v.id === open && (v === last || v === firstV)).map(v => <Report key={v.id} v={v} />)}
          <div className="is-sec">🕘 {tr('All cleanings', 'すべての清掃', 'Todas as limpezas')} · {visits.length}</div>
          <div className="is-list">
            {visits.map(v => (
              <div key={v.id} className={`is-row${open === v.id ? ' on' : ''}`}>
                <button type="button" onClick={() => setOpen(o => (o === v.id ? null : v.id))}>
                  <span className="is-row-date">{fmt(v.date)}</span>
                  <span className="is-row-who">{v.who || '—'}</span>
                  <span className="is-row-min">{v.minutes != null ? fmtDuration(v.minutes, lang) : ''}</span>
                  <span className="is-row-ph">{v.before.length + v.after.length ? `📷 ${v.before.length + v.after.length}` : ''}</span>
                  <i aria-hidden="true">{open === v.id ? '▾' : '›'}</i>
                </button>
                {open === v.id && v !== last && v !== firstV && <Report v={v} />}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="is-empty">🧽 {tr('No cleaning recorded yet for this item.', 'この設備の清掃記録はまだありません。', 'Nenhuma limpeza registrada ainda neste item.')}</div>
      )}

      {el.photos?.length > 0 && (
        <>
          <div className="is-sec">📍 {tr('Photos of the place', '現場の写真', 'Fotos do local')}</div>
          <div className="is-strip">
            {el.photos.map(p => <button key={p} type="button" onClick={() => setZoom(p)}><img src={viewablePhotoUrl(p)} alt="" loading="lazy" /></button>)}
          </div>
        </>
      )}

      {careRows.length > 0 && <div style={{ marginTop: 10 }}><CareList rows={careRows} t={t} lang={lang} dark limit={2} /></div>}
      {el.location_hint && <div className="is-text">🔎 {el.location_hint}</div>}
      {el.instructions && <div className="is-text">🛠 {el.instructions.length > 220 ? `${el.instructions.slice(0, 220)}…` : el.instructions}</div>}

      <div className="is-actions">
        {onDetails && <button type="button" onClick={onDetails}>📅 {t.details}</button>}
        {onOffer && <button type="button" disabled={offered} onClick={onOffer}>{offered ? `✓ ${t.alreadyOffered || 'Offered'}` : `📨 ${t.offerClient || 'Offer'}`}</button>}
        {onLog && <button type="button" className="primary" onClick={onLog}>{careRows.length > 1 ? t.markDone : t.markCleaned}</button>}
        {extraActions}
      </div>
      {zoom && <PhotoLightbox url={zoom} onClose={() => setZoom(null)} closeLabel={t.close} />}
    </div>
  )
}
