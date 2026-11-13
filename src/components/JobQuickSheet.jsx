// v1.0.183 · Tap any card of the day (store, person or one service) → this popup:
// everything about the service(s) in one place — who, when, how long, photos before/after,
// checklist, GPS, warnings — and the 📄 Relatório button. Bottom sheet on the phone, centered on PC.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import StorageImage from './StorageImage'
import { QuickReportButton } from './QuickReport'
import { JaFizButton } from './JaFizSheet'
import { serviceCheck } from '../lib/dayCheck'
import { serviceLabel } from '../lib/dayPanel'
import { viewablePhotoUrl } from '../lib/photoUrl'
import './jobQuickSheet.css'
import DownloadAllMedia from './DownloadAllMedia'

const STATUS = {
  done: ['done', L => L('Done', '完了', 'Feito')],
  working: ['working', L => L('In progress', '作業中', 'Em andamento')],
  late: ['late', L => L('Late', '遅れ', 'Atrasado')],
  not_started: ['idle', L => L('Not started', '未開始', 'Não iniciado')],
}

function ServiceBlock({ s, by, L, actions, onChanged, onPhoto }) {
  const c = serviceCheck(s, L)
  const j = s.job || {}
  const [cls, label] = STATUS[s.status] || STATUS.not_started
  const who = by === 'person' ? s.store : (s.coveredBy || s.assigned || L('nobody', '担当なし', 'sem pessoa'))
  const missed = String(j.checklist_missed_items || '').split(/\n|;|,/).map(x => x.trim()).filter(Boolean)
  const rows = [
    by === 'person' ? [L('Service', '作業', 'Serviço'), serviceLabel(j, L)] : null,
    by === 'person' ? null : [L('Who', '担当', 'Quem'), who],
    s.startedAt || s.doneAt ? [L('Time', '時間', 'Horário'), [s.startedAt, s.doneAt].filter(Boolean).join(' → ') + (c.durMin ? ` (${c.durMin} min)` : '')] : null,
    s.deadline ? [L('Deadline', '期限', 'Prazo'), s.deadline] : s.time ? [L('Planned', '予定', 'Previsto'), s.time] : null,
  ].filter(Boolean)
  return (
    <section className={`jqs-svc is-${c.verdict}`}>
      <div className="jqs-svc-head">
        <strong>{by === 'person' ? s.store : serviceLabel(j, L)}</strong>
        <span className={`jqs-chip ${cls}`}>{label(L)}</span>
      </div>
      <dl className="jqs-dl">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {c.checks.length > 0 && <div className="jqs-checks">{[...c.checks].sort((a, b) => (a.state === 'bad' ? 0 : 1) - (b.state === 'bad' ? 0 : 1)).map(k => <span key={k.key} className={`jqs-check is-${k.state}`}>{k.state === 'ok' ? '✓ ' : k.state === 'bad' ? '✕ ' : ''}{k.label}</span>)}</div>}
      {c.verdict === 'warn' && <p className="jqs-why">⚠️ {L('Check: ', '確認: ', 'Conferir: ')}{c.issues.join(' · ')}</p>}
      {missed.length > 0 && <p className="jqs-missed"><b>{L('Not done in the checklist:', 'チェック未完了:', 'Não feito no checklist:')}</b> {missed.join(' · ')}</p>}
      {(j.photo_start_url || j.photo_end_url) && (
        <div className="jqs-photos">
          {[[j.photo_start_url, L('Before', '作業前', 'Antes')], [j.photo_end_url, L('After', '作業後', 'Depois')]].filter(([u]) => u).map(([u, t]) => (
            <figure key={u}>
              <StorageImage url={u} alt={t} onClick={() => onPhoto(u)} style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 10, cursor: 'zoom-in', display: 'block' }} />
              <figcaption>{t}</figcaption>
            </figure>
          ))}
        </div>
      )}
      <div className="jqs-acts">
        {c.done && !s.coveredBy && <QuickReportButton job={j} className="jqs-btn primary" label={L('Open report', '報告書を開く', 'Abrir relatório')} />}
        {(j.photo_start_url || j.photo_end_url || c.done) && <DownloadAllMedia job={j} className="jqs-btn" date={j.scheduled_date} place={s.store || String(j.title || j.client_name || '').replace(/ — .*/, '')} employee={j.employee_name || s.assigned} />}
        {actions && !c.done && s.assignedId && (s.status === 'not_started' || s.status === 'late') && !s.startedAt && <JaFizButton job={j} className="jqs-btn" label={`✓ ${L('Already done', 'もう済んだ', 'Já fiz')}`} onDone={onChanged} />}
        {!c.done && <span className="jqs-muted">{L('The report appears when the service is finished.', '作業完了後に報告書が出ます。', 'O relatório aparece quando o serviço terminar.')}</span>}
      </div>
    </section>
  )
}

/**
 * sheet = { title, sub, by: 'person'|'store'|'service', services: [svc], footer? }
 */
export default function JobQuickSheet({ sheet, onClose, L, actions = false, onChanged }) {
  const [photo, setPhoto] = useState(null)
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') { if (photo) setPhoto(null); else onClose?.() } }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.body.classList.add('jqs-on')
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; document.body.classList.remove('jqs-on') }
  }, [photo, onClose])
  if (!sheet) return null
  const order = { todo: 0, warn: 1, ok: 2 }
  const list = [...(sheet.services || [])].sort((a, b) => order[serviceCheck(a, L).verdict] - order[serviceCheck(b, L).verdict])
  return createPortal(
    <div className="jqs-back" onClick={onClose} role="presentation">
      <div className="jqs" role="dialog" aria-modal="true" aria-label={sheet.title} onClick={e => e.stopPropagation()}>
        <header className="jqs-head">
          <span className="jqs-grab" aria-hidden="true" />
          <div className="jqs-head-txt"><h3>{sheet.title}</h3>{sheet.sub && <p>{sheet.sub}</p>}</div>
          <button type="button" className="jqs-x" onClick={onClose} aria-label={L('Close', '閉じる', 'Fechar')}>✕</button>
        </header>
        <div className="jqs-body">
          {sheet.top}
          {list.length
            ? list.map(s => <ServiceBlock key={s.id} s={s} by={sheet.by} L={L} actions={actions} onChanged={onChanged} onPhoto={setPhoto} />)
            : <p className="jqs-muted">{sheet.empty || L('No service on this day.', 'この日の作業はありません。', 'Nenhum serviço neste dia.')}</p>}
          {sheet.footer}
        </div>
      </div>
      {photo && (
        <div className="jqs-photo" onClick={e => { e.stopPropagation(); setPhoto(null) }} role="presentation">
          <img src={viewablePhotoUrl(photo)} alt="" />
        </div>
      )}
    </div>,
    document.body,
  )
}
