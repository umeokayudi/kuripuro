import { NavLink } from 'react-router-dom'
import { useLang } from '../hooks/useLang'
import { useAuth } from '../hooks/useAuth'
import { Icons } from './Icons'
import LanguageToggle from './LanguageToggle'
import ViewModeToggle from './ViewModeToggle'

const groups = [
  {
    key: 'navOps',
    items: [
      { to: '/', key: 'dashboard', icon: Icons.dashboard },
      { to: '/jobs', key: 'jobs', icon: Icons.list },
      { to: '/schedule', key: 'schedule', icon: Icons.list },
      { to: '/live', key: 'liveTrack', icon: Icons.users },
      { to: '/reports', key: 'reports', icon: Icons.file },
    ],
  },
  {
    key: 'navPeople',
    items: [
      { to: '/employees', key: 'employees', icon: Icons.users },
      { to: '/evaluations', key: 'evaluations', icon: Icons.users },
      { to: '/equipment-requests', key: 'equipmentRequests', icon: Icons.list },
      { to: '/transport-claims', key: 'transport', icon: Icons.list },
      { to: '/account', key: 'account', icon: Icons.settings },
    ],
  },
  {
    key: 'navPayroll',
    items: [
      { to: '/salary', key: 'salary', icon: Icons.calc },
      { to: '/salary-periods', key: 'payrollClose', icon: Icons.calc },
      { to: '/payments', key: 'payments', icon: Icons.calc },
      { to: '/deductions', key: 'deductions', icon: Icons.calc },
      { to: '/salary-complaints', key: 'salaryIssues', icon: Icons.list },
    ],
  },
  {
    key: 'navClients',
    items: [
      { to: '/clients', key: 'clients', icon: Icons.building },
      { to: '/contracts', key: 'contracts', icon: Icons.file },
      { to: '/client-feedback', key: 'clientFeedback', icon: Icons.receipt },
      { to: '/adminchat', key: 'chat', icon: Icons.users },
    ],
  },
  {
    key: 'navBilling',
    items: [
      { to: '/faturas', key: 'faturas', icon: Icons.file },
      { to: '/ryoshu', key: 'ryoshu', icon: Icons.receipt },
      { to: '/cashflow', key: 'cashflow', icon: Icons.chart },
    ],
  },
]

export default function Sidebar({ mobile = false, open = false, onNavigate, desktopMode = true, onChangeView }) {
  const { t } = useLang()
  const { logout, user } = useAuth()
  const s = t.sidebar
  const a = t.app

  return (
    <aside
      className={`sidebar${mobile && open ? ' is-open' : ''}`}
      aria-hidden={mobile && !open}
      id="admin-sidebar"
    >
      <div className="sidebar-logo">
        <div className="brand">KuriPuro</div>
        <div className="sub">by JBM · {s.adminTag || 'Admin'}</div>
        {user?.name && <div className="sidebar-user">{user.name}</div>}
      </div>
      <nav className="sidebar-nav" onClick={mobile ? onNavigate : undefined}>
        {groups.map(group => (
          <div key={group.key} className="nav-group">
            <div className="nav-group-label">{s[group.key]}</div>
            {group.items.map(({ to, key, icon: Icon }) => (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <Icon />{s[key]}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <LanguageToggle variant="dark" />
        {onChangeView && (
          <ViewModeToggle
            desktopMode={desktopMode}
            onChange={onChangeView}
            mobileLabel={a.mobileView}
            desktopLabel={a.desktopView}
            variant="dark"
          />
        )}
        <button type="button" onClick={logout} className="sidebar-logout">
          {s.logout}
        </button>
      </div>
    </aside>
  )
}
