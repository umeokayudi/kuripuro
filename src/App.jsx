import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import TimeOffCenter from './components/TimeOffCenter'
import ClientSheetHost from './components/ClientSheetHost'
import { APP_VERSION, APP_BUILD_LABEL } from './version'

// Version stays known to the system only (not shown on screen).
if (typeof window !== 'undefined') {
  window.__KP_VERSION__ = APP_VERSION
  document.documentElement.dataset.appVersion = APP_VERSION
  console.info(`[Kuripuro] ${APP_BUILD_LABEL}`)
}
import React, { lazy, Suspense } from 'react'
import { Toaster } from 'react-hot-toast'
import { LangProvider, useLang, localeOf } from './hooks/useLang'
import { AuthProvider, useAuth } from './hooks/useAuth'
import Sidebar, { usePendingCounts } from './components/Sidebar'
import AIFloatingWidget from './components/AIFloatingWidget'
import PortalErrorBoundary from './components/PortalErrorBoundary'
import ConfirmDialogHost from './components/ConfirmDialog'
import Login from './pages/Login'
import { supabase } from './lib/supabase'
import { globalSearch, groupResults } from './lib/globalSearch'

const EmployeePortal = lazy(() => import('./pages/EmployeePortal'))
const ClientPortal = lazy(() => import('./pages/ClientPortal'))

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Jobs = lazy(() => import('./pages/Jobs'))
const Employees = lazy(() => import('./pages/Employees'))
const Salary = lazy(() => import('./pages/Salary'))
const Clients = lazy(() => import('./pages/Clients'))
const Facility = lazy(() => import('./pages/Facility'))
const FacilityEdit = lazy(() => import('./pages/FacilityEdit'))
const FacilityBuilder = lazy(() => import('./pages/FacilityBuilder'))
const Cashflow = lazy(() => import('./pages/Cashflow'))
const Reports = lazy(() => import('./pages/Reports'))
const Ryoshu = lazy(() => import('./pages/Ryoshu'))
const Evaluations = lazy(() => import('./pages/Evaluations'))
const ServiceContracts = lazy(() => import('./pages/ServiceContracts'))
const ScheduleGenerator = lazy(() => import('./pages/ScheduleGenerator'))
const Faturas = lazy(() => import('./pages/Faturas'))
const Mitsumori = lazy(() => import('./pages/Mitsumori'))
const AdminChat = lazy(() => import('./pages/AdminChat'))
const TransportClaims = lazy(() => import('./pages/TransportClaims'))
const LiveTracking = lazy(() => import('./pages/LiveTracking'))
const Deductions = lazy(() => import('./pages/Deductions'))
const Payments = lazy(() => import('./pages/Payments'))
const EmployeeProfile = lazy(() => import('./pages/EmployeeProfile'))
const SalaryPeriods = lazy(() => import('./pages/SalaryPeriods'))
const SalaryComplaints = lazy(() => import('./pages/SalaryComplaints'))
const EquipmentRequests = lazy(() => import('./pages/EquipmentRequests'))
const ClientFeedback = lazy(() => import('./pages/ClientFeedback'))
const AdminAI = lazy(() => import('./pages/AdminAI'))
const SalespersonPortal = lazy(() => import('./pages/SalespersonPortal'))
const MarketingPortal = lazy(() => import('./pages/MarketingPortal'))
const SalesTeam = lazy(() => import('./pages/SalesTeam'))
const SalesFunnelPage = lazy(() => import('./pages/SalesFunnelPage'))
const Marketing = lazy(() => import('./pages/Marketing'))
const Users = lazy(() => import('./pages/Users'))
const Partners = lazy(() => import('./pages/Partners'))

function PortalLoading() {
  return (
    <div style={{ minHeight:'100vh', background:'#0d2137', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ fontSize:13, color:'rgba(255,255,255,0.45)' }}>Loading...</div>
    </div>
  )
}

// Phone: the side menu is hidden, so the menu button shows the total of unresolved items.
function MobileMenuCount() {
  const counts = usePendingCounts()
  const n = Object.values(counts).reduce((a, b) => a + (b || 0), 0)
  return n > 0 ? <span className="nav-count mobile-menu-count">{n > 99 ? '99+' : n}</span> : null
}

function Clock() {
  const { lang } = useLang()
  const [now, setNow] = React.useState(new Date())
  React.useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  const dateLocale = localeOf(lang)
  return (
    <span className="kp-clock" style={{ fontSize:13, color:'var(--text2)' }}>
      {now.toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}
      <span style={{ marginLeft:8, fontSize:12, color:'var(--text3)' }}>
        {now.toLocaleDateString(dateLocale, { weekday:'short', day:'2-digit', month:'short' })}
      </span>
    </span>
  )
}



