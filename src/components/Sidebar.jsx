import { NavLink } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { TIME_OFF_CHANGED } from '../lib/timeOff'
import { PAYROLL_CHANGED } from '../lib/payrollAlerts'
import { fetchPendingCounts, PENDING_CHANGED } from '../lib/adminPending'
import { tokyoToday } from '../lib/dates'
import { useLang, fill } from '../hooks/useLang'
import { useAuth } from '../hooks/useAuth'
import { Icons } from './Icons'
import LanguageToggle from './LanguageToggle'

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
      { to: '/users', key: 'users', icon: Icons.user },
      { to: '/employees', key: 'employees', icon: Icons.users },
      { to: '/evaluations', key: 'evaluations', icon: Icons.users },
      { to: '/equipment-requests', key: 'equipmentRequests', icon: Icons.list },
      { to: '/transport-claims', key: 'transport', icon: Icons.list },
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
      { to: '/facility', key: 'facility', icon: Icons.building },
      { to: '/contracts', key: 'contracts', icon: Icons.file },
      { to: '/client-feedback', key: 'clientFeedback', icon: Icons.receipt },
      { to: '/partners', key: 'partners', icon: Icons.building },
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
  {
    key: 'navSales',
    items: [
      { to: '/mitsumori', key: 'mitsumori', icon: Icons.file },
      { to: '/sales-funnel', key: 'salesFunnel', icon: Icons.chart },
      { to: '/sales-team', key: 'salesTeam', icon: Icons.users },
      { to: '/marketing', key: 'marketing', icon: Icons.chart },
    ],
  },
]

export function usePendingCounts() {
  const [counts, setCounts] = useState({})
  useEffect(() => {
    let alive = true
    const load = () => fetchPendingCounts(tokyoToday()).then(c => { if (alive) setCounts(c) }).catch(() => {})
    load()
    const id = setInterval(load, 60000)
    const events = [TIME_OFF_CHANGED, PAYROLL_CHANGED, PENDING_CHANGED]
    events.forEach(e => window.addEventListener(e, load))
    window.addEventListener('focus', load)
    return () => { alive = false; clearInterval(id); events.forEach(e => window.removeEventListener(e, load)); window.removeEventListener('focus', load) }
  }, [])
  return counts
}

export default function Sidebar({ mobileOpen = false, onMobileClose }) {
  const { t } = useLang()
  const { logout } = useAuth()
  const s = t.sidebar
  const [collapsed, setCollapsed] = useState(false)
  // Unresolved items per menu entry (day-off requests, client quote requests, unread chat…):
  // the number stays next to the item until it is dealt with, on every page.
  const counts = usePendingCounts()

  return (
    <>
    <aside className={`sidebar${collapsed ? " sidebar-collapsed" : ""}${mobileOpen ? " sidebar-mobile-open" : ""}`}>
      <div className="sidebar-logo">
        <div className="brand">KuriPuro</div>
        <div className="brand-mark">KP</div>
        <div className="sub">by JBM · {s.adminTag || 'Admin'}</div>
        <button type="button" className="sidebar-collapse" onClick={() => setCollapsed(v => !v)} aria-label={s.toggleNavigation || "Toggle navigation"} title={s.toggleNavigation || "Toggle navigation"}>‹</button>
      </div>
      <nav className="sidebar-nav">
        <div className="nav-group nav-group-ai">
          <NavLink to="/ai" end onClick={onMobileClose} className={({ isActive }) => `nav-item nav-ai${isActive ? ' active' : ''}`}>
            <Icons.sparkle /><span className="nav-label">{s.ai || 'AI'}</span>
          </NavLink>
        </div>
        {groups.map(group => (
          <div key={group.key} className="nav-group">
            <div className="nav-group-label">{s[group.key]}</div>
            {group.items.map(({ to, key, icon: Icon }) => (
              <NavLink key={to} to={to} end={to === '/'} onClick={onMobileClose} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <Icon /><span className="nav-label">{s[key]}</span>
                {counts[key] > 0 && <span className="nav-count" title={fill(s.pendingTitle || '{n} waiting', { n: counts[key] })}>{counts[key] > 99 ? '99+' : counts[key]}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <LanguageToggle variant="dark" />
        <button type="button" onClick={logout} className="sidebar-logout">
          {s.logout}
        </button>
      </div>
    </aside>
    {mobileOpen && <button type="button" className="sidebar-mobile-overlay" onClick={onMobileClose} aria-label={s.closeMenu || "Close menu"} />}
    </>
  )
}
