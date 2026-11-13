// v1.0.234 · "Ver como": the owner opens the real portal of an employee, seller or marketing login,
// read only (see src/lib/viewAs.js). Client logins keep their own preview (ClientPortalPreview).
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AuthContext, useAuth } from '../hooks/useAuth'
import { LangProvider, useLang } from '../hooks/useLang'
import { supabase } from '../lib/supabase'
import { isOwner, startViewAs, stopViewAs } from '../lib/viewAs'
import { ClientPortalPreview, previewSessionFor } from './ClientPortalPreview'
import './view-as.css'

const EmployeePortal = lazy(() => import('../pages/EmployeePortal'))
const SalespersonPortal = lazy(() => import('../pages/SalespersonPortal'))
const MarketingPortal = lazy(() => import('../pages/MarketingPortal'))

/** The session a login would get, built from its row (same fields the login route returns). */
export async function sessionFor(target) {
  if (target.type === 'employee') {
    const { data } = await supabase.from('employees').select('id,full_name,email,contract_type,hourly_rate,fixed_salary,salary_type,score').eq('id', target.id).maybeSingle()
    if (!data) return null
    return { id: data.id, name: data.full_name, email: data.email, role: 'employee', contract_type: data.contract_type, hourly_rate: data.hourly_rate, fixed_salary: data.fixed_salary, salary_type: data.salary_type, score: data.score }
  }
  if (target.type === 'seller') {
    return { id: target.id, name: target.name, email: target.email, role: 'salesperson', phone: target.phone || '', team: target.team === 'marketing' ? 'marketing' : 'sales' }
  }
  return null
}

export function ViewAsLayer({ session, onClose }) {
  const { tr } = useLang()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    startViewAs({ role: session.role, id: session.id, name: session.name })
    setReady(true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { stopViewAs(); document.body.style.overflow = prev }
  }, [session])
  const auth = useMemo(() => ({ user: session, loading: false, login: async () => ({ success: false }), logout: onClose, updateSession: () => {}, sessionExpired: false }), [session, onClose])
  const Portal = session.role === 'employee' ? EmployeePortal : session.team === 'marketing' ? MarketingPortal : SalespersonPortal
  return createPortal(
    <div className="va-layer">
      <div className="va-bar" role="status">
        <span><strong>{tr('Viewing as', '表示中', 'Vendo como')} {session.name}</strong> · {tr('read only, nothing is changed', '閲覧のみ・変更されません', 'somente leitura, nada é alterado')}</span>
        <button type="button" onClick={onClose}>{tr('Back to my account', '自分のアカウントに戻る', 'Voltar para a minha conta')}</button>
      </div>
      <div className="va-body"><div className="va-scroll">
        {ready && (
          <AuthContext.Provider value={auth}>
            <LangProvider>
              <Suspense fallback={<p style={{ padding: 24 }}>…</p>}><Portal /></Suspense>
            </LangProvider>
          </AuthContext.Provider>
        )}
      </div></div>
    </div>,
    document.body,
  )
}

/** Button for one login (Users page). Renders nothing for anybody but the owner. */
export function ViewAsButton({ target, className = 'btn btn-sm' }) {
  const { user } = useAuth()
  const { tr } = useLang()
  const [session, setSession] = useState(null)
  if (!isOwner(user) || !target || !['employee', 'seller'].includes(target.type)) return null
  const open = async e => { e?.stopPropagation?.(); const s = await sessionFor(target); if (s) setSession(s) }
  return (
    <>
      <button type="button" className={className} onClick={open} title={tr('Opens this person’s area exactly as they see it, read only', 'この人の画面をそのまま表示（閲覧のみ）', 'Abre a área desta pessoa exatamente como ela vê, somente leitura')}>{tr('View as', '画面を見る', 'Ver como')}</button>
      {session && <ViewAsLayer session={session} onClose={() => setSession(null)} />}
    </>
  )
}

