import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useLang } from '../hooks/useLang'
import PasswordReveal from '../components/PasswordReveal'
import { updateRowCredentials } from '../lib/accountCredentials'

function errorText(a, code, detail) {
  if (code === 'wrong_current_password') return a.wrongCurrentPassword
  if (code === 'password_too_short') return a.passwordTooShort
  if (code === 'password_required') return a.passwordRequired
  if (code === 'invalid_email' || code === 'email_required') return a.invalidEmail
  if (code === 'nothing_to_update') return a.nothingToUpdate
  if (code === 'email_taken') return a.emailTaken
  return detail || a.saveFailed
}

function LoginEdit({
  labels: a,
  email,
  password,
  onSave,
  requireCurrent,
  saving,
  name,
}) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newEmail, setNewEmail] = useState(email || '')
  const [newPassword, setNewPassword] = useState('')

  useEffect(() => {
    setNewEmail(email || '')
    setNewPassword('')
    setCurrentPassword('')
  }, [email, password])

  return (
    <div className="grid-2">
      {name != null && (
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>{a.name}</label>
          <div style={{ fontWeight: 650 }}>{name}</div>
        </div>
      )}
      <div className="form-group">
        <label>{a.emailLogin}</label>
        <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} autoComplete="username" />
      </div>
      <div className="form-group">
        <label>{a.currentPasswordShown}</label>
        <PasswordReveal value={password} showLabel={a.showPassword} hideLabel={a.hidePassword} />
      </div>
      {requireCurrent && (
        <div className="form-group">
          <label>{a.currentPassword}</label>
          <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} autoComplete="current-password" />
        </div>
      )}
      <div className="form-group">
        <label>{a.newPassword}</label>
        <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder={a.minChars} autoComplete="new-password" />
      </div>
      <div className="form-group" style={{ gridColumn: '1 / -1' }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving}
          onClick={() => onSave({ currentPassword, newEmail, newPassword })}
        >
          {saving ? a.saving : a.saveCredentials}
        </button>
      </div>
    </div>
  )
}

