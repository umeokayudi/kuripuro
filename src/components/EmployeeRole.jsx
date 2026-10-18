import { useState } from 'react'
import { EMPLOYEE_ROLES, isPresetRole, roleInfo } from '../lib/employeeRoles'

export function RoleBadge({ value, lang = 'en', size = 'md' }) {
  const info = roleInfo(value, lang)
  if (!info) return null
  return (
    <span
      className="kp-role-badge"
      style={{ background: info.bg, color: info.color, fontSize: size === 'sm' ? 11 : 12 }}
    >
      {info.label}
    </span>
  )
}

const PICKER_TXT = {
  en: { none: 'No role', other: 'Other…', custom: 'Write the role', hint: 'Shown as a highlighted badge on the employee.' },
  ja: { none: '役割なし', other: 'その他…', custom: '役割を入力', hint: '従業員の名前の横に目立つバッジで表示されます。' },
}

// Chips for the preset roles plus "Other…" with a free-text box.
export function RolePicker({ value, onChange, lang = 'en' }) {
  const t = PICKER_TXT[lang === 'ja' ? 'ja' : 'en']
  const current = String(value || '')
  const [customOpen, setCustomOpen] = useState(Boolean(current) && !isPresetRole(current))
  const chip = (active, color, bg) => ({
    padding: '7px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: `1.5px solid ${active ? color : 'var(--border)'}`,
    background: active ? bg : 'var(--surface)', color: active ? color : 'var(--text2)',
  })
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" style={chip(!current && !customOpen, '#3d4a5c', '#eef1f5')} onClick={() => { setCustomOpen(false); onChange('') }}>{t.none}</button>
        {EMPLOYEE_ROLES.map(r => (
          <button key={r.key} type="button" aria-pressed={current === r.key} style={chip(current === r.key, r.color, r.bg)} onClick={() => { setCustomOpen(false); onChange(r.key) }}>
            {r[lang === 'ja' ? 'ja' : 'en']}
          </button>
        ))}
        <button type="button" style={chip(customOpen, '#3d4a5c', '#eef1f5')} onClick={() => { setCustomOpen(true); if (isPresetRole(current)) onChange('') }}>{t.other}</button>
      </div>
      {customOpen && (
        <input style={{ marginTop: 8 }} value={isPresetRole(current) ? '' : current} onChange={e => onChange(e.target.value)} placeholder={t.custom} maxLength={40} />
      )}
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>{t.hint}</div>
    </div>
  )
}
