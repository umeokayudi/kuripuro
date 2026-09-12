import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import React, { lazy, Suspense } from 'react'
import { Toaster } from 'react-hot-toast'
import { LangProvider, useLang } from './hooks/useLang'
import { AuthProvider, useAuth } from './hooks/useAuth'
import Sidebar from './components/Sidebar'
import AIFloatingWidget from './components/AIFloatingWidget'
import PortalErrorBoundary from './components/PortalErrorBoundary'
import Login from './pages/Login'

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
  const [now, setNow] = React.useState(new Date())
  React.useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  return (
    <span style={{ fontSize:13, fontFamily:'monospace', color:'var(--text2)' }}>
      {now.toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}
      <span style={{ marginLeft:8, fontSize:12, color:'var(--text3)' }}>
        {now.toLocaleDateString('en-GB', { weekday:'short', day:'2-digit', month:'short' })}
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
  const location = useLocation()
  const a = t.app
  const title = pageTitle(location.pathname, t.sidebar)

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
      <Sidebar />
      <AIFloatingWidget mode="admin" />
      <div className="main">
        <header className="topbar">
          <span className="topbar-title">{title}</span>
          <div className="topbar-right">
            <span style={{ fontSize:13, color:'var(--text2)' }}>{user.name}</span>
            <span style={{ color:'var(--text3)' }}>·</span>
            <Clock />
            <button onClick={logout} style={{ marginLeft:8, padding:'6px 14px', borderRadius:6, border:'1px solid var(--border)', background:'#f4f6f9', color:'#1a2636', fontSize:13, fontWeight:600, cursor:'pointer' }}>
              {t.sidebar.logout}
            </button>
          </div>
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
