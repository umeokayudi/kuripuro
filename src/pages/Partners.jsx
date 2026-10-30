import { useCallback, useEffect, useMemo, useState } from 'react'
import SkeletonRows from '../components/SkeletonRows'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useLang } from '../hooks/useLang'
import { askConfirm } from '../components/ConfirmDialog'
import EmptyHint from '../components/EmptyHint'
import { maskEmail, maskPhone } from '../lib/contactMask'

// v1.0.35 · Business partners (parceiros de negócio) — table business_partners.
// Companies and people the business works with that are not clients, employees or sellers.

const CATEGORIES = [
  { key: 'supplier', en: 'Supplier', ja: '仕入先', pt: 'Fornecedor', color: '#1d6fd8', bg: '#e8f1fd' },
  { key: 'subcontractor', en: 'Subcontractor', ja: '協力会社', pt: 'Empresa parceira (terceirizada)', color: '#0f7a52', bg: '#e6f6ee' },
  { key: 'referral', en: 'Referral partner', ja: '紹介パートナー', pt: 'Parceiro de indicação', color: '#a8640a', bg: '#fdf1df' },
  { key: 'real_estate', en: 'Real estate / property manager', ja: '不動産・管理会社', pt: 'Imobiliária / administradora', color: '#7a3fc4', bg: '#f1e9fb' },
  { key: 'reseller', en: 'Reseller', ja: '販売代理店', pt: 'Revendedor', color: '#b42358', bg: '#fbe8ef' },
  { key: 'other', en: 'Other', ja: 'その他', pt: 'Outro', color: '#3d4a5c', bg: '#eef1f5' },
]

const TXT = {
  en: {
    title: 'Business partners', hint: 'Suppliers, subcontractors, referral partners and other companies you work with.',
    add: '+ Add partner', edit: 'Edit', save: 'Save', cancel: 'Cancel', remove: 'Delete', all: 'All',
    name: 'Company / partner name *', category: 'Type', contact: 'Contact person', phone: 'Phone', email: 'E-mail',
    website: 'Website', address: 'Address', commission: 'Referral commission (%)', notes: 'Notes', active: 'Active partner',
    search: 'Search partners…', empty: 'No partners yet', emptyHow: 'Partners are companies that work with us: subcontractors, suppliers, referral partners. Tap “+ Add partner” above to add the first one with contact, service and conditions.', noMatch: 'No partners match.', loading: 'Loading…',
    saved: 'Partner saved', deleted: 'Partner deleted', needName: 'Write the partner name', confirmDelete: n => `Delete ${n}?`,
    inactive: 'Inactive', showInactive: 'Show inactive', commissionShort: 'commission', newTitle: 'New partner', editTitle: 'Edit partner',
  },
  ja: {
    title: 'ビジネスパートナー', hint: '仕入先・協力会社・紹介パートナーなど、取引のある会社。',
    add: '+ パートナー追加', edit: '編集', save: '保存', cancel: 'キャンセル', remove: '削除', all: 'すべて',
    name: '会社名・パートナー名 *', category: '種類', contact: '担当者', phone: '電話', email: 'メール',
    website: 'ウェブサイト', address: '住所', commission: '紹介手数料（%）', notes: 'メモ', active: '取引中',
    search: 'パートナーを検索…', empty: 'パートナーはまだいません', emptyHow: 'パートナーは協力会社（外注先・仕入先・紹介元など）です。上の「+ パートナー追加」から連絡先・サービス・条件を登録してください。', noMatch: '該当するパートナーはいません。', loading: '読み込み中…',
    saved: '保存しました', deleted: '削除しました', needName: '名前を入力してください', confirmDelete: n => `${n} を削除しますか？`,
    inactive: '取引停止', showInactive: '停止中も表示', commissionShort: '手数料', newTitle: '新しいパートナー', editTitle: 'パートナーを編集',
  },
  pt: {
    title: 'Parceiros de negócio', hint: 'Fornecedores, empresas terceirizadas, parceiros de indicação e outras empresas com quem você trabalha.',
    add: '+ Adicionar parceiro', edit: 'Editar', save: 'Salvar', cancel: 'Cancelar', remove: 'Excluir', all: 'Todos',
    name: 'Nome da empresa / parceiro *', category: 'Tipo', contact: 'Pessoa de contato', phone: 'Telefone', email: 'E-mail',
    website: 'Site', address: 'Endereço', commission: 'Comissão de indicação (%)', notes: 'Observações', active: 'Parceiro ativo',
    search: 'Buscar parceiros…', empty: 'Nenhum parceiro ainda', emptyHow: 'Parceiros são empresas que trabalham com a gente: terceirizados, fornecedores, quem indica clientes. Toque em “+ Adicionar parceiro” acima para cadastrar o primeiro com contato, serviço e condições.', noMatch: 'Nenhum parceiro encontrado.', loading: 'Carregando…',
    saved: 'Parceiro salvo', deleted: 'Parceiro excluído', needName: 'Digite o nome do parceiro', confirmDelete: n => `Excluir ${n}?`,
    inactive: 'Inativo', showInactive: 'Mostrar inativos', commissionShort: 'comissão', newTitle: 'Novo parceiro', editTitle: 'Editar parceiro',
  },
}