const PAGE_KEYS = {
  '/': 'dashboard',
  '/jobs': 'jobs',
  '/employees': 'employees',
  '/salary': 'salary',
  '/clients': 'clients',
  '/facility': 'facility',
  '/facility/edit': 'facility',
  '/facility/studio': 'facility',
  '/client-feedback': 'clientFeedback',
  '/cashflow': 'cashflow',
  '/reports': 'reports',
  '/ryoshu': 'ryoshu',
  '/evaluations': 'evaluations',
  '/schedule': 'schedule',
  '/contracts': 'contracts',
  '/faturas': 'faturas',
  '/mitsumori': 'mitsumori',
  '/sales-funnel': 'salesFunnel',
  '/sales-team': 'salesTeam',
  '/marketing': 'marketing',
  '/payments': 'payments',
  '/adminchat': 'chat',
  '/live': 'liveTrack',
  '/transport-claims': 'transport',
  '/deductions': 'deductions',
  '/salary-periods': 'payrollClose',
  '/salary-complaints': 'salaryIssues',
  '/equipment-requests': 'equipmentRequests',
  '/ai': 'ai',
  '/users': 'users',
  '/partners': 'partners',
}

function pageTitle(pathname, sidebar) {
  if (pathname.startsWith('/employees/')) return sidebar.employees
  return sidebar[PAGE_KEYS[pathname]] || sidebar.dashboard
}

