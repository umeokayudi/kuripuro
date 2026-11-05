// v1.0.150 · list rows of 作業報告書 (admin page, client sheet, client portal, employee card)
import { useLang, localeOf } from '../hooks/useLang'
import { statusLabel } from '../lib/workReport'
import './work-report.css'

export default function WorkReportList({ items, onOpen, onView, onEdit, showClient = true, showStatus = true, empty }) {
  const { lang, tr } = useLang()
  if (!items?.length) return <p className="cs-muted" style={{ color: 'var(--text3)', fontSize: 13 }}>{empty || tr('No report yet.', '報告書はまだありません。', 'Nenhum relatório ainda.')}</p>
  const day = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(localeOf(lang), { year: 'numeric', month: 'short', day: 'numeric' }) : '—')
  return (
    <div className="wr-list">
      {items.map(s => {
        const row = (
        <button key={s.id} type="button" className="wr-row" onClick={() => (onView ? onView(s) : onOpen(s))}>
          <span className="wr-row-ico">{s.day ? '🗓' : s.kind === 'period' ? '🗂' : '📄'}</span>
          <span className="wr-row-main">
            <b>{s.title || tr('Service report', '作業報告書', 'Relatório de serviço')}</b>
            <span>{[s.day ? day(s.day.date) : s.kind === 'period' ? `${day(s.from)} – ${day(s.to)}` : day(s.work_date), showClient && !s.day ? s.client_name : null, s.day ? s.day.employee_name : null, s.kind === 'period' ? `${(s.stores || []).length} ${tr('stores', '店舗', 'lojas')}` : s.location, s.kind === 'period' ? null : s.mode === 'detailed' ? tr('detailed', '詳細', 'detalhado') : tr('simple', 'シンプル', 'simples'), s.photos ? `📷 ${s.photos}` : null].filter(Boolean).join(' · ')}</span>
          </span>
          {s.day && <span className={`wr-badge ${s.accepted_at ? 'st-sent' : 'st-ready'}`}>{s.accepted_at ? tr('Accepted', '承認済み', 'Aceito') : tr('To accept', '承認待ち', 'Para aceitar')}</span>}
          {showStatus && !s.day && <span className={`wr-badge st-${s.status}`}>{statusLabel(s.status, tr)}</span>}
        </button>
        )
        // v1.0.158 · list "Prontos": every row has Ver (clean preview) and Editar (the normal editor)
        if (!onView || !onEdit) return row
        return (
          <div key={s.id} className="wr-row-wrap">
            {row}
            <span className="wr-row-btns">
              <button type="button" className="btn btn-sm" onClick={() => onView(s)}>👁 {tr('View', '表示', 'Ver')}</button>
              <button type="button" className="btn btn-sm" onClick={() => onEdit(s)}>✎ {tr('Edit', '編集', 'Editar')}</button>
            </span>
          </div>
        )
      })}
    </div>
  )
}
