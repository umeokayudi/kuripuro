import { NavLink, useNavigate } from 'react-router-dom'
import { homeLogoProps } from '../lib/homeLogo'
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
      { to: '/jobs', key: 'jobs', icon: Icons.briefcase },
      { to: '/schedule', key: 'schedule', icon: Icons.calendar },
      { to: '/live', key: 'liveTrack', icon: Icons.live },
      { to: '/team-channel', key: 'teamChannel', icon: Icons.messages },
      { to: '/reports', key: 'reports', icon: Icons.chart },
      { to: '/work-reports', key: 'workReports', icon: Icons.clipboard },
      { to: '/deep-report', key: 'deepReport', icon: Icons.chart },
      { to: '/videos', key: 'videos', icon: Icons.video },
      { to: '/google-agenda', key: 'googleAgenda', icon: Icons.calendarCheck },
    ],
  },
  {
    key: 'navPeople',
    items: [
      { to: '/users', key: 'users', icon: Icons.user },
      { to: '/employees', key: 'employees', icon: Icons.users },
      { to: '/evaluations', key: 'evaluations', icon: Icons.award },
      { to: '/meetings', key: 'meetings', icon: Icons.users },
      { to: '/training', key: 'training', icon: Icons.cap },
      { to: '/equipment-requests', key: 'equipmentRequests', icon: Icons.tool },
      { to: '/transport-claims', key: 'transport', icon: Icons.train },
    ],
  },
  {
    key: 'navPayroll',
    items: [
      { to: '/salary', key: 'salary', icon: Icons.calc },
      { to: '/salary-periods', key: 'payrollClose', icon: Icons.calendarCheck },
      { to: '/payments', key: 'payments', icon: Icons.yen },
      { to: '/deductions', key: 'deductions', icon: Icons.minusCircle },
      { to: '/salary-complaints', key: 'salaryIssues', icon: Icons.help },
    ],
  },
  {
    key: 'navClients',
    items: [
      { to: '/clients', key: 'clients', icon: Icons.building },
      { to: '/facility', key: 'facility', icon: Icons.map },
      { to: '/contracts', key: 'contracts', icon: Icons.file },
      { to: '/client-feedback', key: 'clientFeedback', icon: Icons.star2 },
      { to: '/partners', key: 'partners', icon: Icons.handshake },
      { to: '/adminchat', key: 'chat', icon: Icons.message },
    ],
  },
  {
    key: 'navBilling',
    items: [
      { to: '/faturas', key: 'faturas', icon: Icons.invoice },
      { to: '/ryoshu', key: 'ryoshu', icon: Icons.receipt },
      { to: '/cashflow', key: 'cashflow', icon: Icons.wallet },
    ],
  },
  {
    key: 'navSales',
    items: [
      { to: '/mitsumori', key: 'mitsumori', icon: Icons.quote },
      { to: '/sales-funnel', key: 'salesFunnel', icon: Icons.funnel },
      { to: '/sales-team', key: 'salesTeam', icon: Icons.users },
      { to: '/marketing', key: 'marketing', icon: Icons.megaphone },
    ],
  },
]

// v1.0.204 · ONE shared fetch for every place that shows the menu numbers (side menu, phone menu
// button, Quotes page). Before, each one ran the same 11 queries on its own, every minute and on
// every focus. Same events and same 60 s refresh as before; the minute tick is skipped while the
// tab is hidden and runs at once when it comes back.
const pendingStore = { counts: {}, subs: new Set(), inflight: null, timer: null, stop: null }
function loadPendingShared() {
  if (pendingStore.inflight) return pendingStore.inflight
  pendingStore.inflight = fetchPendingCounts(tokyoToday())
    .then(c => { pendingStore.counts = c; pendingStore.subs.forEach(fn => fn(c)) })
    .catch(() => {})
    .finally(() => { pendingStore.inflight = null })
  return pendingStore.inflight
}
function startPendingWatch() {
  const load = () => loadPendingShared()
  const tick = () => { if (document.visibilityState !== 'hidden') load() }
  const onVisible = () => { if (document.visibilityState === 'visible') load() }
  pendingStore.timer = setInterval(tick, 60000)
  const events = [TIME_OFF_CHANGED, PAYROLL_CHANGED, PENDING_CHANGED]
  events.forEach(e => window.addEventListener(e, load))
  window.addEventListener('focus', load)
  document.addEventListener('visibilitychange', onVisible)
  pendingStore.stop = () => {
    clearInterval(pendingStore.timer)
    events.forEach(e => window.removeEventListener(e, load))
    window.removeEventListener('focus', load)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

export function usePendingCounts() {
  const [counts, setCounts] = useState(() => pendingStore.counts)
  useEffect(() => {
    let alive = true
    const fn = c => { if (alive) setCounts(c) }
    if (!pendingStore.subs.size) startPendingWatch()
    pendingStore.subs.add(fn)
    loadPendingShared()
    return () => {
      alive = false
      pendingStore.subs.delete(fn)
      if (!pendingStore.subs.size && pendingStore.stop) { pendingStore.stop(); pendingStore.stop = null }
    }
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
  const navigate = useNavigate()
  const goHome = () => { navigate('/'); onMobileClose?.() }

  return (
    <>
    <aside className={`sidebar${collapsed ? " sidebar-collapsed" : ""}${mobileOpen ? " sidebar-mobile-open" : ""}`}>
      <div className="sidebar-logo">
        {/* Brand: blue rounded box with a white "K" (same look as the user avatar), name beside it. */}
        <div className="brand-box" {...homeLogoProps(goHome, s.home || 'Home')}>K</div>
        <div className="brand-text" {...homeLogoProps(goHome, s.home || 'Home')}>
          <div className="brand">KuriPuro</div>
          <div className="sub">by JBM · {s.adminTag || 'Admin'}</div>
        </div>
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
        {/* v1.0.239/253 · "Ver como" and the real switch live only in the owner's name menu at the top (OwnerView.jsx) */}
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
