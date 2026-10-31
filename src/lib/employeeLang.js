// Which employees use the portal in Portuguese. The admin sets it per person
// (Employees → card → "Portal language"); it lives in employees.speaks_portuguese.
// Portuguese speakers always see the portal in PT with no language switcher;
// everyone else chooses between English and Japanese only.
import { supabase } from './supabase'

// Used until the speaks_portuguese column exists (sql/2026-10-31_idioma_funcionario.sql),
// and as the seed of that column. employees.id, the same stable id the themes use.
export const PT_FALLBACK_EMPLOYEES = [
  '4c064fb5-e39d-4086-a798-f6e670730bac', // Alexandre
  'b62cc1a1-9750-4dbd-8f03-8a4c4aa4d86c', // Gabriel
  '8772f25f-7bd2-460d-8818-ad3bad3ab541', // Guilherme
  '3a39b220-9984-41e4-ab61-4cf96b93a99f', // Letícia
]

/** Has the column been created? (select('*') rows carry the key once it exists.) */
export const hasPtColumn = (emp) => !!emp && Object.prototype.hasOwnProperty.call(emp, 'speaks_portuguese')

/** For an employees row: the stored choice, or the fallback list before the SQL is applied. */
export const speaksPt = (emp) => (hasPtColumn(emp) ? emp.speaks_portuguese === true : PT_FALLBACK_EMPLOYEES.includes(emp?.id))

/** Reads the choice for one employee: true / false, or null when the column is not there yet. */
export async function fetchSpeaksPt(id) {
  if (!id) return null
  try {
    const { data, error } = await supabase.from('employees').select('speaks_portuguese').eq('id', id).maybeSingle()
    if (error || !data) return null
    return data.speaks_portuguese === true
  } catch { return null }
}

/** Language for messages written to an employee by the system ('pt' or 'en'). */
export async function employeeMessageLang(id) {
  const stored = await fetchSpeaksPt(id)
  return (stored ?? PT_FALLBACK_EMPLOYEES.includes(id)) ? 'pt' : 'en'
}

/** Admin: saves the choice. missingColumn = the SQL has not been applied yet. */
export async function saveSpeaksPt(id, value) {
  const { error } = await supabase.from('employees').update({ speaks_portuguese: !!value }).eq('id', id)
  if (!error) return { ok: true }
  const missingColumn = error.code === '42703' || error.code === 'PGRST204' || /speaks_portuguese/.test(error.message || '')
  return { ok: false, missingColumn, error }
}
