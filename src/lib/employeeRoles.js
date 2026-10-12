// v1.0.30 · Employee role (função) stored in employees.job_role.
// Preset keys are translated; anything else is free text typed by the admin.

export const EMPLOYEE_ROLES = [
  { key: 'cleaner', en: 'Cleaning staff', ja: '清掃スタッフ', color: '#1d6fd8', bg: '#e8f1fd' },
  { key: 'leader', en: 'Team leader', ja: 'チームリーダー', color: '#0f7a52', bg: '#e6f6ee' },
  { key: 'supervisor', en: 'Supervisor', ja: 'スーパーバイザー', color: '#7a3fc4', bg: '#f1e9fb' },
  { key: 'driver', en: 'Driver', ja: 'ドライバー', color: '#a8640a', bg: '#fdf1df' },
  { key: 'trainee', en: 'Trainee', ja: '研修中', color: '#4a5870', bg: '#eef2f7' },
  { key: 'office', en: 'Office', ja: '事務', color: '#b42358', bg: '#fbe8ef' },
]

const OTHER = { color: '#3d4a5c', bg: '#eef1f5' }

export function roleInfo(value, lang = 'en') {
  const raw = String(value || '').trim()
  if (!raw) return null
  const preset = EMPLOYEE_ROLES.find(r => r.key === raw)
  if (preset) return { key: preset.key, label: preset[lang === 'ja' ? 'ja' : 'en'], color: preset.color, bg: preset.bg }
  return { key: 'custom', label: raw, ...OTHER }
}

export function isPresetRole(value) {
  return EMPLOYEE_ROLES.some(r => r.key === value)
}
