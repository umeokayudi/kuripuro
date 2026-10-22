// Admin Jobs list: period chips, date range, per-person checkboxes and time summary (v1.0.26).
import { useLang, fill } from '../hooks/useLang'
import { changePct, fmtMinutes } from '../lib/jobsPeriod'

// v1.0.67: upcoming periods first (what is coming is what the admin plans), then the past.
const PERIODS = [
  ['today', 'periodToday'], ['tomorrow', null, ['Tomorrow', '明日', 'Amanhã']],
  ['next7', null, ['Next 7 days', '今後7日', 'Próximos 7 dias']],
  ['yesterday', 'periodYesterday'], ['7d', null, ['Last 7 days', '過去7日', 'Últimos 7 dias']],
  ['30d', 'period30d'], ['all', 'periodAll'],
]
const DOW = { en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], ja: ['日', '月', '火', '水', '木', '金', '土'], pt: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] }

export function rangeLabel(range) {
  if (!range) return ''
  const f = d => `${d.slice(5, 7)}/${d.slice(8, 10)}`
  return range.from === range.to ? f(range.from) : `${f(range.from)}–${f(range.to)}`
}

function Delta({ cur, prev, neutral }) {
  const pct = changePct(cur, prev)
  if (pct == null) return null
  const up = pct > 0
  const color = neutral || pct === 0 ? 'var(--text3)' : up ? '#16a34a' : '#dc2626'
  return <span style={{ color, fontWeight: 700 }}>{pct === 0 ? '=' : up ? `▲ +${pct}%` : `▼ ${pct}%`}</span>
}

function Chip({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick} style={{
      padding: '8px 14px', borderRadius: 999, border: '2px solid',
      borderColor: active ? '#3b82f6' : 'var(--border)',
      background: active ? 'rgba(59,130,246,0.12)' : 'var(--surface)',
      color: active ? 'var(--text)' : 'var(--text2)',
      fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
    }}>{children}</button>
  )
}

