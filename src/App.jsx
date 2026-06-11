import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { LangProvider, useLang } from './hooks/useLang'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import Checkin from './pages/Checkin'
import Employees from './pages/Employees'
import Salary from './pages/Salary'
import Clients from './pages/Clients'
import Cashflow from './pages/Cashflow'
import Ryoshu from './pages/Ryoshu'

function AppShell() {
  const { t } = useLang()
  const now = new Date()
  const timeStr = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })

  const pageTitles = {
    '/': t.nav.dashboard,
    '/checkin': t.nav.checkin,
    '/employees': t.nav.employees,
    '/salary': t.nav.salary,
    '/clients': t.nav.clients,
    '/cashflow': t.nav.cashflow,
    '/ryoshu': t.nav.ryoshu,
  }
  const path = window.location.pathname
  const title = pageTitles[path] || t.appName

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main">
        <header className="topbar">
          <span className="topbar-title">{title}</span>
          <div className="topbar-right">
            <span>{timeStr}</span>
            <span style={{ color: 'var(--text3)' }}>·</span>
            <span>{dateStr}</span>
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
            <Route path="/ryoshu" element={<Ryoshu />} />
          </Routes>
        </main>
      </div>
      <Toaster position="top-right" toastOptions={{ style: { fontSize: 13 } }} />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <LangProvider>
        <AppShell />
      </LangProvider>
    </BrowserRouter>
  )
}
