// v1.0.160 · Hour + minute as two plain selects. The phone's own time dialog (Android "Definir horário")
// cut its OK button off on some phones; selects open the system list, which always fits the screen.
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = ['00', '15', '30', '45']

export default function TimeSelect({ value = '', onChange, emptyLabel = '—', ariaLabel = 'time' }) {
  const m = /^(\d{2}):(\d{2})/.exec(value || '')
  const h = m ? m[1] : ''
  const mm = m ? m[2] : ''
  const mins = mm && !MINUTES.includes(mm) ? [...MINUTES, mm].sort() : MINUTES
  const set = (nh, nm) => onChange(nh ? `${nh}:${nm || '00'}` : '')
  return (
    <div className="time-select" role="group" aria-label={ariaLabel}>
      <select aria-label={`${ariaLabel} h`} value={h} onChange={e => set(e.target.value, mm)}>
        <option value="">{emptyLabel}</option>
        {HOURS.map(x => <option key={x} value={x}>{x}</option>)}
      </select>
      <span aria-hidden="true">:</span>
      <select aria-label={`${ariaLabel} min`} value={mm} disabled={!h} onChange={e => set(h, e.target.value)}>
        {!h && <option value="">--</option>}
        {mins.map(x => <option key={x} value={x}>{x}</option>)}
      </select>
    </div>
  )
}
