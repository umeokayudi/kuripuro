// v1.0.110 · Test accounts / data: a visible "TESTE" badge and a global "hide tests" switch (ON by default)
// used by the Dashboard, rankings and counts. Same rule as the schedule (name starts with "Teste"/"Test").
export const isTestName = name => /^(teste?|test)\b/i.test(String(name || '').trim())
export const isTestEmployee = emp => isTestName(emp?.full_name)
export const isTestClient = c => isTestName(c?.company_name)
export const isTestJob = j => isTestName(j?.employee_name) || isTestName(j?.client_name)

const KEY = 'kp_hide_tests'
export const HIDE_TESTS_CHANGED = 'kp-hide-tests-changed'

export function hideTests() {
  try { return localStorage.getItem(KEY) !== '0' } catch { return true }
}
export function setHideTests(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* private mode */ }
  try { window.dispatchEvent(new Event(HIDE_TESTS_CHANGED)) } catch { /* SSR */ }
}
