import { NavLink } from 'react-router-dom'
import { useLang } from '../hooks/useLang'
import { Icons } from './Icons'

const navItems = [
  { to: '/',           key: 'dashboard', icon: Icons.dashboard },
  { to: '/checkin',    key: 'checkin',   icon: Icons.clock },
  { to: '/employees',  key: 'employees', icon: Icons.users },
  { to: '/salary',     key: 'salary',    icon: Icons.calc },
  { to: '/clients',    key: 'clients',   icon: Icons.building },
  { to: '/cashflow',   key: 'cashflow',  icon: Icons.chart },
  { to: '/ryoshu',     key: 'ryoshu',    icon: Icons.receipt },
]

export default function Sidebar() {
  const { lang, switchLang, t } = useLang()

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="brand">KuriPuro</div>
        <div className="sub">by JBM</div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map(({ to, key, icon: Icon }) => (
          <NavLink
            key={key}
            to={to}
            end={to === '/'}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <Icon />
            {t.nav[key]}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="lang-toggle">
          <button
            className={`lang-btn${lang === 'en' ? ' active' : ''}`}
            onClick={() => switchLang('en')}
          >EN</button>
          <button
            className={`lang-btn${lang === 'ja' ? ' active' : ''}`}
            onClick={() => switchLang('ja')}
          >日本語</button>
        </div>
      </div>
    </aside>
  )
}
