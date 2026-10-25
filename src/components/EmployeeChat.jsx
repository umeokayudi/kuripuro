import { useRef } from 'react'
import { viewablePhotoUrl } from '../lib/photoUrl'
import { chatPhoto, chatDayKey, chatPreview } from '../lib/chatContent'
import { OFFICE_KEY, initials } from '../lib/teamChat'
import { roleInfo } from '../lib/employeeRoles'
import { fill } from '../i18n/kuripuro'
import '../pages/admin-chat.css'
import './employee-chat.css'
import ChatIcon from './ChatIcon'

/**
 * Employee chat, same look as the v1.0.58 client and admin chats.
 * v1.0.72: list of people (own leader, own team, coworkers) + the office (diretoria) for when the leader can't help.
 * Without the team chat tables (teamReady false) it is the office chat only, as before.
 */
export default function EmployeeChat({
  messages, labels, lang, value, onChange, onSend, onPhoto, sendingPhoto, onPhotoClick,
  containerRef, endRef, onScroll, unreadBelow, onJumpDown,
  teamReady = false, sections = null, activeKey = OFFICE_KEY, onOpen, onBack,
}) {
  const fileRef = useRef()
  const dateLocale = lang === 'ja' ? 'ja-JP' : 'en-GB'
  const todayKey = chatDayKey(new Date().toISOString())
  const timeOf = iso => new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })
  const dayLabel = key => key === todayKey
    ? labels.chatToday
    : new Date(`${key}T12:00:00+09:00`).toLocaleDateString(dateLocale, { month: 'short', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' })
  const listTime = iso => chatDayKey(iso) === todayKey ? timeOf(iso) : new Date(iso).toLocaleDateString(dateLocale, { month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo' })

  const all = sections ? [sections.leader, ...sections.team, ...sections.colleagues, sections.office].filter(Boolean) : []
  const active = teamReady ? (all.find(c => c.key === activeKey) || null) : { key: OFFICE_KEY, kind: 'office' }
  const isOffice = active?.kind === 'office'
  const leader = sections?.leader || null
  const quick = (isOffice || active?.kind === 'leader')
    ? [labels.chatQuickArrived, labels.chatQuickLate, labels.chatQuickHelp].filter(Boolean)
    : []
  const placeholder = isOffice ? labels.messageAdmin : fill(labels.chatMessageTo, { name: active?.name || '' })
  const kindLabel = c => c.kind === 'leader' ? labels.chatYourLeader
    : c.kind === 'team' ? labels.chatYourTeam
      : (roleInfo(c.role, lang)?.label || labels.chatCoworker)

  const row = c => {
    const office = c.kind === 'office'
    const last = c.last
    const preview = last ? `${last.mine ? `${labels.chatYou}: ` : ''}${chatPreview(last.content, '📷')}` : (office ? labels.chatWithHint : labels.chatSayHi)
    return (
      <button key={c.key} type="button" className={`ac-person${c.key === activeKey ? ' is-active' : ''}${c.unread ? ' is-unread' : ''}`} onClick={() => onOpen?.(c.key)}>
        <span className={`ac-avatar${office ? '' : ` ec-av-${c.kind}`}`}>{office ? 'KP' : initials(c.name)}</span>
        <span className="ac-person-text">
          <span className="ac-person-top">
            <strong>{office ? labels.chatOffice : c.name}</strong>
            {last && <time>{listTime(last.created_at)}</time>}
          </span>
          <span className="ac-person-sub">{office ? (leader ? labels.chatOfficeOnly : labels.chatWithHint) : kindLabel(c)}</span>
          <span className="ac-person-last"><span>{preview}</span>{c.unread > 0 && <b>{c.unread}</b>}</span>
        </span>
      </button>
    )
  }

  const section = (title, items) => items.length > 0 && (
    <div className="ec-section">
      <div className="ec-section-title">{title}</div>
      {items.map(row)}
    </div>
  )

  let lastDay = ''
  const conversation = active && (
    <div className="ec-chat">
      <div className="ec-head">
        {teamReady && <button type="button" className="ec-back" onClick={onBack} aria-label={labels.chatBack}>‹</button>}
        <span className={`ec-avatar${isOffice ? '' : ` ec-av-${active.kind}`}`}>{isOffice ? 'KP' : initials(active.name)}</span>
        <div>
          <strong>{isOffice ? (teamReady ? labels.chatOffice : labels.chatWith) : active.name}</strong>
          <small>{isOffice ? (teamReady && leader ? labels.chatOfficeOnly : labels.chatWithHint) : kindLabel(active)}</small>
        </div>
      </div>
      <div className="ec-msgs" ref={containerRef} onScroll={onScroll}>
        {isOffice && teamReady && leader && (
          <div className="ec-office-note">
            <p>{fill(labels.chatOfficeNote, { name: leader.name })}</p>
            <button type="button" onClick={() => onOpen?.(leader.key)}>{fill(labels.chatTalkToLeader, { name: leader.name })}</button>
          </div>
        )}
        {messages.length === 0 && (
          <div className="ec-empty">
            <span>👋</span>
            <p>{isOffice ? labels.noMessages : fill(labels.chatNoMessagesWith, { name: active.name })}</p>
          </div>
        )}
        {messages.map(m => {
          const day = chatDayKey(m.created_at)
          const showDay = day !== lastDay
          lastDay = day
          const mine = m.mine
          const photo = chatPhoto(m.content)
          return (
            <div key={m.id} className="ac-item">
              {showDay && <div className="ac-day"><span>{dayLabel(day)}</span></div>}
              <div className={`ac-bubble ${mine ? 'is-mine' : 'is-them'}${photo ? ' is-photo' : ''}`}>
                {photo
                  ? <button type="button" onClick={() => onPhotoClick(photo)}><img src={viewablePhotoUrl(photo)} alt="" loading="lazy" /></button>
                  : m.content}
                <time>
                  {timeOf(m.created_at)}
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
            placeholder={placeholder}
            aria-label={placeholder}
          />
          <button type="button" className="ec-send" onClick={() => onSend()} disabled={!value.trim()} aria-label={labels.chatSend}>
            <ChatIcon name="send" />
          </button>
        </div>
      </div>
    </div>
  )

  if (!teamReady) return conversation

  return (
    <div className={`ec-hub${activeKey ? ' has-active' : ''}`}>
      <div className="ec-list">
        <div className="ec-list-head">
          <strong>{labels.chat}</strong>
          <small>{labels.chatListHint}</small>
        </div>
        <div className="ac-people">
          {section(labels.chatOffice, [sections.office])}
          {section(labels.chatYourLeader, sections.leader ? [sections.leader] : [])}
          {section(labels.chatYourTeam, sections.team)}
          {section(labels.chatCoworkers, sections.colleagues)}
        </div>
      </div>
      {conversation || <div className="ec-chat ec-pick"><p>{labels.chatPick}</p></div>}
    </div>
  )
}
