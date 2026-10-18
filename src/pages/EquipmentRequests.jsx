import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { viewablePhotoUrl } from '../lib/photoUrl'
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'

const CATEGORY_LABELS = {
  tools: { en: 'Tools', ja: '工具', pt: 'Ferramentas' },
  supplies: { en: 'Cleaning supplies', ja: '清掃用品', pt: 'Produtos de limpeza' },
  uniform: { en: 'Uniform / PPE', ja: '制服・保護具', pt: 'Uniforme / EPI' },
  safety: { en: 'Safety', ja: '安全用品', pt: 'Segurança' },
  other: { en: 'Other', ja: 'その他', pt: 'Outros' },
}

export default function EquipmentRequests() {
  const { lang, t, tr } = useLang()
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('pending')
  const [note, setNote] = useState({})

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('equipment_requests').select('*').order('created_at', { ascending: false })
    setRequests(data || [])
    setLoading(false)
  }

  const handleAction = async (id, status) => {
    const now = new Date().toISOString()
    const patch = {
      status,
      admin_note: note[id] || '',
      reviewed_at: now,
      fulfilled_at: status === 'fulfilled' ? now : null,
    }
    const { error } = await supabase.from('equipment_requests').update(patch).eq('id', id)
    if (error) return toast.error(error.message)
    const msg = {
      approved: tr('Approved', '承認しました', 'Aprovado'),
      rejected: tr('Rejected', '拒否しました', 'Recusado'),
      fulfilled: tr('Marked as fulfilled', '交付済みにしました', 'Marcado como entregue'),
    }[status] || tr('Updated', undefined, 'Atualizado')
    toast.success(msg)
    load()
  }

  const filtered = requests.filter(r => filter === 'all' ? true : r.status === filter)
  const pending = requests.filter(r => r.status === 'pending').length
  const catLabel = (k) => (CATEGORY_LABELS[k]?.[lang] || CATEGORY_LABELS[k]?.en) || k

  const tabs = [
    ['pending', `${tr('Pending', '保留中', 'Pendentes')}${pending ? ` (${pending})` : ''}`],
    ['approved', tr('Approved', '承認', 'Aprovado')],
    ['fulfilled', tr('Fulfilled', '交付済み', 'Entregue')],
    ['rejected', tr('Rejected', '拒否', 'Recusado')],
    ['all', tr('All', 'すべて', 'Todos')],
  ]

  return (
    <div>
      <h2 className="page-head" style={{ marginBottom: 8, fontSize: 22 }}>
        🧰 {t.sidebar.equipmentRequests}
      </h2>
      <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 14, lineHeight: 1.5 }}>
        {tr('Employees request equipment to improve their work. Review each request and approve or reject.', '従業員が仕事の改善に必要な備品を申請します。内容を確認して承認・拒否してください。', 'Os funcionários pedem equipamentos para melhorar o trabalho. Revise cada pedido e aprove ou recuse.')}
      </p>

      <div className="tab-pills" style={{ marginBottom: 14 }}>
        {tabs.map(([k, l]) => (
          <button key={k} className={`tab-pill${filter === k ? ' active' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      {loading && <div style={{ color: 'var(--text3)', fontSize: 13 }}>{tr('Loading...', 'Loading...', 'Carregando...')}</div>}
      {filtered.length === 0 && !loading && (
        <div className="card"><div style={{ color: 'var(--text3)', fontSize: 13 }}>{tr('No requests.', 'リクエストなし', 'Nenhum pedido.')}</div></div>
      )}

      {filtered.map(r => (
        <div key={r.id} className="card" style={{ marginBottom: 12 }}>
          {(() => { const match = (r.reason || '').match(/\n\n\[Product link\] (https?:\/\/\S+)/); const reason = match ? r.reason.slice(0, match.index) : r.reason; return <div className="equipment-request-copy">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{r.employee_name}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy)', marginTop: 4 }}>
                {r.item_name}{r.quantity > 1 ? ` × ${r.quantity}` : ''}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
                {catLabel(r.category)} · {(r.created_at || '').slice(0, 10)}
              </div>
            </div>
            <span className={`badge ${
              r.status === 'approved' || r.status === 'fulfilled' ? 'badge-green'
                : r.status === 'rejected' ? 'badge-red' : 'badge-amber'
            }`}>{r.status}</span>
          </div>

          <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 10, background: 'var(--surface2)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 4 }}>
              {tr('Reason', '理由', 'Motivo')}
            </div>
            {reason}
          </div>
          {match && <a href={match[1]} target="_blank" rel="noreferrer" className="emp-request-product-link">↗ {match[1]}</a>}
          </div> })()}

          {r.photo_url && (
            <a href={viewablePhotoUrl(r.photo_url)} target="_blank" rel="noreferrer" className="btn btn-sm" style={{ marginBottom: 10 }}>
              📷 {tr('Reference photo', '参考写真', 'Foto de referência')}
            </a>
          )}

          {r.status === 'pending' && (
            <div>
              <div className="form-group">
                <label>{tr('Admin note (optional)', '管理者メモ（任意）', 'Nota do admin (opcional)')}</label>
                <input
                  value={note[r.id] || ''}
                  onChange={e => setNote(n => ({ ...n, [r.id]: e.target.value }))}
                  placeholder={tr('Reason for approval/rejection...', '承認・拒否の理由など...', 'Motivo da aprovação/recusa...')}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" style={{ flex: 1, minWidth: 120 }} onClick={() => handleAction(r.id, 'approved')}>
                  ✅ {tr('Approve', '承認', 'Aprovar')}
                </button>
                <button className="btn btn-danger" style={{ flex: 1, minWidth: 120 }} onClick={() => handleAction(r.id, 'rejected')}>
                  ❌ {tr('Reject', '拒否', 'Recusar')}
                </button>
              </div>
            </div>
          )}

          {r.status === 'approved' && (
            <div>
              <div className="form-group">
                <label>{tr('Fulfillment note', '交付メモ', 'Nota de entrega')}</label>
                <input
                  value={note[r.id] || ''}
                  onChange={e => setNote(n => ({ ...n, [r.id]: e.target.value }))}
                  placeholder={tr('Delivery date, item ref...', '交付日・品番など...', 'Data de entrega, ref. do item...')}
                />
              </div>
              <button className="btn btn-primary" onClick={() => handleAction(r.id, 'fulfilled')}>
                📦 {tr('Mark fulfilled', '交付済みにする', 'Marcar como entregue')}
              </button>
            </div>
          )}

          {r.admin_note && r.status !== 'pending' && (
            <div style={{ fontSize: 12, color: 'var(--text3)', background: 'var(--surface2)', borderRadius: 8, padding: '8px 10px', marginTop: 8 }}>
              {tr('Note', 'メモ', 'Nota')}: {r.admin_note}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
