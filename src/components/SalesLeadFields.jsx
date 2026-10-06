import { LEAD_SOURCES } from '../lib/sales'

export default function SalesLeadFields({ form, onChange, s }) {
  const upd = (k, v) => onChange({ ...form, [k]: v })
  return (
    <>
      <div className="card-title">{s.companySection}</div>
      <div className="grid-2">
        <div className="form-group" style={{ gridColumn: '1/-1' }}>
          <label>{s.company} *</label>
          <input value={form.company_name} onChange={e => upd('company_name', e.target.value)} />
        </div>
        <div className="form-group"><label>{s.companyKana}</label><input value={form.company_kana || ''} onChange={e => upd('company_kana', e.target.value)} /></div>
        <div className="form-group"><label>{s.industry}</label><input value={form.industry || ''} onChange={e => upd('industry', e.target.value)} /></div>
        <div className="form-group" style={{ gridColumn: '1/-1' }}><label>{s.address}</label><input value={form.address || ''} onChange={e => upd('address', e.target.value)} /></div>
        <div className="form-group"><label>{s.phone}</label><input value={form.phone || ''} onChange={e => upd('phone', e.target.value)} /></div>
        <div className="form-group"><label>{s.email}</label><input value={form.email || ''} onChange={e => upd('email', e.target.value)} /></div>
        <div className="form-group"><label>{s.website}</label><input value={form.website || ''} onChange={e => upd('website', e.target.value)} /></div>
        <div className="form-group"><label>{s.locations}</label><input type="number" value={form.locations_count || ''} onChange={e => upd('locations_count', e.target.value)} /></div>
      </div>

      <div className="card-title">{s.contactSection}</div>
      <div className="grid-2">
        <div className="form-group"><label>{s.contact} *</label><input value={form.contact_name || ''} onChange={e => upd('contact_name', e.target.value)} /></div>
        <div className="form-group"><label>{s.contactTitle}</label><input value={form.contact_title || ''} onChange={e => upd('contact_title', e.target.value)} /></div>
        <div className="form-group"><label>{s.contactPhone}</label><input value={form.contact_phone || ''} onChange={e => upd('contact_phone', e.target.value)} /></div>
        <div className="form-group"><label>{s.contactEmail}</label><input value={form.contact_email || ''} onChange={e => upd('contact_email', e.target.value)} /></div>
        <div className="form-group"><label>{s.contactLine}</label><input value={form.contact_line_id || ''} onChange={e => upd('contact_line_id', e.target.value)} /></div>
        <div className="form-group"><label>{s.decisionMaker}</label><input value={form.decision_maker || ''} onChange={e => upd('decision_maker', e.target.value)} /></div>
      </div>

      <div className="card-title">{s.salesSection}</div>
      <div className="grid-2">
        <div className="form-group"><label>{s.firstContact}</label><input type="date" value={form.first_contact_date || ''} onChange={e => upd('first_contact_date', e.target.value)} /></div>
        <div className="form-group"><label>{s.nextFollowup}</label><input type="date" value={form.next_followup_date || ''} onChange={e => upd('next_followup_date', e.target.value)} /></div>
        <div className="form-group"><label>{s.source}</label>
          <select value={form.source || 'visit'} onChange={e => upd('source', e.target.value)}>
            {LEAD_SOURCES.map(src => <option key={src} value={src}>{s.sources?.[src] || src}</option>)}
          </select>
        </div>
        <div className="form-group"><label>{s.expectedMonthly}</label><input type="number" value={form.expected_monthly || ''} onChange={e => upd('expected_monthly', e.target.value)} /></div>
        <div className="form-group"><label>{s.expectedStart}</label><input type="date" value={form.expected_start || ''} onChange={e => upd('expected_start', e.target.value)} /></div>
        <div className="form-group"><label>{s.competitor}</label><input value={form.competitor || ''} onChange={e => upd('competitor', e.target.value)} /></div>
        <div className="form-group" style={{ gridColumn: '1/-1' }}>
          <label>{s.needs}</label>
          <input value={form.needs || ''} onChange={e => upd('needs', e.target.value)} placeholder={s.needsHint} />
        </div>
        <div className="form-group" style={{ gridColumn: '1/-1' }}>
          <label>{s.stillNeeded}</label>
          <input value={form.still_needed || ''} onChange={e => upd('still_needed', e.target.value)} placeholder={s.stillNeededHint} />
        </div>
        <div className="form-group" style={{ gridColumn: '1/-1' }}>
          <label>{s.notes}</label>
          <input value={form.notes || ''} onChange={e => upd('notes', e.target.value)} />
        </div>
      </div>
    </>
  )
}
