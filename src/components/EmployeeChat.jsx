import { useRef } from 'react'
import { viewablePhotoUrl } from '../lib/photoUrl'
import { chatPhoto, chatDayKey } from '../lib/chatContent'
import '../pages/admin-chat.css'
import './employee-chat.css'
import ChatIcon from './ChatIcon'

/** Employee ↔ admin chat, same look as the v1.0.58 client and admin chats. */
export default function EmployeeChat({
  messages, labels, lang, value, onChange, onSend, onPhoto, sendingPhoto, onPhotoClick,
  containerRef, endRef, onScroll, unreadBelow, onJumpDown,
}) {
  const fileRef = useRef()
  const dateLocale = lang === 'ja' ? 'ja-JP' : 'en-GB'
  const todayKey = chatDayKey(new Date().toISOString())
  const dayLabel = key => key === todayKey
    ? labels.chatToday
    : new Date(`${key}T12:00:00+09:00`).toLocaleDateString(dateLocale, { month: 'short', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' })
  const quick = [labels.chatQuickArrived, labels.chatQuickLate, labels.chatQuickHelp].filter(Boolean)
  let lastDay = ''
  return (
    <div className="ec-chat">
      <div className="ec-head">
        <span className="ec-avatar">KP</span>
        <div>
          <strong>{labels.chatWith}</strong>
          <small>{labels.chatWithHint}</small>
        </div>
      </div>
      <div className="ec-msgs" ref={containerRef} onScroll={onScroll}>
        {messages.length === 0 && (
          <div className="ec-empty">
            <span>👋</span>
            <p>{labels.noMessages}</p>
          </div>
        )}
        {messages.map(m => {
          const day = chatDayKey(m.created_at)
          const showDay = day !== lastDay
          lastDay = day
          const mine = m.sender === 'employee'
          const photo = chatPhoto(m.content)
          return (
            <div key={m.id} className="ac-item">
              {showDay && <div className="ac-day"><span>{dayLabel(day)}</span></div>}
              <div className={`ac-bubble ${mine ? 'is-mine' : 'is-them'}${photo ? ' is-photo' : ''}`}>
                {photo
                  ? <button type="button" onClick={() => onPhotoClick(photo)}><img src={viewablePhotoUrl(photo)} alt="" loading="lazy" /></button>
                  : m.content}
                <time>
                  {new Date(m.created_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })}
                  {mine && <span className={m.read ? 'is-read' : ''}>{m.read ? ' ✓✓' : ' ✓'}</span>}
                </time>
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>
      {unreadBelow > 0 && (
        <button type="button" className="ec-new-pill" onClick={onJumpDown}>↓ {unreadBelow} {labels.chatNewBelow}</button>
      )}
      <div className="ec-compose">
        {!value.trim() && quick.length > 0 && (
          <div className="ec-quick">
            {quick.map(q => <button key={q} type="button" onClick={() => onSend(q)}>{q}</button>)}
          </div>
        )}
        <div className="ec-row">
          <button type="button" className="ec-photo" onClick={() => fileRef.current?.click()} disabled={sendingPhoto} aria-label={labels.chatSendPhoto} title={labels.chatSendPhoto}>
            {sendingPhoto ? '…' : <ChatIcon name="camera" />}
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) onPhoto(f); e.target.value = '' }} />
          <textarea
            rows={1}
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSend() } }}
            placeholder={labels.messageAdmin}
            aria-label={labels.messageAdmin}
          />
          <button type="button" className="ec-send" onClick={() => onSend()} disabled={!value.trim()} aria-label={labels.chatSend}>
            <ChatIcon name="send" />
          </button>
        </div>
      </div>
    </div>
  )
}
