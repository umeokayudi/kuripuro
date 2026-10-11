// Personal visual themes for individual employee accounts. A theme is keyed
// only by the employee's stable database id (employees.id, which is also the
// session's user.id), never by name or e-mail, so nobody else can match it.
export const LETICIA_EMPLOYEE_ID = '3a39b220-9984-41e4-ab61-4cf96b93a99f' // Leticia Nagaoka

const EMPLOYEE_THEMES = {
  [LETICIA_EMPLOYEE_ID]: 'hello-kitty',
}

export function employeeThemeFor(user) {
  if (!user || user.role !== 'employee' || typeof user.id !== 'string') return null
  return Object.prototype.hasOwnProperty.call(EMPLOYEE_THEMES, user.id) ? EMPLOYEE_THEMES[user.id] : null
}

// Theme styles are loaded on demand so other accounts never download them.
const THEME_STYLES = {
  'hello-kitty': () => import('../themes/hello-kitty/hello-kitty.css'),
}

export function loadEmployeeTheme(theme) {
  return THEME_STYLES[theme]?.() || Promise.resolve()
}
