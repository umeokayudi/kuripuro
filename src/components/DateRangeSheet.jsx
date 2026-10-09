import { useState } from 'react'

// Dates are plain 'YYYY-MM-DD' strings in Tokyo time, like the rest of the app.
export const tokyoToday = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).split(' ')[0]

const shift = (iso, days) => {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function presetRange(preset, today = tokyoToday()) {
  const weekday = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7 // Monday = 0
  if (preset === 'today') return { from: today, to: today }
  if (preset === 'week') return { from: shift(today, -weekday), to: today }
  if (preset === 'month') return { from: today.slice(0, 8) + '01', to: today }
  if (preset === 'lastMonth') {
    const end = shift(today.slice(0, 8) + '01', -1)
    return { from: end.slice(0, 8) + '01', to: end }
  }
  if (preset === 'year') return { from: today.slice(0, 5) + '01-01', to: today }
  return null
}

export const RANGE_PRESETS = ['today', 'week', 'month', 'lastMonth', 'year']

export const rangeCopy = lang => lang === 'ja'
  ? { today: '今日', week: '今週', month: '今月', lastMonth: '先月', year: '今年', custom: '期間を指定', title: '期間を選択', from: '開始', to: '終了', orPreset: 'またはよく使う期間', cancel: 'キャンセル', save: '保存', weekdays: ['月', '火', '水', '木', '金', '土', '日'], prev: '前の月', next: '次の月' }
  : { today: 'Today', week: 'This week', month: 'This month', lastMonth: 'Last month', year: 'This year', custom: 'Custom range', title: 'Select date', from: 'From', to: 'To', orPreset: 'Or select a time frame', cancel: 'Cancel', save: 'Save', weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], prev: 'Previous month', next: 'Next month' }

export function formatRangeLabel(range, lang) {
  const copy = rangeCopy(lang)
  if (range.preset && copy[range.preset]) return copy[range.preset]
  const locale = lang === 'ja' ? 'ja-JP' : 'en-GB'
  const fmt = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return range.from === range.to ? fmt(range.from) : `${fmt(range.from)} – ${fmt(range.to)}`
}

const CalendarIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>

export default function DateRangeSheet({ value, onSave, onClose, lang }) {
  const copy = rangeCopy(lang)
  const locale = lang === 'ja' ? 'ja-JP' : 'en-GB'
  const [draft, setDraft] = useState({ from: value.from, to: value.to, preset: value.preset || null })
  const [picking, setPicking] = useState('from')
  const [view, setView] = useState(value.to.slice(0, 7))

  const [year, month] = view.split('-').map(Number)
  const first = `${view}-01`
  const lead = (new Date(first + 'T12:00:00Z').getUTCDay() + 6) % 7
  const cells = Array.from({ length: 42 }, (_, i) => shift(first, i - lead))
  const moveMonth = delta => {
    const d = new Date(Date.UTC(year, month - 1 + delta, 1))
    setView(d.toISOString().slice(0, 7))
  }
  const today = tokyoToday()

  const pickDay = iso => {
    if (picking === 'from' || iso < draft.from) {
      setDraft({ from: iso, to: iso, preset: null })
      setPicking('to')
    } else {
      setDraft({ ...draft, to: iso, preset: null })
      setPicking('from')
    }
  }
  const pickPreset = preset => {
    const r = presetRange(preset)
    setDraft({ ...r, preset })
    setView(r.to.slice(0, 7))
    setPicking('from')
  }
  const short = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })

  return (
    <div className="drs-overlay" onClick={onClose}>
      <section className="drs-sheet" role="dialog" aria-modal="true" aria-label={copy.title} onClick={e => e.stopPropagation()}>
        <header className="drs-head">
          <button type="button" className="drs-close" onClick={onClose} aria-label={copy.cancel}>×</button>
          <strong>{copy.title}</strong>
          <span />
        </header>
        <div className="drs-fields">
          {['from', 'to'].map(key => (
            <button type="button" key={key} className={`drs-field${picking === key ? ' is-active' : ''}`} onClick={() => setPicking(key)}>
              <small>{copy[key]}</small>
              <span>{short(draft[key])}<CalendarIcon /></span>
            </button>
          ))}
        </div>
        <div className="drs-calendar">
          <div className="drs-month">
            <button type="button" onClick={() => moveMonth(-1)} aria-label={copy.prev}>‹</button>
            <strong>{new Date(first + 'T12:00:00Z').toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</strong>
            <button type="button" onClick={() => moveMonth(1)} aria-label={copy.next}>›</button>
          </div>
          <div className="drs-grid">
            {copy.weekdays.map(w => <span key={w} className="drs-weekday">{w}</span>)}
            {cells.map((iso, i) => {
              const inMonth = iso.slice(0, 7) === view
              const inRange = iso >= draft.from && iso <= draft.to
              const edge = iso === draft.from || iso === draft.to
              const col = i % 7
              const cls = ['drs-day', !inMonth && 'is-out', inRange && 'in-range', edge && 'is-edge', iso === draft.from && 'is-start', iso === draft.to && 'is-end', col === 0 && 'row-start', col === 6 && 'row-end', iso === today && 'is-today'].filter(Boolean).join(' ')
              return <button type="button" key={iso} className={cls} onClick={() => pickDay(iso)}><span>{Number(iso.slice(8))}</span></button>
            })}
          </div>
        </div>
        <div className="drs-presets">
          <small>{copy.orPreset}</small>
          {RANGE_PRESETS.map(preset => (
            <label key={preset} className="drs-radio">
              <input type="radio" name="drs-preset" checked={draft.preset === preset} onChange={() => pickPreset(preset)} />
              <span>{copy[preset]}</span>
            </label>
          ))}
        </div>
        <footer className="drs-foot">
          <button type="button" className="drs-cancel" onClick={onClose}>{copy.cancel}</button>
          <button type="button" className="drs-save" onClick={() => onSave(draft)}>{copy.save}</button>
        </footer>
      </section>
    </div>
  )
}
