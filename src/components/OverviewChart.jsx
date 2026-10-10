import { useState, useRef, useEffect } from 'react'

// Bars = completed jobs (right axis), line = recorded net cash (left axis).
// Tap or hover a column to see its values, like the reference dashboard.
export default function OverviewChart({ data, cashLabel, jobsLabel, formatCash, emptyLabel }) {
  const [active, setActive] = useState(null)
  const plotRef = useRef(null)
  const [width, setWidth] = useState(640)
  const hasData = data.length > 0
  useEffect(() => {
    const el = plotRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry.contentRect.width))))
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasData])
  useEffect(() => { setActive(null) }, [data.length])
  if (!data.length) return <div className="ov-empty">{emptyLabel}</div>

  // Drawn at the real pixel width so the axis text is never stretched.
  const W = width, H = 240, padL = 44, padR = 30, padT = 18, padB = 28
  const innerW = W - padL - padR, innerH = H - padT - padB
  const maxJobs = Math.max(1, ...data.map(d => d.jobs))
  const cashValues = data.map(d => d.cash)
  const maxCash = Math.max(0, ...cashValues)
  const minCash = Math.min(0, ...cashValues)
  const span = maxCash - minCash || 1
  const step = innerW / data.length
  const barW = Math.max(3, Math.min(22, step * 0.55))
  const x = i => padL + step * i + step / 2
  const yJobs = v => padT + innerH - (v / maxJobs) * innerH
  const yCash = v => padT + innerH - ((v - minCash) / span) * innerH
  const linePath = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yCash(d.cash).toFixed(1)}`).join(' ')
  const ticks = [0, 0.5, 1]
  const labelEvery = Math.ceil(data.length / Math.max(4, Math.floor(innerW / 48)))
  const compact = v => {
    const abs = Math.abs(v)
    const s = abs >= 1_000_000 ? `${(abs / 1_000_000).toFixed(1)}M` : abs >= 1000 ? `${Math.round(abs / 1000)}k` : `${Math.round(abs)}`
    return (v < 0 ? '−' : '') + '¥' + s
  }
  const point = active != null ? data[active] : null

  return (
    <div className="ov-chart">
      <div className="ov-legend">
        <span className="ov-legend-line">{cashLabel}</span>
        <span className="ov-legend-bar">{jobsLabel}</span>
      </div>
      <div className="ov-plot" ref={plotRef} onMouseLeave={() => setActive(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${cashLabel} / ${jobsLabel}`}>
          {ticks.map(t => {
            const y = padT + innerH - t * innerH
            return (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y} y2={y} className="ov-grid" />
                <text x={padL - 6} y={y + 4} textAnchor="end" className="ov-axis ov-axis-cash">{compact(minCash + span * t)}</text>
                <text x={W - padR + 6} y={y + 4} className="ov-axis ov-axis-jobs">{Math.round(maxJobs * t)}</text>
              </g>
            )
          })}
          {minCash < 0 && <line x1={padL} x2={W - padR} y1={yCash(0)} y2={yCash(0)} className="ov-zero" />}
          {data.map((d, i) => (
            <rect key={d.key} x={x(i) - barW / 2} y={yJobs(d.jobs)} width={barW} height={Math.max(0, padT + innerH - yJobs(d.jobs))} rx={Math.min(4, barW / 2)} className={`ov-bar${active === i ? ' is-active' : ''}`} />
          ))}
          <path d={linePath} className="ov-line" />
          {point && <circle cx={x(active)} cy={yCash(point.cash)} r="6" className="ov-dot" />}
          {data.map((d, i) => i % labelEvery === 0 && (
            <text key={d.key} x={x(i)} y={H - 8} textAnchor="middle" className="ov-axis">{d.label}</text>
          ))}
          {data.map((d, i) => (
            <rect key={d.key} x={padL + step * i} y={padT} width={step} height={innerH} fill="transparent"
              onMouseEnter={() => setActive(i)} onClick={() => setActive(active === i ? null : i)} />
          ))}
        </svg>
        {point && (
          <div className="ov-tip" style={{ left: `${(x(active) / W) * 100}%` }}>
            <small>{point.title || point.label}</small>
            <strong>{formatCash(point.cash)}</strong>
            <span>{point.jobs} {jobsLabel.toLowerCase()}</span>
          </div>
        )}
      </div>
    </div>
  )
}
