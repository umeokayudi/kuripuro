/** Tables the admin AI may read and write. Passwords/hashes are stripped in results. */

export const ADMIN_AI_TABLES = [
  'employees',
  'employee_contracts',
  'jobs',
  'locations',
  'checkins',
  'clients',
  'client_users',
  'client_messages',
  'client_complaints',
  'client_compliments',
  'client_ratings',
  'client_requests',
  'service_contracts',
  'service_reports',
  'evaluations',
  'complaints',
  'messages',
  'badges',
  'salary_payments',
  'payroll',
  'salary_periods',
  'salary_statements',
  'salary_complaints',
  'transport_claims',
  'equipment_requests',
  'cashflow',
  'ryoshu',
  'faturas',
  'fatura_items',
  'sales_leads',
  'mitsumori',
  'mitsumori_items',
  'sales_touchpoints',
  'salespeople',
  'sales_day_reports',
  'sales_field_approaches',
]

export const HIDDEN_AI_FIELDS = ['password', 'password_hash', 'pin', 'secret']

export function scrubAiRow(value) {
  if (Array.isArray(value)) return value.map(scrubAiRow)
  if (!value || typeof value !== 'object') return value
  const out = { ...value }
  for (const key of HIDDEN_AI_FIELDS) delete out[key]
  return out
}

export const ADMIN_AI_TABLE_GUIDE = `employees (staff: name, pay, score, active), employee_contracts (PDF contracts),
jobs (schedule, status assigned/in_progress/completed/cancelled, photos, times), locations,
checkins (in/out), clients (operations clients), client_users (store logins — never output passwords),
client_messages, client_complaints, client_compliments, client_ratings, client_requests,
service_contracts (monthly/visit prices, training), service_reports,
evaluations, complaints (staff), messages (admin↔employee), badges,
salary_payments (MONEY MOVEMENT only: payment_type advance | salary | deduction | bonus | transport; status scheduled|paid),
payroll (CLOSE SHEET only: hours, base, deductions, net_total; status pending=closed unpaid, paid=salary already paid). Close ≠ payment.
salary_periods/salary_statements may be missing — use payroll + salary_payments.
transport_claims, equipment_requests,
cashflow, ryoshu (receipts), faturas + fatura_items (invoices),
sales_leads (approaches/follow-up; interest is INTERNAL; site_name is restaurant/store), mitsumori + mitsumori_items (quotes),
sales_touchpoints (replies and what was said),
salespeople (field sellers; never output password_hash), sales_day_reports (hours + written day report),
sales_field_approaches (places approached; meishi photo required).`
