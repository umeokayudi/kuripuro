import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { salesPost } from '../lib/salesApi'
import { useLang } from '../hooks/useLang'
import { useAuth } from '../hooks/useAuth'
import { RoleBadge } from '../components/EmployeeRole'
import UserEditDialog from '../components/UserEditDialog'

// v1.0.35 · One place for every login: admins, employees, sellers and client logins.
// Each type still lives in its own table; this page only lists them together.
// Passwords are never read here.

const TXT = {
  en: {
    title: 'Users', hint: 'Every login on KuriPuro: admins, employees, sellers and client logins.',
    all: 'All', admin: 'Admins', employee: 'Employees', salesperson: 'Sellers', client: 'Clients',
    typeOne: { admin: 'Admin', employee: 'Employee', salesperson: 'Seller', client: 'Client' },
    search: 'Search name, e-mail, role or store…', showInactive: 'Show inactive',
    active: 'Active', inactive: 'Inactive', open: 'Open', edit: 'Edit', activate: 'Activate', deactivate: 'Deactivate',
    lastSeen: 'Last seen', never: 'never', add: '+ Add user', addAdmin: 'New admin', addEmployee: 'Employee', addSeller: 'Seller', addClient: 'Client login',
    whichType: 'What kind of login?', name: 'Name', email: 'E-mail', password: 'Password (8+ characters)', create: 'Create admin', cancel: 'Cancel',
    created: 'Admin created', emailUsed: 'This e-mail already has a login', fillAll: 'Fill name, e-mail and a password with 8+ characters',
    empty: 'No users match.', loading: 'Loading…', you: 'you', partners: 'Business partners →', saved: 'Saved',
  },
  ja: {
    title: 'ユーザー', hint: 'KuriPuroのすべてのログイン（管理者・従業員・営業・クライアント）。',
    all: 'すべて', admin: '管理者', employee: '従業員', salesperson: '営業', client: 'クライアント',
    typeOne: { admin: '管理者', employee: '従業員', salesperson: '営業', client: 'クライアント' },
    search: '名前・メール・役割・店舗で検索…', showInactive: '無効も表示',
    active: '有効', inactive: '無効', open: '開く', edit: '編集', activate: '有効にする', deactivate: '無効にする',
    lastSeen: '最終利用', never: 'なし', add: '+ ユーザー追加', addAdmin: '新しい管理者', addEmployee: '従業員', addSeller: '営業', addClient: 'クライアントログイン',
    whichType: 'どの種類のログイン？', name: '氏名', email: 'メール', password: 'パスワード（8文字以上）', create: '管理者を作成', cancel: 'キャンセル',
    created: '管理者を作成しました', emailUsed: 'このメールはすでに使われています', fillAll: '氏名・メール・8文字以上のパスワードを入力してください',
    empty: '該当するユーザーはいません。', loading: '読み込み中…', you: 'あなた', partners: 'ビジネスパートナー →', saved: '保存しました',
  },
}

const TYPES = ['admin', 'employee', 'salesperson', 'client']

function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?'
}

