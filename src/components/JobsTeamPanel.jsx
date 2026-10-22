// Admin Jobs: one card per employee with their next job (v1.0.67).
import { useLang, localeOf } from '../hooks/useLang'
import { jobLocationName } from '../lib/jobsBoard'
import { addDays } from '../lib/jobsPeriod'

export default function JobsTeamPanel({ rows, unassigned, today, onOpenJob, onShowPerson }) {
  const { lang, tr } = useLang()
  const dayLabel = (d) => {
    if (d === today) return tr('Today', '今日', 'Hoje')
    if (d === addDays(today, 1)) return tr('Tomorrow', '明日', 'Amanhã')
    return new Date(d + 'T12:00:00').toLocaleDateString(localeOf(lang), { weekday: 'short', day: 'numeric', month: 'short' })
  }

  return (
    <div className="card" style={{ marginBottom: 16, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>👥 {tr('Next job of each person', '各スタッフの次の仕事', 'Próximo serviço de cada funcionário')}</div>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>{tr('Tap a job to edit it', 'タップで編集', 'Toque no serviço para editar')}</div>
      </div>
      {/* Phone: one swipeable row instead of a tall stack. */}
      <style>{`.kp-team-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px}
@media (max-width:640px){.kp-team-grid{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:4px}.kp-team-grid>*{flex:0 0 78%;scroll-snap-align:start}}`}</style>
      <div className="kp-team-grid">
        {rows.map(r => (
          <div key={r.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px', background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
              <div style={{ fontWeight: 800, fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
              <button type="button" className="btn btn-sm" onClick={() => onShowPerson(r.id)} style={{ flexShrink: 0 }}>
                {tr('See all', '一覧', 'Ver todos')}
              </button>
            </div>
            {r.next ? (
              <button type="button" onClick={() => onOpenJob(r.next)}
                style={{ textAlign: 'left', border: 'none', borderRadius: 10, padding: '8px 10px', background: r.next.scheduled_date === today ? 'rgba(59,130,246,0.12)' : 'var(--surface2)', cursor: 'pointer', color: 'inherit' }}>
                <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 700 }}>
                  ⏭ {dayLabel(r.next.scheduled_date)} · 🕐 {(r.next.scheduled_time || '—').slice(0, 5)}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{jobLocationName(r.next)}</div>
              </button>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text3)', padding: '8px 10px', background: 'var(--surface2)', borderRadius: 10 }}>
                {tr('No upcoming jobs', '予定なし', 'Sem serviços marcados')}
              </div>
            )}
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>
              {tr('Today', '今日', 'Hoje')}: <b>{r.today}</b> · {tr('Next 7 days', '7日間', 'Próx. 7 dias')}: <b>{r.week}</b>
            </div>
          </div>
        ))}
        {unassigned.length > 0 && (
          <button type="button" onClick={() => onShowPerson('')}
            style={{ border: '2px solid rgba(220,38,38,0.4)', borderRadius: 12, padding: '10px 12px', background: 'rgba(248,113,113,0.08)', textAlign: 'left', cursor: 'pointer', color: 'inherit' }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: '#dc2626' }}>⚠️ {tr('Without employee', '担当なし', 'Sem funcionário')}</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              {tr(`${unassigned.length} jobs in the next 7 days`, `今後7日で${unassigned.length}件`, `${unassigned.length} serviços nos próximos 7 dias`)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{tr('Tap to assign', 'タップして割り当て', 'Toque para escolher quem faz')}</div>
          </button>
        )}
      </div>
    </div>
  )
}
