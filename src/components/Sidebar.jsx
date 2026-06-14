import { NavLink } from 'react-router-dom'
import { useLang } from '../hooks/useLang'
import { useAuth } from '../hooks/useAuth'
import { Icons } from './Icons'

const navItems = [
  { to: '/',          label: 'Dashboard',  icon: Icons.dashboard },
  { to: '/jobs',      label: 'Jobs',       icon: Icons.list },
  { to: '/employees', label: 'Employees',  icon: Icons.users },
  { to: '/clients',   label: 'Clients',    icon: Icons.building },
  { to: '/salary',    label: 'Salary',     icon: Icons.calc },
  { to: '/cashflow',  label: 'Cashflow',   icon: Icons.chart },
  { to: '/reports',   label: 'Reports',    icon: Icons.file },
  { to: '/schedule', label: 'Schedule Gen', icon: Icons.list },
  { to: '/contracts', label: 'Contracts', icon: Icons.file },
  { to: '/faturas', label: 'Faturas', icon: Icons.file },
  { to: '/ryoshu',    label: '領収書',      icon: Icons.receipt },
  { to: '/adminchat', label: 'Chat',        icon: Icons.users },
  { to: '/live',      label: 'Live Track',  icon: Icons.users },
  { to: '/transport-claims', label: 'Transport', icon: Icons.list },
  { to: '/deductions', label: 'Deductions', icon: Icons.calc },
]

export default function Sidebar() {
  const { lang, switchLang } = useLang()
  const { logout, user } = useAuth()

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="brand">KuriPuro</div>
        <div className="sub">by JBM · Admin</div>
      </div>
      <nav className="sidebar-nav">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to==='/'} className={({ isActive }) => `nav-item${isActive?' active':''}`}>
            <Icon />{label}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="lang-toggle" style={{ marginBottom:10 }}>
          <button className={`lang-btn${lang==='en'?' active':''}`} onClick={()=>switchLang('en')}>EN</button>
          <button className={`lang-btn${lang==='ja'?' active':''}`} onClick={()=>switchLang('ja')}>日本語</button>
        </div>
        <button onClick={logout} style={{ background:'rgba(255,255,255,0.06)', border:'none', color:'rgba(255,255,255,0.5)', padding:'7px 14px', borderRadius:8, cursor:'pointer', fontSize:12, width:'100%' }}>
          Logout
        </button>
      </div>
    </aside>
  )
}