const EMPTY = { name: '', category: 'supplier', contact_name: '', phone: '', email: '', website: '', address: '', commission_rate: '', notes: '', is_active: true }

function categoryInfo(key, lang) {
  const c = CATEGORIES.find(x => x.key === key) || CATEGORIES[CATEGORIES.length - 1]
  return { ...c, label: c[lang === 'ja' ? 'ja' : lang === 'pt' ? 'pt' : 'en'] }
}

function websiteHref(url) {
  const v = String(url || '').trim()
  if (!v) return ''
  return /^https?:\/\//i.test(v) ? v : `https://${v}`
}

export default function Partners() {
  const { lang } = useLang()
  const t = TXT[lang === 'ja' ? 'ja' : lang === 'pt' ? 'pt' : 'en']
  const [partners, setPartners] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(null)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('business_partners').select('*').order('name')
    if (error) toast.error(error.message)
    setPartners(data || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return partners.filter(p => {
      if (!p.is_active && !showInactive) return false
      if (filter !== 'all' && p.category !== filter) return false
      if (!q) return true
      return [p.name, p.contact_name, p.email, p.phone, p.notes].some(v => String(v || '').toLowerCase().includes(q))
    })
  }, [partners, filter, query, showInactive])

  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async e => {
    e.preventDefault()
    if (!form.name.trim()) return toast.error(t.needName)
    setSaving(true)
    const rate = form.commission_rate === '' || form.commission_rate == null ? null : Number(form.commission_rate)
    const row = {
      name: form.name.trim(), category: form.category, contact_name: form.contact_name.trim() || null,
      phone: form.phone.trim() || null, email: form.email.trim().toLowerCase() || null, website: form.website.trim() || null,
      address: form.address.trim() || null, commission_rate: Number.isFinite(rate) ? rate : null,
      notes: form.notes.trim() || null, is_active: form.is_active, updated_at: new Date().toISOString(),
    }
    const { error } = form.id
      ? await supabase.from('business_partners').update(row).eq('id', form.id)
      : await supabase.from('business_partners').insert(row)
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(t.saved)
    setForm(null)
    load()
  }

  const remove = async p => {
    if (!(await askConfirm({ message: t.confirmDelete(p.name), danger: true }))) return
    const { error } = await supabase.from('business_partners').delete().eq('id', p.id)
    if (error) return toast.error(error.message)
    toast.success(t.deleted)
    setForm(null)
    load()
  }

  const startEdit = p => setForm({ ...EMPTY, ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v ?? (k === 'is_active' ? true : '')])) })

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{t.title}</h2>
          <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4 }}>{t.hint}</div>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setForm({ ...EMPTY })}>{t.add}</button>
      </div>

      {form && (
        <form className="card" style={{ marginBottom: 14 }} onSubmit={save}>
          <div className="card-title">{form.id ? t.editTitle : t.newTitle}</div>
          <div className="grid-2">
            <div className="form-group"><label>{t.name}</label><input value={form.name} onChange={e => upd('name', e.target.value)} autoFocus /></div>
            <div className="form-group"><label>{t.category}</label>
              <select value={form.category} onChange={e => upd('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c[lang === 'ja' ? 'ja' : lang === 'pt' ? 'pt' : 'en']}</option>)}
              </select>
            </div>
            <div className="form-group"><label>{t.contact}</label><input value={form.contact_name} onChange={e => upd('contact_name', e.target.value)} /></div>
            <div className="form-group"><label>{t.phone}</label><input value={form.phone} onChange={e => upd('phone', e.target.value)} /></div>
            <div className="form-group"><label>{t.email}</label><input type="email" value={form.email} onChange={e => upd('email', e.target.value)} /></div>
            <div className="form-group"><label>{t.website}</label><input value={form.website} onChange={e => upd('website', e.target.value)} placeholder="example.co.jp" /></div>
            <div className="form-group" style={{ gridColumn: '1/-1' }}><label>{t.address}</label><input value={form.address} onChange={e => upd('address', e.target.value)} /></div>
            {(form.category === 'referral' || form.category === 'reseller' || form.commission_rate !== '') && (
              <div className="form-group"><label>{t.commission}</label><input type="number" min="0" max="100" step="0.1" value={form.commission_rate} onChange={e => upd('commission_rate', e.target.value)} /></div>
            )}
          </div>
          <div className="form-group"><label>{t.notes}</label><textarea value={form.notes} onChange={e => upd('notes', e.target.value)} /></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, marginBottom: 12 }}>
            <input type="checkbox" checked={form.is_active} onChange={e => upd('is_active', e.target.checked)} style={{ width: 16, height: 16 }} />
            {t.active}
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>{t.save}</button>
            <button type="button" className="btn" onClick={() => setForm(null)}>{t.cancel}</button>
            {form.id && <button type="button" className="btn btn-danger" style={{ marginLeft: 'auto' }} onClick={() => remove(form)}>{t.remove}</button>}
          </div>
        </form>
      )}

      <div className="tab-pills" style={{ flexWrap: 'wrap' }}>
        {[{ key: 'all' }, ...CATEGORIES].map(c => {
          const n = partners.filter(p => (p.is_active || showInactive) && (c.key === 'all' || p.category === c.key)).length
          if (c.key !== 'all' && !n) return null
          return (
            <button key={c.key} type="button" className={`tab-pill${filter === c.key ? ' active' : ''}`} onClick={() => setFilter(c.key)}>
              {c.key === 'all' ? t.all : c[lang === 'ja' ? 'ja' : lang === 'pt' ? 'pt' : 'en']} ({n})
            </button>
          )
        })}
      </div>

      <div className="kp-users-toolbar">
        <div className="form-group"><input value={query} onChange={e => setQuery(e.target.value)} placeholder={t.search} aria-label={t.search} /></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} style={{ width: 16, height: 16 }} />
          {t.showInactive}
        </label>
      </div>

      {loading && <SkeletonRows rows={3} label={t.loading} />}
      {!loading && !visible.length && (partners.length ? <div className="card" style={{ fontSize: 13, color: 'var(--text3)' }}>{t.noMatch}</div> : <EmptyHint icon="🤝" title={t.empty}>{t.emptyHow}</EmptyHint>)}
      <div className="kp-partner-grid">
        {visible.map(p => {
          const c = categoryInfo(p.category, lang)
          return (
            <div key={p.id} className="card" style={{ margin: 0, opacity: p.is_active ? 1 : 0.6, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, overflowWrap: 'anywhere' }}>{p.name}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                    <span className="kp-role-badge" style={{ background: c.bg, color: c.color, fontSize: 11 }}>{c.label}</span>
                    {p.commission_rate != null && <span className="kp-role-badge" style={{ background: 'var(--surface2)', color: 'var(--text2)', fontSize: 11 }}>{p.commission_rate}% {t.commissionShort}</span>}
                    {!p.is_active && <span className="badge badge-red">{t.inactive}</span>}
                  </div>
                </div>
                <button type="button" className="btn btn-sm" onClick={() => startEdit(p)}>{t.edit}</button>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text2)', display: 'grid', gap: 3, overflowWrap: 'anywhere' }}>
                {p.contact_name && <div>👤 {p.contact_name}</div>}
                {p.phone && <div>📞 <a href={`tel:${p.phone}`}>{maskPhone(p.phone)}</a></div>}
                {p.email && <div>✉️ <a href={`mailto:${p.email}`}>{maskEmail(p.email)}</a></div>}
                {p.website && <div>🌐 <a href={websiteHref(p.website)} target="_blank" rel="noopener noreferrer">{p.website}</a></div>}
                {p.address && <div>📍 {p.address}</div>}
                {p.notes && <div style={{ color: 'var(--text3)', marginTop: 4, whiteSpace: 'pre-wrap' }}>{p.notes}</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
