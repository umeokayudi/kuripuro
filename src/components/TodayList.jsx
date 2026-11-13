// v1.0.254 · "Pra hoje": one list of what the person has today, each line with its status colour.
// Shared by the seller and marketing portals. Colours mean the same as everywhere else:
//   green = done · amber = attention / follow-up · blue = scheduled · red = late · gray = cancelled / later
// item = { id, group?, time?, icon?, title, sub?, tone, status, onClick?, action?: { label, onClick } }

export const TONES = ['green', 'amber', 'blue', 'red', 'gray']

export function StatusChip({ tone = 'gray', children }) {
  return <span className={`th-chip is-${TONES.includes(tone) ? tone : 'gray'}`}>{children}</span>
}

export function IconTile({ icon, tone = 'blue', size = 40 }) {
  return <span className={`th-tile is-${tone}`} style={{ width: size, height: size, flexBasis: size }} aria-hidden="true">{icon}</span>
}

export default function TodayList({ items = [], groups = [], empty = '', loadingGroups = [] }) {
  // groups = [{ key, label, icon, tone, count?, onOpen?, openLabel? }] in display order
  const byGroup = new Map(groups.map(g => [g.key, []]))
  for (const it of items) { if (!byGroup.has(it.group)) byGroup.set(it.group, []); byGroup.get(it.group).push(it) }
  const shown = groups.filter(g => (byGroup.get(g.key) || []).length || loadingGroups.includes(g.key) || g.always)
  if (!shown.length) return <p className="th-empty">{empty}</p>
  return (
    <div className="th-list">
      {shown.map(g => {
        const rows = byGroup.get(g.key) || []
        return (
          <div className="th-group" key={g.key}>
            <div className="th-group-head">
              <IconTile icon={g.icon} tone={g.tone} size={28} />
              <strong>{g.label}</strong>
              {(g.count ?? rows.length) > 0 && <span className="th-count">{g.count ?? rows.length}</span>}
              {g.onOpen && <button type="button" className="th-open" onClick={g.onOpen}>{g.openLabel || '›'}</button>}
            </div>
            {loadingGroups.includes(g.key) && !rows.length && <p className="th-empty is-small">…</p>}
            {g.note && <p className="th-empty is-small">{g.note}</p>}
            {rows.map(it => (
              <div key={it.id} className={`th-row is-${it.tone || 'gray'}`}>
                <button type="button" className="th-row-main" onClick={it.onClick} disabled={!it.onClick}>
                  <span className="th-time">{it.time || '—'}</span>
                  <span className="th-text"><strong>{it.title}</strong>{it.sub && <small>{it.sub}</small>}</span>
                  <StatusChip tone={it.tone}>{it.status}</StatusChip>
                </button>
                {it.action && <button type="button" className="th-act" onClick={it.action.onClick} aria-label={it.action.label} title={it.action.label}><span className="th-act-icon" aria-hidden="true">✎</span><span className="th-act-label">{it.action.label}</span></button>}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
