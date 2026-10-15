import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { salesPost } from '../lib/salesApi'
import { RolePicker } from './EmployeeRole'

// v1.0.44 · Edit any login from the Users page: name, e-mail, phone, role,
// active, and set a new password. The current password is never read; leaving
// the password box empty keeps it. Sellers go through the API (hashed password).
// With user.isNew it creates an admin or seller login instead (password required).

const MIN_PASSWORD = { admin: 8, employee: 6, client: 6, salesperson: 10 }

const TXT = {
  en: {
    title: 'Edit login', newTitle: 'New login', created: 'Login created', needPassword: n => `Set a password with at least ${n} characters`, newPasswordLabel: 'Password', name: 'Name', contact: 'Contact name', email: 'E-mail (login)', phone: 'Phone', role: 'Role', team: 'Portal', teamSales: 'Sales (seller portal)', teamMarketing: 'Marketing (marketing portal)',
    password: 'New password', passwordHint: n => `Leave empty to keep the current password. At least ${n} characters.`,
    generate: 'Generate', copy: 'Copy', copied: 'Copied', active: 'Can sign in (active)', save: 'Save', cancel: 'Cancel',
    saved: 'Saved', saving: 'Saving…', needName: 'Write the name', badEmail: 'Write a valid e-mail', emailUsed: 'This e-mail already has a login',
    shortPassword: n => `The password needs at least ${n} characters`,
    tellUser: 'Send the new password to the person; it is not shown again.', storeHint: 'Store logins can also sign in with the store name.',
  },
  ja: {
    title: 'ログインを編集', newTitle: '新しいログイン', created: 'ログインを作成しました', needPassword: n => `${n}文字以上のパスワードを設定してください`, newPasswordLabel: 'パスワード', name: '氏名', contact: '担当者名', email: 'メール（ログイン）', phone: '電話', role: '役割', team: 'ポータル', teamSales: '営業（営業ポータル）', teamMarketing: 'マーケティング（マーケティングポータル）',
    password: '新しいパスワード', passwordHint: n => `空欄なら現在のパスワードのままです。${n}文字以上。`,
    generate: '自動生成', copy: 'コピー', copied: 'コピーしました', active: 'ログイン可能（有効）', save: '保存', cancel: 'キャンセル',
    saved: '保存しました', saving: '保存中…', needName: '氏名を入力してください', badEmail: '正しいメールを入力してください', emailUsed: 'このメールはすでに使われています',
    shortPassword: n => `パスワードは${n}文字以上必要です`,
    tellUser: '新しいパスワードを本人に伝えてください。再表示はされません。', storeHint: '店舗ログインは店舗名でもログインできます。',
  },
}

function randomPassword(length) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint32Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => chars[b % chars.length]).join('')
}

