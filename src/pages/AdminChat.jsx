import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

export default function AdminChat() {
  const [employees, setEmployees] = useState([])
  const [selected, setSelected] = useState(null)
  const [messages, setMessages] = useState([])
  const [newMsg, setNewMsg] = useState('')
  const [unread, setUnread] = useState({})
  const pollRef = useRef()
  const msgPollRef = useRef()
  const msgEndRef = useRef()

  useEffect(() => {
    loadEmployees()
    pollRef.current = setInterval(loadEmployees, 10000)
    return () => clearInterval(pollRef.current)
  }, [])

  useEffect(() => {
    if (selected) {
      loadMessages(selected.id)
      markRead(selected.id)
      clearInterval(msgPollRef.current)
      msgPollRef.current = setInterval(() => loadMessages(selected.id), 5000)
    }
    return () => clearInterval(msgPollRef.current)
  }, [selected])

  const [userScrolled, setUserScrolled] = useState(false)
  const [newMsgCount, setNewMsgCount] = useState(0)
  const chatContainerRef = useRef()

  useEffect(() => {
    if (!userScrolled) {
      setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior:'smooth' }), 100)
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

  const loadEmployees = async () => {
    const { data: emps } = await supabase.from('employees').select('id,full_name,is_active,last_seen').eq('is_active',true).order('full_name')
    const { data: msgs } = await supabase.from('messages').select('employee_id,read,sender').eq('sender','employee').eq('read',false)
    const unreadMap = {}
    ;(msgs||[]).forEach(m => { unreadMap[m.employee_id] = (unreadMap[m.employee_id]||0)+1 })
    setEmployees(emps||[])
    setUnread(unreadMap)
  }

  const loadMessages = async (empId) => {
    const { data } = await supabase.from('messages').select('*').eq('employee_id',empId).order('created_at')
    setMessages(data||[])
  }

  const markRead = async (empId) => {
    await supabase.from('messages').update({ read:true }).eq('employee_id',empId).eq('sender','employee').eq('read',false)
    setUnread(u => ({ ...u, [empId]:0 }))
  }

  const prevMsgCount = useRef(0)
  useEffect(() => {
    if (messages.length > prevMsgCount.current && prevMsgCount.current > 0) {
      const lastMsg = messages[messages.length-1]
      if (lastMsg?.sender === 'employee') {
        toast(`💬 ${lastMsg.employee_name?.split(' ')[0]}: ${lastMsg.content.substring(0,40)}`, {duration:4000})
      }
    }
    prevMsgCount.current = messages.length
  }, [messages])

  const sendMessage = async () => {
    if (!newMsg.trim()||!selected) return
    const { error } = await supabase.from('messages').insert({
      employee_id: selected.id,
      employee_name: selected.full_name,
      sender: 'admin',
      content: newMsg.trim(),
      read: false
    })
    if (error) return toast.error(error.message)
    setNewMsg('')
    loadMessages(selected.id)
  }

  const totalUnread = Object.values(unread).reduce((s,v)=>s+v,0)

  return (
    <div style={{ display:'flex', height:'calc(100vh - 80px)', gap:14 }}>
      {/* Employee list */}
      <div style={{ width:220, flexShrink:0, display:'flex', flexDirection:'column', gap:6, overflowY:'auto' }}>
        <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>
          💬 Chat {totalUnread>0&&<span className="badge badge-red" style={{marginLeft:6}}>{totalUnread}</span>}
        </div>
        {employees.length===0&&<div style={{color:'var(--text3)',fontSize:13}}>No employees.</div>}
        {employees.map(e=>(
          <div key={e.id} onClick={()=>setSelected(e)}
            style={{ padding:'10px 12px', borderRadius:10, cursor:'pointer',
              background: selected?.id===e.id?'var(--navy)':'var(--surface2)',
              border:`1px solid ${selected?.id===e.id?'var(--navy)':'var(--border)'}`,
              display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div>
              <div style={{ fontSize:13, fontWeight:500, color: selected?.id===e.id?'#fff':'var(--text)' }}>
                {e.full_name.split(' ')[0]}
              </div>
              <div style={{ fontSize:10, color: e.is_online?'var(--green)':'var(--text3)', marginTop:1 }}>
                {(()=>{ const on=e.last_seen&&(Date.now()-new Date(e.last_seen))<120000; if(on) return '● online'; if(e.last_seen) return 'Last: '+new Date(e.last_seen).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}); return '○ never' })()}
              </div>
            </div>
            {unread[e.id]>0&&<span className="badge badge-red">{unread[e.id]}</span>}
          </div>
        ))}
      </div>

      {/* Chat window */}
      <div className="card" style={{ flex:1, display:'flex', flexDirection:'column', padding:0, overflow:'hidden' }}>
        {!selected ? (
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text3)', fontSize:13 }}>
            Select an employee to start chatting
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--border)', fontWeight:600, fontSize:14, display:'flex', alignItems:'center', gap:10 }}>
              <div className="avatar" style={{ width:34, height:34, fontSize:13, background:'#E6F1FB', color:'#185FA5', fontWeight:700 }}>
                {selected.full_name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}
              </div>
              {selected.full_name}
              <span style={{ fontSize:11, color:'var(--green)', marginLeft:4 }}>● online</span>
            </div>

            {/* Messages */}
            <div ref={chatContainerRef} onScroll={handleChatScroll} style={{ flex:1, overflowY:'auto', padding:'14px 18px', display:'flex', flexDirection:'column', gap:8, position:'relative' }}>
              {userScrolled&&newMsgCount>0&&(
                <div onClick={()=>{setUserScrolled(false);setNewMsgCount(0);msgEndRef.current?.scrollIntoView({behavior:'smooth'})}}
                  style={{position:'sticky',top:0,zIndex:10,textAlign:'center',marginBottom:8}}>
                  <div style={{display:'inline-block',background:'#f87171',color:'#fff',borderRadius:20,padding:'4px 14px',fontSize:12,fontWeight:600,cursor:'pointer',boxShadow:'0 2px 8px rgba(0,0,0,0.2)'}}>
                    ↓ {newMsgCount} new message{newMsgCount>1?'s':''}
                  </div>
                </div>
              )}
              {messages.length===0&&<div style={{textAlign:'center',color:'var(--text3)',fontSize:12,paddingTop:20}}>No messages yet. Say hello!</div>}
              {messages.map(m=>(
                <div key={m.id} style={{ display:'flex', justifyContent:m.sender==='admin'?'flex-end':'flex-start' }}>
                  <div style={{
                    maxWidth:'70%',
                    background: m.sender==='admin'?'var(--navy)':'var(--surface)',
                    borderRadius: m.sender==='admin'?'14px 14px 4px 14px':'14px 14px 14px 4px',
                    padding:'10px 14px'
                  }}>
                    {m.sender==='employee'&&<div style={{ fontSize:10, color:'var(--text3)', marginBottom:3 }}>{selected.full_name.split(' ')[0]}</div>}
                    <div style={{ fontSize:13, color: m.sender==='admin'?'#fff':'var(--text)', lineHeight:1.5, wordBreak:'break-word' }}>{m.content}</div>
                    <div style={{ fontSize:10, color: m.sender==='admin'?'rgba(255,255,255,0.4)':'var(--text3)', marginTop:3, textAlign:'right', display:'flex', justifyContent:'flex-end', alignItems:'center', gap:4 }}>
                      {new Date(m.created_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}
                      {m.sender==='admin'&&(
                        <span style={{fontSize:10, color: m.read?'#4ade80':'rgba(255,255,255,0.3)'}}>
                          {m.read ? '✓✓' : '✓'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={msgEndRef} />
            </div>

            {/* Input */}
            <div style={{ padding:'12px 16px', borderTop:'1px solid var(--border)', display:'flex', gap:8 }}>
              <input
                value={newMsg}
                onChange={e=>setNewMsg(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&sendMessage()}
                placeholder={`Message ${selected.full_name.split(' ')[0]}...`}
                style={{ flex:1, padding:'9px 14px', borderRadius:20, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)', fontSize:13, fontFamily:'inherit' }}
              />
              <button onClick={sendMessage} disabled={!newMsg.trim()} className="btn btn-primary" style={{ borderRadius:20, padding:'9px 20px' }}>
                Send
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
