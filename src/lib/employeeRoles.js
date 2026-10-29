// v1.0.35 · Employee role (função) stored in employees.job_role.
// Preset keys are translated; anything else is free text typed by the admin.

export const EMPLOYEE_ROLES = [
  { key: 'cleaner', en: 'Cleaning staff', ja: '清掃スタッフ', pt: 'Equipe de limpeza', color: '#1d6fd8', bg: '#e8f1fd' },
  { key: 'leader', en: 'Team leader', ja: 'チームリーダー', pt: 'Líder de equipe', color: '#0f7a52', bg: '#e6f6ee' },
  { key: 'supervisor', en: 'Supervisor', ja: 'スーパーバイザー', pt: 'Supervisor', color: '#7a3fc4', bg: '#f1e9fb' },
  { key: 'driver', en: 'Driver', ja: 'ドライバー', pt: 'Motorista', color: '#a8640a', bg: '#fdf1df' },
  { key: 'trainee', en: 'Trainee', ja: '研修中', pt: 'Em treinamento', color: '#4a5870', bg: '#eef2f7' },
  { key: 'office', en: 'Office', ja: '事務', pt: 'Escritório', color: '#b42358', bg: '#fbe8ef' },
]

const OTHER = { color: '#3d4a5c', bg: '#eef1f5' }

export function roleInfo(value, lang = 'en') {
  const raw = String(value || '').trim()
  if (!raw) return null
  const preset = EMPLOYEE_ROLES.find(r => r.key === raw)
  if (preset) return { key: preset.key, label: (lang === 'ja' ? preset.ja : lang === 'pt' ? preset.pt : null) || preset.en, color: preset.color, bg: preset.bg }
  return { key: 'custom', label: raw, ...OTHER }
}

export function isPresetRole(value) {
  return EMPLOYEE_ROLES.some(r => r.key === value)
}

// v1.0.96 · The role is also a permission set, read by the generator, the Agenda and the employee portal.
//   routes   — gets cleaning routes (Generator / Agenda)
//   team_day — sees the team's jobs of the day (read-only, no money)
export const ROLE_PERMISSIONS = {
  cleaner: ['routes'],
  leader: ['routes', 'team_day'],
  supervisor: ['routes', 'team_day'],
  driver: ['routes'],
  trainee: ['routes'],
  office: ['team_day'],
}
const DEFAULT_PERMISSIONS = ['routes'] // no role / free-text role: same as cleaning staff

export function roleCan(role, permission) {
  const raw = String(role || '').trim()
  return (ROLE_PERMISSIONS[raw] || DEFAULT_PERMISSIONS).includes(permission)
}

export const PERMISSION_LABELS = {
  routes: { en: 'Gets cleaning routes', ja: '清掃ルートを担当', pt: 'Recebe rotas de limpeza' },
  team_day: { en: "Sees the team's day (no money)", ja: 'チームの一日を閲覧（金額なし）', pt: 'Vê o dia da equipe (sem valores)' },
}
