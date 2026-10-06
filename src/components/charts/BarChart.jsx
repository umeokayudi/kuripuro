import { useState } from 'react'

export default function BarChart({ rows = [], format, empty, onSelect }) {
  const [tip, setTip] = useState(null)
  const max = Math.max(...rows.map(r => r.value), 0)
  if (!rows.length || !max) return <div className="rdash-empty">{empty}</div>
  return (
    <div className="rdash-bars">
      {rows.map(r => {
        const pct = Math.max(4, Math.round((r.value / max) * 100))
        return (
          <button
            type="button"
            key={r.id || r.name}
            className="rdash-bar-row"
            onClick={() => onSelect?.(r)}
            onMouseEnter={() => setTip(r)}
            onMouseLeave={() => setTip(null)}
          >
            <span className="rdash-bar-name">{r.name}</span>
            <span className="rdash-bar-track"><span className="rdash-bar-fill" style={{ width: `${pct}%` }} /></span>
            <span className="rdash-bar-val">{format ? format(r.value) : r.value}</span>
          </button>
        )
      })}
      {tip && (
        <div className="rdash-tip">
          {tip.name} · {format ? format(tip.value) : tip.value}
          {tip.count != null ? ` · ${tip.count}` : ''}
        </div>
      )}
    </div>
  )
}