function AppContent() {
  const { user, loading, logout } = useAuth()
  const { t } = useLang()
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [searchResults, setSearchResults] = React.useState([])
  const [searching, setSearching] = React.useState(false)
  const [searchError, setSearchError] = React.useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const a = t.app
  const title = pageTitle(location.pathname, t.sidebar)
  // tela cheia (Mundo Kuripuro) abre o menu pelo próprio botão ☰
  React.useEffect(() => {
    const open = () => setSidebarOpen(true)
    window.addEventListener('kp:open-menu', open)
    return () => window.removeEventListener('kp:open-menu', open)
  }, [])

  // v1.0.114 · results belong to the query they were found for: until the search for what is typed
  // now has finished, the box says "Buscando…" — never "nada encontrado" for a search still running.
  const [searchDoneFor, setSearchDoneFor] = React.useState('')
  React.useEffect(() => {
    const q = search.trim()
    if (q.length < 2) {
      setSearchResults([])
      setSearching(false)
      setSearchError(false)
      setSearchDoneFor('')
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(async () => {
      setSearchError(false)
      try {
        const results = await globalSearch(q)
        if (cancelled) return
        setSearchResults(results)
      } catch {
        if (cancelled) return
        setSearchResults([])
        setSearchError(true)
      }
      setSearchDoneFor(q)
      setSearching(false)
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [search])
  const searchSettled = !searching && searchDoneFor === search.trim()
  const searchGroups = searchSettled ? groupResults(searchResults) : []

  React.useEffect(() => {
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
        window.setTimeout(() => document.querySelector('.ref-search-input')?.focus(), 0)
      }
      if (e.key === 'Escape') setSearchOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const goSearchResult = result => {
    setSearchOpen(false)
    setSearch('')
    navigate(`${result.to}?search=${encodeURIComponent(result.id)}`)
  }

  if (loading) return (
    <div style={{ minHeight:'100vh', background:'#f5f7fb', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ width:48, height:48, margin:'0 auto 12px', borderRadius:14, background:'linear-gradient(135deg,#1e3fae,#315cf5)', color:'#fff', fontWeight:800, fontSize:17, display:'grid', placeItems:'center', boxShadow:'0 8px 20px rgba(49,92,245,.25)' }}>KP</div>
        <div style={{ fontSize:20, fontWeight:800, color:'#111827', letterSpacing:'-.02em' }}>KuriPuro</div>
        <div style={{ fontSize:13, color:'#8a96a7', marginTop:6 }}>{a.loading}</div>
      </div>
    </div>
  )

  if (!user) return <Login />
  if (user.role === 'employee') return (
    <PortalErrorBoundary label="Employee portal">
      <Suspense fallback={<PortalLoading />}>
        <EmployeePortal />
      </Suspense>
    </PortalErrorBoundary>
  )
  if (user.role === 'salesperson' && user.team === 'marketing') return (
    <PortalErrorBoundary label="Marketing portal">
      <Suspense fallback={<PortalLoading />}><MarketingPortal /></Suspense>
    </PortalErrorBoundary>
  )
  if (user.role === 'salesperson') return (
    <PortalErrorBoundary label="Sales portal">
      <Suspense fallback={<PortalLoading />}><SalespersonPortal /></Suspense>
    </PortalErrorBoundary>
  )
  if (user.role === 'client') return (
    <PortalErrorBoundary label="Client portal">
      <Suspense fallback={<PortalLoading />}>
        <ClientPortal />
      </Suspense>
    </PortalErrorBoundary>
  )

  return (
    <div className="app-shell">
      <Sidebar mobileOpen={sidebarOpen} onMobileClose={() => setSidebarOpen(false)} />

      <div className={`main${location.pathname === '/facility' || location.pathname === '/facility/edit' ? ' kw-full' : ''}`}>
        <header className="topbar">
          <button type="button" className="mobile-sidebar-toggle" onClick={() => setSidebarOpen(v => !v)} aria-label={sidebarOpen ? a.closeMenu : a.openMenu} aria-expanded={sidebarOpen}>☰<MobileMenuCount /></button>
          <div className="mobile-kp-brand">KP</div>
          <div className="ref-topbar-search">
            <span>⌕</span>
            <input
              className="ref-search-input"
              value={search}
              onChange={e => { setSearch(e.target.value); setSearchOpen(true) }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => window.setTimeout(() => setSearchOpen(false), 150)}
              placeholder={a.searchPlaceholder}
              aria-label={a.searchPlaceholder}
            />
            {searching ? <span className="ref-search-loading" aria-hidden="true">…</span> : <kbd>⌘K</kbd>}
            {search && <button type="button" aria-label={a.clearSearch} className="ref-search-clear" onMouseDown={e => e.preventDefault()} onClick={() => { setSearch(''); setSearchResults([]); setSearchError(false); setSearchOpen(false) }}>×</button>}
            {searchOpen && search.trim().length >= 2 && (
              <div className="ref-search-results">
                {!searchSettled ? <div className="ref-search-empty" aria-live="polite">{a.searching}</div>
                  : searchGroups.length ? searchGroups.map(g => (
                  <div key={g.type} role="group" aria-label={a.searchGroups?.[g.type] || g.type}>
                    <div className="ref-search-group">{a.searchGroups?.[g.type] || g.type} · {g.items.length}</div>
                    {g.items.map((result, i) => (
                      <button key={result.type + result.id + i} type="button" className="ref-search-result" onMouseDown={e => e.preventDefault()} onClick={() => goSearchResult(result)}>
                        <span className="ref-search-type">{a.searchTypes?.[result.type] || result.type}</span>
                        <span className="ref-search-result-main"><strong>{result.title}</strong><small>{[result.meta, result.contractOnly ? a.searchFromContract : '', result.inactive ? a.searchInactive : ''].filter(Boolean).join(' · ')}</small></span>
                        <span>→</span>
                      </button>
                    ))}
                  </div>
                )) : <div className="ref-search-empty">{searchError ? a.searchUnavailable : a.noSearchResults}</div>}
              </div>
            )}
          </div>
          <div className="topbar-right"><TimeOffCenter /><Clock /><div className="ref-user"><div className="ref-avatar">{(user.name || 'A').slice(0,2).toUpperCase()}</div><div><div className="ref-user-name">{user.name}</div><div className="ref-user-role">{a.administrator}</div></div></div><button type="button" onClick={logout} className="ref-top-action" title={t.sidebar.logout}>↪</button></div>
        </header>
        <ClientSheetHost />
        <main className="page-content">
          <Suspense fallback={<div style={{ padding:20, color:'var(--text3)', fontSize:13 }}>{a.loading}</div>}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/jobs" element={<Jobs />} />
              <Route path="/employees" element={<Employees />} />
              <Route path="/salary" element={<Salary />} />
              <Route path="/clients" element={<Clients />} />
              <Route path="/facility" element={<Facility />} />
              <Route path="/facility/edit" element={<FacilityBuilder />} />
              <Route path="/facility/studio" element={<FacilityEdit />} />
              <Route path="/client-feedback" element={<ClientFeedback />} />
              <Route path="/cashflow" element={<Cashflow />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/ryoshu" element={<Ryoshu />} />
              <Route path="/evaluations" element={<Evaluations />} />
              <Route path="/schedule" element={<ScheduleGenerator />} />
              <Route path="/contracts" element={<ServiceContracts />} />
              <Route path="/faturas" element={<Faturas />} />
              <Route path="/mitsumori" element={<Mitsumori />} />
              <Route path="/sales-funnel" element={<SalesFunnelPage />} />
              <Route path="/sales-team" element={<SalesTeam />} />
              <Route path="/marketing" element={<Marketing />} />
              <Route path="/payments" element={<Payments />} />
              <Route path="/adminchat" element={<AdminChat />} />
              <Route path="/live" element={<LiveTracking />} />
              <Route path="/transport-claims" element={<TransportClaims />} />
              <Route path="/deductions" element={<Deductions />} />
              <Route path="/employees/:id" element={<EmployeeProfile />} />
              <Route path="/salary-periods" element={<SalaryPeriods />} />
              <Route path="/salary-complaints" element={<SalaryComplaints />} />
              <Route path="/equipment-requests" element={<EquipmentRequests />} />
              <Route path="/ai" element={<AdminAI />} />
              <Route path="/users" element={<Users />} />
              <Route path="/partners" element={<Partners />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Suspense>
        </main>
      </div>
      {location.pathname !== '/' && location.pathname !== '/ai' && location.pathname !== '/adminchat' && location.pathname !== '/facility/edit' && <AIFloatingWidget mode="admin" />}
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <LangProvider>
          <AppContent />
          <Toaster position="top-right" toastOptions={{ style:{ fontSize:13 } }} />
          <ConfirmDialogHost />
        </LangProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
