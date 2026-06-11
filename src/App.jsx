import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { LangProvider } from './hooks/useLang'
import { AuthProvider, useAuth } from './hooks/useAuth'
import Sidebar from './components/Sidebar'
import Login from './pages/Login'
import EmployeePortal from './pages/EmployeePortal'
import Dashboard from './pages/Dashboard'
import Checkin from './pages/Checkin'
import Employees from './pages/Employees'
import Salary from './pages/Salary'
import Clients from './pages/Clients'
import Cashflow from './pages/Cashflow'
import Ryoshu from './pages/Ryoshu'
import Reports from './pages/Reports'

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
            <span>{new Date().toLocaleDateString('en-GB',{ weekday:'short', day:'2-digit', month:'short' })}</span>
            <button onClick={logout} style={{ marginLeft:8, padding:'6px 14px', borderRadius:6, border:'1px solid var(--border)', background:'#f4f6f9', color:'#1a2636', fontSize:13, fontWeight:600, cursor:'pointer' }}>
              Logout
            </button>
          </div>
        </header>
        <main className="page-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/checkin" element={<Checkin />} />
            <Route path="/employees" element={<Employees />} />
            <Route path="/salary" element={<Salary />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/cashflow" element={<Cashflow />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/ryoshu" element={<Ryoshu />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
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
