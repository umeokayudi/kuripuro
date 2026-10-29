// Employee portal: "My profile" — own data (read-only, the office edits it) and change password.
import { useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'

const box = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18, padding: 16, marginBottom: 12 }
const input = { width: '100%', padding: '12px 14px', fontSize: 14, borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.06)', color: '#fff', boxSizing: 'border-box', marginTop: 6 }

export default function MyProfile({ user, L }) {
  const [form, setForm] = useState({ current: '', next: '', again: '' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const upd = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: null })) }

  const save = async ev => {
    ev.preventDefault()
    const e = {}
    if (!form.current) e.current = L('Enter your current password', '現在のパスワードを入力', 'Digite a senha atual')
    if (form.next.length < 8) e.next = L('At least 8 characters', '8文字以上', 'Pelo menos 8 caracteres')
    else if (form.next === form.current) e.next = L('Use a different password', '別のパスワードにしてください', 'Use uma senha diferente')
    if (form.again !== form.next) e.again = L('The two passwords do not match', 'パスワードが一致しません', 'As duas senhas não são iguais')
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      const { data: ok, error } = await supabase.from('employees').select('id').eq('id', user.id).eq('password', form.current).maybeSingle()
      if (error) throw error
      if (!ok) { setErrors({ current: L('Current password is wrong', '現在のパスワードが違います', 'Senha atual errada') }); return }
      const { error: upErr } = await supabase.from('employees').update({ password: form.next }).eq('id', user.id)
      if (upErr) throw upErr
      toast.success(L('Password changed', 'パスワードを変更しました', 'Senha alterada'))
      setForm({ current: '', next: '', again: '' })
    } catch (err) {
      toast.error(err?.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  const err = k => errors[k] && <div style={{ color: '#f87171', fontSize: 12, fontWeight: 600, marginTop: 4 }}>{errors[k]}</div>
  return (
    <section>
      <div className="emp-section-heading"><span>{L('Account', 'アカウント', 'Conta')}</span><h1>{L('My profile', 'マイプロフィール', 'Meu perfil')}</h1></div>
      <div style={box}>
        {[[L('Name', '氏名', 'Nome'), user.name], [L('E-mail / login', 'メール / ログイン', 'E-mail / login'), user.email]].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', fontSize: 14 }}>
            <span style={{ opacity: 0.55 }}>{k}</span><strong style={{ textAlign: 'right', overflowWrap: 'anywhere' }}>{v || '—'}</strong>
          </div>
        ))}
        <div style={{ fontSize: 12, opacity: 0.5, marginTop: 6 }}>{L('To change your name, phone or bank, ask the office in Chat.', '氏名・電話・口座の変更はチャットで事務所へ。', 'Para mudar nome, telefone ou banco, peça ao escritório pelo Chat.')}</div>
      </div>
      <form style={box} onSubmit={save}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 8 }}>🔒 {L('Change password', 'パスワード変更', 'Alterar senha')}</div>
        {[['current', L('Current password', '現在のパスワード', 'Senha atual'), 'current-password'], ['next', L('New password', '新しいパスワード', 'Nova senha'), 'new-password'], ['again', L('Repeat the new password', '新しいパスワード（確認）', 'Repita a nova senha'), 'new-password']].map(([k, label, ac]) => (
          <label key={k} style={{ display: 'block', fontSize: 12, marginBottom: 10, opacity: 0.9 }}>{label}
            <input type="password" autoComplete={ac} value={form[k]} onChange={e => upd(k, e.target.value)} style={{ ...input, borderColor: errors[k] ? '#f87171' : 'rgba(255,255,255,0.1)' }} />
            {err(k)}
          </label>
        ))}
        <button type="submit" disabled={busy} style={{ width: '100%', padding: 14, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#60a5fa,#3b82f6)', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
          {busy ? '…' : L('Save new password', '新しいパスワードを保存', 'Salvar nova senha')}
        </button>
      </form>
    </section>
  )
}
