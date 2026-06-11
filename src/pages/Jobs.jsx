import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { geocodeAddress } from '../lib/geocode'
import toast from 'react-hot-toast'

export default function Jobs() {
  const [tab, setTab] = useState('list')
  const [jobs, setJobs] = useState([])
  const [employees, setEmployees] = useState([])
  const [clients, setClients] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [geocoding, setGeocoding] = useState(false)
  const [form, setForm] = useState({
    title:'', client_id:'', client_name:'', employee_id:'', employee_name:'',
    scheduled_date:'', scheduled_time:'', address:'', gps_lat:'', gps_lng:'',
    value:0, description:'', checklist_template:'', photo_required:false,
    location_id:'', job_category:'regular', spot_value:0
  })

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    setLoading(true)
    const [j, e, c, l] = await Promise.all([
      supabase.from('jobs').select('*').order('scheduled_date', { ascending: false }),
      supabase.from('employees').select('id,full_name,salary_type,hourly_rate,fixed_salary').eq('is_active', true),
      supabase.from('clients').select('id,company_name').eq('is_active', true),
      supabase.from('locations').select('*').eq('is_active', true).order('name'),
    ])
    setJobs(j.data || [])
    setEmployees(e.data || [])
    setClients(c.data || [])
    setLocations(l.data || [])
    setLoading(false)
  }

  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleLocationSelect = (locId) => {
    const loc = locations.find(l => l.id === locId)
    if (!loc) return
    setForm(f => ({ ...f, location_id: locId, address: loc.address, gps_lat: loc.gps_lat || '', gps_lng: loc.gps_lng || '', title: f.title || loc.name }))
  }

  const handleGeocode = async () => {
    if (!form.address) return toast.error('Enter address first')
    setGeocoding(true)
    const result = await geocodeAddress(form.address)
    setGeocoding(false)
    if (result) { setForm(f => ({ ...f, gps_lat: result.lat, gps_lng: result.lng })); toast.success(`GPS: ${result.lat.toFixed(4)}, ${result.lng.toFixed(4)}`) }
    else toast.error('Address not found')
  }

  const handleCreate = async () => {
    if (!form.title || !form.employee_id || !form.scheduled_date || !form.address) return toast.error('Fill required fields')
    const emp = employees.find(e => e.id === form.employee_id)
    const cli = clients.find(c => c.id === form.client_id)
    const isSpot = form.job_category === 'spot'
    const { error } = await supabase.from('jobs').insert({
      title: form.title,
      client_id: form.client_id || null,
      client_name: cli?.company_name || '',
      employee_id: form.employee_id,
      employee_name: emp?.full_name || '',
      scheduled_date: form.scheduled_date,
      scheduled_time: form.scheduled_time,
      address: form.address,
      gps_lat: form.gps_lat || null,
      gps_lng: form.gps_lng || null,
      value: parseFloat(form.value) || 0,
      spot_value: parseFloat(form.spot_value) || 0,
      description: form.description,
      checklist_template: form.checklist_template,
      photo_required: form.photo_required,
      job_category: form.job_category,
      status: 'assigned',
      spot_status: isSpot ? 'pending' : null,
    })
    if (error) return toast.error(error.message)
    toast.success(isSpot ? 'Spot job sent! Waiting for employee response.' : 'Job created!')
    setForm({ title:'', client_id:'', client_name:'', employee_id:'', employee_name:'', scheduled_date:'', scheduled_time:'', address:'', gps_lat:'', gps_lng:'', value:0, description:'', checklist_template:'', photo_required:false, location_id:'', job_category:'regular', spot_value:0 })
    loadAll()
    setTab('list')
  }

  const statusColor = s => ({ assigned:'badge-blue', in_progress:'badge-amber', completed:'badge-green', cancelled:'badge-red' }[s] || 'badge-navy')
  const spotStatusColor = s => ({ pending:'badge-amber', accepted:'badge-green', declined:'badge-red' }[s] || 'badge-navy')

  const handleCancel = async (id) => {
    await supabase.from('jobs').update({ status: 'cancelled' }).eq('id', id)
    loadAll()
  }

  const spotJobs = jobs.filter(j => j.job_category === 'spot')
  const regularJobs = jobs.filter(j => j.job_category !== 'spot')

  return (
    <div>
      <div className="tab-pills">
        <button className={`tab-pill${tab==='list'?' active':''}`} onClick={()=>setTab('list')}>All Jobs</button>
        <button className={`tab-pill${tab==='spot'?' active':''}`} onClick={()=>setTab('spot')}>
          ⚡ Spot Jobs {spotJobs.filter(j=>j.spot_status==='pending').length > 0 && <span className="badge badge-amber" style={{marginLeft:4}}>{spotJobs.filter(j=>j.spot_status==='pending').length}</span>}
        </button>
        <button className={`tab-pill${tab==='new'?' active':''}`} onClick={()=>setTab('new')}>+ New Job</button>
        <button className={`tab-pill${tab==='locations'?' active':''}`} onClick={()=>setTab('locations')}>📍 Locations</button>
      </div>

      {tab==='list' && (
        <div>
          {loading && <div style={{color:'var(--text3)',fontSize:13}}>Loading...</div>}
          {jobs.length === 0 && !loading && <div className="card"><div style={{color:'var(--text3)',fontSize:13}}>No jobs yet.</div></div>}
          {jobs.map(j => (
            <div key={j.id} className="card" style={{marginBottom:10}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'start',marginBottom:8}}>
                <div>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontWeight:600,fontSize:15}}>{j.title}</span>
                    {j.job_category==='spot' && <span className="badge badge-amber">⚡ Spot</span>}
                  </div>
                  <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{j.employee_name} · {j.scheduled_date} {j.scheduled_time}</div>
                  <div style={{fontSize:12,color:'var(--text3)'}}>{j.address}</div>
                </div>
                <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
                  <span className={`badge ${statusColor(j.status)}`}>{j.status}</span>
                  {j.job_category==='spot' && j.spot_status && <span className={`badge ${spotStatusColor(j.spot_status)}`}>{j.spot_status}</span>}
                  <span style={{fontSize:13,fontWeight:600,color:'var(--green)'}}>¥{Number(j.value||j.spot_value||0).toLocaleString()}</span>
                </div>
              </div>
              {j.description && <div style={{fontSize:12,color:'var(--text2)',background:'var(--surface2)',borderRadius:6,padding:'7px 10px',marginBottom:8}}>{j.description}</div>}
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {j.photo_required && <span className="badge badge-amber">📷 Photo required</span>}
                {j.gps_lat && <span className="badge badge-navy">📍 GPS</span>}
                {j.status==='assigned' && <button className="btn btn-sm btn-danger" onClick={()=>handleCancel(j.id)}>Cancel</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab==='spot' && (
        <div>
          <div style={{fontSize:13,color:'var(--text2)',marginBottom:14}}>Spot jobs are extra services sent to employees. They must accept before starting.</div>
          {spotJobs.length===0 && <div className="card"><div style={{color:'var(--text3)',fontSize:13}}>No spot jobs yet.</div></div>}
          {spotJobs.map(j=>(
            <div key={j.id} className="card" style={{marginBottom:10,borderLeft:`3px solid ${j.spot_status==='accepted'?'var(--green)':j.spot_status==='declined'?'var(--red)':'#EF9F27'}`}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'start',marginBottom:8}}>
                <div>
                  <div style={{fontWeight:600,fontSize:15}}>{j.title}</div>
                  <div style={{fontSize:12,color:'var(--text3)'}}>{j.employee_name} · {j.scheduled_date}</div>
                  <div style={{fontSize:12,color:'var(--text3)'}}>{j.address}</div>
                </div>
                <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
                  <span className={`badge ${spotStatusColor(j.spot_status)}`}>{j.spot_status}</span>
                  <span style={{fontSize:14,fontWeight:700,color:'var(--green)'}}>+¥{Number(j.spot_value||j.value||0).toLocaleString()}</span>
                </div>
              </div>
              {j.description && <div style={{fontSize:12,color:'var(--text2)',background:'var(--surface2)',borderRadius:6,padding:'7px 10px'}}>{j.description}</div>}
            </div>
          ))}
        </div>
      )}

      {tab==='new' && (
        <div className="card">
          <div className="card-title">New Job</div>

          {/* Job type toggle */}
          <div style={{display:'flex',gap:8,marginBottom:16}}>
            <button type="button" onClick={()=>upd('job_category','regular')} style={{flex:1,padding:'10px',borderRadius:8,border:'2px solid',borderColor:form.job_category==='regular'?'var(--navy)':'var(--border)',background:form.job_category==='regular'?'var(--navy)':'none',color:form.job_category==='regular'?'#fff':'var(--text2)',fontWeight:600,cursor:'pointer',fontSize:13}}>
              📋 Regular Job
            </button>
            <button type="button" onClick={()=>upd('job_category','spot')} style={{flex:1,padding:'10px',borderRadius:8,border:'2px solid',borderColor:form.job_category==='spot'?'#EF9F27':'var(--border)',background:form.job_category==='spot'?'#FAEEDA':'none',color:form.job_category==='spot'?'#854F0B':'var(--text2)',fontWeight:600,cursor:'pointer',fontSize:13}}>
              ⚡ Spot Job (employee must accept)
            </button>
          </div>

          <div className="form-group">
            <label>Use saved location</label>
            <select value={form.location_id} onChange={e=>handleLocationSelect(e.target.value)}>
              <option value="">— Select saved location —</option>
              {locations.map(l=><option key={l.id} value={l.id}>{l.name} ({l.location_type})</option>)}
            </select>
          </div>

          <div className="grid-2">
            <div className="form-group"><label>Job Title *</label><input value={form.title} onChange={e=>upd('title',e.target.value)} placeholder="Hotel cleaning" /></div>
            <div className="form-group"><label>Assign to *</label>
              <select value={form.employee_id} onChange={e=>upd('employee_id',e.target.value)}>
                <option value="">Select employee...</option>
                {employees.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Client</label>
              <select value={form.client_id} onChange={e=>upd('client_id',e.target.value)}>
                <option value="">Select client...</option>
                {clients.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>{form.job_category==='spot' ? '⚡ Spot Value (¥) — added to salary' : 'Job Value (¥)'}</label>
              <input type="number" value={form.job_category==='spot'?form.spot_value:form.value} onChange={e=>form.job_category==='spot'?upd('spot_value',e.target.value):upd('value',e.target.value)} />
            </div>
            <div className="form-group"><label>Date *</label><input type="date" value={form.scheduled_date} onChange={e=>upd('scheduled_date',e.target.value)} /></div>
            <div className="form-group"><label>Time</label><input type="time" value={form.scheduled_time} onChange={e=>upd('scheduled_time',e.target.value)} /></div>
          </div>

          <div className="form-group">
            <label>Address *</label>
            <div style={{display:'flex',gap:8}}>
              <input value={form.address} onChange={e=>upd('address',e.target.value)} placeholder="東京都新宿区..." style={{flex:1}} />
              <button className="btn" onClick={handleGeocode} disabled={geocoding} style={{whiteSpace:'nowrap'}}>{geocoding?'...':'📍 Get GPS'}</button>
            </div>
            {form.gps_lat && <div style={{fontSize:11,color:'var(--green)',marginTop:4}}>✓ GPS: {Number(form.gps_lat).toFixed(4)}, {Number(form.gps_lng).toFixed(4)}</div>}
          </div>

          <div className="form-group"><label>Description / Instructions</label><textarea value={form.description} onChange={e=>upd('description',e.target.value)} placeholder="Clean all rooms..." /></div>
          <div className="form-group"><label>Checklist (one item per line)</label><textarea value={form.checklist_template} onChange={e=>upd('checklist_template',e.target.value)} placeholder="Clean floors&#10;Wipe windows&#10;Empty trash" /></div>

          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
            <input type="checkbox" id="photo_req" checked={form.photo_required} onChange={e=>upd('photo_required',e.target.checked)} style={{width:16,height:16,cursor:'pointer'}} />
            <label htmlFor="photo_req" style={{cursor:'pointer',fontSize:13}}>📷 Photo required to complete this job</label>
          </div>

          {form.job_category==='spot' && (
            <div style={{background:'#FAEEDA',border:'1px solid #EF9F27',borderRadius:8,padding:'10px 14px',marginBottom:14,fontSize:13,color:'#854F0B'}}>
              ⚡ This spot job will appear in the employee's app. They must accept it before it becomes active. Value <strong>¥{Number(form.spot_value||0).toLocaleString()}</strong> will be added to their salary automatically when completed.
            </div>
          )}

          <button className="btn btn-primary" onClick={handleCreate}>
            {form.job_category==='spot' ? '⚡ Send Spot Job' : '✅ Create Job'}
          </button>
        </div>
      )}

      {tab==='locations' && <LocationsTab />}
    </div>
  )
}

function LocationsTab() {
  const [locations, setLocations] = useState([])
  const [form, setForm] = useState({ name:'', address:'', location_type:'fixed', notes:'' })
  const [geocoding, setGeocoding] = useState(false)
  const [gps, setGps] = useState(null)

  useEffect(() => { load() }, [])

  const load = async () => {
    const { data } = await supabase.from('locations').select('*').order('name')
    setLocations(data || [])
  }

  const upd = (k,v) => setForm(f=>({...f,[k]:v}))

  const handleGeocode = async () => {
    if (!form.address) return toast.error('Enter address first')
    setGeocoding(true)
    const result = await geocodeAddress(form.address)
    setGeocoding(false)
    if (result) { setGps(result); toast.success(`GPS: ${result.lat.toFixed(4)}, ${result.lng.toFixed(4)}`) }
    else toast.error('Not found')
  }

  const handleSave = async () => {
    if (!form.name || !form.address) return toast.error('Name and address required')
    const { error } = await supabase.from('locations').insert({ ...form, gps_lat: gps?.lat, gps_lng: gps?.lng })
    if (error) return toast.error(error.message)
    toast.success('Location saved!')
    setForm({ name:'', address:'', location_type:'fixed', notes:'' }); setGps(null); load()
  }

  const handleDelete = async (id) => {
    await supabase.from('locations').update({ is_active: false }).eq('id', id)
    load()
  }

  return (
    <div>
      <div className="card" style={{marginBottom:14}}>
        <div className="card-title">Save New Location</div>
        <div className="grid-2">
          <div className="form-group"><label>Name</label><input value={form.name} onChange={e=>upd('name',e.target.value)} placeholder="Hotel Grand" /></div>
          <div className="form-group"><label>Type</label>
            <select value={form.location_type} onChange={e=>upd('location_type',e.target.value)}>
              <option value="fixed">Fixed (recurring)</option>
              <option value="spot">Spot (one-time)</option>
            </select>
          </div>
        </div>
        <div className="form-group">
          <label>Address</label>
          <div style={{display:'flex',gap:8}}>
            <input value={form.address} onChange={e=>upd('address',e.target.value)} placeholder="東京都..." style={{flex:1}} />
            <button className="btn" onClick={handleGeocode} disabled={geocoding}>{geocoding?'...':'📍 GPS'}</button>
          </div>
          {gps && <div style={{fontSize:11,color:'var(--green)',marginTop:4}}>✓ {gps.lat.toFixed(4)}, {gps.lng.toFixed(4)}</div>}
        </div>
        <div className="form-group"><label>Notes</label><input value={form.notes} onChange={e=>upd('notes',e.target.value)} /></div>
        <button className="btn btn-primary" onClick={handleSave}>Save Location</button>
      </div>

      <div className="card">
        <div className="card-title">Saved Locations</div>
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Address</th><th>GPS</th><th></th></tr></thead>
          <tbody>
            {locations.filter(l=>l.is_active).map(l=>(
              <tr key={l.id}>
                <td style={{fontWeight:500}}>{l.name}</td>
                <td><span className={`badge ${l.location_type==='fixed'?'badge-green':'badge-amber'}`}>{l.location_type}</span></td>
                <td style={{fontSize:12}}>{l.address}</td>
                <td>{l.gps_lat ? <span className="badge badge-navy">✓</span> : '—'}</td>
                <td><button className="btn btn-sm" onClick={()=>handleDelete(l.id)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
