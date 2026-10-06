export default function DonutChart({ slices = [], labels = {}, format, empty }) {
  const total = slices.reduce((s, x) => s + Number(x.value || 0), 0)
  if (!total) return <div className="rdash-empty">{empty}</div>
  const colors = {
    received: '#0f6e56',
    pending: '#185fa5',
    overdue: '#a32d2d',
    cancelled: '#8a9db4',
  }
  const r = 36
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="rdash-donut">
      <svg viewBox="0 0 100 100" className="rdash-donut-svg">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#eef2f6" strokeWidth="12" />
        {slices.map(s => {
          if (!s.value) return null
          const len = (s.value / total) * c
          const el = (
            <circle
              key={s.key}
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke={colors[s.key] || '#0c1c30'}
              strokeWidth="12"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 50 50)"
            />
          )
          offset += len
          return el
        })}
      </svg>
      <ul className="rdash-legend">
        {slices.map(s => (
          <li key={s.key}>
            <i style={{ background: colors[s.key] }} />
            <span>{labels[s.key] || s.key}</span>
            <strong>{format ? format(s.value) : s.value} · {Math.round((s.value / total) * 100)}%</strong>
          </li>
        ))}
      </ul>
    </div>
  )
}