/** Owner's picker: any employee, seller, marketing or client login. */
export default function ViewAsPicker({ onClose }) {
  const { user } = useAuth()
  const { tr } = useLang()
  const [people, setPeople] = useState(null)
  const [q, setQ] = useState('')
  const [session, setSession] = useState(null)
  const [clientSession, setClientSession] = useState(null)
  useEffect(() => {
    let alive = true
    Promise.all([
      supabase.from('employees').select('id,full_name,email,is_active,job_role').order('full_name'),
      supabase.from('salespeople').select('id,full_name,email,phone,is_active,team').order('full_name').then(r => r.error ? supabase.from('salespeople').select('id,full_name,email,phone,is_active').order('full_name') : r),
      supabase.from('client_users').select('id,client_id,client_name,location_name,contact_name,email,is_active').order('client_name'),
    ]).then(([e, s, c]) => {
      if (!alive) return
      setPeople([
        ...(e.data || []).filter(x => x.is_active !== false).map(x => ({ type: 'employee', id: x.id, name: x.full_name, email: x.email, group: tr('Employees', 'スタッフ', 'Funcionários') })),
        ...(s.data || []).filter(x => x.is_active !== false).map(x => ({ type: 'seller', id: x.id, name: x.full_name, email: x.email, phone: x.phone, team: x.team, group: x.team === 'marketing' ? 'Marketing' : tr('Sales', '営業', 'Vendas') })),
        ...(c.data || []).filter(x => x.is_active !== false).map(x => ({ type: 'client', id: x.id, name: [x.client_name, x.location_name].filter(Boolean).join(' · '), email: x.email, row: x, group: tr('Clients', 'お客様', 'Clientes') })),
      ])
    })
    return () => { alive = false }
  }, [tr])
  if (!isOwner(user)) return null
  const pick = async p => {
    if (p.type === 'client') return setClientSession(await previewSessionFor({ row: p.row }))
    const s = await sessionFor(p); if (s) setSession(s)
  }
  const k = q.trim().toLowerCase()
  const shown = (people || []).filter(p => !k || `${p.name} ${p.email}`.toLowerCase().includes(k))
  const groups = [...new Set(shown.map(p => p.group))]
  if (session) return <ViewAsLayer session={session} onClose={() => setSession(null)} />
  if (clientSession) return <ClientPortalPreview session={clientSession} onClose={() => setClientSession(null)} />
  return createPortal(
    <div className="va-pick-back" onClick={onClose}>
      <div className="va-pick" role="dialog" aria-modal="true" aria-label={tr('View as', '画面を見る', 'Ver como')} onClick={e => e.stopPropagation()}>
        <div className="va-pick-head"><h2>{tr('View as', '画面を見る', 'Ver como')}</h2><button type="button" className="va-x" onClick={onClose} aria-label={tr('Close', '閉じる', 'Fechar')}>×</button></div>
        <p className="va-pick-sub">{tr('Opens the person’s area exactly as they see it. Read only: nothing you tap there is saved.', '相手の画面をそのまま表示します。閲覧のみで、何も保存されません。', 'Abre a área da pessoa exatamente como ela vê. Somente leitura: nada que você tocar lá é salvo.')}</p>
        <input type="search" autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={tr('Search by name', '名前で検索', 'Buscar pelo nome')} aria-label={tr('Search', '検索', 'Buscar')} />
        <div className="va-pick-list">
          {!people && <p className="va-pick-sub">…</p>}
          {groups.map(g => (
            <div key={g}>
              <div className="va-group">{g}</div>
              {shown.filter(p => p.group === g).map(p => <button key={p.type + p.id} type="button" className="va-person" onClick={() => pick(p)}><strong>{p.name}</strong><span>{p.email}</span></button>)}
            </div>
          ))}
          {people && !shown.length && <p className="va-pick-sub">{tr('Nobody with that name.', '該当なし', 'Ninguém com esse nome.')}</p>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
