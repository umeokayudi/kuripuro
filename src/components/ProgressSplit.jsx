import { dominantPart, splitAria } from '../lib/progressSplit'

const MINI_SKIP = new Set(['missing'])

export function ProgressSplitMini({ parts = [], className = '' }) {
  const shown = parts.filter(p => p.share > 0 && !MINI_SKIP.has(p.key))
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
  story,
  emptyText,
  parts = [],
  variant = 'light',
  compact = false,
}) {
  const active = parts.filter(p => p.count > 0)
  const top = dominantPart({ parts: active })
  const aria = splitAria({ parts: active }, [title, headline].filter(Boolean).join(' · '))
  const storyText = story == null
    ? (top && top.pct >= 55 ? `${top.count} · ${top.pct}% ${top.label}` : '')
    : story

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

      {storyText && top && (
        <div className={`kp-split-story ${top.key}`} style={{ borderColor: top.color }}>
          {storyText}
        </div>
      )}

      {active.length === 0 ? (
        <div className="kp-split-empty">{emptyText || '—'}</div>
      ) : (
        <div className="kp-split-rows" role="img" aria-label={aria}>
          {active.map(p => (
            <div key={p.key} className="kp-split-row">
              <div className="kp-split-row-meta">
                <i style={{ background: p.color }} />
                <span className="kp-split-row-lbl">{p.label || p.key}</span>
                <b>{p.count}</b>
                <span className="kp-split-row-pct">{p.pct}%</span>
              </div>
              <div className="kp-split-row-track">
                <div
                  className="kp-split-row-fill"
                  style={{
                    width: `${Math.max(p.pct, p.count ? 4 : 0)}%`,
                    background: p.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
