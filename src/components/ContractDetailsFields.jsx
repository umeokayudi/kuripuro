import { CONTRACT_NOTE_KEYS } from '../lib/spotContract'

// v1.0.30 · What the 業務委託契約書 prints beyond the price: written address, 責任者, 作業内容 in Japanese,
// and a note per item explaining why (printed as 備考 under that item). Saved in contract_details.

const NOTE_LABELS = {
  place: 'Place 作業場所',
  service: 'Service 作業内容',
  fee: 'Price 委託料',
  payment: 'Payment 支払方法',
  scope: 'Scope 作業範囲',
}

export default function ContractDetailsFields({ value = {}, onChange, placeholders = {}, showClientAddress = true, showTerms = true, showScope = true }) {
  const set = (k, v) => onChange({ ...value, [k]: v })
  const setNote = (k, v) => onChange({ ...value, notes: { ...(value.notes || {}), [k]: v } })
  return (
    <>
      <div className="grid-2">
        <div className="form-group" style={{ gridColumn: '1/-1' }}><label>Written address of the place 作業場所の住所</label>
          <input value={value.written_address || ''} onChange={e => set('written_address', e.target.value)} placeholder={placeholders.written_address || '東京都港区六本木3-14-14 5F'} />
        </div>
        {showClientAddress && (
          <div className="form-group" style={{ gridColumn: '1/-1' }}><label>Company address 甲の住所</label>
            <input value={value.client_address || ''} onChange={e => set('client_address', e.target.value)} placeholder={placeholders.client_address || 'Same as the place'} />
          </div>
        )}
        <div className="form-group"><label>Person in charge 責任者</label>
          <input value={value.responsible || ''} onChange={e => set('responsible', e.target.value)} placeholder={placeholders.responsible || '山田 太郎'} />
        </div>
        <div className="form-group"><label>Service in Japanese 作業内容</label>
          <input value={value.service_label || ''} onChange={e => set('service_label', e.target.value)} placeholder={placeholders.service_label || '定期清掃'} />
        </div>
      </div>
      {showScope && (
        <div className="form-group"><label>Scope of work in Japanese 作業範囲</label>
          <textarea rows={4} value={value.scope_ja || ''} onChange={e => set('scope_ja', e.target.value)} placeholder={placeholders.scope_ja || '店内の清掃\nゴミの回収'} />
        </div>
      )}
      {showTerms && (
        <div className="form-group"><label>Special terms in Japanese 特記事項</label>
          <textarea rows={2} value={value.terms_ja || ''} onChange={e => set('terms_ja', e.target.value)} placeholder="例：作業は月曜日21時までに完了する" />
        </div>
      )}
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', margin: '4px 0 6px' }}>Why · notes per item 備考 (printed under each item)</div>
      <div className="grid-2">
        {CONTRACT_NOTE_KEYS.map(k => (
          <div className="form-group" key={k}><label>{NOTE_LABELS[k]}</label>
            <input value={value.notes?.[k] || ''} onChange={e => setNote(k, e.target.value)} placeholder="—" />
          </div>
        ))}
      </div>
    </>
  )
}
