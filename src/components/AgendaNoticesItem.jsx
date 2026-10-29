// v1.0.101 · Bell item in the employee portal: what the office changed in my agenda, with one
// "Got it" that confirms all of them (the admin sees it in the Agenda do Dia).
import { pickLang } from '../hooks/useLang'

const fmt = (d, lang) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(lang === 'ja' ? 'ja-JP' : lang === 'pt' ? 'pt-BR' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '')

export default function AgendaNoticesItem({ notices, lang, onAck }) {
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const place = n => (n.title || '').split(' — ')[0]
  const line = n => {
    const d = n.detail || {}
    if (n.kind === 'assigned') return <><b>+ {place(n)}</b> · {fmt(d.date, lang)} {d.time}</>
    if (n.kind === 'unassigned') return <><b>− {place(n)}</b> · {fmt(d.date || d.old_date, lang)} — {L('given to someone else', '他の人に変更', 'passou para outra pessoa')}</>
    return <><b>↻ {place(n)}</b> · {fmt(d.old_date, lang)} {d.old_time} → {fmt(d.date, lang)} {d.time}</>
  }
  const shown = notices.slice(0, 8)
  return (
    <div className="emp-bell-item is-agenda">
      <span className="emp-bell-icon" aria-hidden="true">📌</span>
      <div>
        <strong>{L('Your agenda changed', 'あなたの予定が変わりました', 'Sua agenda mudou')}</strong>
        <ul>{shown.map(n => <li key={n.id}>{line(n)}</li>)}</ul>
        {notices.length > shown.length && <small>{L(`+${notices.length - shown.length} more`, `ほか${notices.length - shown.length}件`, `+${notices.length - shown.length} outros`)}</small>}
      </div>
      <button type="button" className="emp-bell-ok" onClick={onAck}>✓ {L('Got it', '確認', 'Ciente')}</button>
    </div>
  )
}
