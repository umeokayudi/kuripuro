import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import PasswordReveal from './PasswordReveal'
import { updateRowCredentials } from '../lib/accountCredentials'

function mapError(labels, code, detail) {
  if (code === 'wrong_current_password') return labels.wrongCurrentPassword
  if (code === 'password_too_short') return labels.passwordTooShort
  if (code === 'invalid_email' || code === 'email_required') return labels.invalidEmail
  if (code === 'nothing_to_update') return labels.nothingToUpdate
  if (code === 'email_taken') return labels.emailTaken
  return detail || labels.saveFailed
}

export default function EmployeeAccountPanel({ user, labels, updateSession }) {
  const [row, setRow] = useState(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newEmail, setNewEmail] = useState(user?.email || '')
  const [newPassword, setNewPassword] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const { data } = await supabase
        .from('employees')
        .select('id,email,password,full_name')
        .eq('id', user.id)
        .maybeSingle()
      if (cancelled) return
      setRow(data)
      setNewEmail(data?.email || user.email || '')
    }
    load()
    return () => { cancelled = true }
  }, [user.id, user.email])

  const save = async () => {
    if (!row?.id) return
    setSaving(true)
    const result = await updateRowCredentials(supabase, {
      table: 'employees',
      id: row.id,
      currentEmail: row.email,
      storedPassword: row.password,
      submittedCurrent: currentPassword,
      newEmail,
      newPassword,
      requireCurrent: true,
    })
    setSaving(false)
    if (!result.ok) return toast.error(mapError(labels, result.error, result.detail))
    toast.success(labels.credentialsUpdated)
    updateSession?.({ email: result.patch.email || row.email })
    setCurrentPassword('')
    setNewPassword('')
    const { data } = await supabase.from('employees').select('id,email,password,full_name').eq('id', user.id).maybeSingle()
    setRow(data)
    setNewEmail(data?.email || '')
  }

  const field = {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.06)',
    color: '#fff',
    fontSize: 14,
    boxSizing: 'border-box',
    marginBottom: 12,
  }

  return (
    <div>
      <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', marginBottom: 6 }}>{labels.accountTitle}</div>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 16, lineHeight: 1.5 }}>{labels.accountHint}</div>

      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>{labels.emailLogin}</div>
      <div style={{ fontSize: 14, color: '#fff', marginBottom: 12 }}>{row?.email || user.email}</div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>{labels.currentPasswordShown}</div>
      <div style={{ marginBottom: 16 }}>
        <PasswordReveal
          value={row?.password}
          showLabel={labels.showPassword}
          hideLabel={labels.hidePassword}
          copyLabel={labels.copyPassword}
          copiedLabel={labels.copied}
          dark
        />
      </div>

      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>{labels.currentPassword}</div>
      <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} style={field} autoComplete="current-password" />
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>{labels.newEmail}</div>
      <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} style={field} autoComplete="email" />
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>{labels.newPassword}</div>
      <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder={labels.minChars} style={field} autoComplete="new-password" />

      <button
        type="button"
        disabled={saving}
        onClick={save}
        style={{
          width: '100%', padding: 16, borderRadius: 14, border: 'none', fontSize: 15, fontWeight: 800,
          background: saving ? 'rgba(255,255,255,0.08)' : 'linear-gradient(135deg,#c19c56,#e8c47a)',
          color: saving ? 'rgba(255,255,255,0.3)' : '#0a1929',
          cursor: saving ? 'not-allowed' : 'pointer',
        }}
      >
        {saving ? labels.saving : labels.saveCredentials}
      </button>
    </div>
  )
}
