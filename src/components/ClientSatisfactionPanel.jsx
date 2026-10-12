import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useLang } from '../hooks/useLang'
import { groupRatingsByClient, ratingsInPeriod, avgStars, starsDisplay } from '../lib/satisfaction'

// Moved from the admin dashboard in v1.0.34: per-client satisfaction (last 30 days)
// and internal employee scores now live on the Client Feedback page.
const levelColor = l => ({ excellent: 'var(--green)', good: '#60a5fa', warning: '#EF9F27', critical: 'var(--red)', none: 'var(--text3)' }[l] || 'var(--text3)')

export default function ClientSatisfactionPanel() {
  const { t } = useLang()
  const d = t.dashboard
  const [clients, setClients] = useState([])
  const [employees, setEmployees] = useState([])
  const [ratings, setRatings] = useState([])

  useEffect(() => {
    Promise.all([
      supabase.from('clients').select('id,company_name').eq('is_active', true),
      supabase.from('employees').select('id,full_name,score').eq('is_active', true).order('full_name'),
      supabase.from('client_ratings').select('*').order('created_at', { ascending: false }).limit(500),
    ]).then(([c, e, r]) => {
      setClients(c.data || [])
      setEmployees(e.data || [])
      setRatings(r.data || [])
    })
  }, [])

  const ratings30 = ratingsInPeriod(ratings, 30)
  const overallAvg = avgStars(ratings30)
  const weeklyAvg = avgStars(ratingsInPeriod(ratings, 7))
  const byClient = groupRatingsByClient(ratings30, clients)
  const atRisk = byClient.filter(x => x.avg != null && x.avg < 3.5)

  return (
    <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #c19c56' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{d.satisfactionTitle}</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{d.satisfactionSubtitle}</div>
      </div>

      <div className="dash-sat">
        {[
          [d.avgRating, overallAvg != null ? overallAvg.toFixed(1) + ' ★' : '—'],
          [d.weeklyAvg, weeklyAvg != null ? weeklyAvg.toFixed(1) : '—'],
          [d.ratingsCount, ratings30.length],
        ].map(([l, v]) => (
          <div key={l} style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#EF9F27' }}>{v}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{l}</div>
          </div>
        ))}
      </div>

      {atRisk.length > 0 && (
        <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: 'var(--red)' }}>
          ⚠️ {d.atRiskClients}: {atRisk.map(x => x.client.company_name).join(', ')}
        </div>
      )}

      {byClient.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text3)' }}>{d.noRatingsYet}</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
          {byClient.map(({ client, avg, count, level }) => (
            <div key={client.id} style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--surface2)', border: `1px solid ${levelColor(level)}30` }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{client.company_name}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: levelColor(level) }}>{avg != null ? starsDisplay(avg) : '—'}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{count} {d.ratingsCount.toLowerCase()}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 10 }}>{d.employeeScores}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {[...employees].sort((a, b) => (b.score || 100) - (a.score || 100)).slice(0, 8).map(emp => (
            <div key={emp.id} style={{ padding: '6px 12px', borderRadius: 20, background: 'var(--surface2)', fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>{emp.full_name}</span>
              <span style={{ marginLeft: 8, fontWeight: 700, color: (emp.score || 100) >= 70 ? 'var(--green)' : 'var(--red)' }}>{emp.score || 100}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
