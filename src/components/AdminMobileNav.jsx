import { NavLink, useLocation } from 'react-router-dom'
import { useLang } from '../hooks/useLang'
import { Icons } from './Icons'
import { isAdminMobileTabPath } from '../lib/adminView'

export const ADMIN_MOBILE_TABS = [
  { to: '/', key: 'dashboard', icon: Icons.dashboard, end: true },
  { to: '/live', key: 'liveTrack', icon: Icons.users },
  { to: '/jobs', key: 'jobs', icon: Icons.list },
  { to: '/salary-periods', key: 'payrollClose', icon: Icons.calc },
]

export default function AdminMobileNav({ onMore, moreOpen }) {
  const { t } = useLang()
  const location = useLocation()
  const s = t.sidebar
  const moreOn = moreOpen || !isAdminMobileTabPath(location.pathname)

  return (
    <nav className="admin-tabbar" aria-label={s.adminTag}>
      {ADMIN_MOBILE_TABS.map(({ to, key, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => `admin-tab${isActive ? ' on' : ''}`}
        >
          <Icon />
          <span>{s[key]}</span>
        </NavLink>
      ))}
      <button
        type="button"
        className={`admin-tab${moreOn ? ' on' : ''}`}
        aria-expanded={moreOpen}
        aria-controls="admin-sidebar"
        onClick={onMore}
      >
        <span className="admin-tab-more-dots" aria-hidden="true">
          <i /><i /><i />
        </span>
        <span>{s.more}</span>
      </button>
    </nav>
  )
}
