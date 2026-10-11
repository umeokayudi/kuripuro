import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { fetchPendingTimeOff, decideTimeOff, TIME_OFF_CHANGED } from '../lib/timeOff'
import { fmtDay } from './AvailabilityPlanner'
import { fetchDayContext } from '../lib/dayContext'
import DayContext from './DayContext'

const SEEN_KEY = 'kp_timeoff_seen_v1'
const readSeen = () => { try { return new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]')) } catch { return new Set() } }
const writeSeen = (ids) => { try { sessionStorage.setItem(SEEN_KEY, JSON.stringify([...ids])) } catch { /* private mode */ } }

// Admin topbar: bell with the number of pending day-off requests, a small alert when new
// ones arrive, and a pop-up to approve / reject each one (or open the calendar).
export default function TimeOffCenter() {
  const { lang } = useLang()
  const ja = lang === 'ja'
  const L = (en, jaText) => (ja ? jaText : en)
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState(false)
  const [toastOpen, setToastOpen] = useState(false)
  const [busy, setBusy] = useState(null)
  const [noteFor, setNoteFor] = useState(null)
  const [notes, setNotes] = useState({})
  const [dayCtx, setDayCtx] = useState({})
  const seen = useRef(readSeen())

  const load = () => fetchPendingTimeOff(tokyoToday()).then(list => {
    setRows(list)
    // Alert only for requests the admin has not been told about in this session
    if (list.some(r => !seen.current.has(r.id))) setToastOpen(true)
  }).catch(() => {})

  useEffect(() => {
    load()
    const id = setInterval(load, 60000)
    window.addEventListener(TIME_OFF_CHANGED, load)
    return () => { clearInterval(id); window.removeEventListener(TIME_OFF_CHANGED, load) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const markSeen = () => {
    rows.forEach(r => seen.current.add(r.id))
    writeSeen(seen.current)
    setToastOpen(false)
  }
  const openPopup = () => {
    markSeen(); setOpen(true)
    fetchDayContext(rows.map(r => r.date)).then(setDayCtx).catch(() => {})
  }

  const decide = async (row, status) => {
    setBusy(row.id + status)
    try {
      await decideTimeOff(row.id, status, notes[row.id])
      toast.success(status === 'approved' ? L('Day off approved', '休みを承認しました') : L('Request declined', '申請を却下しました'))
      setRows(r => r.filter(x => x.id !== row.id))
      setNoteFor(null)
    } catch (e) {
      toast.error(e.message)
    }
    setBusy(null)
  }

  const openCalendar = () => { setOpen(false); markSeen(); navigate('/employees?tab=availability') }
  const n = rows.length

  return (
    <>
      <button type="button" className={`ref-top-action tor-bell${n ? ' has-items' : ''}`} onClick={openPopup}
        title={n ? L(`${n} day-off request(s) waiting`, `休み申請 ${n}件`) : L('No requests waiting', '承認待ちはありません')}
        aria-label={L('Day-off requests', '休み申請')}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        {n > 0 && <span className="tor-count">{n > 9 ? '9+' : n}</span>}
      </button>

      {/* Portal: the topbar uses backdrop-filter, which would trap position:fixed inside it */}
      {createPortal(<>
      {toastOpen && n > 0 && !open && (
        <div className="tor-toast" role="status">
          <span className="tor-toast-icon" aria-hidden="true">🗓</span>
          <div className="tor-toast-text">
            <strong>{ja ? `休み申請 ${n}件` : `${n} day-off request${n > 1 ? 's' : ''}`}</strong>
            <span>{n === 1 ? `${rows[0].employee_name || '—'} · ${fmtDay(rows[0].date, lang, { weekday: 'short', day: 'numeric', month: 'short' })}` : L('Waiting for your decision', '承認待ちです')}</span>
          </div>
          <button type="button" className="tor-btn tor-btn-primary tor-btn-sm" onClick={openPopup}>{L('Review', '確認')}</button>
          <button type="button" className="tor-toast-close" onClick={markSeen} aria-label={L('Dismiss', '閉じる')}>×</button>
        </div>
      )}

      {open && (
        <div className="tor-backdrop" onClick={() => setOpen(false)}>
          <section className="tor-modal" role="dialog" aria-modal="true" aria-label={L('Day-off requests', '休み申請')} onClick={e => e.stopPropagation()}>
            <header className="tor-head">
              <div>
                <h2>{L('Day-off requests', '休み申請')}</h2>
                <p>{n ? L(`${n} waiting for approval`, `${n}件が承認待ち`) : L('Nothing waiting. All caught up.', '承認待ちはありません。')}</p>
              </div>
              <button type="button" className="tor-close" onClick={() => setOpen(false)} aria-label={L('Close', '閉じる')}>×</button>
            </header>

            <div className="tor-list">
              {rows.map(r => (
                <article key={r.id} className="tor-item">
                  <div className="tor-item-top">
                    <div className="tor-avatar" aria-hidden="true">{(r.employee_name || '?').slice(0, 1).toUpperCase()}</div>
                    <div className="tor-item-main">
                      <strong>{r.employee_name || '—'}</strong>
                      <span>{fmtDay(r.date, lang, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                    </div>
                    <span className={`tor-kind is-${r.kind}`}>{r.kind === 'off' ? L('Day off', '休み') : L('Extra work', '追加勤務')}</span>
                  </div>
                  {r.note && <p className="tor-note">“{r.note}”</p>}
                  <DayContext ctx={dayCtx[r.date]} req={r} L={L} />
                  {noteFor === r.id && (
                    <input className="tor-input" autoFocus value={notes[r.id] || ''} onChange={e => setNotes(x => ({ ...x, [r.id]: e.target.value }))} placeholder={L('Message to the employee (optional)', 'スタッフへのメッセージ（任意）')} />
                  )}
                  <div className="tor-actions">
                    <button type="button" className="tor-btn tor-btn-reject" disabled={!!busy} onClick={() => decide(r, 'rejected')}>
                      {busy === r.id + 'rejected' ? '…' : <>✕ {L('Decline', '却下')}</>}
                    </button>
                    <button type="button" className="tor-btn tor-btn-approve" disabled={!!busy} onClick={() => decide(r, 'approved')}>
                      {busy === r.id + 'approved' ? '…' : <>✓ {L('Approve', '承認')}</>}
                    </button>
                    {noteFor !== r.id && <button type="button" className="tor-link" onClick={() => setNoteFor(r.id)}>{L('+ Add message', '+ メッセージ')}</button>}
                  </div>
                </article>
              ))}
            </div>

            <footer className="tor-foot">
              <button type="button" className="tor-btn tor-btn-ghost" onClick={openCalendar}>🗓 {L('Open calendar', 'カレンダーを開く')}</button>
              <button type="button" className="tor-btn tor-btn-ghost" onClick={() => setOpen(false)}>{L('Later', 'あとで')}</button>
            </footer>
          </section>
        </div>
      )}
      </>, document.body)}
    </>
  )
}
