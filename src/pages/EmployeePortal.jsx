import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

const ROUTES = ['Subway — Hibiya Line','Bus — Line 21','Own bicycle','Walking','Train — JR Yamanote','Other']

export default function EmployeePortal() {
  const { user, logout } = useAuth()
  const [tab, setTab] = useState('checkin')
  const [step, setStep] = useState('home')
  const [activeCheckin, setActiveCheckin] = useState(null)
  const [clients, setClients] = useState([])
  const [elapsed, setElapsed] = useState(0)
  const [checklist, setChecklist] = useState([])
  const [newTask, setNewTask] = useState('')
  const [calendarData, setCalendarData] = useState([])
  const [salaryData, setSalaryData] = useState(null)
  const [form, setForm] = useState({ client_id:'', client_name:'', route:ROUTES[0], transport_cost:280, notes:'', notes_out:'' })
  const [photos, setPhotos] = useState({ start:null, end:null })
  const [previews, setPreviews] = useState({ start:null, end:null })
  const [submitting, setSubmitting] = useState(false)
  const timerRef = useRef(null)
  const startRef = useRef()
  const endRef = useRef()

  useEffect(() => { loadClients(); checkActive(); loadCalendar(); loadSalary() }, [])

  useEffect(() => {
    if (step === 'checkout' && activeCheckin) {
      const start = new Date(`${activeCheckin.checkin_date}T${activeCheckin.checkin_time}`)
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now()-start)/1000)), 1000)
    }
    return () => clearInterval(timerRef.current)
  }, [step, activeCheckin])

  const loadClients = async () => {
    const { data } = await supabase.from('clients').select('id,company_name').eq('is_active',true)
    if (data?.length) { setClients(data); setForm(f=>({...f,client_id:data[0].id,client_name:data[0].company_name})) }
  }

  const checkActive = async () => {
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase.from('checkins').select('*').eq('employee_id',user.id).eq('checkin_date',today).is('time_out',null).order('created_at',{ascending:false}).limit(1)
    if (data?.length) { setActiveCheckin(data[0]); setStep('checkout') }
  }

  const loadCalendar = async () => {
    const { data } = await supabase.from('service_reports').select('*').eq('employee_id',user.id).order('report_date',{ascending:false}).limit(30)
    setCalendarData(data||[])
  }

  const loadSalary = async () => {
    const month = new Date().toISOString().slice(0,7)
    const { data } = await supabase.from('service_reports').select('*').eq('employee_id',user.id).gte('report_date',month+'-01')
    if (data) {
      const hours = data.reduce((s,r) => {
        if (!r.time_in||!r.time_out) return s
        const [h1,m1]=r.time_in.split(':').map(Number)
        const [h2,m2]=r.time_out.split(':').map(Number)
        return s+((h2*60+m2)-(h1*60+m1))/60
      },0)
      setSalaryData({ shifts:data.length, hours:hours.toFixed(1), estimated: Math.round(hours*(user.hourly_rate||0)) })
    }
  }

  const upd = (k,v) => setForm(f=>({...f,[k]:v}))
  const fmt = s => `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`

  const handleCheckin = async () => {
    setSubmitting(true)
    const now = new Date().toTimeString().slice(0,5)
    const today = new Date().toISOString().split('T')[0]
    try {
      const { data, error } = await supabase.from('checkins').insert({
        employee_id:user.id, employee_name:user.name,
        client_id:form.client_id||null, client_name:form.client_name,
        checkin_date:today, checkin_type:'in', checkin_time:now,
        transport_route:form.route, transport_cost:form.transport_cost, notes:form.notes,
      }).select().single()
      if (error) throw error
      if (photos.start) {
        const ext = photos.start.name.split('.').pop()
        const path = `checkins/${data.id}/start.${ext}`
        await supabase.storage.from('service-photos').upload(path,photos.start,{upsert:true})
        const { data:pd } = supabase.storage.from('service-photos').getPublicUrl(path)
        await supabase.from('checkins').update({photo_before_url:pd.publicUrl}).eq('id',data.id)
        data.photo_before_url = pd.publicUrl
      }
      setActiveCheckin(data); setStep('checkout')
      toast.success('Check-in registered!')
    } catch(e) { toast.error(e.message) }
    setSubmitting(false)
  }

  const handleCheckout = async () => {
    setSubmitting(true)
    const now = new Date().toTimeString().slice(0,5)
    try {
      let endUrl = null
      if (photos.end) {
        const ext = photos.end.name.split('.').pop()
        const path = `checkins/${activeCheckin.id}/end.${ext}`
        await supabase.storage.from('service-photos').upload(path,photos.end,{upsert:true})
        const { data:pd } = supabase.storage.from('service-photos').getPublicUrl(path)
        endUrl = pd.publicUrl
      }
      await supabase.from('checkins').update({ time_out:now, notes_out:form.notes_out, ...(endUrl&&{photo_after_url:endUrl}) }).eq('id',activeCheckin.id)
      await supabase.from('service_reports').insert({
        checkin_id:activeCheckin.id, employee_id:user.id, employee_name:user.name,
        client_name:activeCheckin.client_name, report_date:activeCheckin.checkin_date,
        time_in:activeCheckin.checkin_time, time_out:now,
        transport_route:activeCheckin.transport_route, transport_cost:activeCheckin.transport_cost,
        notes_in:activeCheckin.notes, notes_out:form.notes_out,
        photo_before_url:activeCheckin.photo_before_url, photo_after_url:endUrl,
        checklist:JSON.stringify(checklist),
      })
      clearInterval(timerRef.current)
      setStep('done'); setChecklist([])
      toast.success('Check-out done!')
      loadCalendar(); loadSalary()
    } catch(e) { toast.error(e.message) }
    setSubmitting(false)
  }

  const IS = { width:'100%', padding:'9px 11px', fontSize:13, borderRadius:8, border:'1px solid rgba(255,255,255,0.15)', background:'rgba(255,255,255,0.07)', color:'#fff', fontFamily:'inherit', boxSizing:'border-box' }
  const F = ({label,children}) => <div style={{display:'flex',flexDirection:'column',gap:5}}><label style={{fontSize:12,color:'rgba(255,255,255,0.5)'}}>{label}</label>{children}</div>
  const PhotoSlot = ({slot,label,ref_}) => (
    <div>
      <input type="file" accept="image/*" capture="environment" ref={ref_} style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(f){setPhotos(p=>({...p,[slot]:f}));setPreviews(p=>({...p,[slot]:URL.createObjectURL(f)}));}}} />
      <div onClick={()=>ref_.current.click()} style={{aspectRatio:'1',borderRadius:10,overflow:'hidden',cursor:'pointer',border:previews[slot]?'none':'2px dashed rgba(255,255,255,0.2)',background:previews[slot]?'none':'rgba(255,255,255,0.04)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6,color:'rgba(255,255,255,0.4)',fontSize:12}}>
        {previews[slot]?<img src={previews[slot]} style={{width:'100%',height:'100%',objectFit:'cover'}} />:<><span style={{fontSize:26}}>📷</span><span>{label}</span></>}
      </div>
    </div>
  )

  return (
    <div style={{minHeight:'100vh',background:'#0d2137',display:'flex',flexDirection:'column'}}>
      <div style={{padding:'14px 18px',display:'flex',justifyContent:'space-between',alignItems:'center',borderBottom:'1px solid rgba(255,255,255,0.08)'}}>
        <div><div style={{fontSize:15,fontWeight:700,color:'#c19c56'}}>KuriPuro</div><div style={{fontSize:11,color:'rgba(255,255,255,0.45)'}}>{user.name}</div></div>
        <button onClick={logout} style={{background:'rgba(255,255,255,0.1)',border:'none',color:'#fff',padding:'7px 14px',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:600}}>Logout</button>
      </div>

      <div style={{display:'flex',borderBottom:'1px solid rgba(255,255,255,0.08)'}}>
        {[['checkin','🕐 Shift'],['salary','💴 Salary'],['calendar','📅 History']].map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)} style={{flex:1,padding:'11px 0',border:'none',background:'none',color:tab===k?'#c19c56':'rgba(255,255,255,0.4)',fontSize:13,fontWeight:tab===k?600:400,borderBottom:tab===k?'2px solid #c19c56':'2px solid transparent',cursor:'pointer'}}>{l}</button>
        ))}
      </div>

      <div style={{flex:1,padding:18,maxWidth:480,margin:'0 auto',width:'100%',overflowY:'auto'}}>

        {tab==='checkin' && <>
          {step==='home' && (
            <div style={{display:'flex',flexDirection:'column',gap:16,paddingTop:30}}>
              <div style={{textAlign:'center',color:'rgba(255,255,255,0.5)',fontSize:14}}>{new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'})}</div>
              <div style={{textAlign:'center',fontSize:30,fontWeight:700,color:'#fff'}}>{new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</div>
              <button onClick={()=>setStep('checkin-form')} style={{padding:'18px',borderRadius:14,border:'none',background:'#0F6E56',color:'#fff',fontSize:18,fontWeight:700,cursor:'pointer',marginTop:10}}>✅ Start Shift</button>
            </div>
          )}

          {step==='checkin-form' && (
            <div style={{display:'flex',flexDirection:'column',gap:13}}>
              <div style={{fontSize:17,fontWeight:700,color:'#fff',marginBottom:4}}>Check-IN</div>
              <F label="Client"><select value={form.client_id} onChange={e=>{const c=clients.find(c=>c.id===e.target.value);upd('client_id',e.target.value);upd('client_name',c?.company_name||'')}} style={IS}>{clients.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}</select></F>
              <F label="Transport"><select value={form.route} onChange={e=>upd('route',e.target.value)} style={IS}>{ROUTES.map(r=><option key={r}>{r}</option>)}</select></F>
              <F label="Transport Cost (¥)"><input type="number" value={form.transport_cost} onChange={e=>upd('transport_cost',e.target.value)} style={IS} /></F>
              <F label="Notes"><textarea value={form.notes} onChange={e=>upd('notes',e.target.value)} style={{...IS,minHeight:60,resize:'vertical'}} /></F>
              <F label="📷 Start Photo"><PhotoSlot slot="start" label="Start" ref_={startRef} /></F>
              <button onClick={handleCheckin} disabled={submitting} style={{padding:'14px',borderRadius:12,border:'none',background:'#0F6E56',color:'#fff',fontSize:16,fontWeight:700,cursor:'pointer',marginTop:6}}>{submitting?'Registering...':'✅ Check-IN'}</button>
            </div>
          )}

          {step==='checkout' && activeCheckin && (
            <div style={{display:'flex',flexDirection:'column',gap:13}}>
              <div style={{background:'rgba(15,110,86,0.2)',border:'1px solid rgba(15,110,86,0.5)',borderRadius:10,padding:'12px 16px',marginBottom:4}}>
                <div style={{fontSize:12,color:'rgba(255,255,255,0.5)'}}>Active shift</div>
                <div style={{fontSize:16,fontWeight:700,color:'#fff',marginTop:2}}>{activeCheckin.client_name}</div>
                <div style={{fontSize:12,color:'#c19c56'}}>Started: {activeCheckin.checkin_time}</div>
                <div style={{fontSize:24,fontWeight:700,color:'#4ade80',marginTop:6,fontFamily:'monospace'}}>{fmt(elapsed)}</div>
              </div>
              <div>
                <div style={{fontSize:12,color:'rgba(255,255,255,0.5)',marginBottom:8}}>CHECKLIST</div>
                {checklist.map((t,i)=>(
                  <div key={i} onClick={()=>setChecklist(c=>c.map((x,j)=>j===i?{...x,done:!x.done}:x))} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid rgba(255,255,255,0.06)',cursor:'pointer'}}>
                    <div style={{width:18,height:18,borderRadius:4,border:'2px solid',borderColor:t.done?'#4ade80':'rgba(255,255,255,0.3)',background:t.done?'#4ade80':'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                      {t.done&&<span style={{fontSize:11,color:'#0d2137',fontWeight:700}}>✓</span>}
                    </div>
                    <span style={{fontSize:13,color:t.done?'rgba(255,255,255,0.4)':'#fff',textDecoration:t.done?'line-through':'none'}}>{t.label}</span>
                  </div>
                ))}
                <div style={{display:'flex',gap:8,marginTop:8}}>
                  <input value={newTask} onChange={e=>setNewTask(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&newTask.trim()){setChecklist(c=>[...c,{label:newTask.trim(),done:false}]);setNewTask('')}}} placeholder="Add task + Enter" style={{...IS,flex:1,padding:'7px 10px',fontSize:12}} />
                  <button onClick={()=>{if(newTask.trim()){setChecklist(c=>[...c,{label:newTask.trim(),done:false}]);setNewTask('')}}} style={{padding:'7px 12px',borderRadius:8,border:'none',background:'#c19c56',color:'#0d2137',fontWeight:700,cursor:'pointer'}}>+</button>
                </div>
              </div>
              <F label="Service Notes"><textarea value={form.notes_out} onChange={e=>upd('notes_out',e.target.value)} style={{...IS,minHeight:70,resize:'vertical'}} /></F>
              <F label="📷 End Photo"><PhotoSlot slot="end" label="End" ref_={endRef} /></F>
              <button onClick={handleCheckout} disabled={submitting} style={{padding:'14px',borderRadius:12,border:'none',background:'#c19c56',color:'#0d2137',fontSize:16,fontWeight:700,cursor:'pointer',marginTop:6}}>{submitting?'Saving...':'🏁 Check-OUT'}</button>
            </div>
          )}

          {step==='done' && (
            <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:16,paddingTop:50,textAlign:'center'}}>
              <div style={{fontSize:56}}>✅</div>
              <div style={{fontSize:20,fontWeight:700,color:'#fff'}}>Shift complete!</div>
              <button onClick={()=>{setStep('home');setActiveCheckin(null);setPhotos({start:null,end:null});setPreviews({start:null,end:null});setElapsed(0)}} style={{marginTop:16,padding:'11px 28px',borderRadius:10,border:'none',background:'rgba(255,255,255,0.1)',color:'#fff',fontSize:13,cursor:'pointer'}}>Back to Home</button>
            </div>
          )}
        </>}

        {tab==='salary' && (
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div style={{fontSize:17,fontWeight:700,color:'#fff',marginBottom:4}}>My Salary</div>
            {salaryData ? (
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                {[['Shifts',salaryData.shifts],['Hours',salaryData.hours+'h'],['Contract',user.contract_type||'—'],['Estimated','¥'+salaryData.estimated.toLocaleString()]].map(([l,v])=>(
                  <div key={l} style={{background:'rgba(255,255,255,0.06)',borderRadius:10,padding:'12px'}}>
                    <div style={{fontSize:11,color:'rgba(255,255,255,0.4)'}}>{l}</div>
                    <div style={{fontSize:18,fontWeight:700,color:'#c19c56',marginTop:4}}>{v}</div>
                  </div>
                ))}
              </div>
            ) : <div style={{color:'rgba(255,255,255,0.4)'}}>Loading...</div>}
            <div style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginTop:4}}>* Final salary confirmed by admin</div>
          </div>
        )}

        {tab==='calendar' && (
          <div>
            <div style={{fontSize:17,fontWeight:700,color:'#fff',marginBottom:16}}>Work History</div>
            {calendarData.length===0&&<div style={{color:'rgba(255,255,255,0.4)',fontSize:13}}>No records yet.</div>}
            {calendarData.map(r=>(
              <div key={r.id} style={{background:'rgba(255,255,255,0.05)',borderRadius:10,padding:'12px 14px',marginBottom:10}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                  <div style={{fontSize:14,fontWeight:600,color:'#fff'}}>{r.client_name}</div>
                  <div style={{fontSize:12,color:'#c19c56'}}>{r.time_in} → {r.time_out}</div>
                </div>
                <div style={{fontSize:11,color:'rgba(255,255,255,0.4)'}}>{r.report_date}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
