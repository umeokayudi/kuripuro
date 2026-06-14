import { useState } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

const EMPLOYEES = {
  bemnet: { id: '417d0c0c-6de0-4f1e-978b-0fca021d7026', name: 'Bemnet Leykun Berhanu' },
  gabriel: { id: 'afb5bd34-3b46-4e6c-acf9-ae3feb4dfced', name: 'Gabriel Guerra' },
  solomon: { id: '0f605ec2-e956-4d6b-8a23-560d103b7c51', name: 'Solomon' },
}

const CLIENTS = {
  ontheplanet: { id: '7138f082-0d38-43e4-bd77-00c4598690b3', name: 'On The Planet' },
  atomicbar: { id: 'bf3f7ab5-24c4-4ec1-b25f-d91becb166de', name: 'Atomic Bar' },
}

const RESTAURANTS = [
  { name: 'Ibushio', address: 'https://maps.app.goo.gl/xxDzKRfpJYpk2XtW6', notes: 'Key box: 0315', price: 50000/26, days: [1,2,3,4,5,6], deepClean: 7000 },
  { name: 'Nyu Ibushio', address: 'https://maps.app.goo.gl/ZXqfCc5MNn1aicPHA', notes: 'Key box: 0625', price: 50000/26, days: [1,2,3,4,5,6], deepClean: 5000 },
  { name: 'Horumon no Manmosu', address: 'https://maps.app.goo.gl/r12jwNF7RpEFZTtA8', notes: 'Key box: 4840', price: 50000/26, days: [1,2,3,4,5,6], deepClean: 5000 },
  { name: 'Yakiniku Otoko Manmosu', address: 'https://maps.app.goo.gl/n8YnpXDyQXmuefJK7', notes: 'Key box: 0601', price: 50000/26, days: [1,2,3,4,5,6], deepClean: 5000 },
  { name: 'Nyu Sakana Yakio', address: 'https://maps.app.goo.gl/ig73pcZ4Gxff4kjU6', notes: 'Key box B1: 1209 | Shutter: 549 | Black: 5493', price: 120000/30, days: [0,1,2,3,4,5,6], deepClean: 5000 },
  { name: 'Kodama Shinbashi', address: 'https://maps.app.goo.gl/SFPkHjrQkJ3ie6x57', notes: 'Key box: 0606', price: 120000/30, days: [0,1,2,3,4,5,6], deepClean: 5000 },
  { name: 'Kodama Kinshicho', address: 'https://maps.app.goo.gl/HseQiawXKs32KzNz7', notes: 'Key box: 5493', price: 120000/30, days: [0,1,2,3,4,5,6], deepClean: 5000 },
  { name: 'Kodama Oimachi', address: 'https://maps.app.goo.gl/WZH9grtQtnPBvb9A6', notes: 'Key box: 3110', price: 100000/26, days: [1,2,3,4,5,6], deepClean: 5000 },
  { name: 'Sakana Yakio Honten', address: 'https://maps.app.goo.gl/w9QHq1rX97N4J73d7', notes: 'Key box: 0919', price: 100000/26, days: [1,2,3,4,5,6], deepClean: 5000 },
  { name: 'Sakana Yakio 2', address: 'https://maps.app.goo.gl/Kxrk58ofn6465Yew8', notes: 'Key box: 0808', price: 100000/26, days: [1,2,3,4,5,6], deepClean: 5000 },
  { name: 'Tooda', address: 'https://maps.app.goo.gl/u5WefsYvHS3qi6lZ9', notes: 'Key box: 5493', price: 100000/26, days: [1,2,3,4,5,6], deepClean: 5000 },
]

// 7 days restaurants (Mon-Sun) for Bemnet Monday special
const MON_ONLY = ['Nyu Sakana Yakio', 'Kodama Shinbashi', 'Kodama Kinshicho']

