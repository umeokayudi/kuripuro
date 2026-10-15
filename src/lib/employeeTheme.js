// Personal visual themes for individual employee accounts. A theme is keyed
// only by the employee's stable database id (employees.id, which is also the
// session's user.id), never by name or e-mail, so nobody else can match it.
export const LETICIA_EMPLOYEE_ID = '3a39b220-9984-41e4-ab61-4cf96b93a99f' // Leticia Nagaoka

const EMPLOYEE_THEMES = {
  [LETICIA_EMPLOYEE_ID]: 'hello-kitty',
}

// Personal greeting shown instead of "Good morning" for the same accounts.
// Always in Portuguese, whatever language the portal is set to.
const EMPLOYEE_GREETINGS = {
  [LETICIA_EMPLOYEE_ID]: { title: 'Te amo muito', emoji: '❤️', subtitle: 'Obrigado por tudo' },
}

export function employeeGreetingFor(user) {
  if (!user || user.role !== 'employee' || typeof user.id !== 'string') return null
  return Object.prototype.hasOwnProperty.call(EMPLOYEE_GREETINGS, user.id) ? EMPLOYEE_GREETINGS[user.id] : null
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
