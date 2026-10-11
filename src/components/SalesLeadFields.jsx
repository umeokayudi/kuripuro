export default function SalesLeadFields({ form, onChange, s, locked = false }) {
  const update = (field, value) => onChange({ ...form, [field]: value })
  return (
    <>
      <div className="card-title">{s.companySection}</div>
      <div className="grid-2">
        <div className="form-group" style={{ gridColumn: '1/-1' }}>
          <label>{s.siteName} *</label>
          <input value={form.site_name || ''} disabled={locked} onChange={e => update('site_name', e.target.value)} placeholder={s.siteHint} />
        </div>
        <div className="form-group" style={{ gridColumn: '1/-1' }}>
          <label>{s.company} *</label>
          <input value={form.company_name || ''} disabled={locked} onChange={e => update('company_name', e.target.value)} />
        </div>
        <div className="form-group" style={{ gridColumn: '1/-1' }}>
          <label>{s.address}</label>
          <input value={form.address || ''} disabled={locked} onChange={e => update('address', e.target.value)} />
        </div>
      </div>
      <div className="card-title">{s.contactSection}</div>
      <div className="grid-2">
        <div className="form-group"><label>{s.contact} *</label><input value={form.contact_name || ''} disabled={locked} onChange={e => update('contact_name', e.target.value)} /></div>
        <div className="form-group"><label>{s.contactTitle}</label><input value={form.contact_title || ''} disabled={locked} onChange={e => update('contact_title', e.target.value)} /></div>
        <div className="form-group"><label>{s.phone}</label><input value={form.phone || ''} disabled={locked} onChange={e => update('phone', e.target.value)} /></div>
        <div className="form-group"><label>{s.email}</label><input type="email" value={form.email || ''} disabled={locked} onChange={e => update('email', e.target.value)} /></div>
        <div className="form-group" style={{ gridColumn: '1/-1' }}><label>{s.notes}</label><textarea value={form.notes || ''} disabled={locked} onChange={e => update('notes', e.target.value)} rows={3} /></div>
      </div>
    </>
  )
}
