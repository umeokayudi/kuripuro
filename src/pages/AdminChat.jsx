import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useLang } from '../hooks/useLang'
import toast from 'react-hot-toast'

export default function AdminChat() {
  const { t } = useLang()
  const [mode, setMode] = useState('employees')
  const [employees, setEmployees] = useState([])
  const [clients, setClients] = useState([])
  const [selected, setSelected] = useState(null)
  const [messages, setMessages] = useState([])
  const [newMsg, setNewMsg] = useState('')
  const [unread, setUnread] = useState({})
  const pollRef = useRef()
  const msgPollRef = useRef()
  const msgEndRef = useRef()

  useEffect(() => {
    loadList()
    pollRef.current = setInterval(loadList, 10000)
    return () => clearInterval(pollRef.current)
  }, [mode])

  useEffect(() => {
    setSelected(null)
    setMessages([])
  }, [mode])

  useEffect(() => {
    if (selected) {
      loadMessages()
      markRead()
      clearInterval(msgPollRef.current)
      msgPollRef.current = setInterval(loadMessages, 5000)
    }
    return () => clearInterval(msgPollRef.current)
  }, [selected, mode])

  const [userScrolled, setUserScrolled] = useState(false)
  const [newMsgCount, setNewMsgCount] = useState(0)
  const chatContainerRef = useRef()

  useEffect(() => {
    if (!userScrolled) {
      setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    } else {
      setNewMsgCount(prev => prev + 1)
    }
  }, [messages])

  const handleChatScroll = (e) => {
    const el = e.target
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
    if (isAtBottom) { setUserScrolled(false); setNewMsgCount(0) }
    else setUserScrolled(true)
  }

  const loadList = async () => {
    if (mode === 'employees') {
      const { data: emps } = await supabase.from('employees').select('id,full_name,is_active,last_seen').eq('is_active', true).order('full_name')
      const { data: msgs } = await supabase.from('messages').select('employee_id,read,sender').eq('sender', 'employee').eq('read', false)
      const unreadMap = {}
      ;(msgs || []).forEach(m => { unreadMap[m.employee_id] = (unreadMap[m.employee_id] || 0) + 1 })
      setEmployees(emps || [])
      setUnread(unreadMap)
    } else {
      const { data: cls } = await supabase.from('client_users').select('id,client_id,client_name,location_name,contact_name,email,last_seen,is_active').eq('is_active', true).order('client_name')
      const { data: msgs } = await supabase.from('client_messages').select('client_id,read,sender').eq('sender', 'client').eq('read', false)
      const unreadMap = {}
      ;(msgs || []).forEach(m => { unreadMap[m.client_id] = (unreadMap[m.client_id] || 0) + 1 })
      setClients(cls || [])
      setUnread(unreadMap)
    }
  }

  const loadMessages = async () => {
    if (!selected) return
    if (mode === 'employees') {
      const { data } = await supabase.from('messages').select('*').eq('employee_id', selected.id).order('created_at')
      setMessages(data || [])
    } else {
      const { data } = await supabase.from('client_messages').select('*').eq('client_id', selected.client_id).order('created_at')
      setMessages(data || [])
    }
  }

  const markRead = async () => {
    if (!selected) return
    if (mode === 'employees') {
      await supabase.from('messages').update({ read: true }).eq('employee_id', selected.id).eq('sender', 'employee').eq('read', false)
      setUnread(u => ({ ...u, [selected.id]: 0 }))
    } else {
      await supabase.from('client_messages').update({ read: true }).eq('client_id', selected.client_id).eq('sender', 'client').eq('read', false)
      setUnread(u => ({ ...u, [selected.client_id]: 0 }))
    }
  }

  const prevMsgCount = useRef(0)
  useEffect(() => {
    if (messages.length > prevMsgCount.current && prevMsgCount.current > 0) {
      const lastMsg = messages[messages.length - 1]
      const fromOther = mode === 'employees' ? lastMsg?.sender === 'employee' : lastMsg?.sender === 'client'
      if (fromOther) {
        const name = mode === 'employees' ? lastMsg.employee_name : lastMsg.client_name
        toast(`💬 ${name?.split(' ')[0]}: ${lastMsg.content.substring(0, 40)}`, { duration: 4000 })
      }
    }
    prevMsgCount.current = messages.length
  }, [messages, mode])

  const sendMessage = async () => {
    if (!newMsg.trim() || !selected) return
    if (mode === 'employees') {
      const { error } = await supabase.from('messages').insert({
        employee_id: selected.id,
        employee_name: selected.full_name,
        sender: 'admin',
        content: newMsg.trim(),
        read: false,
      })
      if (error) return toast.error(error.message)
    } else {
      const { error } = await supabase.from('client_messages').insert({
        client_id: selected.client_id,
        client_user_id: selected.id,
        client_name: selected.client_name,
        location_name: selected.location_name,
        sender: 'admin',
        content: newMsg.trim(),
        read: false,
      })
      if (error) return toast.error(error.message)
    }
    setNewMsg('')
    loadMessages()
  }

  const totalUnread = Object.values(unread).reduce((s, v) => s + v, 0)
  const list = mode === 'employees' ? employees : clients
  const selectedName = mode === 'employees' ? selected?.full_name : selected?.contact_name
  const selectedKey = mode === 'employees' ? selected?.id : selected?.client_id

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 80px)', gap: 14 }}>
      <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
          💬 {t.sidebar.chat} {totalUnread > 0 && <span className="badge badge-red" style={{ marginLeft: 6 }}>{totalUnread}</span>}
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <button className={`btn btn-sm${mode === 'employees' ? ' btn-primary' : ''}`} onClick={() => setMode('employees')}>{t.sidebar.employees}</button>
          <button className={`btn btn-sm${mode === 'clients' ? ' btn-primary' : ''}`} onClick={() => setMode('clients')}>{t.sidebar.clients}</button>
        </div>
        {list.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13 }}>{mode === 'employees' ? 'No employees.' : 'No client accounts.'}</div>}
        {mode === 'employees' && employees.map(e => (
          <div key={e.id} onClick={() => setSelected(e)}
            style={{ padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
              background: selected?.id === e.id ? 'var(--navy)' : 'var(--surface2)',
              border: `1px solid ${selected?.id === e.id ? 'var(--navy)' : 'var(--border)'}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: selected?.id === e.id ? '#fff' : 'var(--text)' }}>{e.full_name.split(' ')[0]}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>employee</div>
            </div>
            {unread[e.id] > 0 && <span className="badge badge-red">{unread[e.id]}</span>}
          </div>
        ))}
        {mode === 'clients' && clients.map(cl => (
          <div key={cl.id} onClick={() => setSelected(cl)}
            style={{ padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
              background: selected?.id === cl.id ? 'var(--navy)' : 'var(--surface2)',
              border: `1px solid ${selected?.id === cl.id ? 'var(--navy)' : 'var(--border)'}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: selected?.id === cl.id ? '#fff' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cl.client_name || cl.contact_name}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>{cl.location_name || cl.contact_name}</div>
            </div>
            {unread[cl.client_id] > 0 && <span className="badge badge-red">{unread[cl.client_id]}</span>}
          </div>
        ))}
      </div>

      <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
        {!selected ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13 }}>
            {mode === 'employees' ? 'Select an employee' : 'Select a client'}
          </div>
        ) : (
          <>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="avatar" style={{ width: 34, height: 34, fontSize: 13, background: '#E6F1FB', color: '#185FA5', fontWeight: 700 }}>
                {(selectedName || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div>{selectedName}</div>
                {mode === 'clients' && <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 400 }}>{selected.client_name}{selected.location_name ? ` · ${selected.location_name}` : ''}</div>}
              </div>
            </div>

            <div ref={chatContainerRef} onScroll={handleChatScroll} style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
              {userScrolled && newMsgCount > 0 && (
                <div onClick={() => { setUserScrolled(false); setNewMsgCount(0); msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }}
                  style={{ position: 'sticky', top: 0, zIndex: 10, textAlign: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'inline-block', background: '#f87171', color: '#fff', borderRadius: 20, padding: '4px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    ↓ {newMsgCount} new
                  </div>
                </div>
              )}
              {messages.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 12, paddingTop: 20 }}>No messages yet.</div>}
              {messages.map(m => {
                const isAdmin = m.sender === 'admin'
                return (
                  <div key={m.id} style={{ display: 'flex', justifyContent: isAdmin ? 'flex-end' : 'flex-start' }}>
                    <div style={{
                      maxWidth: '70%',
                      background: isAdmin ? 'var(--navy)' : 'var(--surface)',
                      borderRadius: isAdmin ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                      padding: '10px 14px',
                    }}>
                      <div style={{ fontSize: 13, color: isAdmin ? '#fff' : 'var(--text)', lineHeight: 1.5, wordBreak: 'break-word' }}>{m.content}</div>
                      <div style={{ fontSize: 10, color: isAdmin ? 'rgba(255,255,255,0.4)' : 'var(--text3)', marginTop: 3, textAlign: 'right' }}>
                        {new Date(m.created_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                        {isAdmin && <span style={{ marginLeft: 4, color: m.read ? '#4ade80' : 'rgba(255,255,255,0.3)' }}>{m.read ? '✓✓' : '✓'}</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={msgEndRef} />
            </div>

            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
              <input
                value={newMsg}
                onChange={e => setNewMsg(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                placeholder={`Message ${selectedName?.split(' ')[0]}...`}
                style={{ flex: 1, padding: '9px 14px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit' }}
              />
              <button onClick={sendMessage} disabled={!newMsg.trim()} className="btn btn-primary" style={{ borderRadius: 20, padding: '9px 20px' }}>Send</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
