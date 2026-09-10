import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { viewablePhotoUrl } from '../lib/photoUrl'
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'

const CATEGORY_LABELS = {
  tools: { en: 'Tools', ja: '工具' },
  supplies: { en: 'Cleaning supplies', ja: '清掃用品' },
  uniform: { en: 'Uniform / PPE', ja: '制服・保護具' },
  safety: { en: 'Safety', ja: '安全用品' },
  other: { en: 'Other', ja: 'その他' },
}

export default function EquipmentRequests() {
  const { lang } = useLang()
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
      approved: lang === 'ja' ? '承認しました' : 'Approved',
      rejected: lang === 'ja' ? '拒否しました' : 'Rejected',
      fulfilled: lang === 'ja' ? '交付済みにしました' : 'Marked as fulfilled',
    }[status] || 'Updated'
    toast.success(msg)
    load()
  }

  const filtered = requests.filter(r => filter === 'all' ? true : r.status === filter)
  const pending = requests.filter(r => r.status === 'pending').length
  const catLabel = (k) => CATEGORY_LABELS[k]?.[lang === 'ja' ? 'ja' : 'en'] || k

  const tabs = [
    ['pending', lang === 'ja' ? `保留中${pending ? ` (${pending})` : ''}` : `Pending${pending ? ` (${pending})` : ''}`],
    ['approved', lang === 'ja' ? '承認' : 'Approved'],
    ['fulfilled', lang === 'ja' ? '交付済み' : 'Fulfilled'],
    ['rejected', lang === 'ja' ? '拒否' : 'Rejected'],
    ['all', lang === 'ja' ? 'すべて' : 'All'],
  ]

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
        🧰 {lang === 'ja' ? '備品・改善リクエスト' : 'Equipment requests'}
      </h2>
      <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 14, lineHeight: 1.5 }}>
        {lang === 'ja'
          ? '従業員が仕事の改善に必要な備品を申請します。内容を確認して承認・拒否してください。'
          : 'Employees request equipment to improve their work. Review each request and approve or reject.'}
      </p>

      <div className="tab-pills" style={{ marginBottom: 14 }}>
        {tabs.map(([k, l]) => (
          <button key={k} className={`tab-pill${filter === k ? ' active' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      {loading && <div style={{ color: 'var(--text3)', fontSize: 13 }}>Loading...</div>}
      {filtered.length === 0 && !loading && (
        <div className="card"><div style={{ color: 'var(--text3)', fontSize: 13 }}>{lang === 'ja' ? 'リクエストなし' : 'No requests.'}</div></div>
      )}

      {filtered.map(r => (
        <div key={r.id} className="card" style={{ marginBottom: 12 }}>
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
              {lang === 'ja' ? '理由' : 'Reason'}
            </div>
            {r.reason}
          </div>

          {r.photo_url && (
            <a href={viewablePhotoUrl(r.photo_url)} target="_blank" rel="noreferrer" className="btn btn-sm" style={{ marginBottom: 10 }}>
              📷 {lang === 'ja' ? '参考写真' : 'Reference photo'}
            </a>
          )}

          {r.status === 'pending' && (
            <div>
              <div className="form-group">
                <label>{lang === 'ja' ? '管理者メモ（任意）' : 'Admin note (optional)'}</label>
                <input
                  value={note[r.id] || ''}
                  onChange={e => setNote(n => ({ ...n, [r.id]: e.target.value }))}
                  placeholder={lang === 'ja' ? '承認・拒否の理由など...' : 'Reason for approval/rejection...'}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" style={{ flex: 1, minWidth: 120 }} onClick={() => handleAction(r.id, 'approved')}>
                  ✅ {lang === 'ja' ? '承認' : 'Approve'}
                </button>
                <button className="btn btn-danger" style={{ flex: 1, minWidth: 120 }} onClick={() => handleAction(r.id, 'rejected')}>
                  ❌ {lang === 'ja' ? '拒否' : 'Reject'}
                </button>
              </div>
            </div>
          )}

          {r.status === 'approved' && (
            <div>
              <div className="form-group">
                <label>{lang === 'ja' ? '交付メモ' : 'Fulfillment note'}</label>
                <input
                  value={note[r.id] || ''}
                  onChange={e => setNote(n => ({ ...n, [r.id]: e.target.value }))}
                  placeholder={lang === 'ja' ? '交付日・品番など...' : 'Delivery date, item ref...'}
                />
              </div>
              <button className="btn btn-primary" onClick={() => handleAction(r.id, 'fulfilled')}>
                📦 {lang === 'ja' ? '交付済みにする' : 'Mark fulfilled'}
              </button>
            </div>
          )}

          {r.admin_note && r.status !== 'pending' && (
            <div style={{ fontSize: 12, color: 'var(--text3)', background: 'var(--surface2)', borderRadius: 8, padding: '8px 10px', marginTop: 8 }}>
              {lang === 'ja' ? 'メモ' : 'Note'}: {r.admin_note}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