export default function ScheduleGenerator() {
  const [month, setMonth] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 1)
    return d.toISOString().slice(0, 7)
  })
  const [preview, setPreview] = useState([])
  const [loading, setLoading] = useState(false)
  const [generated, setGenerated] = useState(false)
  const [includeYuraku, setIncludeYuraku] = useState(false)

  const getDaysInMonth = (yearMonth) => {
    const [year, mon] = yearMonth.split('-').map(Number)
    const days = []
    const d = new Date(year, mon - 1, 1)
    while (d.getMonth() === mon - 1) {
      days.push(new Date(d))
      d.setDate(d.getDate() + 1)
    }
    return days
  }

  const generatePreview = () => {
    const days = getDaysInMonth(month)
    const jobs = []
    let jobId = 1

    days.forEach(date => {
      const dow = date.getDay() // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
      const dateStr = date.toISOString().split('T')[0]
      const isMon = dow === 1
      const isTue = dow === 2
      const isSatSun = dow === 0 || dow === 6
      const isMonFri = dow >= 1 && dow <= 5

      // MONDAY - Bemnet: Atomic 00:30 + 3 restaurants 06:00
      if (isMon) {
        jobs.push({ id: jobId++, date: dateStr, time: '00:30', employee: 'Bemnet', client: 'Atomic Bar', title: 'Atomic Bar — Basic Cleaning', address: 'https://share.google/dGNoA7mGwHxRtZtnn', notes: 'Monday night shift', seq: 1 })
        MON_ONLY.forEach((name, i) => {
          const r = RESTAURANTS.find(r => r.name === name)
          jobs.push({ id: jobId++, date: dateStr, time: '06:00', employee: 'Bemnet', client: 'On The Planet', title: `${name} — Basic Cleaning`, address: r.address, notes: r.notes, seq: i + 2 })
        })

        // Solomon - Deep Clean every Tuesday
        if (isTue) {
        const solomonRests = [...RESTAURANTS]
        if (includeYuraku) solomonRests.push({ name: 'Kodama Yurakucho', address: '', notes: 'Key box: TBD', deepClean: 7000 })
        solomonRests.forEach((r, i) => {
          jobs.push({ id: jobId++, date: dateStr, time: '00:30', employee: 'Solomon', client: 'On The Planet', title: `${r.name} — Deep Clean`, address: r.address || '', notes: r.notes || '', seq: i + 1, description: `Range Hood + AC + Grating + Grease Trap${r.deepClean === 7000 ? ' x2' : ''} | ¥${r.deepClean?.toLocaleString()}` })
        })
        } // end solomon tuesday
      }

      // TUE-FRI - Bemnet: all 11 restaurants
      if (isMonFri && !isMon) {
        RESTAURANTS.forEach((r, i) => {
          if (r.days.includes(dow)) {
            jobs.push({ id: jobId++, date: dateStr, time: '00:30', employee: 'Bemnet', client: 'On The Planet', title: `${r.name} — Basic Cleaning`, address: r.address, notes: r.notes, seq: i + 1 })
          }
        })
      }

      // SAT-SUN - Gabriel: all 11 restaurants
      if (isSatSun) {
        RESTAURANTS.forEach((r, i) => {
          if (r.days.includes(dow)) {
            jobs.push({ id: jobId++, date: dateStr, time: '00:30', employee: 'Gabriel', client: 'On The Planet', title: `${r.name} — Basic Cleaning`, address: r.address, notes: r.notes, seq: i + 1 })
          }
        })
      }
    })

    setPreview(jobs)
    return jobs
  }

  const handleGenerate = async () => {
    setLoading(true)
    const jobs = generatePreview()

    // Check if jobs already exist for this month
    const { data: existing } = await supabase.from('jobs').select('id').gte('scheduled_date', month + '-01').lte('scheduled_date', month + '-31')
    if (existing && existing.length > 0) {
      if (!confirm(`${existing.length} jobs already exist for ${month}. Delete and regenerate?`)) {
        setLoading(false); return
      }
      await supabase.from('jobs').delete().gte('scheduled_date', month + '-01').lte('scheduled_date', month + '-31')
    }

    const empMap = { Bemnet: EMPLOYEES.bemnet, Gabriel: EMPLOYEES.gabriel, Solomon: EMPLOYEES.solomon }
    const clientMap = { 'On The Planet': CLIENTS.ontheplanet, 'Atomic Bar': CLIENTS.atomicbar }

    const rows = jobs.map(j => ({
      title: j.title,
      employee_id: empMap[j.employee].id,
      employee_name: empMap[j.employee].name,
      client_id: clientMap[j.client].id,
      client_name: j.client,
      scheduled_date: j.date,
      scheduled_time: j.time,
      status: 'assigned',
      job_category: 'regular',
      sequence_order: j.seq,
      address: j.address || null,
      description: j.description || j.notes || null,
    }))

    // Insert in batches of 50
    for (let i = 0; i < rows.length; i += 50) {
      const { error } = await supabase.from('jobs').insert(rows.slice(i, i + 50))
      if (error) { toast.error(error.message); setLoading(false); return }
    }

    toast.success(`✅ ${rows.length} jobs generated for ${month}!`)
    setGenerated(true)
    setLoading(false)
  }

  const byDate = preview.reduce((acc, j) => {
    if (!acc[j.date]) acc[j.date] = []
    acc[j.date].push(j)
    return acc
  }, {})

  const empColors = { Bemnet: '#60a5fa', Gabriel: '#4ade80', Solomon: '#fbbf24' }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">🗓 Schedule Generator</div>
        <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 16 }}>
          Auto-generates all jobs for a month based on contracts: Bemnet (Mon-Fri), Gabriel (Sat-Sun), Solomon (Deep Clean every Monday).
        </div>

        <div className="grid-2" style={{ marginBottom: 14 }}>
          <div className="form-group">
            <label>Month</label>
            <input type="month" value={month} onChange={e => { setMonth(e.target.value); setPreview([]); setGenerated(false) }} />
          </div>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 24 }}>
              <input type="checkbox" checked={includeYuraku} onChange={e => setIncludeYuraku(e.target.checked)} style={{ width: 16, height: 16 }} />
              Include Kodama Yurakucho (from July)
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={() => { generatePreview(); }}>
            👁 Preview
          </button>
          <button className="btn btn-primary" onClick={handleGenerate} disabled={loading}>
            {loading ? '⏳ Generating...' : `✅ Generate Jobs for ${month}`}
          </button>
        </div>

        {generated && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(74,222,128,0.1)', borderRadius: 10, border: '1px solid rgba(74,222,128,0.2)', color: 'var(--green)', fontSize: 13, fontWeight: 600 }}>
            ✅ Jobs generated! Go to Jobs to view them.
          </div>
        )}
      </div>

      {preview.length > 0 && (
        <div className="card">
          <div className="card-title">Preview — {preview.length} jobs</div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            {Object.entries(empColors).map(([name, color]) => (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
                <span style={{ fontSize: 12, color: 'var(--text2)' }}>{name}</span>
              </div>
            ))}
          </div>
          <div style={{ maxHeight: 500, overflowY: 'auto' }}>
            {Object.keys(byDate).sort().map(date => (
              <div key={date} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })} — {byDate[date].length} jobs
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {byDate[date].map(j => (
                    <span key={j.id} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: `${empColors[j.employee]}20`, color: empColors[j.employee], border: `1px solid ${empColors[j.employee]}40` }}>
                      {j.employee[0]} · {j.title.split(' —')[0]}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
