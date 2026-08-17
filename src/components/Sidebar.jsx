import { NavLink } from 'react-router-dom'
import { useLang } from '../hooks/useLang'
import { useAuth } from '../hooks/useAuth'
import { Icons } from './Icons'

const navItems = [
  { to: '/ai',        key: 'ai', icon: Icons.sparkle },
  { to: '/',          key: 'dashboard', icon: Icons.dashboard },
  { to: '/jobs',      key: 'jobs', icon: Icons.list },
  { to: '/employees', key: 'employees', icon: Icons.users },
  { to: '/clients',   key: 'clients', icon: Icons.building },
  { to: '/salary',    key: 'salary', icon: Icons.calc },
  { to: '/salary-periods', key: 'payrollClose', icon: Icons.calc },
  { to: '/salary-complaints', key: 'salaryIssues', icon: Icons.list },
  { to: '/cashflow',  key: 'cashflow', icon: Icons.chart },
  { to: '/reports',   key: 'reports', icon: Icons.file },
  { to: '/schedule', key: 'schedule', icon: Icons.list },
  { to: '/contracts', key: 'contracts', icon: Icons.file },
  { to: '/faturas', key: 'faturas', icon: Icons.file },
  { to: '/ryoshu',    key: 'ryoshu', icon: Icons.receipt },
  { to: '/adminchat', key: 'chat', icon: Icons.users },
  { to: '/live',      key: 'liveTrack', icon: Icons.users },
  { to: '/transport-claims', key: 'transport', icon: Icons.list },
  { to: '/deductions', key: 'deductions', icon: Icons.calc },
]

export default function Sidebar() {
  const { lang, switchLang, t } = useLang()
  const { logout } = useAuth()
  const s = t.sidebar

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="brand">KuriPuro</div>
        <div className="sub">by JBM · Admin</div>
      </div>
      <nav className="sidebar-nav">
        {navItems.map(({ to, key, icon: Icon }) => (
          <NavLink key={to} to={to} end={to==='/'} className={({ isActive }) => `nav-item${isActive?' active':''}`}>
            <Icon />{s[key]}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="lang-toggle" style={{ marginBottom:10 }}>
          <button className={`lang-btn${lang==='en'?' active':''}`} onClick={()=>switchLang('en')}>EN</button>
          <button className={`lang-btn${lang==='ja'?' active':''}`} onClick={()=>switchLang('ja')}>日本語</button>
        </div>
        <button onClick={logout} style={{ background:'rgba(255,255,255,0.06)', border:'none', color:'rgba(255,255,255,0.5)', padding:'7px 14px', borderRadius:8, cursor:'pointer', fontSize:12, width:'100%' }}>
          {s.logout}
        </button>
      </div>
    </aside>
  )
}