export default function JobsPeriodPanel({
  period, setPeriod, custom, setCustom, range, prevRange,
  people, setPeople, peopleOptions, summary, prevSummary, byPerson,
  locationOptions = [], places, setPlaces, upcoming = false,
}) {
  const { t, tr, lang } = useLang()
  const dowNames = DOW[lang] || DOW.en
  const togglePlace = (name) => {
    const next = new Set(places)
    if (next.has(name)) next.delete(name); else next.add(name)
    setPlaces(next)
  }
  const setDate = (k, v) => {
    const base = range || custom
    setCustom({ from: base?.from || v, to: base?.to || v, [k]: v })
    setPeriod('custom')
  }
  const jt = t.jobs

  const togglePerson = (id) => {
    const next = new Set(people)
    if (next.has(id)) next.delete(id); else next.add(id)
    setPeople(next)
  }

  const prevLabel = prevRange ? rangeLabel(prevRange) : ''
  const stat = (label, value, cur, prev, prevValue, neutral) => (
    <div style={{ minWidth: 0, padding: '10px 10px', background: 'var(--surface2)', borderRadius: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 'clamp(15px, 4.2vw, 20px)', fontWeight: 800, color: 'var(--text)', lineHeight: 1.2 }}>{value}</div>
      {prevSummary && (
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
          {jt.prevShort} {prevValue} · <Delta cur={cur} prev={prev} neutral={neutral} />
        </div>
      )}
    </div>
  )

  return (
    <div className="card" style={{ marginBottom: 16, padding: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {PERIODS.map(([key, label, own]) => (
          <Chip key={key} active={period === key} onClick={() => setPeriod(key)}>{own ? tr(...own) : jt[label]}</Chip>
        ))}
      </div>

      {/* Dates are always visible: picking one switches to a custom range. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12, alignItems: 'flex-end' }}>
        <label style={{ fontSize: 12, color: 'var(--text3)', display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 140px' }}>
          📅 {jt.periodFrom}
          <input type="date" value={(range || custom)?.from || ''} onChange={e => e.target.value && setDate('from', e.target.value)} />
        </label>
        <label style={{ fontSize: 12, color: 'var(--text3)', display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 140px' }}>
          📅 {jt.periodTo}
          <input type="date" value={(range || custom)?.to || ''} min={(range || custom)?.from || undefined} onChange={e => e.target.value && setDate('to', e.target.value)} />
        </label>
      </div>

      {locationOptions.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
            📍 {tr('Locations · times per week', '場所 · 週の回数', 'Locais · vezes por semana')}
            {places.size > 0 && (
              <button type="button" onClick={() => setPlaces(new Set())} style={{ border: 'none', background: 'none', color: 'var(--navy)', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                {jt.clearPeople}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {locationOptions.map(l => (
              <label key={l.name} style={personStyle(places.has(l.name))} title={l.dows.map(d => dowNames[d]).join(' ')}>
                <input type="checkbox" checked={places.has(l.name)} onChange={() => togglePlace(l.name)} style={boxStyle} />
                <span style={{ whiteSpace: 'nowrap' }}>{l.name}</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#2563eb', background: 'rgba(59,130,246,0.12)', borderRadius: 999, padding: '1px 7px' }}>
                  {l.perWeek}×/{tr('wk', '週', 'sem')}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>{l.dows.length === 7 ? tr('every day', '毎日', 'todo dia') : l.dows.map(d => dowNames[d]).join(' ')}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {peopleOptions.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
            👤 {jt.people}
            {people.size > 0 && (
              <button type="button" onClick={() => setPeople(new Set())} style={{ border: 'none', background: 'none', color: 'var(--navy)', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                {jt.clearPeople}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <label style={personStyle(people.size === 0)}>
              <input type="checkbox" checked={people.size === 0} onChange={() => setPeople(new Set())} style={boxStyle} />
              {jt.everyone}
            </label>
            {peopleOptions.map(p => (
              <label key={p.id || 'none'} style={personStyle(people.has(p.id))}>
                <input type="checkbox" checked={people.has(p.id)} onChange={() => togglePerson(p.id)} style={boxStyle} />
                {p.id ? p.name : jt.noOne}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Time totals only make sense for days already worked. */}
      {!upcoming && (<>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        {stat(jt.sumJobs, fill(jt.jobsShort, { done: summary.done, total: summary.total }), summary.done, prevSummary?.done, prevSummary ? `${prevSummary.done}` : '')}
        {stat(jt.sumTime, fmtMinutes(summary.minutes), summary.minutes, prevSummary?.minutes, prevSummary ? fmtMinutes(prevSummary.minutes) : '')}
        {stat(jt.sumAvg, fmtMinutes(summary.avgMin), summary.avgMin, prevSummary?.avgMin, prevSummary ? fmtMinutes(prevSummary.avgMin) : '', true)}
      </div>
      {summary.done > summary.timedCount && (
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>⏱ {fill(jt.timedOf, { n: summary.timedCount })}</div>
      )}

      {byPerson.length > 1 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>{jt.byPerson}</div>
          {byPerson.map(r => (
            <div key={r.id || 'none'} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 10px', padding: '7px 0', borderTop: '1px solid var(--border)', fontSize: 13 }}>
              <div style={{ flex: '1 1 120px', fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.id ? r.name : jt.noOne}</div>
              <div style={{ color: 'var(--text2)' }}>{fill(jt.jobsShort, { done: r.cur.done, total: r.cur.total })}</div>
              <div style={{ fontWeight: 700 }}>⏱ {fmtMinutes(r.cur.minutes)}</div>
              <div style={{ color: 'var(--text3)', fontSize: 12 }}>Ø {fmtMinutes(r.cur.avgMin)}</div>
              {prevSummary && <div style={{ fontSize: 12 }}><Delta cur={r.cur.minutes} prev={r.prev.minutes} /></div>}
            </div>
          ))}
        </div>
      )}
      {prevSummary && (
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>
          {rangeLabel(range)} {fill(jt.vsPrev, { range: prevLabel })}
        </div>
      )}
      </>)}
    </div>
  )
}

const boxStyle = { width: 16, height: 16, margin: 0, cursor: 'pointer', accentColor: '#3b82f6' }
function personStyle(active) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 999,
    border: `2px solid ${active ? '#3b82f6' : 'var(--border)'}`,
    background: active ? 'rgba(59,130,246,0.1)' : 'var(--surface)',
    color: active ? 'var(--text)' : 'var(--text2)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  }
}
