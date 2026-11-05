// v1.0.150 · list rows of 作業報告書 (admin page, client sheet, client portal, employee card)
import { useLang, localeOf } from '../hooks/useLang'
import { statusLabel } from '../lib/workReport'
import './work-report.css'

export default function WorkReportList({ items, onOpen, showClient = true, showStatus = true, empty }) {
  const { lang, tr } = useLang()
  if (!items?.length) return <p className="cs-muted" style={{ color: 'var(--text3)', fontSize: 13 }}>{empty || tr('No report yet.', '報告書はまだありません。', 'Nenhum relatório ainda.')}</p>
  const day = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(localeOf(lang), { year: 'numeric', month: 'short', day: 'numeric' }) : '—')
  return (
    <div className="wr-list">
      {items.map(s => (
        <button key={s.id} type="button" className="wr-row" onClick={() => onOpen(s)}>
          <span className="wr-row-ico">📄</span>
          <span className="wr-row-main">
            <b>{s.title || tr('Service report', '作業報告書', 'Relatório de serviço')}</b>
            <span>{[day(s.work_date), showClient ? s.client_name : null, s.location, s.mode === 'detailed' ? tr('detailed', '詳細', 'detalhado') : tr('simple', 'シンプル', 'simples'), s.photos ? `📷 ${s.photos}` : null].filter(Boolean).join(' · ')}</span>
          </span>
          {showStatus && <span className={`wr-badge st-${s.status}`}>{statusLabel(s.status, tr)}</span>}
        </button>
      ))}
    </div>
  )
}
