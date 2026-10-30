import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { salesPost } from '../lib/salesApi'
import { useLang, localeOf } from '../hooks/useLang'
import { useAuth } from '../hooks/useAuth'
import { RoleBadge } from '../components/EmployeeRole'
import UserEditDialog from '../components/UserEditDialog'
import { maskEmail, maskPhone } from '../lib/contactMask'

// v1.0.35 · One place for every login: admins, employees, sellers and client logins.
// Each type still lives in its own table; this page only lists them together.
// Passwords are never read here.

const TXT = {
  en: {
    title: 'Users', hint: 'Every login on KuriPuro: admins, employees, sellers and client logins.',
    all: 'All', admin: 'Admins', employee: 'Employees', salesperson: 'Sellers', client: 'Clients',
    typeOne: { admin: 'Admin', employee: 'Employee', salesperson: 'Seller', client: 'Client' },
    sector: { admin: 'Admins', employee: 'Employees', salesperson: 'Sales / Marketing', client: 'Clients' },
    addOne: { admin: '+ New admin', employee: '+ New employee', salesperson: '+ New seller', client: '+ New client login' },
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
    sector: { admin: '管理者', employee: '従業員', salesperson: '営業・マーケティング', client: 'クライアント' },
    addOne: { admin: '+ 管理者', employee: '+ 従業員', salesperson: '+ 営業', client: '+ クライアントログイン' },
    search: '名前・メール・役割・店舗で検索…', showInactive: '無効も表示',
    active: '有効', inactive: '無効', open: '開く', edit: '編集', activate: '有効にする', deactivate: '無効にする',
    lastSeen: '最終利用', never: 'なし', add: '+ ユーザー追加', addAdmin: '新しい管理者', addEmployee: '従業員', addSeller: '営業', addClient: 'クライアントログイン',
    whichType: 'どの種類のログイン？', name: '氏名', email: 'メール', password: 'パスワード（8文字以上）', create: '管理者を作成', cancel: 'キャンセル',
    created: '管理者を作成しました', emailUsed: 'このメールはすでに使われています', fillAll: '氏名・メール・8文字以上のパスワードを入力してください',
    empty: '該当するユーザーはいません。', loading: '読み込み中…', you: 'あなた', partners: 'ビジネスパートナー →', saved: '保存しました',
  },
  pt: {
    title: 'Usuários', hint: 'Todos os logins do KuriPuro: administradores, funcionários, vendedores e logins de clientes.',
    all: 'Todos', admin: 'Administradores', employee: 'Funcionários', salesperson: 'Vendedores', client: 'Clientes',
    typeOne: { admin: 'Administrador', employee: 'Funcionário', salesperson: 'Vendedor', client: 'Cliente' },
    sector: { admin: 'Administradores', employee: 'Funcionários', salesperson: 'Vendas / Marketing', client: 'Clientes' },
    addOne: { admin: '+ Novo administrador', employee: '+ Novo funcionário', salesperson: '+ Novo vendedor', client: '+ Novo login de cliente' },
    search: 'Buscar nome, e-mail, função ou loja…', showInactive: 'Mostrar inativos',
    active: 'Ativo', inactive: 'Inativo', open: 'Abrir', edit: 'Editar', activate: 'Ativar', deactivate: 'Desativar',
    lastSeen: 'Último acesso', never: 'nunca', add: '+ Adicionar usuário', addAdmin: 'Novo administrador', addEmployee: 'Funcionário', addSeller: 'Vendedor', addClient: 'Login de cliente',
    whichType: 'Que tipo de login?', name: 'Nome', email: 'E-mail', password: 'Senha (8+ caracteres)', create: 'Criar administrador', cancel: 'Cancelar',
    created: 'Administrador criado', emailUsed: 'Este e-mail já tem um login', fillAll: 'Preencha nome, e-mail e uma senha com 8+ caracteres',
    empty: 'Nenhum usuário encontrado.', loading: 'Carregando…', you: 'você', partners: 'Parceiros de negócio →', saved: 'Salvo',
  },
}

const TYPES = ['admin', 'employee', 'salesperson', 'client']
// Order of the sectors on screen: field staff first, admins last.
const SECTION_ORDER = ['employee', 'salesperson', 'client', 'admin']

function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?'
}

