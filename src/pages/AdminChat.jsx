import { useState, useEffect, useRef, useMemo } from 'react'
import { pendingChanged } from '../lib/adminPending'
import { supabase } from '../lib/supabase'
import { useLang, pickLang } from '../hooks/useLang'
import { uploadJobPhoto } from '../lib/uploadPhoto'
import { viewablePhotoUrl } from '../lib/photoUrl'
import { chatPhoto, chatPreview, chatDayKey, photoMessage } from '../lib/chatContent'
import PhotoLightbox from '../components/PhotoLightbox'
import ChatIcon from '../components/ChatIcon'
import toast from 'react-hot-toast'
import { useSearchParams, Link } from 'react-router-dom'
import { looksLikeSalaryMessage, salaryIssueFromChat } from '../lib/salaryIssueLink'
import './admin-chat.css'

const initials = name => String(name || '?').split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
const timeOf = iso => new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })

export default function AdminChat() {
  const { t, lang } = useLang()
  const ja = lang === 'ja'
  const L = {
    search: pickLang(lang, 'Search by name', '名前で検索', 'Buscar por nome'),
    noMessagesYet: pickLang(lang, 'No messages yet', 'まだメッセージはありません', 'Ainda não há mensagens'),
    pick: pickLang(lang, 'Pick a conversation from the list', '左の一覧から会話を選んでください', 'Escolha uma conversa na lista'),
    noPeople: pickLang(lang, 'Nobody found', '該当なし', 'Ninguém encontrado'),
    write: pickLang(lang, 'Write a message…', 'メッセージを入力…', 'Escreva uma mensagem…'),
    today: pickLang(lang, 'Today', '今日', 'Hoje'),
    photo: pickLang(lang, '📷 Photo', '📷 写真', '📷 Foto'),
    back: pickLang(lang, 'Back', '戻る', 'Voltar'),
    sendPhoto: pickLang(lang, 'Send photo', '写真を送る', 'Enviar foto'),
    newBelow: pickLang(lang, 'new', '件の新着', 'novas'),
  }
  const [mode, setMode] = useState('employees')
  const [employees, setEmployees] = useState([])
  const [clients, setClients] = useState([])
  const [lastByKey, setLastByKey] = useState({})
  const [selected, setSelected] = useState(null)
  const [messages, setMessages] = useState([])
  const [newMsg, setNewMsg] = useState('')
  const [unread, setUnread] = useState({})
  const [unreadOther, setUnreadOther] = useState(0)
  const [query, setQuery] = useState('')
  const [sendingPhoto, setSendingPhoto] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [userScrolled, setUserScrolled] = useState(false)
  const [newMsgCount, setNewMsgCount] = useState(0)
  const msgEndRef = useRef()
  const [params] = useSearchParams()
  const wantedEmp = params.get('employee')
  const [issued, setIssued] = useState({}) // message id → salary issue created
  const fileRef = useRef()

  const isEmp = mode === 'employees'
  // A client conversation is one store: messages of that client for that location (or with no location).
  const keyOf = row => (isEmp ? row.id : `${row.client_id}|${row.location_name || ''}`)
  const msgKey = m => (isEmp ? m.employee_id : `${m.client_id}|${m.location_name || ''}`)

  useEffect(() => {
    setSelected(null)
    setMessages([])
    setQuery('')
    loadList()
    const poll = setInterval(loadList, 10000)
    return () => clearInterval(poll)
  }, [mode])

  useEffect(() => {
    if (!selected) return undefined
    setMessages([])
    setUserScrolled(false)
    setNewMsgCount(0)
    loadMessages()
    markRead()
    const poll = setInterval(loadMessages, 5000)
    return () => clearInterval(poll)
  }, [selected, mode])

  const loadList = async () => {
    const table = isEmp ? 'messages' : 'client_messages'
    const idCol = isEmp ? 'employee_id' : 'client_id'
    const other = isEmp ? 'employee' : 'client'
    const [peopleRes, recentRes, otherRes] = await Promise.all([
      isEmp
        ? supabase.from('employees').select('id,full_name,is_active').eq('is_active', true).order('full_name')
        : supabase.from('client_users').select('id,client_id,client_name,location_name,contact_name,is_active').eq('is_active', true).order('client_name'),
      supabase.from(table).select(`${idCol},${isEmp ? '' : 'location_name,'}sender,content,read,created_at`).order('created_at', { ascending: false }).limit(400),
      supabase.from(isEmp ? 'client_messages' : 'messages').select('id', { count: 'exact', head: true }).eq('sender', isEmp ? 'client' : 'employee').eq('read', false),
    ])
    const last = {}
    const unreadMap = {}
    for (const m of recentRes.data || []) {
      const k = msgKey(m)
      if (!last[k]) last[k] = m
      if (m.sender === other && !m.read) unreadMap[k] = (unreadMap[k] || 0) + 1
    }
    if (isEmp) {
      setEmployees(peopleRes.data || [])
      // Opened from Salary issues: go straight to that person's conversation.
      if (wantedEmp) setSelected(s => s || (peopleRes.data || []).find(e => e.id === wantedEmp) || null)
    }
    else setClients(peopleRes.data || [])
    setLastByKey(last)
    setUnread(unreadMap)
    setUnreadOther(otherRes.count || 0)
  }

  const loadMessages = async () => {
    if (!selected) return
    if (isEmp) {
      const { data } = await supabase.from('messages').select('*').eq('employee_id', selected.id).order('created_at')
      setMessages(data || [])
      return
    }
    const { data } = await supabase.from('client_messages').select('*').eq('client_id', selected.client_id).order('created_at')
    const loc = selected.location_name
    setMessages((data || []).filter(m => !loc || !m.location_name || m.location_name === loc))
  }

  const markRead = async () => {
    if (!selected) return
    if (isEmp) await supabase.from('messages').update({ read: true }).eq('employee_id', selected.id).eq('sender', 'employee').eq('read', false)
    else {
      let q = supabase.from('client_messages').update({ read: true }).eq('client_id', selected.client_id).eq('sender', 'client').eq('read', false)
      if (selected.location_name) q = q.eq('location_name', selected.location_name)
      await q
    }
    setUnread(u => ({ ...u, [keyOf(selected)]: 0 }))
    pendingChanged()
  }

  // Follow new messages unless the admin scrolled up to read older ones.
  const prevCount = useRef(0)
  useEffect(() => {
    const grew = messages.length > prevCount.current
    const first = prevCount.current === 0
    if (grew && !first) {
      const lastMsg = messages[messages.length - 1]
      const fromOther = lastMsg?.sender !== 'admin'
      if (fromOther) markRead()
      if (userScrolled) setNewMsgCount(n => n + 1)
    }
    if (grew && (first || !userScrolled)) setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: first ? 'auto' : 'smooth', block: 'end' }), 60)
    prevCount.current = messages.length
  }, [messages])
  useEffect(() => { prevCount.current = 0 }, [selected])

  const handleChatScroll = (e) => {
    const el = e.currentTarget
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    setUserScrolled(!atBottom)
    if (atBottom) setNewMsgCount(0)
  }

  const send = async (content) => {
    if (!content || !selected) return false
    const row = isEmp
      ? { employee_id: selected.id, employee_name: selected.full_name, sender: 'admin', content, read: false }
      : { client_id: selected.client_id, client_user_id: selected.id, client_name: selected.client_name, location_name: selected.location_name, sender: 'admin', content, read: false }
    const { error } = await supabase.from(isEmp ? 'messages' : 'client_messages').insert(row)
    if (error) { toast.error(error.message); return false }
    setUserScrolled(false)
    loadMessages()
    loadList()
    return true
  }

  const sendText = async () => {
    const text = newMsg.trim()
    if (!text) return
    if (await send(text)) setNewMsg('')
  }

  const sendPhoto = async (file) => {
    if (!file || !selected || sendingPhoto) return
    setSendingPhoto(true)
    try {
      const folder = isEmp ? `employee/${selected.id}` : `client/${selected.client_id}`
      const path = await uploadJobPhoto(`jobs/chat/${folder}/${crypto.randomUUID()}.jpg`, file)
      await send(photoMessage(path))
    } catch (err) {
      toast.error(err?.message || 'Upload failed')
    } finally {
      setSendingPhoto(false)
    }
  }

  const rows = useMemo(() => {
    const list = (isEmp ? employees : clients).map(r => ({
      row: r,
      key: keyOf(r),
      name: isEmp ? r.full_name : (r.location_name || r.client_name || r.contact_name),
      sub: isEmp ? null : [r.client_name, r.contact_name].filter(Boolean).filter(v => v !== (r.location_name || '')).join(' · '),
    }))
    const q = query.trim().toLowerCase()
    const filtered = q ? list.filter(r => `${r.name} ${r.sub || ''}`.toLowerCase().includes(q)) : list
    // Unread first, then most recent conversation, then name.
    return filtered.sort((a, b) => {
      const ua = unread[a.key] ? 1 : 0
      const ub = unread[b.key] ? 1 : 0
      if (ua !== ub) return ub - ua
      const la = lastByKey[a.key]?.created_at || ''
      const lb = lastByKey[b.key]?.created_at || ''
      if (la !== lb) return lb.localeCompare(la)
      return String(a.name).localeCompare(String(b.name))
    })
  }, [isEmp, employees, clients, query, unread, lastByKey])

  const totalUnread = Object.values(unread).reduce((s, v) => s + v, 0)
  const selectedName = selected ? (isEmp ? selected.full_name : (selected.location_name || selected.client_name || selected.contact_name)) : ''
  const selectedSub = selected && !isEmp ? [selected.client_name, selected.contact_name].filter(Boolean).join(' · ') : ''
  const todayKey = chatDayKey(new Date().toISOString())
  const dayLabel = key => key === todayKey ? L.today
    : new Date(`${key}T12:00:00+09:00`).toLocaleDateString(ja ? 'ja-JP' : lang === 'pt' ? 'pt-BR' : 'en-GB', { month: 'short', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' })
  let lastDay = ''

  return (
    <div className={`ac-wrap${selected ? ' has-selection' : ''}`}>
      {lightbox && <PhotoLightbox url={lightbox} onClose={() => setLightbox(null)} />}

      <aside className="ac-list">
        <div className="ac-list-head">
          <h1>💬 {t.sidebar.chat}</h1>
          <div className="ac-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={isEmp} className={isEmp ? 'is-on' : ''} onClick={() => setMode('employees')}>
              {t.sidebar.employees}{isEmp ? (totalUnread > 0 && <b>{totalUnread}</b>) : (unreadOther > 0 && <b>{unreadOther}</b>)}
            </button>
            <button type="button" role="tab" aria-selected={!isEmp} className={!isEmp ? 'is-on' : ''} onClick={() => setMode('clients')}>
              {t.sidebar.clients}{!isEmp ? (totalUnread > 0 && <b>{totalUnread}</b>) : (unreadOther > 0 && <b>{unreadOther}</b>)}
            </button>
          </div>
          <input className="ac-search" value={query} onChange={e => setQuery(e.target.value)} placeholder={L.search} />
        </div>
        <div className="ac-people">
          {rows.length === 0 && <div className="ac-empty">{L.noPeople}</div>}
          {rows.map(({ row, key, name, sub }) => {
            const last = lastByKey[key]
            const active = selected?.id === row.id
            return (
              <button key={row.id} type="button" className={`ac-person${active ? ' is-active' : ''}${unread[key] ? ' is-unread' : ''}`} onClick={() => setSelected(row)}>
                <span className="ac-avatar">{initials(name)}</span>
                <span className="ac-person-text">
                  <span className="ac-person-top">
                    <strong>{name}</strong>
                    {last && <time>{chatDayKey(last.created_at) === todayKey ? timeOf(last.created_at) : chatDayKey(last.created_at).slice(5).replace('-', '/')}</time>}
                  </span>
                  {sub && <small className="ac-person-sub">{sub}</small>}
                  <span className="ac-person-last">
                    <span>{last ? `${last.sender === 'admin' ? '✓ ' : ''}${chatPreview(last.content, L.photo)}` : L.noMessagesYet}</span>
                    {unread[key] > 0 && <b>{unread[key]}</b>}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </aside>

      <section className="ac-conv">
        {!selected ? (
          <div className="ac-placeholder">{L.pick}</div>
        ) : (
          <>
            <header className="ac-conv-head">
              <button type="button" className="ac-back" onClick={() => setSelected(null)} aria-label={L.back}>‹</button>
              <span className="ac-avatar">{initials(selectedName)}</span>
              <div>
                <strong>{selectedName}</strong>
                {selectedSub && <small>{selectedSub}</small>}
              </div>
            </header>

            <div className="ac-msgs" onScroll={handleChatScroll}>
              {messages.length === 0 && <div className="ac-empty">{L.noMessagesYet}</div>}
              {messages.map(m => {
                const day = chatDayKey(m.created_at)
                const showDay = day !== lastDay
                lastDay = day
                const mine = m.sender === 'admin'
                const photo = chatPhoto(m.content)
                return (
                  <div key={m.id} className="ac-item">
                    {showDay && <div className="ac-day"><span>{dayLabel(day)}</span></div>}
                    <div className={`ac-bubble ${mine ? 'is-mine' : 'is-them'}${photo ? ' is-photo' : ''}`}>
                      {photo
                        ? <button type="button" onClick={() => setLightbox(photo)}><img src={viewablePhotoUrl(photo)} alt="" loading="lazy" /></button>
                        : m.content}
                      {isEmp && !mine && !photo && looksLikeSalaryMessage(m.content) && (
                        issued[m.id]
                          ? <Link to="/salary-complaints" className="ac-issue-link">💴 {pickLang(lang, 'Sent to Salary issues', '給与の問題に登録済み', 'Enviado para Problemas de salário')} →</Link>
                          : <button type="button" className="ac-issue-link" onClick={async () => {
                            try { await salaryIssueFromChat(selected, m); setIssued(x => ({ ...x, [m.id]: true })); pendingChanged(); toast.success(pickLang(lang, 'Salary issue created', '給与の問題を作成しました', 'Problema de salário criado')) } catch (e) { toast.error(e.message) }
                          }}>💴 {pickLang(lang, 'Open as salary issue', '給与の問題にする', 'Abrir como problema de salário')}</button>
                      )}
                      <time>
                        {timeOf(m.created_at)}
                        {mine && <span className={m.read ? 'is-read' : ''}>{m.read ? ' ✓✓' : ' ✓'}</span>}
                      </time>
                    </div>
                  </div>
                )
              })}
              <div ref={msgEndRef} />
            </div>
            {userScrolled && newMsgCount > 0 && (
              <button type="button" className="ac-new-pill" onClick={() => { setUserScrolled(false); setNewMsgCount(0); msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }}>
                ↓ {newMsgCount} {L.newBelow}
              </button>
            )}

            <div className="ac-compose">
              <button type="button" className="ac-icon-btn" onClick={() => fileRef.current?.click()} disabled={sendingPhoto} aria-label={L.sendPhoto} title={L.sendPhoto}>
                {sendingPhoto ? '…' : <ChatIcon name="camera" />}
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) sendPhoto(f); e.target.value = '' }} />
              <textarea
                rows={1}
                value={newMsg}
                onChange={e => setNewMsg(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendText() } }}
                placeholder={L.write}
              />
              <button type="button" className="ac-send" onClick={sendText} disabled={!newMsg.trim()} aria-label="Send">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12l16-8-6 16-2.5-6.5z" /></svg>
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
