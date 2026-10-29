import { useState, useEffect, useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { geocodeAddress } from '../lib/geocode'
import { isNavigableAddress, mapsOpenUrl, hasMapsLink } from '../lib/mapsLink'
import {
  getCleaningType, locationNameFromTitle, applyCleaningTypeToTitle, cleaningTypesForLang,
  DEEP_TASKS, deepTaskName, parseDeepTaskList,
} from '../lib/cleaningType'
import { useLang, fill, localeOf } from '../hooks/useLang'
import JobPhotos from '../components/JobPhotos'
import JobVideos from '../components/JobVideos'
import PhotoLightbox from '../components/PhotoLightbox'
import toast from 'react-hot-toast'
import { googleCalendarUrl } from '../lib/calendar'
import { contractStatus } from '../lib/spotContract'
import { generateContractForJob } from '../lib/spotContractOps'
import { fetchContractSellers } from '../lib/contractSellers'
import JobsPeriodPanel from '../components/JobsPeriodPanel'
import NewJobForm from '../components/NewJobForm'
import DayAgenda from '../components/DayAgenda'
import { confirmAndRun } from '../components/ConfirmDialog'
import SetupChain from '../components/SetupChain'
import { buildPlaces } from '../lib/places'
import { splitChecklist } from '../lib/agenda'
import '../components/agenda.css'
import { tokyoToday } from '../lib/dates'
import { isMissedJob, isRetroJob } from '../lib/jobOverdue'
import { jobDurationMin } from '../lib/workKpis'
import KeyReveal from '../components/KeyReveal'
import {
  periodRange, previousRange, inRange, matchesPeople, summarize, summarizeByPerson, fmtMinutes, fmtStartEnd,
} from '../lib/jobsPeriod'

function applyGeocodeResult(result, setCoords, mapsMsg) {
  if (result?.lat != null && result?.lng != null) {
    setCoords(result)
    toast.success(`GPS: ${result.lat.toFixed(4)}, ${result.lng.toFixed(4)}`)
    return true
  }
  if (result?.mapsLink) {
    setCoords(null)
    toast.success(mapsMsg)
    return true
  }
  return false
}

/** "Coifa, Fritadeira" from a "Deep Clean (Range Hood, Fryer)" title, or '' when it has no list. */
function deepTaskList(title, lang) {
  return (parseDeepTaskList(title) || [])
    .map(l => { const t = DEEP_TASKS.find(x => x.label.toLowerCase() === l.toLowerCase()); return t ? deepTaskName(t, lang) : l })
    .join(', ')
}

function toDateStr(d) {
  return d.toISOString().split('T')[0]
}

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return toDateStr(d)
}

function ProgressBar({ pct, height = 10, style }) {
  const safe = Math.min(100, Math.max(0, pct))
  return (
    <div style={{ height, background: 'var(--surface2)', borderRadius: height / 2, overflow: 'hidden', ...style }}>
      <div style={{
        height: '100%', width: `${safe}%`,
        background: safe >= 100 ? '#4ade80' : 'linear-gradient(90deg,#60a5fa,#4ade80)',
        borderRadius: height / 2, transition: 'width 0.35s ease',
      }} />
    </div>
  )
}

