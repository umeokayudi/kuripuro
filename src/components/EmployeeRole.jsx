import { useState } from 'react'
import { EMPLOYEE_ROLES, isPresetRole, roleInfo, PERMISSION_LABELS, roleCan } from '../lib/employeeRoles'
import { pickLang } from '../hooks/useLang'

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
  pt: { none: 'Sem função', other: 'Outra…', custom: 'Digite a função', hint: 'Aparece como um selo destacado no funcionário.' },
}

// Chips for the preset roles plus "Other…" with a free-text box.
export function RolePicker({ value, onChange, lang = 'en' }) {
  const t = PICKER_TXT[lang === 'ja' ? 'ja' : lang === 'pt' ? 'pt' : 'en']
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
            {pickLang(lang, r.en, r.ja, r.pt)}
          </button>
        ))}
        <button type="button" style={chip(customOpen, '#3d4a5c', '#eef1f5')} onClick={() => { setCustomOpen(true); if (isPresetRole(current)) onChange('') }}>{t.other}</button>
      </div>
      {customOpen && (
        <input style={{ marginTop: 8 }} value={isPresetRole(current) ? '' : current} onChange={e => onChange(e.target.value)} placeholder={t.custom} maxLength={40} />
      )}
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>{t.hint}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        {Object.keys(PERMISSION_LABELS).map(p => {
          const on = roleCan(current, p)
          return <span key={p} style={{ fontSize: 11, fontWeight: 600, color: on ? '#0f7a52' : 'var(--text3)' }}>{on ? '✓' : '✕'} {pickLang(lang, PERMISSION_LABELS[p].en, PERMISSION_LABELS[p].ja, PERMISSION_LABELS[p].pt)}</span>
        })}
      </div>
    </div>
  )
}
