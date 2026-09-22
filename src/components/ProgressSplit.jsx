import { splitAria } from '../lib/progressSplit'

export function ProgressSplitMini({ parts = [], className = '' }) {
  const shown = parts.filter(p => p.share > 0)
  return (
    <div className={`kp-split-track mini ${className}`.trim()} aria-hidden="true">
      {shown.length === 0 ? (
        <div className="kp-split-seg empty" style={{ width: '100%' }} />
      ) : shown.map(p => (
        <div
          key={p.key}
          className="kp-split-seg"
          style={{ width: `${p.share}%`, background: p.color }}
        />
      ))}
    </div>
  )
}

export default function ProgressSplit({
  title,
  subtitle,
  headline,
  headlineHint,
  parts = [],
  variant = 'light',
  compact = false,
}) {
  const aria = splitAria({ parts }, [title, headline].filter(Boolean).join(' · '))
  const shown = parts.filter(p => p.share > 0)

  return (
    <div className={`kp-split ${variant}${compact ? ' compact' : ''}`}>
      {(title || headline || subtitle) && (
        <div className="kp-split-head">
          {title && <div className="kp-split-title">{title}</div>}
          {(headline || headlineHint) && (
            <div className="kp-split-hero">
              {headline && <div className="kp-split-hero-num">{headline}</div>}
              {headlineHint && <div className="kp-split-hero-hint">{headlineHint}</div>}
            </div>
          )}
          {subtitle && <div className="kp-split-sub">{subtitle}</div>}
        </div>
      )}

      <div className="kp-split-track" role="img" aria-label={aria}>
        {shown.length === 0 ? (
          <div className="kp-split-seg empty" style={{ width: '100%' }} />
        ) : shown.map(p => (
          <div
            key={p.key}
            className="kp-split-seg"
            style={{ width: `${p.share}%`, background: p.color }}
            title={`${p.label || p.key} ${p.count} (${p.pct}%)`}
          />
        ))}
      </div>

      <div className="kp-split-legend">
        {parts.map(p => (
          <div key={p.key} className={`kp-split-chip${p.count ? '' : ' muted'}`}>
            <i style={{ background: p.color }} />
            <span className="kp-split-chip-lbl">{p.label || p.key}</span>
            <b>{p.count}</b>
            <span className="kp-split-chip-pct">{p.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
