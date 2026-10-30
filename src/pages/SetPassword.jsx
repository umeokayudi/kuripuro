// v1.0.117 · Public page opened from the "set your password" link (see lib/passwordLink.js).
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLang, pickLang } from '../hooks/useLang'
import LanguageToggle from '../components/LanguageToggle'
import { readSetupLink, passwordProblem, completeSetup } from '../lib/passwordLink'

export default function SetPassword() {
  const { lang } = useLang()
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const link = readSetupLink(window.location.search)
  const [pw, setPw] = useState('')
  const [again, setAgain] = useState('')
  const [state, setState] = useState(link ? 'form' : 'used')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async e => {
    e.preventDefault()
    const problem = passwordProblem(pw, again)
    if (problem) return setError(problem === 'mismatch'
      ? L('The two passwords do not match', 'パスワードが一致しません', 'As duas senhas não são iguais')
      : L('Use at least 8 characters', '8文字以上にしてください', 'Use pelo menos 8 caracteres'))
    setBusy(true); setError('')
    try { setState(await completeSetup(supabase, { ...link, password: pw })) }
    catch (err) { setError(err.message) }
    setBusy(false)
  }

  const goLogin = () => { window.location.href = '/' }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-lang-row"><LanguageToggle variant="dark" /></div>
        <div className="login-brand-lockup">
          <span className="login-kp-mark" aria-hidden="true">KP</span>
          <span className="login-mark">KuriPuro</span>
        </div>
        <div className="login-sub">BY JBM · BUSINESS PORTAL</div>
        {state === 'form' && <>
          <div className="login-title">{L('Create your password', 'パスワードを作成', 'Crie sua senha')}</div>
          <div className="login-hint">{link.email}</div>
          <form onSubmit={save}>
            <label htmlFor="sp-pw">{L('New password (8+ characters)', '新しいパスワード（8文字以上）', 'Nova senha (8+ caracteres)')}</label>
            <input id="sp-pw" type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" required />
            <label htmlFor="sp-again">{L('Repeat the password', 'パスワード（確認）', 'Repita a senha')}</label>
            <input id="sp-again" type="password" value={again} onChange={e => setAgain(e.target.value)} autoComplete="new-password" required />
            {error && <div className="login-error">{error}</div>}
            <button type="submit" disabled={busy} className="login-go">{busy ? '…' : L('Save password', 'パスワードを保存', 'Salvar senha')}</button>
          </form>
        </>}
        {state === 'ok' && <>
          <div className="login-title">✅ {L('Password saved', 'パスワードを保存しました', 'Senha salva')}</div>
          <div className="login-hint">{L('Sign in with your e-mail and the new password.', 'メールと新しいパスワードでログインしてください。', 'Entre com seu e-mail e a nova senha.')}</div>
          <button type="button" className="login-go" onClick={goLogin}>{L('Go to sign in', 'ログインへ', 'Ir para o login')}</button>
        </>}
        {state === 'used' && <>
          <div className="login-title">{L('This link no longer works', 'このリンクは使えません', 'Este link não vale mais')}</div>
          <div className="login-hint">{L('It was already used or is incomplete. Ask the office for a new link.', 'すでに使用済みか、不完全です。事務所に新しいリンクを依頼してください。', 'Ele já foi usado ou está incompleto. Peça um novo link ao escritório.')}</div>
          <button type="button" className="login-go" onClick={goLogin}>{L('Go to sign in', 'ログインへ', 'Ir para o login')}</button>
        </>}
      </div>
    </div>
  )
}
