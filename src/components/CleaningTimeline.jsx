import { useMemo, useState } from 'react'
import { useLang, localeOf } from '../hooks/useLang'
import { viewablePhotoUrl } from '../lib/photoUrl'
import PhotoLightbox from './PhotoLightbox'
import './cleaning-timeline.css'

// v1.0.73 · Photos of the place + last cleanings + calendar of the days it was cleaned.
// entries come from src/lib/cleaningTimeline.js (newest first).

const tokyoToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000)
const ym = d => d.slice(0, 7)
const shiftMonth = (month, n) => {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return d.toISOString().slice(0, 7)
}

function PhotoPair({ photos, onOpen, tr }) {
  if (!photos.length) return null
  return (
    <div className="ct-pair">
      {photos.map(p => (
        <button key={p.url} type="button" className="ct-pair-ph" onClick={() => onOpen(p.url)}>
          <img src={viewablePhotoUrl(p.url)} alt="" loading="lazy" />
          {p.label && <span>{p.label === 'before' ? tr('Before', '作業前', 'Antes') : tr('After', '作業後', 'Depois')}</span>}
        </button>
      ))}
    </div>
  )
}

/**
 * entries: [{ id, date, who, what, notes, photos: [{ url, label }] }]
 * placePhotos: photo urls of the place itself (size reference); size: "12 × 8 m · 96 m²".
 * onLogDay(date): optional, lets the employee/admin log a cleaning on a past day.
 */
