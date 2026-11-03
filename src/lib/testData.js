// v1.0.110 · Test accounts / data: a visible "TESTE" badge and a global "hide tests" switch (ON by default)
// used by the Dashboard, rankings and counts. Same rule as the schedule (name starts with "Teste"/"Test").
export const isTestName = name => /^(teste?|test)\b/i.test(String(name || '').trim())
// v1.0.133 · "é teste" = the is_test column (sql/2026-11-03_pendentes_revisao.sql) OR, until it runs / for old
// rows, the name / e-mail rule. Test rows are kept (never deleted) and never count in any total or "active" list.
const emailTest = e => isTestName(String(e || '').split('@')[0])
export const isTestEmployee = emp => emp?.is_test === true || isTestName(emp?.full_name) || emailTest(emp?.email)
export const isTestClient = c => c?.is_test === true || isTestName(c?.company_name)
export const isTestJob = j => j?.is_test === true || isTestName(j?.employee_name) || isTestName(j?.client_name)
export const isTestSeller = s => s?.is_test === true || isTestName(s?.full_name) || emailTest(s?.email)
export const isTestClientUser = u => u?.is_test === true || isTestName(u?.client_name) || isTestName(u?.contact_name) || isTestName(u?.location_name) || emailTest(u?.email)
export const isTestInvoice = f => isTestName(f?.client_name)

const KEY = 'kp_hide_tests'
export const HIDE_TESTS_CHANGED = 'kp-hide-tests-changed'

export function hideTests() {
  try { return localStorage.getItem(KEY) !== '0' } catch { return true }
}
export function setHideTests(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* private mode */ }
  try { window.dispatchEvent(new Event(HIDE_TESTS_CHANGED)) } catch { /* SSR */ }
}
