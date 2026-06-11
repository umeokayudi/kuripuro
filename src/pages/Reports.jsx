import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function Reports() {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  useEffect(() => { loadReports() }, [])

  const loadReports = async () => {
    setLoading(true)
    const { data } = await supabase.from('service_reports').select('*').order('created_at', { ascending: false }).limit(50)
    setReports(data || [])
    setLoading(false)
  }

  return (
    <div>
      <div className="card">
        <div className="card-title">Service Reports</div>
        {loading && <div style={{ color:'var(--text3)', fontSize:13 }}>Loading...</div>}
        {!loading && reports.length === 0 && <div style={{ color:'var(--text3)', fontSize:13 }}>No reports yet.</div>}
        {reports.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Employee</th><th>Client</th><th>Date</th><th>Start</th><th>End</th><th>PDF</th><th></th></tr></thead>
              <tbody>
                {reports.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontWeight:500 }}>{r.employee_name}</td>
                    <td>{r.client_name}</td>
                    <td>{r.report_date}</td>
                    <td>{r.time_in}</td>
                    <td>{r.time_out}</td>
                    <td>{r.pdf_url ? <a href={r.pdf_url} target="_blank" rel="noreferrer" className="btn btn-sm">PDF</a> : '—'}</td>
                    <td><button className="btn btn-sm" onClick={() => setSelected(r)}>View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {selected && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }} onClick={() => setSelected(null)}>
          <div style={{ background:'var(--surface)', borderRadius:14, padding:24, maxWidth:520, width:'100%', maxHeight:'90vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:16 }}>
              <div style={{ fontWeight:600 }}>Report Detail</div>
              <button onClick={() => setSelected(null)} style={{ background:'none', border:'none', fontSize:18, cursor:'pointer' }}>✕</button>
            </div>
            <div className="grid-2" style={{ gap:8, marginBottom:14 }}>
              {[['Employee',selected.employee_name],['Client',selected.client_name],['Date',selected.report_date],['Start',selected.time_in],['End',selected.time_out],['Transport',selected.transport_route]].map(([l,v]) => (
                <div key={l} style={{ background:'var(--surface2)', borderRadius:8, padding:'8px 12px' }}>
                  <div style={{ fontSize:11, color:'var(--text3)' }}>{l}</div>
                  <div style={{ fontSize:13, fontWeight:500 }}>{v||'—'}</div>
                </div>
              ))}
            </div>
            {selected.notes_out && <div style={{ marginBottom:12 }}><div style={{ fontSize:11, color:'var(--text3)', marginBottom:4 }}>Notes</div><div style={{ fontSize:13, background:'var(--surface2)', borderRadius:8, padding:'8px 12px' }}>{selected.notes_out}</div></div>}
            <div className="grid-3" style={{ gap:8 }}>
              {['before','during','after'].map(slot => (
                <div key={slot}>
                  <div style={{ fontSize:11, color:'var(--text3)', marginBottom:4, textTransform:'uppercase' }}>{slot}</div>
                  {selected[`photo_${slot}_url`] ? <img src={selected[`photo_${slot}_url`]} style={{ width:'100%', borderRadius:8, aspectRatio:'1', objectFit:'cover' }} /> : <div style={{ aspectRatio:'1', background:'var(--surface2)', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'var(--text3)' }}>No photo</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