export default function Users() {
  const { lang, tr } = useLang()
  const { user: me, updateSession } = useAuth()
  const navigate = useNavigate()
  const t = TXT[lang === 'ja' ? 'ja' : lang === 'pt' ? 'pt' : 'en']
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [busy, setBusy] = useState('')
  const [editing, setEditing] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [admins, employees, sellers, clients] = await Promise.all([
      supabase.from('admins').select('id,name,email,created_at').order('name'),
      supabase.from('employees').select('id,full_name,email,phone,is_active,job_role,last_seen,created_at').order('full_name'),
      // team needs sql/2026-10-15_vendedor_gps_marketing.sql; without it everyone is a seller.
      supabase.from('salespeople').select('id,full_name,email,phone,is_active,created_at,team').order('full_name')
        .then(r => r.error ? supabase.from('salespeople').select('id,full_name,email,phone,is_active,created_at').order('full_name') : r),
      supabase.from('client_users').select('id,client_id,client_name,location_name,contact_name,email,is_active,last_seen,created_at').order('client_name'),
    ])
    setRows([
      ...(admins.data || []).map(a => ({ type: 'admin', id: a.id, name: a.name || a.email, email: a.email, active: true, created_at: a.created_at })),
      ...(employees.data || []).map(e => ({ type: 'employee', id: e.id, name: e.full_name, email: e.email, phone: e.phone, active: e.is_active !== false, role: e.job_role, last_seen: e.last_seen, created_at: e.created_at })),
      ...(sellers.data || []).map(s => ({ type: 'salesperson', id: s.id, name: s.full_name, email: s.email, phone: s.phone, active: s.is_active !== false, team: s.team === 'marketing' ? 'marketing' : 'sales', created_at: s.created_at })),
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
    return new Date(iso).toLocaleString(localeOf(lang), { timeZone: 'Asia/Tokyo', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
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

  // Admin and seller logins are created right here; employees and client logins
  // need their full forms (pay, contract / client and store), so those open their page.
  const addFor = type => {
    if (type === 'admin' || type === 'salesperson') setEditing({ type, isNew: true, active: true })
    else if (type === 'employee') navigate('/employees?tab=register')
    else navigate('/clients')
  }

  const renderRow = r => (
    <div key={r.type + r.id} className="kp-users-row" style={{ opacity: r.active ? 1 : 0.6 }}>
      <div className="avatar" style={{ width: 38, height: 38, fontSize: 13, fontWeight: 700, background: 'var(--surface2)', color: 'var(--text2)', flexShrink: 0 }}>{initials(r.name)}</div>
      <div className="kp-users-main">
        <div className="kp-users-name">
          {r.name}
          {me?.role === 'admin' && r.type === 'admin' && r.id === me.id && <span style={{ fontSize: 11, color: 'var(--text3)' }}>({t.you})</span>}
          {r.type === 'employee' && <RoleBadge value={r.role} lang={lang} size="sm" />}
          {r.type === 'salesperson' && <span className={`kp-team-badge is-${r.team}`}>{r.team === 'marketing' ? tr('Marketing', 'マーケティング', 'Marketing') : tr('Sales', '営業', 'Vendas')}</span>}
          {!r.active && <span className="badge badge-red">{t.inactive}</span>}
        </div>
        <div className="kp-users-meta">
          {[maskEmail(r.email), r.place, maskPhone(r.phone)].filter(Boolean).join(' · ')}
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
  )

  const sections = (filter === 'all' ? SECTION_ORDER : [filter]).map(type => ({ type, list: visible.filter(r => r.type === type) }))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{t.title}</h2>
          <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4 }}>{t.hint}</div>
        </div>
        <button type="button" className="btn" onClick={() => navigate('/partners')}>{t.partners}</button>
      </div>

      <div className="kp-users-tabs" role="tablist">
        {['all', ...SECTION_ORDER].map(k => (
          <button key={k} type="button" role="tab" className={`kp-users-tab${filter === k ? ' active' : ''}`} onClick={() => setFilter(k)} aria-selected={filter === k}>
            {k === 'all' ? t.all : t.sector[k]} <span>{counts[k]}</span>
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

      {loading && <div aria-busy="true" aria-label={t.loading}>{[0,1,2,3].map(i => <div key={i} className="kp-skel kp-skel-row" />)}</div>}
      {!loading && sections.map(({ type, list }) => (
        <section key={type} className="kp-users-section">
          <div className="kp-users-section-head">
            <span className={`kp-type-badge kp-type-${type}`}>{t.sector[type]}</span>
            <span className="kp-users-section-count">{list.length}</span>
            <button type="button" className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => addFor(type)}>{t.addOne[type]}</button>
          </div>
          <div className="card" style={{ padding: 0, margin: 0 }}>
            {list.length ? list.map(renderRow) : <div style={{ padding: 14, fontSize: 13, color: 'var(--text3)' }}>{t.empty}</div>}
          </div>
        </section>
      ))}

      {editing && (
        <UserEditDialog
          user={editing}
          allRows={rows}
          lang={lang}
          typeLabel={t.typeOne[editing.type]}
          onClose={() => setEditing(null)}
          onSaved={patch => {
            if (!patch) { setEditing(null); load(); return }
            setRows(list => list.map(x => (x.type === editing.type && x.id === editing.id ? { ...x, ...patch } : x)))
            if (editing.type === 'admin' && me?.role === 'admin' && me.id === editing.id) updateSession({ name: patch.name, email: patch.email })
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
