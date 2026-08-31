import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { findClientUserForLogin, clientUserToSession } from '../lib/clientCredentials'

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const saved = localStorage.getItem('kp_user')
    if (saved) { try { setUser(JSON.parse(saved)) } catch {} }
    setLoading(false)
  }, [])

  const login = async (email, password) => {
    const em = email.trim().toLowerCase()
    const pw = password.trim()

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
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateSession }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
