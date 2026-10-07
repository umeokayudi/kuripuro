import { useMemo, useState } from 'react'
import { useLang } from '../hooks/useLang'
import { usePeriod } from '../hooks/usePeriod'
import { growthWindows, monthBuckets } from '../lib/period'

const WINDOWS = [3, 6, 9, 12]

function monthTick(ym, lang) {
  const [y, m] = String(ym).split('-')
  if (lang === 'ja') return `${Number(m)}月`
  return new Date(`${y}-${m}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'short' })
}

export default function RevenueGrowth({ invoices, fmt }) {
  const { lang, t } = useLang()
  const p = t.period
  const { setCustom } = usePeriod()
  const [metric, setMetric] = useState('billed')
  const [months, setMonths] = useState(3)

  const windows = useMemo(() => growthWindows(invoices), [invoices])
  const buckets = useMemo(() => monthBuckets(invoices, months), [invoices, months])
  const w = windows.find(x => x.months === months) || windows[0]
  const current = metric === 'billed' ? w.billed : w.received
  const prev = metric === 'billed' ? w.billedPrev : w.receivedPrev
  const growth = metric === 'billed' ? w.billedGrowth : w.receivedGrowth
  const maxBar = Math.max(...buckets.map(b => (metric === 'billed' ? b.billed : b.received)), 1)
  const up = growth > 0
  const down = growth < 0

  return (
    <div className="rev-panel">
      <div className="rev-head">
        <div className="rev-title">{p.tableTitle}</div>
        <div className="rev-filters">
          <div className="rev-seg" role="tablist">
            <button type="button" className={metric === 'billed' ? 'on' : ''} onClick={() => setMetric('billed')}>{p.billed}</button>
            <button type="button" className={metric === 'received' ? 'on' : ''} onClick={() => setMetric('received')}>{p.received}</button>
          </div>
          <div className="rev-chips">
            {WINDOWS.map(n => (
              <button type="button" key={n} className={months === n ? 'on' : ''} onClick={() => setMonths(n)}>
                {p[`m${n}`]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rev-body">
        <div className="rev-hero">
          <div className="rev-amount">{fmt(current)}</div>
          <div className={`rev-delta ${up ? 'growth-up' : down ? 'growth-down' : ''}`}>
            {up ? '+' : ''}{growth}% <span>{p.vsPrev}</span>
          </div>
          <div className="rev-prior">{p.prev}: {fmt(prev)}</div>
        </div>
        <div className="rev-spark" role="img" aria-label={p.monthlyTitle}>
          {buckets.map((b, i) => {
            const val = metric === 'billed' ? b.billed : b.received
            const h = Math.max(4, Math.round((val / maxBar) * 56))
            const showTick = months <= 6 || i === 0 || i === buckets.length - 1 || i % 3 === 0
            return (
              <button
                type="button"
                key={b.ym}
                className="rev-col"
                title={`${b.ym} ${fmt(val)}`}
                onClick={() => setCustom(b.start, b.end)}
              >
                <span className="rev-bar" style={{ height: h }} />
                {showTick && <span className="rev-tick">{monthTick(b.ym, lang)}</span>}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