export default function UserEditDialog({ user, allRows, lang = 'en', typeLabel, onClose, onSaved }) {
  const t = TXT[lang === 'ja' ? 'ja' : 'en']
  const min = MIN_PASSWORD[user.type] || 8
  const [form, setForm] = useState(() => ({
    name: user.type === 'client' ? (user.contact_name || '') : (user.name || ''),
    email: user.email || '',
    phone: user.phone || '',
    role: user.role || '',
    team: user.team || 'sales',
    password: '',
    active: user.active !== false,
  }))
  const [saving, setSaving] = useState(false)
  const isNew = Boolean(user.isNew)
  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = async e => {
    e.preventDefault()
    const name = form.name.trim()
    const email = form.email.trim().toLowerCase()
    const password = form.password.trim()
    if (!name && user.type !== 'client') return toast.error(t.needName)
    if (!email.includes('@') && !(user.type === 'client' && !email && !user.email)) return toast.error(t.badEmail)
    if (email && allRows.some(r => !(r.type === user.type && r.id === user.id) && String(r.email || '').toLowerCase() === email)) return toast.error(t.emailUsed)
    if (password && password.length < min) return toast.error(t.shortPassword(min))
    if (isNew && !password) return toast.error(t.needPassword(min))
    setSaving(true)
    try {
      let patchRow = { email: email || null, active: form.active }
      if (isNew) {
        if (user.type === 'salesperson') {
          await salesPost('/api/sales-data', { action: 'create-salesperson', full_name: name, email, phone: form.phone.trim(), password, team: form.team }, lang)
        } else {
          const { error } = await supabase.from('admins').insert({ name, email, password })
          if (error) throw new Error(error.code === '23505' ? t.emailUsed : error.message)
        }
        toast.success(`${t.created} · ${t.tellUser}`, { duration: 6000 })
        onSaved(null)
        return
      }
      if (user.type === 'salesperson') {
        const body = { action: 'update-salesperson', salesperson_id: user.id, full_name: name, email, phone: form.phone.trim(), is_active: form.active, team: form.team }
        if (password) body.password = password
        await salesPost('/api/sales-data', body, lang)
        patchRow = { ...patchRow, name, phone: form.phone.trim(), team: form.team }
      } else {
        let table, patch
        if (user.type === 'admin') {
          table = 'admins'; patch = { name, email }
          patchRow = { email, name, active: true }
        } else if (user.type === 'employee') {
          table = 'employees'; patch = { full_name: name, email, phone: form.phone.trim() || null, job_role: form.role.trim() || null, is_active: form.active }
          patchRow = { ...patchRow, name, phone: form.phone.trim(), role: form.role.trim() || null }
        } else {
          table = 'client_users'; patch = { contact_name: name || null, email: email || null, is_active: form.active }
          patchRow = { ...patchRow, contact_name: name, name: name || user.place || user.email }
        }
        if (password) patch.password = password
        const { error } = await supabase.from(table).update(patch).eq('id', user.id)
        if (error) throw new Error(error.code === '23505' ? t.emailUsed : error.message)
      }
      toast.success(password ? `${t.saved} · ${t.tellUser}` : t.saved, { duration: password ? 6000 : 3000 })
      onSaved(patchRow)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const copyPassword = async () => {
    try { await navigator.clipboard.writeText(form.password); toast.success(t.copied) } catch { /* clipboard blocked */ }
  }

  return (
    <div className="kp-dialog-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <form className="kp-dialog" role="dialog" aria-modal="true" aria-label={isNew ? t.newTitle : t.title} onSubmit={save}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 800, flex: 1, minWidth: 0 }}>{isNew ? t.newTitle : t.title}</div>
          <span className={`kp-type-badge kp-type-${user.type}`}>{typeLabel}</span>
          <button type="button" className="kp-dialog-x" onClick={onClose} aria-label={t.cancel}>×</button>
        </div>
        {user.type === 'client' && user.place && <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>{user.place}</div>}

        <div className="form-group"><label>{user.type === 'client' ? t.contact : t.name}</label><input value={form.name} onChange={e => upd('name', e.target.value)} autoFocus /></div>
        <div className="form-group"><label>{t.email}</label><input type="email" value={form.email} onChange={e => upd('email', e.target.value)} autoComplete="off" /></div>
        {(user.type === 'employee' || user.type === 'salesperson') && (
          <div className="form-group"><label>{t.phone}</label><input value={form.phone} onChange={e => upd('phone', e.target.value)} /></div>
        )}
        {user.type === 'salesperson' && (
          <div className="form-group"><label>{t.team}</label>
            <select value={form.team} onChange={e => upd('team', e.target.value)}>
              <option value="sales">{t.teamSales}</option>
              <option value="marketing">{t.teamMarketing}</option>
            </select>
          </div>
        )}
        {user.type === 'employee' && (
          <div className="form-group"><label>{t.role}</label><RolePicker value={form.role} onChange={v => upd('role', v)} lang={lang} /></div>
        )}

        <div className="form-group">
          <label>{isNew ? `${t.newPasswordLabel} *` : t.password}</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="text" value={form.password} onChange={e => upd('password', e.target.value)} autoComplete="new-password" spellCheck={false} style={{ flex: 1, minWidth: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }} />
            <button type="button" className="btn btn-sm" onClick={() => upd('password', randomPassword(Math.max(min, 10)))}>{t.generate}</button>
            {form.password && <button type="button" className="btn btn-sm" onClick={copyPassword}>{t.copy}</button>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5 }}>{isNew ? t.shortPassword(min) + '.' : t.passwordHint(min)}{user.type === 'client' ? ` ${t.storeHint}` : ''}</div>
        </div>

        {user.type !== 'admin' && !isNew && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, margin: '4px 0 14px' }}>
            <input type="checkbox" checked={form.active} onChange={e => upd('active', e.target.checked)} style={{ width: 16, height: 16 }} />
            {t.active}
          </label>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>{t.cancel}</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? t.saving : t.save}</button>
        </div>
      </form>
    </div>
  )
}
