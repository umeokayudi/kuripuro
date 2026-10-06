import { NavLink } from 'react-router-dom'
import { useLang } from '../hooks/useLang'
import { Icons } from './Icons'
import { ADMIN_MOBILE_TABS, adminTabActive } from '../lib/adminLayout'

const ICONS = {
  ai: Icons.sparkle,
  dashboard: Icons.dashboard,
  jobs: Icons.list,
  mitsumori: Icons.file,
}

const TAB_COPY = {
  ai: 'tabAi',
  dashboard: 'tabDashboard',
  jobs: 'tabJobs',
  mitsumori: 'tabMitsumori',
}

export default function AdminMobileNav({ pathname, onMore }) {
  const { t } = useLang()
  const s = t.sidebar

  return (
    <nav className="admin-bottom-nav" aria-label={s.menu}>
      {ADMIN_MOBILE_TABS.map(({ to, key }) => {
        const Icon = ICONS[key]
        const active = adminTabActive(pathname, to)
        return (
          <NavLink key={to} to={to} end={to === '/'} className={`admin-bottom-item${active ? ' active' : ''}`}>
            <Icon />
            <span>{s[TAB_COPY[key]] || s[key]}</span>
          </NavLink>
        )
      })}
      <button type="button" className="admin-bottom-item" onClick={onMore}>
        <Icons.list />
        <span>{s.tabMore || s.more}</span>
      </button>
    </nav>
  )
}
