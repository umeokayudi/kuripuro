import { useEffect, useRef, useState } from 'react'

// Small chart pieces for the sales and marketing KPI panels.
// One hue (--kpi-bar) for magnitude; status colors only for good/bad, always with a sign or label.

export const yen = n => (n == null ? '—' : `¥${Math.round(Number(n) || 0).toLocaleString()}`)
export const pct = n => (n == null ? '—' : `${Math.round(n)}%`)
export const num = (n, digits = 0) => (n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: digits }))

export function monthLabel(month, lang) {
  const [y, m] = String(month).split('-').map(Number)
  if (!y || !m) return month
  return new Intl.DateTimeFormat(lang === 'ja' ? 'ja-JP' : 'en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)))
}

/** Range pills shared by every panel. */
export function RangePills({ value, onChange, options }) {
  return <div className="kpi-pills" role="tablist">{options.map(([key, label]) => <button type="button" role="tab" aria-selected={value === key} key={key} className={value === key ? 'active' : ''} onClick={() => onChange(key)}>{label}</button>)}</div>
}

/** Change vs the previous window. `goodWhenDown` flips the color for costs. */
export function Delta({ value, goodWhenDown = false, label, unit = '%' }) {
  if (value == null) return <span className="kpi-delta flat">—</span>
  const up = value > 0
  const good = value === 0 ? null : (up !== goodWhenDown)
  return <span className={`kpi-delta ${good == null ? 'flat' : good ? 'good' : 'bad'}`} title={label}>{value === 0 ? `±0${unit}` : `${up ? '▲' : '▼'} ${Math.abs(value)}${unit}`}</span>
}

export function KpiTile({ label, value, delta, goodWhenDown, hint, vsLabel, unit }) {
  return <div className="kpi-tile">
    <span className="kpi-tile-label">{label}</span>
    <strong className="kpi-tile-value">{value}</strong>
    <span className="kpi-tile-foot">{delta !== undefined && <Delta value={delta} goodWhenDown={goodWhenDown} label={vsLabel} unit={unit} />}{hint && <small>{hint}</small>}</span>
  </div>
}

/**
 * Monthly bars with an optional goal tick per month. The caption shows the hovered
 * (or latest) month so the value is readable on touch screens too.
 */
export function TrendBars({ rows, valueKey, goalKey, format = num, lang, goalLabel, actualLabel, emptyLabel }) {
  const [active, setActive] = useState(null)
  const boxRef = useRef(null)
  const [boxWidth, setBoxWidth] = useState(640)
  useEffect(() => {
    const el = boxRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(([entry]) => setBoxWidth(Math.round(entry.contentRect.width) || 640))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const values = rows.map(row => Number(row[valueKey] || 0))
  const goals = goalKey ? rows.map(row => Number(row.goal?.[goalKey] || 0)) : []
  const max = Math.max(1, ...values, ...goals)
  const shown = active ?? rows.length - 1
  const current = rows[shown]
  const hasData = values.some(Boolean) || goals.some(Boolean)
  // Real pixel width so labels never stretch; scrolls sideways only when months don't fit.
  const width = Math.max(rows.length * 40, boxWidth)
  const height = 150
  const slot = width / rows.length
  const barW = Math.min(30, slot * 0.58)
  return <div className="kpi-trend">
    <div className="kpi-trend-caption" aria-live="polite">
      {current && <><b>{monthLabel(current.month, lang)}</b><span>{format(current[valueKey])}</span>{goalKey && current.goal?.[goalKey] > 0 && <small>{goalLabel}: {format(current.goal[goalKey])} · {pct(Number(current[valueKey] || 0) / current.goal[goalKey] * 100)}</small>}</>}
    </div>
    {!hasData && <p className="kpi-empty">{emptyLabel}</p>}
    <div className="kpi-trend-scroll" ref={boxRef}>
      <svg viewBox={`0 0 ${width} ${height + 22}`} width={width} height={height + 22} role="img" aria-label={valueKey} onMouseLeave={() => setActive(null)}>
        <line x1="0" x2={width} y1={height} y2={height} className="kpi-axis" />
        {rows.map((row, i) => {
          const h = values[i] / max * (height - 8)
          const x = i * slot + (slot - barW) / 2
          const goalY = goals[i] ? height - goals[i] / max * (height - 8) : null
          return <g key={row.month} className={`kpi-bar-group${shown === i ? ' active' : ''}`} onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onClick={() => setActive(i)} tabIndex={0}>
            <rect x={i * slot} y="0" width={slot} height={height} className="kpi-hit" />
            {h > 0 && <path className="kpi-bar" d={`M${x},${height} V${height - h + Math.min(4, h)} Q${x},${height - h} ${x + Math.min(4, h)},${height - h} H${x + barW - Math.min(4, h)} Q${x + barW},${height - h} ${x + barW},${height - h + Math.min(4, h)} V${height} Z`} />}
            {goalY != null && <line className="kpi-goal-tick" x1={x - 4} x2={x + barW + 4} y1={goalY} y2={goalY} />}
            <text x={i * slot + slot / 2} y={height + 15} textAnchor="middle" className="kpi-x-label">{monthLabel(row.month, lang)}</text>
          </g>
        })}
      </svg>
    </div>
    {goalKey && goals.some(Boolean) && <div className="kpi-legend"><span><i className="kpi-swatch bar" />{actualLabel}</span><span><i className="kpi-swatch goal" />{goalLabel}</span></div>}
  </div>
}

/** Funnel as horizontal bars with step conversion. */
export function FunnelBars({ steps, labels, convLabel }) {
  const max = Math.max(1, ...steps.map(s => s.value))
  return <div className="kpi-funnel">{steps.map(step => <div className="kpi-funnel-row" key={step.key}>
    <span className="kpi-funnel-label">{labels[step.key]}</span>
    <div className="kpi-funnel-track"><i style={{ width: `${Math.max(step.value ? 3 : 0, step.value / max * 100)}%` }} /></div>
    <b className="kpi-funnel-value">{num(step.value)}</b>
    <small className="kpi-funnel-conv">{step.fromPrev != null ? `${pct(step.fromPrev)} ${convLabel}` : ''}</small>
  </div>)}</div>
}

/** Ranked horizontal bars (lost reasons, stages, sources). */
export function RankBars({ rows, labelKey, valueKey, format = num, extra }) {
  const max = Math.max(1, ...rows.map(row => Number(row[valueKey] || 0)))
  return <div className="kpi-rank">{rows.map(row => <div className="kpi-rank-row" key={row[labelKey]}>
    <span className="kpi-rank-label" title={row[labelKey]}>{row[labelKey]}</span>
    <div className="kpi-rank-track"><i style={{ width: `${Number(row[valueKey] || 0) / max * 100}%` }} /></div>
    <b>{format(row[valueKey])}</b>
    {extra && <small>{extra(row)}</small>}
  </div>)}</div>
}

/** One stacked bar for parts of a whole (follow-up health), labelled under it. */
export function StackBar({ parts }) {
  const total = parts.reduce((a, p) => a + p.value, 0)
  return <div className="kpi-stack">
    <div className="kpi-stack-bar" role="img" aria-label={parts.map(p => `${p.label} ${p.value}`).join(', ')}>
      {total === 0 ? <i className="kpi-stack-empty" style={{ width: '100%' }} /> : parts.filter(p => p.value).map(p => <i key={p.key} className={`kpi-stack-${p.tone}`} style={{ width: `${p.value / total * 100}%` }} title={`${p.label}: ${p.value}`} />)}
    </div>
    <div className="kpi-stack-legend">{parts.map(p => <span key={p.key}><i className={`kpi-dot kpi-stack-${p.tone}`} />{p.label} <b>{p.value}</b></span>)}</div>
  </div>
}

/** Progress bar against a target, with the share of the month gone as a marker. */
export function TargetBar({ label, value, target, format = num, pace, invert = false, doneLabel }) {
  const percent = target ? Math.round(value / target * 100) : null
  const width = percent == null ? 0 : Math.min(100, percent)
  const tone = percent == null ? '' : invert ? (percent > 100 ? 'bad' : 'good') : percent >= 100 ? 'good' : pace != null && percent < pace - 10 ? 'warn' : ''
  return <div className="kpi-target">
    <div className="kpi-target-meta"><span>{label}</span><b>{format(value)}{target ? <small> / {format(target)}</small> : null}</b></div>
    <div className="kpi-target-track"><i className={tone} style={{ width: `${width}%` }} />{pace != null && target ? <em style={{ left: `${pace}%` }} /> : null}</div>
    <small className={`kpi-target-foot ${tone}`}>{percent == null ? '—' : percent >= 100 && !invert ? `✓ ${doneLabel} · ${percent}%` : `${percent}%`}</small>
  </div>
}
