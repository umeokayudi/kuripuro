import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useLang } from '../hooks/useLang'
import PasswordReveal from '../components/PasswordReveal'
import { filterCredentialRows, pickOwnAdmin, updateRowCredentials } from '../lib/accountCredentials'

function errorText(a, code, detail) {
  if (code === 'wrong_current_password') return a.wrongCurrentPassword
  if (code === 'password_too_short') return a.passwordTooShort
  if (code === 'password_required') return a.passwordRequired
  if (code === 'invalid_email' || code === 'email_required') return a.invalidEmail
  if (code === 'nothing_to_update') return a.nothingToUpdate
  if (code === 'email_taken') return a.emailTaken
  if (code === 'password_mismatch') return a.passwordMismatch
  return detail || a.saveFailed
}

function Reveal({ labels: a, value, compact }) {
  return (
    <PasswordReveal
      value={value}
      showLabel={a.showPassword}
      hideLabel={a.hidePassword}
      copyLabel={a.copyPassword}
      copiedLabel={a.copied}
      compact={compact}
    />
  )
}

function ChangeLoginForm({
  labels: a,
  email,
  onSave,
  requireCurrent,
  saving,
  prefillEmail,
  confirmNew,
}) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newEmail, setNewEmail] = useState(prefillEmail ? (email || '') : '')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  useEffect(() => {
    setNewEmail(prefillEmail ? (email || '') : '')
    setNewPassword('')
    setConfirmPassword('')
    setCurrentPassword('')
  }, [email, prefillEmail])

  return (
    <div className="login-form">
      {requireCurrent && (
        <div className="form-group">
          <label>{a.currentPassword}</label>
          <input
            type="password"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
      )}
      <div className="form-group">
        <label>{a.newEmail}</label>
        <input
          type="email"
          value={newEmail}
          onChange={e => setNewEmail(e.target.value)}
          placeholder={email || a.emailLogin}
          autoComplete="username"
        />
      </div>
      <div className="form-group">
        <label>{a.newPassword}</label>
        <input
          type="password"
          value={newPassword}
          onChange={e => setNewPassword(e.target.value)}
          placeholder={a.minChars}
          autoComplete="new-password"
        />
      </div>
      {confirmNew && (
        <div className="form-group">
          <label>{a.confirmPassword}</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder={a.minChars}
            autoComplete="new-password"
          />
        </div>
      )}
      <div className="form-group" style={{ marginBottom: 0 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving}
          onClick={() => onSave({ currentPassword, newEmail, newPassword, confirmPassword })}
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
  const [saving, setSaving] = useState(null)
  const [editStaff, setEditStaff] = useState(null)
  const [editClient, setEditClient] = useState(null)
  const [editAdmin, setEditAdmin] = useState(null)
  const [staffQuery, setStaffQuery] = useState('')
  const [clientQuery, setClientQuery] = useState('')
  const [activeOnly, setActiveOnly] = useState(false)

  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [adminRes, staffRes, clientRes] = await Promise.all([
        supabase.from('admins').select('id,name,email,password').order('name'),
        supabase.from('employees').select('id,full_name,email,password,is_active').order('full_name'),
        supabase.from('client_users').select('id,contact_name,email,password,location_name,client_name,is_active').order('client_name'),
      ])
      if (cancelled) return
      const adminRows = adminRes.data || []
      setAdmins(adminRows)
      setMine(pickOwnAdmin(adminRows, user))
      setStaff(staffRes.data || [])
      setClients(clientRes.error ? [] : (clientRes.data || []))
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [user, reloadTick])

  const otherAdmins = useMemo(
    () => admins.filter(row => row.id !== mine?.id),
    [admins, mine?.id],
  )
  const visibleStaff = useMemo(
    () => filterCredentialRows(staff, staffQuery, { activeOnly }),
    [staff, staffQuery, activeOnly],
  )
  const visibleClients = useMemo(
    () => filterCredentialRows(clients, clientQuery),
    [clients, clientQuery],
  )

  const saveMine = async ({ currentPassword, newEmail, newPassword, confirmPassword }) => {
    if (!mine?.id) return
    setSaving('mine')
    const result = await updateRowCredentials(supabase, {
      table: 'admins',
      id: mine.id,
      currentEmail: mine.email,
      storedPassword: mine.password,
      submittedCurrent: currentPassword,
      newEmail,
      newPassword,
      confirmPassword,
      requireCurrent: true,
    })
    setSaving(null)
    if (!result.ok) return toast.error(errorText(a, result.error, result.detail))
    toast.success(a.credentialsUpdated)
    if (result.patch.email) updateSession({ email: result.patch.email })
    setReloadTick(n => n + 1)
  }

  const saveAdmin = async (row, { newEmail, newPassword }) => {
    setSaving(row.id)
    const result = await updateRowCredentials(supabase, {
      table: 'admins',
      id: row.id,
      currentEmail: row.email,
      storedPassword: row.password,
      newEmail,
      newPassword,
      requireCurrent: false,
    })
    setSaving(null)
    if (!result.ok) return toast.error(errorText(a, result.error, result.detail))
    toast.success(a.credentialsUpdated)
    setEditAdmin(null)
    setReloadTick(n => n + 1)
  }

  const saveStaff = async (row, { newEmail, newPassword }) => {
    setSaving(row.id)
    const result = await updateRowCredentials(supabase, {
      table: 'employees',
      id: row.id,
      currentEmail: row.email,
      storedPassword: row.password,
      newEmail,
      newPassword,
      requireCurrent: false,
    })
    setSaving(null)
    if (!result.ok) return toast.error(errorText(a, result.error, result.detail))
    toast.success(a.credentialsUpdated)
    setEditStaff(null)
    setReloadTick(n => n + 1)
  }

  const saveClient = async (row, { newEmail, newPassword }) => {
    setSaving(row.id)
    const result = await updateRowCredentials(supabase, {
      table: 'client_users',
      id: row.id,
      currentEmail: row.email,
      storedPassword: row.password,
      newEmail,
      newPassword,
      requireCurrent: false,
    })
    setSaving(null)
    if (!result.ok) return toast.error(errorText(a, result.error, result.detail))
    toast.success(a.credentialsUpdated)
    setEditClient(null)
    setReloadTick(n => n + 1)
  }

  if (loading) return <div style={{ color: 'var(--text3)', fontSize: 13 }}>{t.app.loading}</div>

  return (
    <div className="account-page">
      <div className="page-head">
        <h2>{t.sidebar.account}</h2>
        <p>{a.pageHint}</p>
      </div>

      <div className="card">
        <div className="card-title">{a.yourLogin}</div>
        <ol className="login-steps">
          <li>{a.stepShow}</li>
          <li>{a.stepChange}</li>
        </ol>
        {mine ? (
          <>
            <div className="login-identity">
              <div className="form-group">
                <label>{a.name}</label>
                <div className="login-identity-name">{mine.name}</div>
              </div>
              <div className="form-group">
                <label>{a.emailLogin}</label>
                <div className="login-identity-email">{mine.email || '—'}</div>
              </div>
              <div className="form-group">
                <label>{a.currentPasswordShown}</label>
                <Reveal labels={a} value={mine.password} />
              </div>
            </div>
            <div className="login-change-title">{a.changeLogin}</div>
            <ChangeLoginForm
              labels={a}
              email={mine.email}
              requireCurrent
              confirmNew
              prefillEmail={false}
              saving={saving === 'mine'}
              onSave={saveMine}
            />
          </>
        ) : (
          <div style={{ color: 'var(--text3)' }}>{a.noAdminRow}</div>
        )}
      </div>

      {otherAdmins.length > 0 && (
        <div className="card">
          <div className="card-title">{a.admins}</div>
          <p className="login-hint">{a.otherAdminsHint}</p>
          {otherAdmins.map(row => (
            <div key={row.id} className="login-row">
              <div className="login-row-main">
                <div className="login-row-name">{row.name}</div>
                <div className="login-row-meta">{row.email}</div>
                <Reveal labels={a} value={row.password} compact />
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setEditAdmin(editAdmin?.id === row.id ? null : row)}
              >
                {editAdmin?.id === row.id ? a.cancel : a.editLogin}
              </button>
              {editAdmin?.id === row.id && (
                <div className="login-row-edit">
                  <ChangeLoginForm
                    labels={a}
                    email={row.email}
                    requireCurrent={false}
                    prefillEmail
                    saving={saving === row.id}
                    onSave={vals => saveAdmin(row, vals)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-title">{a.staffLogins} ({staff.length})</div>
        <p className="login-hint">{a.staffHint}</p>
        <div className="login-toolbar">
          <input
            className="login-search"
            value={staffQuery}
            onChange={e => setStaffQuery(e.target.value)}
            placeholder={a.searchLogins}
          />
          <label className="login-filter">
            <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} />
            {a.activeOnly}
          </label>
        </div>
        {visibleStaff.map(row => (
          <div key={row.id} className="login-row">
            <div className="login-row-main">
              <div className="login-row-name">{row.full_name}</div>
              <div className="login-row-meta">
                {row.email || '—'} · {row.is_active ? a.active : a.inactive}
              </div>
              <Reveal labels={a} value={row.password} compact />
            </div>
            <div className="login-row-actions">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setEditStaff(editStaff?.id === row.id ? null : row)}
              >
                {editStaff?.id === row.id ? a.cancel : a.editLogin}
              </button>
              <Link className="btn btn-sm" to={`/employees/${row.id}`}>{a.profile}</Link>
            </div>
            {editStaff?.id === row.id && (
              <div className="login-row-edit">
                <ChangeLoginForm
                  labels={a}
                  email={row.email}
                  requireCurrent={false}
                  prefillEmail
                  saving={saving === row.id}
                  onSave={vals => saveStaff(row, vals)}
                />
              </div>
            )}
          </div>
        ))}
        {!staff.length && <div className="login-empty">{a.noStaff}</div>}
        {!!staff.length && !visibleStaff.length && <div className="login-empty">{a.noMatches}</div>}
      </div>

      <div className="card">
        <div className="card-title">{a.clientLogins} ({clients.length})</div>
        <p className="login-hint">{a.clientHint}</p>
        <div className="login-toolbar">
          <input
            className="login-search"
            value={clientQuery}
            onChange={e => setClientQuery(e.target.value)}
            placeholder={a.searchLogins}
          />
        </div>
        {visibleClients.map(row => (
          <div key={row.id} className="login-row">
            <div className="login-row-main">
              <div className="login-row-name">{row.contact_name || row.location_name || row.client_name}</div>
              <div className="login-row-meta">
                {row.client_name}{row.location_name ? ` · ${row.location_name}` : ''} · {row.email || '—'}
                {row.is_active === false ? ` · ${a.inactive}` : ''}
              </div>
              <Reveal labels={a} value={row.password} compact />
            </div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setEditClient(editClient?.id === row.id ? null : row)}
            >
              {editClient?.id === row.id ? a.cancel : a.editLogin}
            </button>
            {editClient?.id === row.id && (
              <div className="login-row-edit">
                <ChangeLoginForm
                  labels={a}
                  email={row.email}
                  requireCurrent={false}
                  prefillEmail
                  saving={saving === row.id}
                  onSave={vals => saveClient(row, vals)}
                />
              </div>
            )}
          </div>
        ))}
        {!clients.length && (
          <div className="login-empty">
            {a.noClients} <Link to="/clients">{a.openClients}</Link>
          </div>
        )}
        {!!clients.length && !visibleClients.length && <div className="login-empty">{a.noMatches}</div>}
      </div>
    </div>
  )
}
