import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useLang } from '../hooks/useLang'

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

  const IS = { width:'100%', padding:'10px 12px', fontSize:14, borderRadius:8, border:'1px solid rgba(255,255,255,0.15)', background:'rgba(255,255,255,0.07)', color:'#fff', fontFamily:'inherit', boxSizing:'border-box' }

  return (
    <div style={{ minHeight:'100vh', background:'#0d2137', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ textAlign:'center', marginBottom:32 }}>
        <div style={{ fontSize:32, fontWeight:700, color:'#c19c56' }}>KuriPuro</div>
        <div style={{ fontSize:12, color:'rgba(255,255,255,0.35)', marginTop:4 }}>by JBM</div>
      </div>
      <div style={{ background:'rgba(255,255,255,0.06)', borderRadius:16, padding:'32px 28px', width:'100%', maxWidth:360 }}>
        <div style={{ fontSize:16, fontWeight:600, color:'#fff', marginBottom:22, textAlign:'center' }}>{a.signIn}</div>
        <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
            <label htmlFor="login-email" style={{ fontSize:12, color:'rgba(255,255,255,0.5)' }}>{a.login || a.email}</label>
            <input id="login-email" name="email" type="text" value={email} onChange={e=>setEmail(e.target.value)} placeholder={a.loginPlaceholder || 'your@email.com'} required style={IS} autoComplete="username" />
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
            <label htmlFor="login-password" style={{ fontSize:12, color:'rgba(255,255,255,0.5)' }}>{a.password}</label>
            <input id="login-password" name="password" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" required style={IS} autoComplete="current-password" />
          </div>
          {error && <div style={{ background:'rgba(248,113,113,0.12)', borderRadius:8, padding:'9px 12px', fontSize:13, color:'#f87171', textAlign:'center' }}>{error}</div>}
          <button type="submit" disabled={loading} style={{ padding:'13px', borderRadius:10, border:'none', background:'#c19c56', color:'#0d2137', fontWeight:700, fontSize:15, cursor:'pointer', marginTop:4 }}>
            {loading ? a.loading : a.signIn}
          </button>
        </form>
      </div>
    </div>
  )
}
