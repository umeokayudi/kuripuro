import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import React, { lazy, Suspense, useState } from 'react'
import { Toaster } from 'react-hot-toast'
import { LangProvider, useLang } from './hooks/useLang'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { useAdminLayout } from './hooks/useAdminLayout'
import Sidebar from './components/Sidebar'
import AdminMobileNav from './components/AdminMobileNav'
import AIFloatingWidget from './components/AIFloatingWidget'
import PortalErrorBoundary from './components/PortalErrorBoundary'
import Login from './pages/Login'
import { APP_VERSION } from './lib/appVersion'
import { PeriodProvider } from './hooks/usePeriod'
import PeriodFilter from './components/PeriodFilter'

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
const SalesLeads = lazy(() => import('./pages/SalesLeads'))
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
const SalesTeam = lazy(() => import('./pages/SalesTeam'))

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
  '/sales-followup': 'followup',
  '/sales-approaches': 'approaches',
  '/payments': 'payments',
  '/adminchat': 'chat',
  '/live': 'liveTrack',
  '/transport-claims': 'transport',
  '/deductions': 'deductions',
  '/salary-periods': 'payrollClose',
  '/salary-complaints': 'salaryIssues',
  '/equipment-requests': 'equipmentRequests',
  '/ai': 'ai',
  '/sales-team': 'salesTeam',
}

function pageTitle(pathname, sidebar) {
  if (pathname.startsWith('/employees/')) return sidebar.employees
  return sidebar[PAGE_KEYS[pathname]] || sidebar.dashboard
}

function AppContent() {
  const { user, loading, logout } = useAuth()
  const { t } = useLang()
  const location = useLocation()
  const a = t.app
  const title = pageTitle(location.pathname, t.sidebar)
  const { mobile, pref, setView, width } = useAdminLayout()
  const [menuOpen, setMenuOpen] = useState(false)

  React.useEffect(() => { setMenuOpen(false) }, [location.pathname])
  React.useEffect(() => {
    if (!mobile || !menuOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [mobile, menuOpen])

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
  if (user.role === 'salesperson') return (
    <PortalErrorBoundary label="Salesperson portal">
      <Suspense fallback={<PortalLoading />}>
        <SalespersonPortal />
      </Suspense>
    </PortalErrorBoundary>
  )

  return (
    <div className={`app-shell${mobile ? ' app-shell-mobile' : ''}`}>
      {mobile && menuOpen && <button type="button" className="admin-drawer-backdrop" aria-label={t.sidebar.menu} onClick={() => setMenuOpen(false)} />}
      <Sidebar
        mobile={mobile}
        open={!mobile || menuOpen}
        onClose={() => setMenuOpen(false)}
        onUseDesktop={() => { setView('desktop'); setMenuOpen(false) }}
      />
      {location.pathname !== '/ai' && <AIFloatingWidget mode="admin" lift={mobile} />}
      <div className="main">
        <header className="topbar">
          {mobile && (
            <button type="button" className="admin-menu-btn" onClick={() => setMenuOpen(true)} aria-label={t.sidebar.menu}>☰</button>
          )}
          <span className="topbar-title">{title}</span>
          <div className="topbar-right">
            <span className="topbar-version">{APP_VERSION}</span>
            <span className="topbar-user">{user.name}</span>
            <span className="topbar-clock"><Clock /></span>
            {!mobile && (
              <button type="button" onClick={logout} className="btn btn-sm" style={{ marginLeft:8 }}>
                {t.sidebar.logout}
              </button>
            )}
            {mobile && (
              <button type="button" className="btn btn-sm admin-desktop-toggle" onClick={() => setView('desktop')}>{t.sidebar.desktopView}</button>
            )}
            {!mobile && pref === 'desktop' && width <= 900 && (
              <button type="button" className="btn btn-sm" onClick={() => setView('auto')}>{t.sidebar.mobileView}            </button>
          )}
        </div>
        </header>
        {!['/ai', '/live', '/adminchat'].includes(location.pathname) && (
          <div className="period-strip">
            <PeriodFilter />
          </div>
        )}
        <main className={`page-content${location.pathname === '/ai' ? ' page-content-ai' : ''}`}>
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
              <Route path="/sales-followup" element={<SalesLeads stage="followup" />} />
              <Route path="/sales-approaches" element={<SalesLeads stage="approach" />} />
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
              <Route path="/sales-team" element={<SalesTeam />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Suspense>
        </main>
        {mobile && <AdminMobileNav pathname={location.pathname} onMore={() => setMenuOpen(true)} />}
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <LangProvider>
          <PeriodProvider>
            <AppContent />
            <Toaster position="top-center" toastOptions={{ style:{ fontSize:13 } }} />
          </PeriodProvider>
        </LangProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
