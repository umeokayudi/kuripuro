import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import React, { lazy, Suspense } from 'react'
import { Toaster } from 'react-hot-toast'
import { LangProvider } from './hooks/useLang'
import { AuthProvider, useAuth } from './hooks/useAuth'
import Sidebar from './components/Sidebar'
import Login from './pages/Login'
import EmployeePortal from './pages/EmployeePortal'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Jobs = lazy(() => import('./pages/Jobs'))
const Employees = lazy(() => import('./pages/Employees'))
const Salary = lazy(() => import('./pages/Salary'))
const Clients = lazy(() => import('./pages/Clients'))
const Cashflow = lazy(() => import('./pages/Cashflow'))
const Reports = lazy(() => import('./pages/Reports'))
const Ryoshu = lazy(() => import('./pages/Ryoshu'))
const Evaluations = lazy(() => import('./pages/Evaluations'))
const AdminChat = lazy(() => import('./pages/AdminChat'))
const Payments = lazy(() => import('./pages/Payments'))
const EmployeeProfile = lazy(() => import('./pages/EmployeeProfile'))
const Checkin = lazy(() => import('./pages/Checkin'))

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



function AppContent() {
  const { user, loading, logout } = useAuth()

  if (loading) return (
    <div style={{ minHeight:'100vh', background:'#0d2137', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontSize:24, fontWeight:700, color:'#c19c56' }}>KuriPuro</div>
        <div style={{ fontSize:13, color:'rgba(255,255,255,0.4)', marginTop:8 }}>Loading...</div>
      </div>
    </div>
  )

  if (!user) return <Login />
  if (user.role === 'employee') return <EmployeePortal />

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main">
        <header className="topbar">
          <span className="topbar-title">KuriPuro Admin</span>
          <div className="topbar-right">
            <span style={{ fontSize:13, color:'var(--text2)' }}>{user.name}</span>
            <span style={{ color:'var(--text3)' }}>·</span>
            <Clock />
            <button onClick={logout} style={{ marginLeft:8, padding:'6px 14px', borderRadius:6, border:'1px solid var(--border)', background:'#f4f6f9', color:'#1a2636', fontSize:13, fontWeight:600, cursor:'pointer' }}>
              Logout
            </button>
          </div>
        </header>
        <main className="page-content">
          <Suspense fallback={<div style={{ padding:20, color:'var(--text3)', fontSize:13 }}>Loading...</div>}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/jobs" element={<Jobs />} />
              <Route path="/employees" element={<Employees />} />
              <Route path="/salary" element={<Salary />} />
              <Route path="/clients" element={<Clients />} />
              <Route path="/cashflow" element={<Cashflow />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/ryoshu" element={<Ryoshu />} />
              <Route path="/evaluations" element={<Evaluations />} />
              <Route path="/checkin" element={<Checkin />} />
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
