import { usePeriod } from '../hooks/usePeriod'
import { useLang } from '../hooks/useLang'
import { PERIOD_PRESETS } from '../lib/period'

export default function PeriodFilter({ compact = false }) {
  const { t } = useLang()
  const p = t.period
  const { preset, start, end, setPreset, setCustom } = usePeriod()

  return (
    <div className={`period-filter${compact ? ' compact' : ''}`}>
      <span className="period-label">{p.label}</span>
      <div className="period-chips">
        {PERIOD_PRESETS.filter(k => k !== 'custom').map(k => (
          <button
            key={k}
            type="button"
            className={`period-chip${preset === k ? ' on' : ''}`}
            onClick={() => setPreset(k)}
          >
            {p[k]}
          </button>
        ))}
        <button
          type="button"
          className={`period-chip${preset === 'custom' ? ' on' : ''}`}
          onClick={() => setPreset('custom')}
        >
          {p.custom}
        </button>
      </div>
      <div className="period-dates">
        <label>
          {p.from}
          <input type="date" value={start} onChange={e => setCustom(e.target.value, end)} />
        </label>
        <label>
          {p.to}
          <input type="date" value={end} onChange={e => setCustom(start, e.target.value)} />
        </label>
      </div>
    </div>
  )
}
