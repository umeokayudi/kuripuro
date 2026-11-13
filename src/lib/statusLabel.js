// v1.0.224 · One place for the words on status tags. Several admin pages printed the raw
// database value ("paid", "sent", "overdue"…) even with the panel in Portuguese or Japanese.
// Only the text shown changes: the value saved in the database stays the same.
const LABELS = {
  draft: ['Draft', '下書き', 'Rascunho'],
  sent: ['Sent', '送付済', 'Enviada'],
  pending: ['Pending', '保留中', 'Pendente'],
  paid: ['Paid', '入金済', 'Paga'],
  overdue: ['Overdue', '期限超過', 'Vencida'],
  cancelled: ['Cancelled', '取消', 'Cancelada'],
  completed: ['Completed', '完了', 'Concluído'],
  in_progress: ['In progress', '作業中', 'Em andamento'],
  scheduled: ['Scheduled', '予定', 'Agendado'],
  open: ['Open', '未対応', 'Aberto'],
  new: ['New', '新規', 'Novo'],
  resolved: ['Resolved', '解決済', 'Resolvido'],
  rejected: ['Rejected', '却下', 'Recusado'],
  approved: ['Approved', '承認済', 'Aprovado'],
  fulfilled: ['Delivered', '対応済', 'Entregue'],
  reviewing: ['Reviewing', '確認中', 'Em análise'],
  accepted: ['Accepted', '承諾', 'Aceito'],
  declined: ['Declined', '辞退', 'Recusado'],
  active: ['Active', '有効', 'Ativo'],
  inactive: ['Inactive', '無効', 'Inativo'],
}

/** Readable status in the panel language; unknown values are shown as they are. */
export function statusLabel(status, lang) {
  const row = LABELS[String(status || '').toLowerCase()]
  if (!row) return status || '—'
  return lang === 'ja' ? row[1] : lang === 'pt' ? row[2] : row[0]
}

/** ISO date (2026-11-01) as a short date in the panel language; anything else is returned as is. */
export function shortDate(iso, lang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!m) return iso || '—'
  if (lang === 'ja') return `${m[1]}/${m[2]}/${m[3]}`
  return `${m[3]}/${m[2]}/${m[1]}`
}
