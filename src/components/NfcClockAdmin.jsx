import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { normalizeTagUid, nfcSupported, readOneTag, nfcActiveFor, tagPlace } from '../lib/nfcClock'

const STATUS = {
  ok: '✅ Right sticker',
  other_place: '⚠️ Another place\'s sticker',
  unknown: '⚠️ Unregistered sticker',
  skipped: '⏭ Skipped (no sticker)',
  no_device: '📵 Phone without NFC',
}
const section = { fontSize: 12, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }
const muted = { fontSize: 12, color: 'var(--text3)' }

/** Admin → Employees → NFC clock: global switch, per-worker override, sticker registry, recent reads. */
export default function NfcClockAdmin({ employees }) {
  const [ready, setReady] = useState(null) // null loading · false tables missing · true
  const [enabled, setEnabled] = useState(false)
  const [tags, setTags] = useState([])
  const [places, setPlaces] = useState([])
  const [overrides, setOverrides] = useState({})
  const [recent, setRecent] = useState([])
  const [form, setForm] = useState({ uid: '', place: '', label: '' })
  const [reading, setReading] = useState(null)

  const load = async () => {
    const s = await supabase.from('nfc_settings').select('enabled').eq('id', 1).maybeSingle()
    if (s.error) { setReady(false); return }
    setReady(true)
    setEnabled(Boolean(s.data?.enabled))
    const [t, c, cl, emp, jobs] = await Promise.all([
      supabase.from('nfc_tags').select('*').order('created_at', { ascending: false }),
      supabase.from('service_contracts').select('location_name,client_id').eq('is_active', true),
      supabase.from('clients').select('id,company_name'),
      supabase.from('employees').select('id,nfc_clock'),
      supabase.from('jobs').select('id,title,employee_name,scheduled_date,nfc_start_status,nfc_end_status')
        .not('nfc_start_status', 'is', null).order('scheduled_date', { ascending: false }).limit(30),
    ])
    setTags(t.data || [])
    const clientName = Object.fromEntries((cl.data || []).map(x => [x.id, x.company_name]))
    const seen = new Set()
    setPlaces((c.data || []).filter(r => r.location_name && !seen.has(r.location_name) && seen.add(r.location_name))
      .map(r => ({ location_name: r.location_name, client_id: r.client_id, client_name: clientName[r.client_id] || '' }))
      .sort((a, b) => a.location_name.localeCompare(b.location_name)))
    setOverrides(Object.fromEntries((emp.data || []).map(e => [e.id, e.nfc_clock || ''])))
    setRecent(jobs.data || [])
  }
  useEffect(() => { load() }, [])

  const toggleGlobal = async (on) => {
    const { error } = await supabase.from('nfc_settings').upsert({ id: 1, enabled: on, updated_at: new Date().toISOString() })
    if (error) return toast.error(error.message)
    setEnabled(on)
    toast.success(on ? 'NFC clock on for everyone (except workers set to Off)' : 'NFC clock off (except workers set to On)')
  }

  const setOverride = async (id, value) => {
    const { error } = await supabase.from('employees').update({ nfc_clock: value || null }).eq('id', id)
    if (error) return toast.error(error.message)
    setOverrides(o => ({ ...o, [id]: value }))
  }

  const readSticker = () => {
    const r = readOneTag()
    setReading(r)
    r.promise.then(uid => { setForm(f => ({ ...f, uid })); toast.success('Sticker read: ' + uid) })
      .catch(err => { if (err?.message !== 'cancelled') toast.error('Could not read the sticker') })
      .finally(() => setReading(null))
  }

  const addTag = async () => {
    const uid = normalizeTagUid(form.uid)
    if (!uid) return toast.error('Type or read the sticker ID')
    const place = places.find(p => p.location_name === form.place)
    if (!place) return toast.error('Choose the location')
    const { error } = await supabase.from('nfc_tags').insert({
      tag_uid: uid, label: form.label.trim() || null,
      location_name: place.location_name, client_id: place.client_id || null, client_name: place.client_name || null,
    })
    if (error) return toast.error(error.code === '23505' ? 'This sticker is already registered' : error.message)
    setForm({ uid: '', place: '', label: '' })
    toast.success('Sticker registered')
    load()
  }

  const setTagActive = async (tag, on) => {
    const { error } = await supabase.from('nfc_tags').update({ is_active: on }).eq('id', tag.id)
    if (error) return toast.error(error.message)
    setTags(ts => ts.map(t => t.id === tag.id ? { ...t, is_active: on } : t))
  }

  const removeTag = async (tag) => {
    if (!window.confirm(`Remove sticker ${tag.tag_uid}?`)) return
    const { error } = await supabase.from('nfc_tags').delete().eq('id', tag.id)
    if (error) return toast.error(error.message)
    setTags(ts => ts.filter(t => t.id !== tag.id))
  }

  if (ready === null) return <div style={muted}>Loading...</div>
  if (ready === false) return (
    <div className="card">
      <div className="card-title">📶 NFC clock</div>
      <div style={{ fontSize: 13 }}>The database tables for NFC are not created yet. Run <code>sql/2026-10-11_ponto_nfc.sql</code> in Supabase. Until then everyone keeps starting and finishing with the normal button.</div>
    </div>
  )

  const active = (employees || []).filter(e => e.is_active !== false)
  return (
    <div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-title">📶 NFC clock</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
          <input type="checkbox" checked={enabled} onChange={e => toggleGlobal(e.target.checked)} style={{ width: 18, height: 18 }} />
          Ask for the NFC sticker to start and finish every job
        </label>
        <div style={{ ...muted, marginTop: 8, lineHeight: 1.5 }}>
          When on, pressing Start or Finish opens “tap the sticker”. Works on Android phones with Chrome.
          iPhones cannot read NFC in the browser, so they keep the normal button and the job is marked “Phone without NFC”.
          The worker can always continue without the sticker; it is noted on the job.
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={section}>Stickers ({tags.length})</div>
        <div className="grid-2">
          <div className="form-group">
            <label>Sticker ID</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={form.uid} onChange={e => setForm(f => ({ ...f, uid: e.target.value }))} placeholder="04:A2:5F:1B:3C:80:00" style={{ flex: 1, minWidth: 0 }} />
              {nfcSupported() && (reading
                ? <button className="btn btn-sm" type="button" onClick={() => reading.cancel()}>Stop</button>
                : <button className="btn btn-sm" type="button" onClick={readSticker}>📶 Read</button>)}
            </div>
            {reading && <div style={{ ...muted, marginTop: 4 }}>Hold the phone on the sticker…</div>}
          </div>
          <div className="form-group">
            <label>Location</label>
            <select value={form.place} onChange={e => setForm(f => ({ ...f, place: e.target.value }))}>
              <option value="">Select...</option>
              {places.map(p => <option key={p.location_name} value={p.location_name}>{p.location_name}{p.client_name ? ` — ${p.client_name}` : ''}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ gridColumn: '1/-1' }}>
            <label>Note (optional)</label>
            <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. back door, next to the switch" />
          </div>
        </div>
        <button className="btn btn-primary" onClick={addTag}>+ Register sticker</button>
        {!nfcSupported() && <div style={{ ...muted, marginTop: 8 }}>Tip: open this page on an Android phone with Chrome to read the sticker ID with the 📶 Read button.</div>}

        {tags.length > 0 && <div style={{ marginTop: 14 }}>
          {tags.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{tagPlace(t)}</div>
                <div style={muted}>
                  <code>{t.tag_uid}</code>{t.label ? ` · ${t.label}` : ''} · {t.last_seen_at ? `last read ${new Date(t.last_seen_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}` : 'never read'}
                </div>
              </div>
              <button className="btn btn-sm" onClick={() => setTagActive(t, !t.is_active)}>{t.is_active ? 'Active' : 'Off'}</button>
              <button className="btn btn-sm" onClick={() => removeTag(t)}>🗑️</button>
            </div>
          ))}
        </div>}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={section}>Per worker</div>
        {active.map(e => {
          const v = overrides[e.id] || ''
          const on = nfcActiveFor(v || null, enabled)
          return (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ flex: 1, fontSize: 14 }}>{e.full_name}</div>
              <span className={`badge ${on ? 'badge-green' : ''}`} style={{ fontSize: 11 }}>{on ? 'NFC' : 'Button'}</span>
              <select value={v} onChange={ev => setOverride(e.id, ev.target.value)} style={{ width: 'auto' }}>
                <option value="">Follow switch</option>
                <option value="on">Always NFC</option>
                <option value="off">Never NFC</option>
              </select>
            </div>
          )
        })}
      </div>

      <div className="card">
        <div style={section}>Recent NFC records</div>
        {recent.length === 0 && <div style={muted}>Nothing yet.</div>}
        {recent.map(j => (
          <div key={j.id} style={{ padding: '8px 0', borderTop: '1px solid var(--border)', fontSize: 13 }}>
            <div style={{ fontWeight: 600 }}>{(j.title || '').split(' —')[0]} <span style={muted}>· {j.employee_name} · {j.scheduled_date}</span></div>
            <div style={muted}>Start: {STATUS[j.nfc_start_status] || j.nfc_start_status} · Finish: {STATUS[j.nfc_end_status] || j.nfc_end_status || '—'}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
