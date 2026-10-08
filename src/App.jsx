import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import React, { lazy, Suspense } from 'react'
import { Toaster } from 'react-hot-toast'
import { LangProvider, useLang } from './hooks/useLang'
import { AuthProvider, useAuth } from './hooks/useAuth'
import Sidebar from './components/Sidebar'
import AIFloatingWidget from './components/AIFloatingWidget'
import PortalErrorBoundary from './components/PortalErrorBoundary'
import Login from './pages/Login'
import { supabase } from './lib/supabase'

const EmployeePortal = lazy(() => import('./pages/EmployeePortal'))
const ClientPortal = lazy(() => import('./pages/ClientPortal'))

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Jobs = lazy(() => import('./pages/Jobs'))
const Employees = lazy(() => import('./pages/Employees'))
const Salary = lazy(() => import('./pages/Salary'))
const Clients = lazy(() => import('./pages/Clients'))
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

function PortalLoading() {
  return (
    <div style={{ minHeight:'100vh', background:'#0d2137', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ fontSize:13, color:'rgba(255,255,255,0.45)' }}>Loading...</div>
    </div>
  )
}

function Clock() {
  const { lang } = useLang()
  const [now, setNow] = React.useState(new Date())
  React.useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  const dateLocale = lang === 'ja' ? 'ja-JP' : 'en-GB'
  return (
    <span style={{ fontSize:13, fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace', color:'var(--text2)' }}>
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
  '/client-feedback': 'clientFeedback',
  '/cashflow': 'cashflow',
  '/reports': 'reports',
  '/ryoshu': 'ryoshu',
  '/evaluations': 'evaluations',
  '/schedule': 'schedule',
  '/contracts': 'contracts',
  '/faturas': 'faturas',
  '/mitsumori': 'mitsumori',
  '/payments': 'payments',
  '/adminchat': 'chat',
  '/live': 'liveTrack',
  '/transport-claims': 'transport',
  '/deductions': 'deductions',
  '/salary-periods': 'payrollClose',
  '/salary-complaints': 'salaryIssues',
  '/equipment-requests': 'equipmentRequests',
  '/ai': 'ai',
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
  const location = useLocation()
  const navigate = useNavigate()
  const a = t.app
  const title = pageTitle(location.pathname, t.sidebar)

  React.useEffect(() => {
    const q = search.trim()
    if (q.length < 2) {
      setSearchResults([])
      setSearching(false)
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      setSearching(true)
      const pattern = '%' + q.replace(/[%_]/g, '') + '%'
      const [clientsRes, jobsRes, invoicesRes] = await Promise.all([
        supabase.from('clients').select('id,company_name,contact_name').or(`company_name.ilike.${pattern},contact_name.ilike.${pattern}`).limit(5),
        supabase.from('jobs').select('id,title,client_name,scheduled_date,status').or(`title.ilike.${pattern},client_name.ilike.${pattern}`).order('scheduled_date', { ascending:false }).limit(5),
        supabase.from('faturas').select('id,client_id,client_name,issue_date,due_date,total,status').or(`client_name.ilike.${pattern},status.ilike.${pattern}`).order('issue_date', { ascending:false }).limit(5),
      ])
      if (cancelled) return
      const results = [
        ...(clientsRes.data || []).map(x => ({ type:'client', title:x.company_name || x.contact_name || 'Client', meta:x.contact_name && x.company_name ? x.contact_name : '', to:'/clients', id:x.id })),
        ...(jobsRes.data || []).map(x => ({ type:'job', title:x.title || x.client_name || 'Job', meta:[x.client_name, x.scheduled_date].filter(Boolean).join(' · '), to:'/jobs', id:x.id })),
        ...(invoicesRes.data || []).map(x => ({ type:'invoice', title:x.client_name || 'Invoice', meta:[x.status, x.due_date].filter(Boolean).join(' · '), to:'/faturas', id:x.id })),
      ]
      setSearchResults(results)
      setSearching(false)
    }, 220)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [search])

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
    navigate(result.to)
  }

  if (loading) return (
    <div style={{ minHeight:'100vh', background:'#0d2137', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontSize:24, fontWeight:700, color:'#c19c56' }}>KuriPuro</div>
        <div style={{ fontSize:13, color:'rgba(255,255,255,0.4)', marginTop:8 }}>{a.loading}</div>
      </div>
    </div>
  )

  if (!user) return <Login />
  if (user.role === 'employee') return (
    <PortalErrorBoundary label="Employee portal">
      <Suspense fallback={<PortalLoading />}>
        <EmployeePortal />
        <AIFloatingWidget mode="employee" employeeId={user.id} employeeName={user.name} dark />
      </Suspense>
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

      <div className="main">
        <header className="topbar">
          <button type="button" className="mobile-sidebar-toggle" onClick={() => setSidebarOpen(v => !v)} aria-label={sidebarOpen ? a.closeMenu : a.openMenu} aria-expanded={sidebarOpen}>☰</button>
          <div className="mobile-kp-brand">KP</div>
          <div className="ref-topbar-search">
            <span>⌕</span>
            <input
              className="ref-search-input"
              value={search}
              onChange={e => { setSearch(e.target.value); setSearchOpen(true) }}
              onFocus={() => setSearchOpen(true)}
              placeholder={a.searchPlaceholder}
              aria-label={a.searchPlaceholder}
            />
            {searching ? <span className="ref-search-loading">…</span> : <kbd>⌘K</kbd>}
            {searchOpen && search.trim().length >= 2 && (
              <div className="ref-search-results">
                {searchResults.length ? searchResults.map((result, i) => (
                  <button key={result.type + result.id + i} type="button" className="ref-search-result" onMouseDown={e => e.preventDefault()} onClick={() => goSearchResult(result)}>
                    <span className="ref-search-type">{a.searchTypes?.[result.type] || result.type}</span>
                    <span className="ref-search-result-main"><strong>{result.title}</strong><small>{result.meta}</small></span>
                    <span>→</span>
                  </button>
                )) : !searching ? <div className="ref-search-empty">{a.noSearchResults}</div> : null}
              </div>
            )}
          </div>
          <div className="topbar-right"><button type="button" className="ref-top-action" title={a.notifications}>♧</button><Clock /><div className="ref-user"><div className="ref-avatar">{(user.name || 'A').slice(0,2).toUpperCase()}</div><div><div className="ref-user-name">{user.name}</div><div className="ref-user-role">{a.administrator}</div></div></div><button type="button" onClick={logout} className="ref-top-action" title={t.sidebar.logout}>↪</button></div>
        </header>
        <main className="page-content">
          <Suspense fallback={<div style={{ padding:20, color:'var(--text3)', fontSize:13 }}>{a.loading}</div>}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/jobs" element={<Jobs />} />
              <Route path="/employees" element={<Employees />} />
              <Route path="/salary" element={<Salary />} />
              <Route path="/clients" element={<Clients />} />
              <Route path="/client-feedback" element={<ClientFeedback />} />
              <Route path="/cashflow" element={<Cashflow />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/ryoshu" element={<Ryoshu />} />
              <Route path="/evaluations" element={<Evaluations />} />
              <Route path="/schedule" element={<ScheduleGenerator />} />
              <Route path="/contracts" element={<ServiceContracts />} />
              <Route path="/faturas" element={<Faturas />} />
              <Route path="/mitsumori" element={<Mitsumori />} />
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
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Suspense>
        </main>
      </div>
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
        </LangProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