export default function Users() {
  const { lang } = useLang()
  const { user: me, updateSession } = useAuth()
  const navigate = useNavigate()
  const t = TXT[lang === 'ja' ? 'ja' : 'en']
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [adding, setAdding] = useState(false)
  const [adminForm, setAdminForm] = useState(null)
  const [busy, setBusy] = useState('')
  const [editing, setEditing] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [admins, employees, sellers, clients] = await Promise.all([
      supabase.from('admins').select('id,name,email,created_at').order('name'),
      supabase.from('employees').select('id,full_name,email,phone,is_active,job_role,last_seen,created_at').order('full_name'),
      supabase.from('salespeople').select('id,full_name,email,phone,is_active,created_at').order('full_name'),
      supabase.from('client_users').select('id,client_id,client_name,location_name,contact_name,email,is_active,last_seen,created_at').order('client_name'),
    ])
    setRows([
      ...(admins.data || []).map(a => ({ type: 'admin', id: a.id, name: a.name || a.email, email: a.email, active: true, created_at: a.created_at })),
      ...(employees.data || []).map(e => ({ type: 'employee', id: e.id, name: e.full_name, email: e.email, phone: e.phone, active: e.is_active !== false, role: e.job_role, last_seen: e.last_seen, created_at: e.created_at })),
      ...(sellers.data || []).map(s => ({ type: 'salesperson', id: s.id, name: s.full_name, email: s.email, phone: s.phone, active: s.is_active !== false, created_at: s.created_at })),
      ...(clients.data || []).map(c => ({ type: 'client', id: c.id, client_id: c.client_id, name: c.contact_name || c.location_name || c.client_name || c.email, contact_name: c.contact_name, email: c.email, place: [c.client_name, c.location_name].filter(Boolean).join(' · '), active: c.is_active !== false, last_seen: c.last_seen, created_at: c.created_at })),
    ])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const counts = useMemo(() => {
    const c = { all: 0 }
    for (const type of TYPES) c[type] = 0
    for (const r of rows) if (r.active || showInactive) { c.all += 1; c[r.type] += 1 }
    return c
  }, [rows, showInactive])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(r => {
      if (filter !== 'all' && r.type !== filter) return false
      if (!r.active && !showInactive) return false
      if (!q) return true
      return [r.name, r.email, r.phone, r.place, r.role].some(v => String(v || '').toLowerCase().includes(q))
    })
  }, [rows, filter, query, showInactive])

  const fmtSeen = iso => {
    if (!iso) return t.never
    return new Date(iso).toLocaleString(lang === 'ja' ? 'ja-JP' : 'en-GB', { timeZone: 'Asia/Tokyo', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  const open = r => {
    if (r.type === 'employee') navigate(`/employees/${r.id}`)
    else if (r.type === 'salesperson') navigate('/sales-team')
    else if (r.type === 'client') navigate(r.client_id ? `/clients?search=${encodeURIComponent(r.client_id)}` : '/clients')
  }

  const toggleActive = async r => {
    setBusy(r.type + r.id)
    try {
      if (r.type === 'salesperson') {
        await salesPost('/api/sales-data', { action: 'set-salesperson-active', salesperson_id: r.id, is_active: !r.active }, lang)
      } else {
        const table = r.type === 'employee' ? 'employees' : 'client_users'
        const { error } = await supabase.from(table).update({ is_active: !r.active }).eq('id', r.id)
        if (error) throw error
      }
      setRows(list => list.map(x => (x.type === r.type && x.id === r.id ? { ...x, active: !r.active } : x)))
      toast.success(t.saved)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy('')
    }
  }

  const createAdmin = async e => {
    e.preventDefault()
    const name = adminForm.name.trim()
    const email = adminForm.email.trim().toLowerCase()
    if (!name || !email.includes('@') || adminForm.password.length < 8) return toast.error(t.fillAll)
    if (rows.some(r => String(r.email || '').toLowerCase() === email)) return toast.error(t.emailUsed)
    setBusy('new-admin')
    const { error } = await supabase.from('admins').insert({ name, email, password: adminForm.password })
    setBusy('')
    if (error) return toast.error(error.message)
    toast.success(t.created)
    setAdminForm(null)
    setAdding(false)
    load()
  }

  const pick = type => {
    if (type === 'admin') { setAdminForm({ name: '', email: '', password: '' }); return }
    setAdding(false)
    if (type === 'employee') navigate('/employees?tab=register')
    if (type === 'salesperson') navigate('/sales-team')
    if (type === 'client') navigate('/clients')
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{t.title}</h2>
          <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4 }}>{t.hint}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={() => navigate('/partners')}>{t.partners}</button>
          <button type="button" className="btn btn-primary" onClick={() => { setAdding(v => !v); setAdminForm(null) }}>{t.add}</button>
        </div>
      </div>

      {adding && (
        <div className="card" style={{ marginBottom: 14 }}>
          {!adminForm ? (
            <>
              <div className="card-title">{t.whichType}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn" onClick={() => pick('admin')}><span className="kp-type-badge kp-type-admin">{t.typeOne.admin}</span>&nbsp;{t.addAdmin}</button>
                <button type="button" className="btn" onClick={() => pick('employee')}><span className="kp-type-badge kp-type-employee">{t.typeOne.employee}</span>&nbsp;{t.addEmployee} →</button>
                <button type="button" className="btn" onClick={() => pick('salesperson')}><span className="kp-type-badge kp-type-salesperson">{t.typeOne.salesperson}</span>&nbsp;{t.addSeller} →</button>
                <button type="button" className="btn" onClick={() => pick('client')}><span className="kp-type-badge kp-type-client">{t.typeOne.client}</span>&nbsp;{t.addClient} →</button>
              </div>
            </>
          ) : (
            <form onSubmit={createAdmin}>
              <div className="card-title">{t.addAdmin}</div>
              <div className="grid-2">
                <div className="form-group"><label>{t.name}</label><input value={adminForm.name} onChange={e => setAdminForm(f => ({ ...f, name: e.target.value }))} /></div>
                <div className="form-group"><label>{t.email}</label><input type="email" value={adminForm.email} onChange={e => setAdminForm(f => ({ ...f, email: e.target.value }))} /></div>
                <div className="form-group"><label>{t.password}</label><input type="text" autoComplete="new-password" value={adminForm.password} onChange={e => setAdminForm(f => ({ ...f, password: e.target.value }))} /></div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn btn-primary" disabled={busy === 'new-admin'}>{t.create}</button>
                <button type="button" className="btn" onClick={() => { setAdminForm(null); setAdding(false) }}>{t.cancel}</button>
              </div>
            </form>
          )}
        </div>
      )}

      <div className="kp-users-kpis">
        {['all', ...TYPES].map(k => (
          <button key={k} type="button" className={`kp-users-kpi${filter === k ? ' active' : ''}`} onClick={() => setFilter(k)} aria-pressed={filter === k}>
            <strong>{counts[k]}</strong><span>{t[k]}</span>
          </button>
        ))}
      </div>

      <div className="kp-users-toolbar">
        <div className="form-group"><input value={query} onChange={e => setQuery(e.target.value)} placeholder={t.search} aria-label={t.search} /></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} style={{ width: 16, height: 16 }} />
          {t.showInactive}
        </label>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading && <div style={{ padding: 16, fontSize: 13, color: 'var(--text3)' }}>{t.loading}</div>}
        {!loading && !visible.length && <div style={{ padding: 16, fontSize: 13, color: 'var(--text3)' }}>{t.empty}</div>}
        {visible.map(r => (
          <div key={r.type + r.id} className="kp-users-row" style={{ opacity: r.active ? 1 : 0.6 }}>
            <div className="avatar" style={{ width: 38, height: 38, fontSize: 13, fontWeight: 700, background: 'var(--surface2)', color: 'var(--text2)', flexShrink: 0 }}>{initials(r.name)}</div>
            <div className="kp-users-main">
              <div className="kp-users-name">
                {r.name}
                {me?.role === 'admin' && r.type === 'admin' && r.id === me.id && <span style={{ fontSize: 11, color: 'var(--text3)' }}>({t.you})</span>}
                <span className={`kp-type-badge kp-type-${r.type}`}>{t.typeOne[r.type]}</span>
                {r.type === 'employee' && <RoleBadge value={r.role} lang={lang} size="sm" />}
                {!r.active && <span className="badge badge-red">{t.inactive}</span>}
              </div>
              <div className="kp-users-meta">
                {[r.email, r.place, r.phone].filter(Boolean).join(' · ')}
                {(r.type === 'employee' || r.type === 'client') && <> · {t.lastSeen}: {fmtSeen(r.last_seen)}</>}
              </div>
            </div>
            <div className="kp-users-actions">
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditing(r)}>{t.edit}</button>
              {r.type !== 'admin' && <button type="button" className="btn btn-sm" onClick={() => open(r)}>{t.open}</button>}
              {r.type !== 'admin' && (
                <button type="button" className="btn btn-sm" disabled={busy === r.type + r.id} onClick={() => toggleActive(r)}>
                  {r.active ? t.deactivate : t.activate}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <UserEditDialog
          user={editing}
          allRows={rows}
          lang={lang}
          typeLabel={t.typeOne[editing.type]}
          onClose={() => setEditing(null)}
          onSaved={patch => {
            setRows(list => list.map(x => (x.type === editing.type && x.id === editing.id ? { ...x, ...patch } : x)))
            if (editing.type === 'admin' && me?.role === 'admin' && me.id === editing.id) updateSession({ name: patch.name, email: patch.email })
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
