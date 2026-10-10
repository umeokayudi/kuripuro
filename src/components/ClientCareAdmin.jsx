import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useLang } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { locationFromJob } from '../lib/clientPortal'
import { LOCATION_FIELDS, maintenanceRows } from '../lib/clientCare'
import { ManagerCard } from './ClientCare'
import '../pages/client-portal.css'

const MANAGER_FIELDS = ['manager_name', 'manager_email', 'manager_phone', 'manager_line_url', 'manager_photo_url']
const tone = { overdue: 'badge-red', soon: 'badge-amber', ok: 'badge-green', unknown: 'badge-navy' }

// Admin side of the client portal: account manager, store details and maintenance plan.
export default function ClientCareAdmin({ clients, onClientsChanged }) {
  const { t, lang } = useLang()
  const c = t.client
  const ja = lang === 'ja'
  const today = tokyoToday()
  const [clientId, setClientId] = useState(clients[0]?.id || '')
  const [manager, setManager] = useState({})
  const [stores, setStores] = useState([])
  const [store, setStore] = useState('')
  const [profiles, setProfiles] = useState([])
  const [records, setRecords] = useState([])
  const [jobs, setJobs] = useState([])
  const [profileDraft, setProfileDraft] = useState({})
  const [maintDraft, setMaintDraft] = useState({})
  const [newStore, setNewStore] = useState('')
  const client = clients.find(x => x.id === clientId)

  useEffect(() => { if (!clientId && clients[0]) setClientId(clients[0].id) }, [clients, clientId])

  const load = async () => {
    if (!clientId) return
    const since = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10)
    const [ct, pr, mr, jb] = await Promise.all([
      supabase.from('service_contracts').select('location_name').eq('client_id', clientId).eq('is_active', true),
      supabase.from('location_profiles').select('*').eq('client_id', clientId),
      supabase.from('location_maintenance').select('*').eq('client_id', clientId),
      supabase.from('jobs').select('id,title,description,status,scheduled_date,client_id').eq('client_id', clientId).eq('status', 'completed').gte('scheduled_date', since).limit(1000),
    ])
    const names = [...new Set([
      ...(ct.data || []).map(r => r.location_name),
      ...(pr.data || []).map(r => r.location_name),
      ...(jb.data || []).map(j => locationFromJob(j)),
    ].filter(Boolean))].sort()
    setStores(names)
    setProfiles(pr.data || [])
    setRecords(mr.data || [])
    setJobs(jb.data || [])
    setStore(s => (names.includes(s) ? s : names[0] || ''))
  }

  useEffect(() => {
    setManager(Object.fromEntries(MANAGER_FIELDS.map(k => [k, client?.[k] || ''])))
    load()
  }, [clientId]) // eslint-disable-line react-hooks/exhaustive-deps

  const profile = profiles.find(p => p.location_name === store) || null
  useEffect(() => { setProfileDraft(profile || {}); setMaintDraft({}) }, [store, profiles]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => maintenanceRows({ jobs, locationName: store, records, today }), [jobs, store, records, today])

  const saveManager = async () => {
    const body = Object.fromEntries(MANAGER_FIELDS.map(k => [k, manager[k]?.trim() || null]))
    const { error } = await supabase.from('clients').update(body).eq('id', clientId)
    if (error) return toast.error(error.message)
    toast.success(c.saved)
    onClientsChanged?.()
  }

  const saveProfile = async () => {
    if (!store) return
    const body = { client_id: clientId, location_name: store, updated_by: 'admin', updated_at: new Date().toISOString() }
    for (const f of LOCATION_FIELDS) {
      const v = profileDraft[f.key]
      body[f.key] = v === '' || v === undefined || v === null ? null : f.type === 'number' ? Number(v) : v
    }
    const { error } = await supabase.from('location_profiles').upsert(body, { onConflict: 'client_id,location_name' })
    if (error) return toast.error(error.message)
    toast.success(c.saved)
    load()
  }

  const saveMaintenance = async () => {
    const changed = Object.entries(maintDraft)
    if (!changed.length) return
    const body = changed.map(([key, d]) => {
      const row = rows.find(r => r.key === key)
      return {
        client_id: clientId, location_name: store, item_key: key,
        last_done: (d.last_done ?? row.record?.last_done) || null,
        interval_days: Number(d.interval_days ?? row.interval) || null,
        updated_at: new Date().toISOString(),
      }
    })
    const { error } = await supabase.from('location_maintenance').upsert(body, { onConflict: 'client_id,location_name,item_key' })
    if (error) return toast.error(error.message)
    toast.success(c.saved)
    load()
  }

  const addStore = () => {
    const name = newStore.trim()
    if (!name || stores.includes(name)) return
    setStores(s => [...s, name].sort())
    setStore(name)
    setNewStore('')
  }

  if (!clients.length) return null
  return (
    <div className="care-admin">
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="form-group" style={{ maxWidth: 360 }}>
          <label>{ja ? 'クライアント' : 'Client'}</label>
          <select value={clientId} onChange={e => setClientId(e.target.value)}>
            {clients.map(x => <option key={x.id} value={x.id}>{x.company_name}</option>)}
          </select>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title">{c.yourManager}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: '0 12px' }}>
          {[
            ['manager_name', ja ? '担当者名' : 'Name'],
            ['manager_email', 'Email'],
            ['manager_phone', ja ? '電話番号' : 'Phone'],
            ['manager_line_url', ja ? 'LINEのURL（QRを自動生成）' : 'LINE link (QR is generated)'],
            ['manager_photo_url', ja ? '写真URL（任意）' : 'Photo URL (optional)'],
          ].map(([key, label]) => (
            <div key={key} className="form-group">
              <label>{label}</label>
              <input value={manager[key] || ''} onChange={e => setManager(m => ({ ...m, [key]: e.target.value }))} placeholder={key === 'manager_line_url' ? 'https://line.me/ti/p/...' : ''} />
            </div>
          ))}
        </div>
        <button className="btn btn-primary" onClick={saveManager}>{c.save}</button>
        {manager.manager_name && (
          <div style={{ marginTop: 14, maxWidth: 520 }}>
            <ManagerCard client={manager} labels={c} />
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title">{c.storesTab}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {stores.map(s => (
            <button key={s} className={`tab-pill${s === store ? ' active' : ''}`} onClick={() => setStore(s)}>{s}</button>
          ))}
          <input value={newStore} onChange={e => setNewStore(e.target.value)} placeholder={ja ? '店舗を追加' : 'Add store'} style={{ width: 160 }} onKeyDown={e => e.key === 'Enter' && addStore()} />
          <button className="btn btn-sm" onClick={addStore}>+</button>
        </div>
        {store && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: '0 12px' }}>
              {LOCATION_FIELDS.map(f => (
                <div key={f.key} className="form-group">
                  <label>{c[`f_${f.key}`]}{f.unit ? ` (${f.unit})` : ''}</label>
                  <input type={f.type} min={f.type === 'number' ? 0 : undefined} value={profileDraft[f.key] ?? ''} onChange={e => setProfileDraft(d => ({ ...d, [f.key]: e.target.value }))} />
                </div>
              ))}
            </div>
            <button className="btn btn-primary" onClick={saveProfile}>{c.save}</button>
            {profile?.updated_by && <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text3)' }}>{profile.updated_by} · {String(profile.updated_at || '').slice(0, 10)}</span>}
          </>
        )}
      </div>

      {store && (
        <div className="card">
          <div className="card-title">{c.maintenanceTitle} · {store}</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>
            {ja ? '前回実施日は完了した深層清掃の仕事から自動で読み取ります。手入力も可能です（新しい方を使用）。'
              : 'Last done is read automatically from completed deep-clean jobs. You can also type a date; the newer one wins.'}
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{ja ? '項目' : 'Item'}</th><th>{c.lastDone}</th><th>{ja ? '間隔（日）' : 'Every (days)'}</th><th>{ja ? '次回' : 'Next due'}</th><th /></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.key}>
                    <td>{ja ? r.ja : r.en}</td>
                    <td>
                      <input type="date" value={maintDraft[r.key]?.last_done ?? r.lastDone ?? ''} onChange={e => setMaintDraft(d => ({ ...d, [r.key]: { ...d[r.key], last_done: e.target.value } }))} />
                    </td>
                    <td>
                      <input type="number" min="1" style={{ width: 90 }} value={maintDraft[r.key]?.interval_days ?? r.interval} onChange={e => setMaintDraft(d => ({ ...d, [r.key]: { ...d[r.key], interval_days: e.target.value } }))} />
                    </td>
                    <td>{r.nextDue || '—'}</td>
                    <td><span className={`badge ${tone[r.state]}`}>{r.state === 'overdue' ? c.invOverdue : r.state === 'soon' ? (ja ? 'まもなく' : 'Soon') : r.state === 'ok' ? c.upToDate : c.noRecord}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={saveMaintenance} disabled={!Object.keys(maintDraft).length}>{c.save}</button>
        </div>
      )}
    </div>
  )
}
