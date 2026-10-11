import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { findClientUserForLogin, clientUserToSession } from '../lib/clientCredentials'

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sessionExpired, setSessionExpired] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('kp_user')
    let parsed = null
    if (saved) { try { parsed = JSON.parse(saved) } catch {} }
    if (parsed) setUser(parsed)
    setLoading(false)

    // Admins, employees and sellers also need the server login cookie: the AI,
    // photo checks and Sales Team refuse requests without it. Accounts saved
    // before that cookie existed (or after it expired) would look signed in but
    // every AI answer would fail, so send them back to the login screen once.
    if (!parsed || !['admin', 'employee', 'salesperson'].includes(parsed.role)) return
    fetch('/api/sales-session', { credentials: 'same-origin', cache: 'no-store' })
      .then(async response => {
        if (response.status !== 401) return // 503/404 (local dev, preview without secrets): keep the user
        localStorage.removeItem('kp_user')
        setUser(null)
        setSessionExpired(true)
      })
      .catch(() => {})
  }, [])

  const login = async (email, password) => {
    const em = email.trim().toLowerCase()
    const pw = password.trim()

    // Commercial roles receive a server-signed HttpOnly session. The browser
    // never gets a service key or a seller password hash.
    try {
      const response = await fetch('/api/sales-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: em, password: pw }),
      })
      const result = await response.json().catch(() => ({}))
      if (response.ok && result.user) {
        setSessionExpired(false)
        setUser(result.user)
        localStorage.setItem('kp_user', JSON.stringify(result.user))
        return { success: true }
      }
      if (response.status === 429) return { success: false, error: result.error }
    } catch {
      // Vite's local dev server does not host Vercel API routes; keep the
      // existing employee/client login available there.
    }

    const { data: admin } = await supabase
      .from('admins')
      .select('*')
      .eq('email', em)
      .eq('password', pw)
      .maybeSingle()
    if (admin) {
      const u = { id: admin.id, name: admin.name, email: admin.email, role: 'admin' }
      setUser(u)
      localStorage.setItem('kp_user', JSON.stringify(u))
      return { success: true }
    }

    const { data: emp } = await supabase
      .from('employees')
      .select('id, full_name, email, password, is_active, contract_type, hourly_rate, fixed_salary, salary_type, score')
      .eq('email', em)
      .eq('password', pw)
      .eq('is_active', true)
      .maybeSingle()
    if (emp) {
      const u = { id: emp.id, name: emp.full_name, email: emp.email, role: 'employee', contract_type: emp.contract_type, hourly_rate: emp.hourly_rate, fixed_salary: emp.fixed_salary, salary_type: emp.salary_type, score: emp.score }
      setUser(u)
      localStorage.setItem('kp_user', JSON.stringify(u))
      return { success: true }
    }

    const clientUser = await findClientUserForLogin(supabase, email, pw)
    if (clientUser) {
      const u = clientUserToSession(clientUser)
      setUser(u)
      localStorage.setItem('kp_user', JSON.stringify(u))
      return { success: true }
    }

    return { success: false, error: 'Invalid login or password' }
  }

  const updateSession = (patch) => {
    setUser(prev => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      localStorage.setItem('kp_user', JSON.stringify(next))
      return next
    })
  }

  const logout = () => {
    setUser(null)
    localStorage.removeItem('kp_user')
    fetch('/api/sales-session', { method: 'DELETE', credentials: 'same-origin' }).catch(() => {})
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateSession, sessionExpired }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
