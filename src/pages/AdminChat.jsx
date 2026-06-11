import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

export default function AdminChat() {
  const [employees, setEmployees] = useState([])
  const [selected, setSelected] = useState(null)
  const [messages, setMessages] = useState([])
  const [newMsg, setNewMsg] = useState('')
  const [unread, setUnread] = useState({})
  const msgEndRef = useRef()
  const pollRef = useRef()

  useEffect(() => {
    loadEmployees()
    pollRef.current = setInterval(() => loadEmployees(), 10000)
    return () => clearInterval(pollRef.current)
  }, [])

  useEffect(() => {
    if (selected) { loadMessages(selected.id); markRead(selected.id) }
  }, [selected])

  useEffect(() => {
    setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior:'smooth' }), 100)
  }, [messages])

  const loadEmployees = async () => {
    const { data: emps } = await supabase.from('employees').select('id,full_name,is_active').eq('is_active',true).order('full_name')
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

  const sendMessage = async () => {
    if (!newMsg.trim()||!selected) return
    await supabase.from('messages').insert({ employee_id:selected.id, employee_name:selected.full_name, sender:'admin', content:newMsg.trim(), read:false })
    setNewMsg('')
    loadMessages(selected.id)
  }

  const totalUnread = Object.values(unread).reduce((s,v)=>s+v,0)

  return (
    <div style={{ display:'flex', height:'calc(100vh - 120px)', gap:14 }}>
      {/* Employee list */}
      <div style={{ width:220, flexShrink:0, display:'flex', flexDirection:'column', gap:6 }}>
        <div className="card-title">
          💬 Chat {totalUnread>0&&<span className="badge badge-red">{totalUnread} new</span>}
        </div>
        {employees.map(e=>(
          <div key={e.id} onClick={()=>setSelected(e)}
            style={{ padding:'10px 12px', borderRadius:10, cursor:'pointer', background: selected?.id===e.id?'var(--navy)':'var(--surface2)', border:`1px solid ${selected?.id===e.id?'var(--navy)':'var(--border)'}`, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div>
              <div style={{ fontSize:13, fontWeight:500, color: selected?.id===e.id?'#fff':'var(--text)' }}>{e.full_name.split(' ')[0]}</div>
            </div>
            {unread[e.id]>0&&<span className="badge badge-red">{unread[e.id]}</span>}
          </div>
        ))}
        {employees.length===0&&<div style={{fontSize:12,color:'var(--text3)'}}>No employees</div>}
      </div>

      {/* Chat window */}
      <div className="card" style={{ flex:1, display:'flex', flexDirection:'column', padding:0, overflow:'hidden' }}>
        {!selected ? (
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text3)', fontSize:13 }}>
            Select an employee to chat
          </div>
        ) : (
          <>
            <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--border)', fontWeight:600, fontSize:14, display:'flex', alignItems:'center', gap:8 }}>
              <div className="avatar" style={{ width:32, height:32, fontSize:12, background:'#E6F1FB', color:'#185FA5' }}>
                {selected.full_name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}
              </div>
              {selected.full_name}
            </div>

            <div style={{ flex:1, overflowY:'auto', padding:'14px 18px', display:'flex', flexDirection:'column', gap:8 }}>
              {messages.length===0&&<div style={{textAlign:'center',color:'var(--text3)',fontSize:12,paddingTop:20}}>No messages yet</div>}
              {messages.map(m=>(
                <div key={m.id} style={{ display:'flex', justifyContent:m.sender==='admin'?'flex-end':'flex-start' }}>
                  <div style={{ maxWidth:'70%', background:m.sender==='admin'?'var(--navy)':'var(--surface2)', borderRadius:m.sender==='admin'?'14px 14px 4px 14px':'14px 14px 14px 4px', padding:'10px 14px' }}>
                    {m.sender==='employee'&&<div style={{ fontSize:10, color:'var(--text3)', marginBottom:3 }}>{selected.full_name.split(' ')[0]}</div>}
                    <div style={{ fontSize:13, color:m.sender==='admin'?'#fff':'var(--text)', lineHeight:1.5 }}>{m.content}</div>
                    <div style={{ fontSize:10, color:m.sender==='admin'?'rgba(255,255,255,0.4)':'var(--text3)', marginTop:3, textAlign:'right' }}>
                      {new Date(m.created_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={msgEndRef} />
            </div>

            <div style={{ padding:'12px 16px', borderTop:'1px solid var(--border)', display:'flex', gap:8 }}>
              <input value={newMsg} onChange={e=>setNewMsg(e.target.value)} onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&sendMessage()} placeholder={`Message ${selected.full_name.split(' ')[0]}...`} style={{ flex:1, padding:'9px 14px', borderRadius:20, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)', fontSize:13, fontFamily:'inherit' }} />
              <button onClick={sendMessage} disabled={!newMsg.trim()} className="btn btn-primary" style={{ borderRadius:20, padding:'9px 18px' }}>Send</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