export default function CleaningTimeline({ entries = [], placePhotos = [], size = '', title, compact = false, dark = false, loading = false, onLogDay }) {
  const { lang, tr } = useLang()
  const today = tokyoToday()
  const byDay = useMemo(() => {
    const m = new Map()
    for (const e of entries) m.set(e.date, [...(m.get(e.date) || []), e])
    return m
  }, [entries])
  const last = entries[0] || null
  const lastWithPhoto = entries.find(e => e.photos.length) || null
  const [selected, setSelected] = useState(() => last?.date || null)
  const [month, setMonth] = useState(() => ym(last?.date || today))
  const [placeIdx, setPlaceIdx] = useState(0)
  const [zoom, setZoom] = useState(null)

  const fmt = (d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) =>
    new Date(`${d}T00:00:00+09:00`).toLocaleDateString(localeOf(lang), { ...opts, timeZone: 'Asia/Tokyo' })
  const ago = d => {
    const n = daysBetween(d, today)
    if (n <= 0) return tr('today', '今日', 'hoje')
    if (n === 1) return tr('yesterday', '昨日', 'ontem')
    return tr(`${n} days ago`, `${n}日前`, `há ${n} dias`)
  }

  const pick = d => { setSelected(d); setMonth(ym(d)) }

  // month grid, Monday first
  const [y, m] = month.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1))
  const lead = (first.getUTCDay() + 6) % 7
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)]
  const monthCount = entries.filter(e => ym(e.date) === month).length
  const weekdays = lang === 'ja' ? ['月', '火', '水', '木', '金', '土', '日'] : lang === 'pt' ? ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  const dayEntries = selected ? byDay.get(selected) || [] : []
  const place = placePhotos[Math.min(placeIdx, placePhotos.length - 1)]
  const recentDates = [...byDay.keys()].slice(0, 10)
  const monthName = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(localeOf(lang), { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const monthTitle = monthName.charAt(0).toUpperCase() + monthName.slice(1)

  return (
    <div className={`ct${dark ? ' ct-dark' : ''}${compact ? ' ct-compact' : ''}`}>
      {title && <div className="ct-title">{title}</div>}

      <div className="ct-top">
        <div className="ct-place">
          {place ? (
            <button type="button" className="ct-place-ph" onClick={() => setZoom(place)}>
              <img src={viewablePhotoUrl(place)} alt="" />
              <span className="ct-tag">📍 {tr('The place', '現場', 'O local')}</span>
              {size && <span className="ct-size">📐 {size}</span>}
            </button>
          ) : (
            <div className="ct-place-empty">
              <span>📍</span>
              <b>{tr('No photo of the place yet', '現場の写真はまだありません', 'Ainda sem foto do local')}</b>
              {size && <small>📐 {size}</small>}
            </div>
          )}
          {placePhotos.length > 1 && (
            <div className="ct-strip">
              {placePhotos.map((p, i) => (
                <button key={p} type="button" className={i === placeIdx ? 'on' : ''} onClick={() => setPlaceIdx(i)}>
                  <img src={viewablePhotoUrl(p)} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="ct-last">
          <div className="ct-label">🧽 {tr('Last cleaning', '前回の清掃', 'Última limpeza')}</div>
          {loading ? <div className="ct-muted">…</div> : last ? (
            <>
              <button type="button" className="ct-last-date" onClick={() => pick(last.date)}>
                <b>{fmt(last.date)}</b>
                <span className={daysBetween(last.date, today) > 30 ? 'ct-old' : ''}>{ago(last.date)}</span>
              </button>
              <div className="ct-muted">{[last.who && last.who.split(' ')[0], last.what].filter(Boolean).join(' · ')}</div>
              <PhotoPair photos={(lastWithPhoto?.date === last.date ? (byDay.get(last.date) || []).flatMap(e => e.photos) : last.photos).slice(0, compact ? 2 : 4)} onOpen={setZoom} tr={tr} />
              {lastWithPhoto && lastWithPhoto.date !== last.date && (
                <button type="button" className="ct-link" onClick={() => pick(lastWithPhoto.date)}>
                  📷 {tr('Last photos', '最新の写真', 'Últimas fotos')}: {fmt(lastWithPhoto.date)}
                </button>
              )}
              {!lastWithPhoto && <div className="ct-muted">{tr('No cleaning photos yet', '清掃写真はまだありません', 'Ainda sem fotos de limpeza')}</div>}
            </>
          ) : <div className="ct-muted">{tr('No cleaning recorded yet', '清掃記録はまだありません', 'Nenhuma limpeza registrada ainda')}</div>}
        </div>
      </div>

      <div className="ct-bottom">
        <div className="ct-cal">
          <div className="ct-cal-head">
            <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="‹">‹</button>
            <div>
              <b>{monthTitle}</b>
              <small>{monthCount ? tr(`${monthCount} cleanings`, `清掃 ${monthCount}回`, `${monthCount} limpezas`) : tr('no cleaning', '清掃なし', 'sem limpeza')}</small>
            </div>
            <button type="button" disabled={month >= ym(today)} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="›">›</button>
          </div>
          <div className="ct-grid">
            {weekdays.map((w, i) => <span key={`w${i}`} className="ct-wd">{w}</span>)}
            {cells.map((d, i) => {
              if (!d) return <span key={`e${i}`} />
              const list = byDay.get(d)
              const thumb = list?.flatMap(e => e.photos).find(p => p.label !== 'before')?.url || list?.flatMap(e => e.photos)[0]?.url
              const cls = ['ct-day', list && 'has', thumb && 'ph', d === selected && 'sel', d === today && 'today', d > today && 'future'].filter(Boolean).join(' ')
              return (
                <button key={d} type="button" className={cls} disabled={d > today} onClick={() => setSelected(d)}
                  style={thumb ? { backgroundImage: `url("${viewablePhotoUrl(thumb)}")` } : undefined}>
                  <i>{Number(d.slice(8))}</i>
                </button>
              )
            })}
          </div>
          {recentDates.length > 1 && (
            <div className="ct-dates">
              {recentDates.map(d => (
                <button key={d} type="button" className={d === selected ? 'on' : ''} onClick={() => pick(d)}>
                  {fmt(d, { day: 'numeric', month: 'short' })}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="ct-day-detail">
          {!selected ? (
            <div className="ct-muted">{tr('Pick a day on the calendar', 'カレンダーで日付を選択', 'Escolha um dia no calendário')}</div>
          ) : (
            <>
              <div className="ct-label">📅 {fmt(selected, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</div>
              {dayEntries.length ? dayEntries.map(e => (
                <div key={e.id} className="ct-entry">
                  <div className="ct-entry-head">
                    <b>{e.what || tr('Cleaning', '清掃', 'Limpeza')}</b>
                    {e.who && <span>{e.who}</span>}
                  </div>
                  {e.notes && <div className="ct-muted">{e.notes}</div>}
                  <PhotoPair photos={e.photos} onOpen={setZoom} tr={tr} />
                </div>
              )) : <div className="ct-muted">{tr('No cleaning on this day', 'この日の清掃はありません', 'Nenhuma limpeza neste dia')}</div>}
              {onLogDay && selected <= today && (
                <button type="button" className="ct-log" onClick={() => onLogDay(selected)}>
                  ＋ {tr('Log a cleaning on this day', 'この日の清掃を記録', 'Registrar limpeza neste dia')}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {zoom && (
        <div onClick={e => e.stopPropagation()}>
          <PhotoLightbox url={zoom} onClose={() => setZoom(null)} closeLabel={tr('Close', '閉じる', 'Fechar')} />
        </div>
      )}
    </div>
  )
}
