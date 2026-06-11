import { useLang } from '../hooks/useLang'
import { Icons } from '../components/Icons'

const DEMO_CLIENTS = [
  { name: 'Hotel Grand', profit: 320000, pct: 85 },
  { name: 'Clinic Sakura', profit: 270000, pct: 72 },
  { name: 'Tokyo Office', profit: 225000, pct: 60 },
  { name: 'Fit+ Gym', profit: 150000, pct: 40 },
  { name: 'Zen Restaurant', profit: 94000, pct: 25 },
]

const DEMO_CHECKINS = [
  { name: 'Yuki Tanaka', client: 'Hotel Grand', time: '08:00', initials: 'YT', color: '#185FA5', bg: '#E6F1FB', status: 'active' },
  { name: 'Kenji Sato', client: 'Tokyo Office', time: '09:30', initials: 'KS', color: '#0F6E56', bg: '#E1F5EE', status: 'done' },
  { name: 'Mika Kobayashi', client: 'Clinic Sakura', time: '14:00', initials: 'MK', color: '#854F0B', bg: '#FAEEDA', status: 'pending' },
]

const DEMO_COMPLAINTS = [
  { name: 'Yuki Tanaka', desc: 'Window not cleaned — Hotel Grand, Jun 10', pts: -5 },
  { name: 'Kenji Sato', desc: '20 min late — Tokyo Office, Jun 8', pts: -3 },
]

export default function Dashboard() {
  const { t } = useLang()

  const statusBadge = (s) => {
    if (s === 'active') return <span className="badge badge-green">{t.common.active}</span>
    if (s === 'done')   return <span className="badge badge-blue">✓</span>
    return <span className="badge badge-amber">—</span>
  }

  return (
    <div>
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">{t.dashboard.monthRevenue}</div>
          <div className="metric-value" style={{ color: 'var(--navy)' }}>¥2,340,000</div>
          <div className="metric-sub">+8% vs last month</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">{t.dashboard.netProfit}</div>
          <div className="metric-value positive">¥890,000</div>
          <div className="metric-sub">38% margin</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">{t.dashboard.activeEmployees}</div>
          <div className="metric-value">12</div>
          <div className="metric-sub">2 on leave</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">{t.dashboard.activeClients}</div>
          <div className="metric-value">8</div>
          <div className="metric-sub">1 trial</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title"><Icons.clock /> {t.dashboard.todayCheckins}</div>
          {DEMO_CHECKINS.map((e, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: i < DEMO_CHECKINS.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <div className="avatar" style={{ background: e.bg, color: e.color }}>{e.initials}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: 13 }}>{e.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{e.client} — {e.time}</div>
              </div>
              {statusBadge(e.status)}
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-title"><Icons.alert /> {t.dashboard.recentComplaints}</div>
          {DEMO_COMPLAINTS.map((c, i) => (
            <div key={i} style={{ padding: '9px 0', borderBottom: i < DEMO_COMPLAINTS.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontWeight: 500, fontSize: 13 }}>{c.name}</span>
                <span className="badge badge-red">{c.pts} pts</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{c.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title"><Icons.trending /> {t.dashboard.profitByClient}</div>
        {DEMO_CLIENTS.map((c, i) => (
          <div key={i} className="profit-row">
            <span className="pname">{c.name}</span>
            <div className="profit-bar">
              <div className="profit-fill" style={{ width: c.pct + '%', background: c.pct > 50 ? 'var(--green)' : c.pct > 30 ? '#EF9F27' : 'var(--red)' }} />
            </div>
            <span className="pval positive">¥{c.profit.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
