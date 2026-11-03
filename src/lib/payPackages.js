// v1.0.148 · Monthly package ("pacote mensal") paid apart from the per-job sum — e.g. Guilherme's
// Atomic Bar package ¥35.000/mês. Stored on employees.pay_packages (jsonb list, SQL
// sql/2026-11-03_pacote_e_migracao_pagamento.sql):
//   [{ client_name: 'Atomic Bar', client_id?: uuid, amount: 35000, from: '2026-11', to?: 'YYYY-MM' }]
// The package's jobs have no pay of their own: they are "no pacote", never "a definir" and never ¥0.
const norm = s => String(s || '').toLowerCase().normalize('NFKC').replace(/\s+/g, '')

export function packagesOf(emp) {
  let list = emp?.pay_packages
  if (typeof list === 'string') { try { list = JSON.parse(list) } catch { list = [] } }
  return Array.isArray(list) ? list.filter(p => p && Number(p.amount) > 0 && (p.client_name || p.client_id)) : []
}

/** Packages that count in month YYYY-MM. */
export const activePackages = (emp, month) => packagesOf(emp).filter(p => (!p.from || p.from <= month) && (!p.to || p.to >= month))

/** Is this job covered by one of the packages (same client)? Returns the package or null. */
export function packageOfJob(job, packages = []) {
  return packages.find(p => (p.client_id && p.client_id === job?.client_id) || (p.client_name && norm(p.client_name) === norm(job?.client_name))) || null
}

export const packagesTotal = list => (list || []).reduce((s, p) => s + Math.round(Number(p.amount) || 0), 0)
