import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useLang } from '../hooks/useLang'
import LanguageToggle from '../components/LanguageToggle'

export default function Login() {
  const { login } = useAuth()
  const { t } = useLang()
  const a = t.app
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const result = await login(email, password)
    setLoading(false)
    if (!result.success) setError(result.error || a.invalidLogin)
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-lang-row"><LanguageToggle variant="dark" /></div>
        <div className="login-brand-lockup">
          <span className="login-kp-mark" aria-hidden="true">KP</span>
          <span className="login-mark">KuriPuro</span>
        </div>
        <div className="login-sub">BY JBM · BUSINESS PORTAL</div>
        <div className="login-title">{a.signIn}</div>
        <div className="login-hint">{a.loginHint}</div>
        <form onSubmit={handleSubmit}>
          <label htmlFor="login-email">{a.login || a.email}</label>
          <input
            id="login-email"
            name="email"
            type="text"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder={a.loginPlaceholder}
            required
            autoComplete="username"
            autoCapitalize="none"
            spellCheck="false"
          />
          <label htmlFor="login-password">{a.password}</label>
          <input
            id="login-password"
            name="password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            autoComplete="current-password"
          />
          {error && <div className="login-error">{error}</div>}
          <button type="submit" disabled={loading} className="login-go">
            {loading ? a.loading : a.signIn}
          </button>
        </form>
        <div className="login-version">KP · REBUILD COMERCIAL · 2026.10.09 · v1.0.1</div>
      </div>
    </div>
  )
}
