// v1.0.110 · Labels + resolving action of each exception kind — shared by the bell and the Dashboard,
// so the same exception reads (and resolves) the same everywhere. L = (en, ja, pt) => string.
export function exceptionInfo(L) {
  return {
    late: { icon: '⏰', title: x => L(`Late: not started (${x.minutes} min)`, `遅れ: 未開始（${x.minutes}分）`, `Atrasado: não iniciado (${x.minutes} min)`), action: L('Open Live Track', 'ライブ追跡', 'Abrir Live Track'), to: () => '/live' },
    problem: { icon: '🛠', title: x => L(`Problem reported: ${x.text || '—'}`, `問題の報告: ${x.text || '—'}`, `Problema reportado: ${x.text || '—'}`), action: L('Answer', '回答', 'Responder'), to: x => `/adminchat?employee=${x.employeeId}` },
    no_person: { icon: '⚠️', title: () => L('No person assigned', '担当なし', 'Sem pessoa'), action: L('Assign', '割当', 'Atribuir'), to: () => '/schedule' },
    incomplete: { icon: '🚫', title: () => L('Incomplete — never started', '未完了 — 未開始のまま', 'Incompleto — nunca iniciado'), action: L('Close or reschedule', '終了・再予定', 'Fechar ou reagendar'), to: x => `/jobs?search=${x.jobId}` },
    disputed: { icon: '💬', title: x => L(`Payslip disputed (${x.period})`, `明細に異議（${x.period}）`, `Holerite contestado (${x.period})`), action: L('Answer', '回答', 'Responder'), to: () => '/salary-complaints' },
    paid_unconfirmed: { icon: '💴', title: x => L(`Paid without confirmation (${x.period})`, `確認なしで支払済（${x.period}）`, `Pago sem confirmação (${x.period})`), action: L('Check', '確認', 'Conferir'), to: () => '/payments' },
    payroll_review: { icon: '💴', title: x => L(`Payroll ${x.period} closed automatically`, `${x.period} 自動締め`, `Folha ${x.period} fechada automaticamente`), action: L('Review', '確認', 'Revisar'), to: x => `/salary-periods?period=${x.period}` },
    long: { icon: '⏱', title: x => L(`Took ${x.minutes} min (planned ${x.expected})`, `${x.minutes}分（予定${x.expected}分）`, `Levou ${x.minutes} min (previsto ${x.expected})`), action: L('Review', '確認', 'Revisar'), to: x => `/jobs?search=${x.jobId}` },
    no_photo: { icon: '📷', title: () => L('Done without the final photo', '完了写真なし', 'Concluído sem foto final'), action: L('Open job', '作業を開く', 'Abrir job'), to: x => `/jobs?search=${x.jobId}` },
    ai_waiting: { icon: '🤖', title: () => L('Photo waiting for the AI check', 'AI確認待ちの写真', 'Foto aguardando a IA'), action: L('Open job', '作業を開く', 'Abrir job'), to: x => `/jobs?search=${x.jobId}` },
  }
}

/** v1.0.115 · "Resp.: Escritório · prazo 31/10" (+ "vencido") for exceptions that carry a deadline, else '' */
export function exceptionDeadline(x, L) {
  if (!x?.due) return ''
  const owner = x.owner === 'office' ? L('Office', '事務所', 'Escritório') : x.owner
  const d = x.due.slice(8, 10) + '/' + x.due.slice(5, 7)
  return `${L('Owner', '担当', 'Resp.')}: ${owner} · ${x.overdue ? L(`overdue since ${d}`, `${d}期限切れ`, `vencido em ${d}`) : L(`due ${d}`, `期限 ${d}`, `prazo ${d}`)}`
}