export default function Jobs() {
  const [searchParams] = useSearchParams()
  const searchId = searchParams.get('search')
  const { lang, t, tr } = useLang()
  const jt = t.jobs
  const st = t.status
  const CLEANING_TYPES = cleaningTypesForLang(lang)
  const [tab, setTab] = useState(() => searchId ? 'list' : searchParams.get('tab') === 'locations' ? 'locations' : 'agenda')
  const [cleaningFilter, setCleaningFilter] = useState('all')
  const [period, setPeriod] = useState('7d')
  const [customRange, setCustomRange] = useState(() => ({ from: shiftDate(tokyoToday(), -6), to: tokyoToday() }))
  const [people, setPeople] = useState(() => new Set())
  const [jobs, setJobs] = useState([])
  const [employees, setEmployees] = useState([])
  const [clients, setClients] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [geocoding, setGeocoding] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [spotContracts, setSpotContracts] = useState([])
  const [sellers, setSellers] = useState({ salespeople: [], rules: [] })

  useEffect(() => { loadAll(); fetchContractSellers().then(setSellers) }, [])
  useEffect(() => {
    if (!searchId) return
    const selected = jobs.find(job => job.id === searchId)
    if (selected) setTab(selected.job_category === 'spot' ? 'spot' : 'list')
  }, [searchId, jobs])

  const loadAll = async () => {
    setLoading(true)
    const [j, e, c, l, scs] = await Promise.all([
      supabase.from('jobs').select('*').order('scheduled_date', { ascending: false }),
      supabase.from('employees').select('id,full_name,salary_type,hourly_rate,fixed_salary').eq('is_active', true),
      supabase.from('clients').select('id,company_name,address,contact_person,contact_name,phone,manager_name,manager_phone').eq('is_active', true),
      supabase.from('locations').select('*').eq('is_active', true).order('name'),
      supabase.from('service_contracts').select('*').eq('is_active', true),
    ])
    // Table added in v1.0.21; ignore errors so Jobs still loads if it is missing.
    const sc = await supabase.from('spot_contracts').select('id,job_id,contract_number,status').eq('is_active', true)
    setSpotContracts(sc.error ? [] : (sc.data || []))
    setJobs(j.data || [])
    setEmployees(e.data || [])
    setClients(c.data || [])
    setLocations(buildPlaces(l.data || [], scs.data || []))
    setLoading(false)
  }

  const statusColor = s => ({ assigned:'badge-blue', in_progress:'badge-amber', completed:'badge-green', cancelled:'badge-red' }[s] || 'badge-navy')
  const spotStatusColor = s => ({ pending:'badge-amber', accepted:'badge-green', declined:'badge-red' }[s] || 'badge-navy')

  const handleCleaningTypeChange = async (job, type) => {
    const loc = locationNameFromTitle(job.title)
    const newTitle = applyCleaningTypeToTitle(loc, type)
    const { error } = await supabase.from('jobs').update({ title: newTitle }).eq('id', job.id)
    if (error) return toast.error(error.message)
    toast.success(type === 'deep' ? jt.deep : jt.simple)
    loadAll()
  }

  const handleCancel = async (id) => {
    await supabase.from('jobs').update({ status: 'cancelled' }).eq('id', id)
    loadAll()
  }

  const matchingJobs = searchId ? jobs.filter(j => j.id === searchId) : jobs
  const spotJobs = matchingJobs.filter(j => j.job_category === 'spot')
  const allRegularJobs = matchingJobs.filter(j => j.job_category !== 'spot')
  // Period + people filters (skipped when opening one job from search).
  const range = searchId ? null : periodRange(period, tokyoToday(), customRange)
  const prevRange = previousRange(range)
  const peopleOptions = (() => {
    const seen = new Map()
    for (const j of allRegularJobs) if (!seen.has(j.employee_id || '')) seen.set(j.employee_id || '', j.employee_name || '')
    for (const e of employees) if (seen.has(e.id)) seen.set(e.id, e.full_name)
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => (!a.id) - (!b.id) || a.name.localeCompare(b.name))
  })()
  const byPeople = j => searchId || matchesPeople(j, people)
  const regularJobs = allRegularJobs.filter(j => inRange(j, range) && byPeople(j))
  const prevRegularJobs = prevRange ? allRegularJobs.filter(j => inRange(j, prevRange) && byPeople(j)) : []
  const basicJobs = regularJobs.filter(j => getCleaningType(j) === 'basic')
  const deepJobs = regularJobs.filter(j => getCleaningType(j) === 'deep')
  const filteredJobs = cleaningFilter === 'basic' ? basicJobs : cleaningFilter === 'deep' ? deepJobs : regularJobs
  const prevFilteredJobs = prevRegularJobs.filter(j => cleaningFilter === 'all' || getCleaningType(j) === cleaningFilter)
  const periodSummary = summarize(filteredJobs)
  const prevSummary = prevRange ? summarize(prevFilteredJobs) : null
  const personRows = summarizeByPerson(filteredJobs, prevFilteredJobs)
  const dayTotals = {}
  for (const j of filteredJobs) {
    const d = (dayTotals[j.scheduled_date] ||= { n: 0, min: 0 })
    d.n++
    d.min += jobDurationMin(j) || 0
  }
  const listCompleted = filteredJobs.filter(j => j.status === 'completed').length
  const listPct = filteredJobs.length ? Math.round((listCompleted / filteredJobs.length) * 100) : 0

  return (
    <div>
      <div className="tab-pills">
        <button className={`tab-pill${tab==='agenda'?' active':''}`} onClick={()=>setTab('agenda')}>📅 {tr('Day agenda', '本日の予定', 'Agenda do Dia')}</button>
        <button className={`tab-pill${tab==='list'?' active':''}`} onClick={()=>setTab('list')}>{jt.allJobs}</button>
        <button className={`tab-pill${tab==='spot'?' active':''}`} onClick={()=>setTab('spot')}>
          ⚡ {jt.spotJobs} {spotJobs.filter(j=>j.spot_status==='pending').length > 0 && <span className="badge badge-amber" style={{marginLeft:4}}>{spotJobs.filter(j=>j.spot_status==='pending').length}</span>}
        </button>
        <button className={`tab-pill${tab==='new'?' active':''}`} onClick={()=>setTab('new')}>+ {jt.newJob}</button>
        <button className={`tab-pill${tab==='locations'?' active':''}`} onClick={()=>setTab('locations')}>📍 {jt.locations}</button>
      </div>

      {tab==='agenda' && <DayAgenda onChanged={loadAll} />}

      {tab==='list' && (
        <div>
          {!searchId && (
            <JobsPeriodPanel
              period={period} setPeriod={setPeriod}
              custom={customRange} setCustom={setCustomRange}
              range={range} prevRange={prevRange}
              people={people} setPeople={setPeople} peopleOptions={peopleOptions}
              summary={periodSummary} prevSummary={prevSummary} byPerson={personRows}
            />
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {[
              { key: 'all', label: jt.filterAll, count: regularJobs.length, color: 'var(--navy)' },
              { key: 'basic', label: jt.filterBasic, count: basicJobs.length, color: CLEANING_TYPES.basic.color },
              { key: 'deep', label: jt.filterDeep, count: deepJobs.length, color: CLEANING_TYPES.deep.color },
            ].map(f => (
              <button key={f.key} type="button" onClick={() => setCleaningFilter(f.key)}
                style={{
                  padding: '10px 18px', borderRadius: 10, border: '2px solid',
                  borderColor: cleaningFilter === f.key ? f.color : 'var(--border)',
                  background: cleaningFilter === f.key ? `${f.color}18` : 'var(--surface)',
                  color: cleaningFilter === f.key ? f.color : 'var(--text2)',
                  fontWeight: 700, fontSize: 14, cursor: 'pointer',
                }}>
                {f.label} <span style={{ opacity: 0.85 }}>({f.count})</span>
              </button>
            ))}
          </div>

          {!loading && filteredJobs.length > 0 && (
            <div style={{
              marginBottom: 16, padding: '14px 16px', background: 'var(--surface)',
              borderRadius: 12, border: '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{jt.checkingProgress}</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: listPct >= 100 ? '#4ade80' : '#60a5fa' }}>
                  {fill(jt.progressSummary, { done: listCompleted, total: filteredJobs.length, pct: listPct })}
                </div>
              </div>
              <ProgressBar pct={listPct} height={10} />
            </div>
          )}

          {loading && <div style={{color:'var(--text3)',fontSize:13}}>{t.app.loading}</div>}
          {filteredJobs.length === 0 && !loading && (
            <div className="card">
              <div style={{color:'var(--text3)',fontSize:13}}>
                {cleaningFilter === 'all' ? jt.noJobs : fill(jt.noJobsFilter, { type: cleaningFilter === 'deep' ? jt.deep : jt.simple })}
              </div>
            </div>
          )}
          {filteredJobs.map((j, idx) => {
            const ctype = getCleaningType(j)
            const ctypeCfg = CLEANING_TYPES[ctype]
            const locName = locationNameFromTitle(j.title)
            const dur = jobDurationMin(j)
            const startEnd = fmtStartEnd(j)
            const newDay = j.scheduled_date !== filteredJobs[idx - 1]?.scheduled_date
            const dayInfo = dayTotals[j.scheduled_date]
            return (
            <div key={j.id}>
            {newDay && j.scheduled_date && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, margin: '14px 2px 8px', fontSize: 13, color: 'var(--text2)' }}>
                <span style={{ fontWeight: 800, color: 'var(--text)' }}>
                  {new Date(j.scheduled_date + 'T12:00:00').toLocaleDateString(localeOf(lang), { weekday: 'short', day: 'numeric', month: 'short' })}
                </span>
                <span>{fill(jt.jobsWithJobs, { n: dayInfo.n })}{dayInfo.min > 0 && ` · ⏱ ${fmtMinutes(dayInfo.min)}`}</span>
              </div>
            )}
            <div className="card" style={{ marginBottom: 12, borderLeft: `4px solid ${ctypeCfg.color}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>{locName}</div>
                    <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: `${ctypeCfg.color}20`, color: ctypeCfg.color, border: `1px solid ${ctypeCfg.color}50` }}>
                      {ctype === 'deep' ? jt.filterDeep : jt.filterBasic}
                    </span>
                  </div>
                  {ctype === 'deep' && deepTaskList(j.title, lang) && (
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#b7791f', marginBottom: 4 }}>✨ {deepTaskList(j.title, lang)}</div>
                  )}
                  <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 6 }}>
                    👤 {j.employee_name || '—'} · 📅 {j.scheduled_date} · 🕐 {j.scheduled_time || '—'}
                  </div>
                  {(dur != null || startEnd) && (
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
                      ⏱ {dur != null ? fmtMinutes(dur) : st.in_progress || '…'}
                      {startEnd && <span style={{ fontWeight: 500, color: 'var(--text3)' }}> ({startEnd})</span>}
                    </div>
                  )}
                  {j.address && (
                    <div style={{ fontSize: 12, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {j.address.startsWith('http') ? `🗺 ${jt.maps}` : j.address}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                  {isMissedJob(j)
                    ? <span className="badge badge-red">{jt.incomplete}</span>
                    : <span className={`badge ${statusColor(j.status)}`}>{st[j.status] || j.status}</span>}
                  {isRetroJob(j) && <span className="badge badge-amber" title={jt.retroBadgeHint}>{jt.retroBadge}</span>}
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--green)' }}>¥{Number(j.value || j.spot_value || 0).toLocaleString()}</span>
                </div>
              </div>

              {j.description && (
                <KeyReveal value={j.description.split('\n')[0]} style={{ fontSize: 12, color: 'var(--text2)', background: 'var(--surface2)', borderRadius: 8, padding: '8px 10px', marginBottom: 10, lineHeight: 1.5 }} />
              )}

              {j.status === 'completed' && (j.photo_start_url || j.photo_end_url) && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>{jt.servicePhotos}</div>
                  <JobPhotos
                    photoStartUrl={j.photo_start_url}
                    photoEndUrl={j.photo_end_url}
                    beforeLabel={jt.before}
                    afterLabel={jt.after}
                    variant="full"
                    onPhotoClick={setLightbox}
                  />
                  <JobVideos jobId={j.id} lazy style={{ marginTop: 8 }} />
                </div>
              )}

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <label style={{ fontSize: 12, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {jt.type}:
                  <select
                    value={ctype}
                    onChange={e => handleCleaningTypeChange(j, e.target.value)}
                    style={{ fontSize: 13, fontWeight: 600, padding: '6px 10px', borderRadius: 8, border: `2px solid ${ctypeCfg.color}`, background: `${ctypeCfg.color}15`, color: ctypeCfg.color }}
                  >
                    <option value="basic">{jt.filterBasic}</option>
                    <option value="deep">{jt.filterDeep}</option>
                  </select>
                </label>
                {j.photo_required && <span className="badge badge-amber">📷 {jt.photoRequired}</span>}
                {j.gps_lat && <span className="badge badge-navy">📍 GPS</span>}
                {hasMapsLink(j.address, locName) && (
                  <a href={mapsOpenUrl(j.address, locName)} target="_blank" rel="noreferrer" className="btn btn-sm">🗺 {jt.maps}</a>
                )}
                {j.status === 'assigned' && <button className="btn btn-sm btn-danger" onClick={() => handleCancel(j.id)}>{jt.cancel}</button>}
              </div>
            </div>
            </div>
          )})}
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
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:8}}>
                {(() => { const c = spotContracts.find(x => x.job_id === j.id); return c
                  ? <Link className="btn btn-sm" to={`/contracts?spot=${c.id}`}>📄 {c.contract_number} · {({ draft:'awaiting approval', approved:'approved ✓', rejected:'not approved', cancelled:'cancelled' })[contractStatus(c)]}</Link>
                  : <button className="btn btn-sm btn-primary" onClick={async()=>{ try { const { contract, invoiceError } = await generateContractForJob(j); toast.success(`📄 ${contract.contract_number}`); if (invoiceError) toast.error(invoiceError.message); loadAll() } catch (err) { toast.error(err.message) } }}>📄 Generate contract</button> })()}
                <a className="btn btn-sm" href={googleCalendarUrl(j)} target="_blank" rel="noreferrer">📅 Google Calendar</a>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab==='new' && (
        <NewJobForm
          jobs={jobs} employees={employees} clients={clients} locations={locations} sellers={sellers}
          onCreated={({ another }) => { loadAll(); if (!another) setTab('list') }}
        />
      )}

      {tab==='locations' && <LocationsTab />}

      <PhotoLightbox url={lightbox} onClose={() => setLightbox(null)} closeLabel={t.reports?.close || 'Close'} />
    </div>
  )
}

function LocationsTab() {
  const { t, tr } = useLang()
  const jt = t.jobs
  const EMPTY_LOC = { name:'', address:'', location_type:'fixed', notes:'', client_id:'', area:'', key_box:'', checklist:'' }
  const clientFromUrl = new URLSearchParams(window.location.search).get('client') || ''
  const [locations, setLocations] = useState([])
  const [contracts, setContracts] = useState([])
  const [clients, setClients] = useState([])
  const [editingLoc, setEditingLoc] = useState(null)
  const [form, setForm] = useState(() => ({ ...EMPTY_LOC, client_id: clientFromUrl }))
  const [errors, setErrors] = useState({})
  const [geocoding, setGeocoding] = useState(false)
  const [gps, setGps] = useState(null)

  useEffect(() => { load() }, [])

  const load = async () => {
    const [l, sc, c] = await Promise.all([
      supabase.from('locations').select('*').order('name'),
      supabase.from('service_contracts').select('*').eq('is_active', true),
      supabase.from('clients').select('id,company_name').eq('is_active', true).order('company_name'),
    ])
    setLocations(l.data || [])
    setContracts(sc.data || [])
    setClients(c.data || [])
  }
  // Columns added by the v1.0.96 SQL (checklist, key box, area on the place itself).
  const hasPlaceCols = locations.some(l => 'checklist' in l)
  const places = buildPlaces(locations.filter(l => l.is_active), contracts)
  const clientName = id => clients.find(c => c.id === id)?.company_name || ''

  const upd = (k,v) => { setForm(f=>({...f,[k]:v})); setErrors(e => ({ ...e, [k]: null })) }

  const handleGeocode = async () => {
    if (!form.address) { setErrors(e => ({ ...e, address: jt.enterAddressFirst })); return }
    setGeocoding(true)
    const result = await geocodeAddress(form.address)
    setGeocoding(false)
    if (!applyGeocodeResult(result, setGps, jt.mapsValid)) setErrors(e => ({ ...e, address: t.jobs.addressNotFound }))
  }

  const payload = () => {
    const row = { name: form.name.trim(), address: form.address.trim(), location_type: form.location_type, notes: form.notes, client_id: form.client_id || null, gps_lat: gps?.lat ?? null, gps_lng: gps?.lng ?? null }
    if (hasPlaceCols) Object.assign(row, { area: form.area || null, key_box: form.key_box || null, checklist: splitChecklist(form.checklist).join('\n') || null })
    return row
  }
  const validate = () => {
    const e = {}
    if (!form.name.trim()) e.name = tr('Name is required', '名前は必須です', 'Nome é obrigatório')
    if (!form.address.trim()) e.address = tr('Address or Google Maps link is required', '住所またはGoogleマップのリンクが必要です', 'Endereço ou link do Google Maps é obrigatório')
    const dup = locations.find(l => l.is_active && l.id !== editingLoc && l.name.trim().toLowerCase() === form.name.trim().toLowerCase())
    if (dup) e.name = tr('A place with this name already exists', '同じ名前の場所があります', 'Já existe um local com este nome')
    setErrors(e)
    return !Object.keys(e).length
  }

  const handleSave = async () => {
    if (!validate()) return
    const { error } = editingLoc
      ? await supabase.from('locations').update(payload()).eq('id', editingLoc)
      : await supabase.from('locations').insert(payload())
    if (error) return toast.error(error.message)
    toast.success(editingLoc ? tr('Place updated', '更新しました', 'Local atualizado') : tr('Place saved', '保存しました', 'Local salvo'))
    setEditingLoc(null); setForm(EMPTY_LOC); setGps(null); load()
  }

  const handleEditLoc = (l) => {
    if (l.fromContract) {
      // Store that only exists in Contracts: open the form prefilled to save it as a place.
      setEditingLoc(null)
      setForm({ ...EMPTY_LOC, name: l.name, address: l.address || '', client_id: l.client_id || '', area: l.area || '' })
      setGps(null)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setEditingLoc(l.id)
    setForm({ ...EMPTY_LOC, name:l.name||'', address:l.address||'', location_type:l.location_type||'fixed', notes:l.notes||'', client_id:l.client_id||'', area:l.area||'', key_box:l.key_box||'', checklist:l.checklist||'' })
    setGps(l.gps_lat&&l.gps_lng?{lat:l.gps_lat,lng:l.gps_lng}:null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDelete = (l) => confirmAndRun({
    title: tr('Remove place?', '場所を削除しますか？', 'Remover local?'),
    message: `${l.name}${l.contracts.length ? `\n${tr('Its contracts stay in Contracts.', '契約は契約画面に残ります。', 'Os contratos dele continuam em Contratos.')}` : ''}`,
    confirmLabel: tr('Remove', '削除', 'Remover'),
    success: tr('Place removed', '削除しました', 'Local removido'),
    run: () => supabase.from('locations').update({ is_active: false }).eq('id', l.id),
  }).then(ok => ok && load())

  const fieldErr = k => errors[k] && <div className="ag-field-error">{errors[k]}</div>

  return (
    <div>
      <SetupChain current="place" clientId={form.client_id || null} />
      <div className="card" style={{marginBottom:14}}>
        <div className="card-title">{editingLoc ? tr('Edit place', '場所を編集', 'Editar local') : tr('New place', '新しい場所', 'Novo local')}</div>
        <div style={{fontSize:12,color:'var(--text3)',marginBottom:10}}>{tr('One registry for Jobs, Contracts, Generator and World. Value and checklist of each job come from the place\'s contract.', 'Jobs・契約・スケジュール・ワールド共通の登録です。作業の金額とチェックリストは場所の契約から入ります。', 'Cadastro único para Jobs, Contratos, Gerador e Mundo. Valor e checklist de cada job vêm do contrato do local.')}</div>
        <div className="grid-2">
          <div className="form-group"><label>{tr('Name', '名前', 'Nome')} *</label><input className={errors.name?'ag-invalid':''} value={form.name} onChange={e=>upd('name',e.target.value)} placeholder="Hotel Grand" />{fieldErr('name')}</div>
          <div className="form-group"><label>{tr('Client', '顧客', 'Cliente')}</label>
            <select value={form.client_id} onChange={e=>upd('client_id',e.target.value)}>
              <option value="">—</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label>{t.jobs.addressLabel} *</label>
          <div style={{display:'flex',gap:8}}>
            <input className={errors.address?'ag-invalid':''} value={form.address} onChange={e=>upd('address',e.target.value)} placeholder={t.jobs.addressPlaceholder} style={{flex:1,minWidth:0}} />
            <button className="btn" onClick={handleGeocode} disabled={geocoding}>{geocoding?'...':'📍 GPS'}</button>
          </div>
          {fieldErr('address')}
          {gps && <div style={{fontSize:11,color:'var(--green)',marginTop:4}}>✓ {gps.lat.toFixed(4)}, {gps.lng.toFixed(4)}</div>}
          {!gps && isNavigableAddress(form.address) && <div style={{fontSize:11,color:'var(--green)',marginTop:4}}>✓ {jt.mapsValid}</div>}
        </div>
        <div className="grid-2">
          <div className="form-group"><label>{tr('Type', '種類', 'Tipo')}</label>
            <select value={form.location_type} onChange={e=>upd('location_type',e.target.value)}>
              <option value="fixed">{tr('Fixed (recurring)', '定期', 'Fixo (recorrente)')}</option>
              <option value="spot">{tr('Spot (one-time)', 'スポット', 'Spot (avulso)')}</option>
            </select>
          </div>
          {hasPlaceCols
            ? <div className="form-group"><label>🔑 Key box</label><input value={form.key_box} onChange={e=>upd('key_box',e.target.value)} placeholder="0315" /></div>
            : <div className="form-group"><label>{jt.keyboxNotes}</label><input value={form.notes} onChange={e=>upd('notes',e.target.value)} placeholder="Key box: 0315" /></div>}
        </div>
        {hasPlaceCols && (
          <div className="form-group"><label>{tr('Checklist (one item per line)', 'チェックリスト（1行1項目）', 'Checklist (um item por linha)')}</label>
            <textarea rows={4} value={form.checklist} onChange={e=>upd('checklist',e.target.value)} />
            {splitChecklist(form.checklist).length > 0 && <small style={{color:'var(--text3)'}}>{splitChecklist(form.checklist).length} {tr('items', '項目', 'itens')}</small>}
          </div>
        )}
        <button className="btn btn-primary" onClick={handleSave}>{editingLoc ? jt.updateLocation : jt.saveLocation}</button>
        {(editingLoc || form.name) && <button className="btn" style={{ marginLeft: 8 }} onClick={() => { setEditingLoc(null); setForm(EMPTY_LOC); setErrors({}); setGps(null) }}>{jt.cancelEdit}</button>}
      </div>

      <div className="card">
        <div className="card-title">{tr('Places', '場所', 'Locais')} ({places.length})</div>
        <div style={{display:'grid',gap:8}}>
          {places.map(l => (
            <div key={l.id} style={{display:'flex',gap:10,alignItems:'flex-start',flexWrap:'wrap',padding:'10px 12px',border:'1px solid var(--border)',borderRadius:10,background:l.fromContract?'rgba(245,158,11,0.06)':'var(--surface)'}}>
              <div style={{flex:'1 1 220px',minWidth:0}}>
                <div style={{fontWeight:700}}>{l.name} {l.client_id && <span style={{fontWeight:400,color:'var(--text3)',fontSize:12}}>· {clientName(l.client_id)}</span>}</div>
                <div style={{fontSize:12,color:'var(--text2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.address || '—'}</div>
                <div style={{fontSize:12,color:'var(--text3)',marginTop:4}}>
                  📄 {l.contracts.length ? l.contracts.map(c => `${c.location_name}${c.price_per_visit ? ` ¥${Number(c.price_per_visit).toLocaleString()}` : ''}`).join(' · ') : tr('No contract yet', '契約なし', 'Sem contrato ainda')}
                </div>
                {l.fromContract && <div style={{fontSize:12,color:'#b45309',fontWeight:700,marginTop:4}}>⚠️ {tr('Only in Contracts — save it as a place', '契約にのみ存在 — 場所として保存してください', 'Só existe em Contratos — salve como local')}</div>}
              </div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {l.gps_lat ? <span className="badge badge-navy">GPS ✓</span> : hasMapsLink(l.address, l.name) ? <span className="badge badge-green">🗺</span> : null}
                <Link className="btn btn-sm" to={`/contracts${l.client_id ? `?client=${l.client_id}` : ''}`}>{l.contracts.length ? tr('Contracts', '契約', 'Contratos') : `+ ${tr('Contract', '契約', 'Contrato')}`}</Link>
                <button className="btn btn-sm btn-primary" onClick={()=>handleEditLoc(l)}>{l.fromContract ? tr('Save as place', '場所として保存', 'Salvar como local') : '✏️'}</button>
                {!l.fromContract && <button className="btn btn-sm btn-danger" onClick={()=>handleDelete(l)} aria-label={tr('Remove', '削除', 'Remover')}>✕</button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
