import { useState } from 'react'

// One metric, one bar per month. The value sits above each bar so the chart reads
// without hovering; tap or hover a bar for the full month. Negative months are red.
export default function MonthBars({ data, format, tone = '#3b82f6', min = 0, max: fixedMax, emptyLabel }) {
  const [active, setActive] = useState(null)
  const values = data.map(d => d.value).filter(v => v != null)
  if (!values.length) return <div className="mk-empty">{emptyLabel}</div>

  const W = 320, H = 150, padT = 20, padB = 22, padX = 6
  const innerH = H - padT - padB
  const max = fixedMax ?? Math.max(...values.map(Math.abs), 1)
  const step = (W - padX * 2) / data.length
  const barW = Math.min(30, step * 0.6)
  const x = i => padX + step * i + step / 2
  const h = v => v == null ? 0 : Math.max(2, ((Math.abs(v) - min) / ((max - min) || 1)) * innerH)
  const last = data.length - 1
  const point = active != null ? data[active] : null

  return (
    <div className="mk-plot" onMouseLeave={() => setActive(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={data.map(d => `${d.title}: ${d.value == null ? '—' : format(d.value)}`).join(', ')}>
        <line x1={padX} x2={W - padX} y1={padT + innerH} y2={padT + innerH} className="mk-base" />
        {data.map((d, i) => {
          const bh = h(d.value)
          const y = padT + innerH - bh
          return (
            <g key={d.key}>
              {d.value != null && (
                <rect x={x(i) - barW / 2} y={y} width={barW} height={bh} rx="4"
                  fill={d.value < 0 ? '#e06c6c' : tone} opacity={active === i || (active == null && i === last) ? 1 : 0.42} />
              )}
              <text x={x(i)} y={d.value == null ? padT + innerH - 4 : y - 5} textAnchor="middle" className={`mk-val${i === last ? ' is-now' : ''}`}>
                {d.value == null ? '—' : format(d.value, true)}
              </text>
              <text x={x(i)} y={H - 6} textAnchor="middle" className={`mk-month${i === last ? ' is-now' : ''}`}>{d.label}</text>
              <rect x={padX + step * i} y={0} width={step} height={H} fill="transparent"
                onMouseEnter={() => setActive(i)} onClick={() => setActive(active === i ? null : i)} />
            </g>
          )
        })}
      </svg>
      {point && (
        <div className="mk-tip" style={{ left: `${(x(active) / W) * 100}%` }}>
          <small>{point.title}</small>
          <strong>{point.value == null ? '—' : format(point.value)}</strong>
          {point.sub && <span>{point.sub}</span>}
        </div>
      )}
    </div>
  )
}
