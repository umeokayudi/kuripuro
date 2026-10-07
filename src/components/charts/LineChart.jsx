import { useMemo, useState } from 'react'

export default function LineChart({ series = [], formatY, formatX, formatCount, empty }) {
  const [tip, setTip] = useState(null)
  const w = 320
  const h = 148
  const pad = { l: 8, r: 8, t: 12, b: 22 }
  const innerW = w - pad.l - pad.r
  const innerH = h - pad.t - pad.b
  const max = Math.max(...series.map(s => s.value), 0)
  const pts = useMemo(() => {
    if (!series.length) return []
    return series.map((s, i) => {
      const x = pad.l + (series.length === 1 ? innerW / 2 : (i / (series.length - 1)) * innerW)
      const y = pad.t + innerH - (max ? (s.value / max) * innerH : 0)
      return { ...s, x, y }
    })
  }, [series, max, innerW, innerH, pad.l, pad.t])
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const area = pts.length
    ? `${d} L${pts[pts.length - 1].x.toFixed(1)},${pad.t + innerH} L${pts[0].x.toFixed(1)},${pad.t + innerH} Z`
    : ''
  const ticks = pts.filter((_, i) => i === 0 || i === pts.length - 1 || (pts.length > 4 && i === Math.floor(pts.length / 2)))

  if (!series.length || series.every(s => !s.value)) {
    return <div className="rdash-empty">{empty}</div>
  }

  const nearest = (clientX, rect) => {
    const x = ((clientX - rect.left) / rect.width) * w
    let best = pts[0]
    let dist = Infinity
    for (const p of pts) {
      const dd = Math.abs(p.x - x)
      if (dd < dist) { dist = dd; best = p }
    }
    return best
  }

  return (
    <div className="rdash-chart-wrap">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="rdash-svg"
        onMouseMove={e => setTip(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
        onMouseLeave={() => setTip(null)}
        onTouchStart={e => {
          const t = e.touches[0]
          setTip(nearest(t.clientX, e.currentTarget.getBoundingClientRect()))
        }}
      >
        <path d={area} fill="rgba(12,28,48,0.08)" />
        <path d={d} fill="none" stroke="#0c1c30" strokeWidth="2" strokeLinejoin="round" />
        {pts.map(p => (
          <circle key={p.key} cx={p.x} cy={p.y} r={tip?.key === p.key ? 4 : 2.4} fill={tip?.key === p.key ? '#c19c56' : '#0c1c30'} />
        ))}
        {ticks.map(p => (
          <text key={`t-${p.key}`} x={p.x} y={h - 4} textAnchor="middle" className="rdash-tick">{formatX ? formatX(p) : p.key}</text>
        ))}
      </svg>
      {tip && (
        <div className="rdash-tip">
          <strong>{formatX ? formatX(tip) : tip.key}</strong>
          <span>{formatY ? formatY(tip.value) : tip.value}</span>
          {tip.count != null && <span>{formatCount ? formatCount(tip.count) : tip.count}</span>}
        </div>
      )}
    </div>
  )
}