export default function Account() {
  const { user, updateSession } = useAuth()
  const { t } = useLang()
  const a = t.account
  const [mine, setMine] = useState(null)
  const [admins, setAdmins] = useState([])
  const [staff, setStaff] = useState([])
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editStaff, setEditStaff] = useState(null)
  const [editClient, setEditClient] = useState(null)

  const load = async () => {
    setLoading(true)
    const [adminRes, staffRes, clientRes] = await Promise.all([
      supabase.from('admins').select('id,name,email,password').order('name'),
      supabase.from('employees').select('id,full_name,email,password,is_active').order('full_name'),
      supabase.from('client_users').select('id,contact_name,email,password,location_name,client_name,is_active').order('client_name'),
    ])
    const adminRows = adminRes.data || []
    setAdmins(adminRows)
    setMine(adminRows.find(r => r.id === user?.id) || adminRows.find(r => r.email === user?.email) || adminRows[0] || null)
    setStaff(staffRes.data || [])
    setClients(clientRes.error ? [] : (clientRes.data || []))
    setLoading(false)
  }

  useEffect(() => { load() }, [user?.id])

  const saveMine = async ({ currentPassword, newEmail, newPassword }) => {
    if (!mine?.id) return
    setSaving(true)
    const result = await updateRowCredentials(supabase, {
      table: 'admins',
      id: mine.id,
      currentEmail: mine.email,
      storedPassword: mine.password,
      submittedCurrent: currentPassword,
      newEmail,
      newPassword,
      requireCurrent: true,
    })
    setSaving(false)
    if (!result.ok) return toast.error(errorText(a, result.error, result.detail))
    toast.success(a.credentialsUpdated)
    if (result.patch.email || result.patch.password) {
      updateSession({
        email: result.patch.email || mine.email,
      })
    }
    load()
  }

  const saveStaff = async (row, { newEmail, newPassword }) => {
    setSaving(true)
    const result = await updateRowCredentials(supabase, {
      table: 'employees',
      id: row.id,
      currentEmail: row.email,
      storedPassword: row.password,
      newEmail,
      newPassword,
      requireCurrent: false,
    })
    setSaving(false)
    if (!result.ok) return toast.error(errorText(a, result.error, result.detail))
    toast.success(a.credentialsUpdated)
    setEditStaff(null)
    load()
  }

  const saveClient = async (row, { newEmail, newPassword }) => {
    setSaving(true)
    const result = await updateRowCredentials(supabase, {
      table: 'client_users',
      id: row.id,
      currentEmail: row.email,
      storedPassword: row.password,
      newEmail,
      newPassword,
      requireCurrent: false,
    })
    setSaving(false)
    if (!result.ok) return toast.error(errorText(a, result.error, result.detail))
    toast.success(a.credentialsUpdated)
    setEditClient(null)
    load()
  }

  if (loading) return <div style={{ color: 'var(--text3)', fontSize: 13 }}>{t.app.loading}</div>

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">{a.yourLogin}</div>
        <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 14px', lineHeight: 1.5 }}>{a.yourLoginHint}</p>
        {mine ? (
          <LoginEdit
            labels={a}
            name={mine.name}
            email={mine.email}
            password={mine.password}
            requireCurrent
            saving={saving && !editStaff && !editClient}
            onSave={saveMine}
          />
        ) : (
          <div style={{ color: 'var(--text3)' }}>{a.noAdminRow}</div>
        )}
      </div>

      {admins.length > 1 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">{a.admins}</div>
          {admins.map(row => (
            <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 650 }}>{row.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{row.email}</div>
              </div>
              <PasswordReveal value={row.password} showLabel={a.showPassword} hideLabel={a.hidePassword} compact />
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">{a.staffLogins}</div>
        <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 12px', lineHeight: 1.5 }}>{a.staffHint}</p>
        {staff.map(row => (
          <div key={row.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 650 }}>{row.full_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>{row.email || '—'} · {row.is_active ? a.active : a.inactive}</div>
                <PasswordReveal value={row.password} showLabel={a.showPassword} hideLabel={a.hidePassword} compact />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-sm" onClick={() => setEditStaff(editStaff?.id === row.id ? null : row)}>
                  {editStaff?.id === row.id ? a.cancel : a.editLogin}
                </button>
                <Link className="btn btn-sm" to={`/employees/${row.id}`}>{a.profile}</Link>
              </div>
            </div>
            {editStaff?.id === row.id && (
              <div style={{ marginTop: 12 }}>
                <LoginEdit
                  labels={a}
                  email={row.email}
                  password={row.password}
                  requireCurrent={false}
                  saving={saving}
                  onSave={vals => saveStaff(row, vals)}
                />
              </div>
            )}
          </div>
        ))}
        {!staff.length && <div style={{ color: 'var(--text3)', fontSize: 13 }}>{a.noStaff}</div>}
      </div>

      <div className="card">
        <div className="card-title">{a.clientLogins}</div>
        <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 12px', lineHeight: 1.5 }}>{a.clientHint}</p>
        {clients.map(row => (
          <div key={row.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 650 }}>{row.contact_name || row.location_name || row.client_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>
                  {row.client_name}{row.location_name ? ` · ${row.location_name}` : ''} · {row.email || '—'}
                </div>
                <PasswordReveal value={row.password} showLabel={a.showPassword} hideLabel={a.hidePassword} compact />
              </div>
              <button type="button" className="btn btn-sm" onClick={() => setEditClient(editClient?.id === row.id ? null : row)}>
                {editClient?.id === row.id ? a.cancel : a.editLogin}
              </button>
            </div>
            {editClient?.id === row.id && (
              <div style={{ marginTop: 12 }}>
                <LoginEdit
                  labels={a}
                  email={row.email}
                  password={row.password}
                  requireCurrent={false}
                  saving={saving}
                  onSave={vals => saveClient(row, vals)}
                />
              </div>
            )}
          </div>
        ))}
        {!clients.length && (
          <div style={{ color: 'var(--text3)', fontSize: 13 }}>
            {a.noClients} <Link to="/clients">{a.openClients}</Link>
          </div>
        )}
      </div>
    </div>
  )
}
